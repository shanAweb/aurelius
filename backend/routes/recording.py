"""
Recording Routes — start/stop recording, stream transcript in real-time
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel

from audio.capture import AudioCaptureSession
from transcription.whisper_transcriber import WhisperTranscriber
from diarization.speaker_diarizer import SpeakerDiarizer
from notes.generator import NotesGenerator
from db.database import (
    create_meeting, update_meeting, save_transcript_segments,
    save_notes, get_meeting, get_transcript
)

router = APIRouter()
logger = logging.getLogger("aurelius.routes.recording")

# Module-level singletons (initialized once)
_transcriber: Optional[WhisperTranscriber] = None
_diarizer: Optional[SpeakerDiarizer] = None
_notes_gen: Optional[NotesGenerator] = None

# Active WebSocket connections (for streaming transcript updates)
_ws_connections: dict[str, list[WebSocket]] = {}


def get_transcriber() -> WhisperTranscriber:
    global _transcriber
    if _transcriber is None:
        _transcriber = WhisperTranscriber(model_size="base")
    return _transcriber


def get_diarizer() -> SpeakerDiarizer:
    global _diarizer
    if _diarizer is None:
        _diarizer = SpeakerDiarizer()
    return _diarizer


def get_notes_gen() -> NotesGenerator:
    global _notes_gen
    if _notes_gen is None:
        _notes_gen = NotesGenerator()
    return _notes_gen


# ─── Models ───────────────────────────────────────────────────────────────────

class StartRecordingRequest(BaseModel):
    title: str = "Manual Recording"
    calendar_event_id: Optional[str] = None
    use_blackhole: bool = True


class StopRecordingResponse(BaseModel):
    meeting_id: str
    audio_path: str
    duration_seconds: float
    status: str


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/start")
async def start_recording(req: StartRecordingRequest, request: Request):
    audio_manager = request.app.state.audio_manager
    meeting_id = str(uuid.uuid4())[:8]

    # Create meeting in DB
    await create_meeting(
        meeting_id=meeting_id,
        title=req.title,
        source="calendar" if req.calendar_event_id else "manual",
        calendar_event_id=req.calendar_event_id,
    )

    data_dir = str(request.app.state.__dict__.get("data_dir", "/tmp/aurelius"))

    async def on_chunk(chunk_path: str, chunk_index: int):
        """Called every 30s with a new audio chunk — transcribe it live."""
        try:
            transcriber = get_transcriber()
            segments = await transcriber.transcribe_chunk(chunk_path, chunk_index)
            seg_dicts = [s.to_dict() for s in segments]

            # Broadcast to any connected WebSocket clients
            if meeting_id in _ws_connections:
                for ws in _ws_connections[meeting_id]:
                    try:
                        await ws.send_json({
                            "type": "transcript_chunk",
                            "meeting_id": meeting_id,
                            "segments": seg_dicts,
                            "chunk_index": chunk_index,
                        })
                    except Exception:
                        pass
        except Exception as e:
            logger.error(f"Chunk transcription error: {e}")

    session = audio_manager.start_session(
        meeting_id=meeting_id,
        output_dir=f"{data_dir}/recordings",
        on_chunk=on_chunk,
        use_blackhole=req.use_blackhole,
    )
    session.start()

    await update_meeting(meeting_id, status="recording", started_at=datetime.now(timezone.utc).isoformat())

    logger.info(f"Recording started: {meeting_id} — '{req.title}'")
    return {"meeting_id": meeting_id, "status": "recording", "title": req.title}


@router.post("/stop/{meeting_id}")
async def stop_recording(meeting_id: str, request: Request):
    audio_manager = request.app.state.audio_manager
    session = audio_manager.active_session

    if not session or session.meeting_id != meeting_id:
        raise HTTPException(status_code=404, detail="No active recording for this meeting")

    started_at_str = (await get_meeting(meeting_id) or {}).get("started_at")
    audio_path = audio_manager.stop_session()

    # Calculate duration
    duration = 0.0
    if started_at_str:
        started = datetime.fromisoformat(started_at_str)
        duration = (datetime.now(timezone.utc) - started).total_seconds()

    await update_meeting(
        meeting_id,
        status="processing",
        ended_at=datetime.now(timezone.utc).isoformat(),
        duration_seconds=int(duration),
        audio_path=audio_path,
    )

    # Kick off post-processing in background
    asyncio.create_task(_process_meeting(meeting_id, audio_path, request))

    logger.info(f"Recording stopped: {meeting_id} — {duration:.0f}s")
    return {"meeting_id": meeting_id, "status": "processing", "duration_seconds": duration}


async def _process_meeting(meeting_id: str, audio_path: str, request: Request):
    """Full post-processing pipeline: transcription → diarization → notes."""
    logger.info(f"Processing meeting {meeting_id}...")

    try:
        # 1. Full transcription
        transcriber = get_transcriber()
        segments = await transcriber.transcribe_file(audio_path)
        logger.info(f"Transcription done: {len(segments)} segments")

        # 2. Speaker diarization
        diarizer = get_diarizer()
        speaker_segments = await diarizer.diarize(audio_path)
        segments = diarizer.assign_speakers_to_transcript(segments, speaker_segments)
        logger.info(f"Diarization done: found {len(set(s.speaker for s in segments))} speakers")

        # 3. Save full transcript
        seg_dicts = [s.to_dict() for s in segments]
        await save_transcript_segments(meeting_id, seg_dicts)

        # Notify frontend — transcript ready
        if meeting_id in _ws_connections:
            for ws in _ws_connections[meeting_id]:
                try:
                    await ws.send_json({"type": "transcript_complete", "meeting_id": meeting_id})
                except Exception:
                    pass

        # 4. Generate notes
        notes_gen = get_notes_gen()
        notes = await notes_gen.generate_notes(seg_dicts)
        await save_notes(meeting_id, notes)
        logger.info(f"Notes generated for meeting {meeting_id}")

        await update_meeting(meeting_id, status="done")

        # Notify frontend — notes ready
        if meeting_id in _ws_connections:
            for ws in _ws_connections[meeting_id]:
                try:
                    await ws.send_json({
                        "type": "notes_complete",
                        "meeting_id": meeting_id,
                        "notes": notes,
                    })
                except Exception:
                    pass

    except Exception as e:
        logger.error(f"Processing failed for meeting {meeting_id}: {e}")
        await update_meeting(meeting_id, status="error")


@router.get("/status/{meeting_id}")
async def get_recording_status(meeting_id: str, request: Request):
    meeting = await get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    active = request.app.state.audio_manager.active_session
    is_live = active is not None and active.meeting_id == meeting_id and active.is_recording

    return {**meeting, "is_live": is_live}


@router.websocket("/ws/{meeting_id}")
async def transcript_websocket(websocket: WebSocket, meeting_id: str):
    """WebSocket for real-time transcript streaming during recording."""
    await websocket.accept()

    if meeting_id not in _ws_connections:
        _ws_connections[meeting_id] = []
    _ws_connections[meeting_id].append(websocket)

    try:
        while True:
            # Keep connection alive; we push data from the recording thread
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
    finally:
        if meeting_id in _ws_connections:
            _ws_connections[meeting_id] = [
                ws for ws in _ws_connections[meeting_id] if ws != websocket
            ]
