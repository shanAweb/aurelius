"""
Transcription — whisper.cpp wrapper
Runs locally with bundled whisper.cpp binary and model weights.
No API key required.
"""

import asyncio
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger("aurelius.transcription")

# Paths — resolved relative to bundled app resources
RESOURCES_DIR = Path(os.environ.get("AURELIUS_RESOURCES", Path(__file__).parent.parent.parent / "resources"))
WHISPER_BIN = RESOURCES_DIR / "bin" / "whisper-cpp"
MODELS_DIR = RESOURCES_DIR / "models"
DEFAULT_MODEL = "ggml-base.en.bin"  # ~74MB — good balance of speed/quality
LARGE_MODEL = "ggml-large-v3.bin"   # ~1.5GB — highest quality


class TranscriptionSegment:
    def __init__(self, start: float, end: float, text: str, speaker: Optional[str] = None):
        self.start = start   # seconds
        self.end = end
        self.text = text.strip()
        self.speaker = speaker

    def to_dict(self) -> dict:
        return {
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "speaker": self.speaker,
        }


class WhisperTranscriber:
    """
    Wraps whisper.cpp binary for local transcription.
    Falls back to faster-whisper Python library if binary not found.
    """

    def __init__(self, model_size: str = "base"):
        self.model_size = model_size
        self._faster_whisper_model = None
        self._use_python_fallback = not WHISPER_BIN.exists()

        if self._use_python_fallback:
            logger.info("whisper.cpp binary not found — using faster-whisper Python library")
            self._init_faster_whisper()
        else:
            logger.info(f"Using whisper.cpp binary at {WHISPER_BIN}")

    def _init_faster_whisper(self):
        try:
            from faster_whisper import WhisperModel
            model_name = {
                "tiny": "tiny.en",
                "base": "base.en",
                "small": "small.en",
                "medium": "medium.en",
                "large": "large-v3",
            }.get(self.model_size, "base.en")

            model_dir = MODELS_DIR / "faster-whisper" / model_name
            self._faster_whisper_model = WhisperModel(
                str(model_dir) if model_dir.exists() else model_name,
                device="auto",       # uses Apple Silicon MPS when available
                compute_type="auto",
            )
            logger.info(f"Loaded faster-whisper model: {model_name}")
        except ImportError:
            logger.error("faster-whisper not installed — transcription unavailable")

    async def transcribe_file(self, audio_path: str) -> list[TranscriptionSegment]:
        """Transcribe a complete audio file. Returns list of timestamped segments."""
        if self._use_python_fallback:
            return await self._transcribe_python(audio_path)
        else:
            return await self._transcribe_cpp(audio_path)

    async def transcribe_chunk(self, chunk_path: str, chunk_index: int) -> list[TranscriptionSegment]:
        """Transcribe a single audio chunk (for streaming). Offsets timestamps by chunk position."""
        segments = await self.transcribe_file(chunk_path)
        offset = chunk_index * 30.0  # CHUNK_DURATION seconds
        for seg in segments:
            seg.start += offset
            seg.end += offset
        return segments

    async def _transcribe_cpp(self, audio_path: str) -> list[TranscriptionSegment]:
        model_path = MODELS_DIR / DEFAULT_MODEL
        if not model_path.exists():
            model_path = MODELS_DIR / LARGE_MODEL
        if not model_path.exists():
            raise FileNotFoundError(f"No Whisper model found in {MODELS_DIR}")

        cmd = [
            str(WHISPER_BIN),
            "-m", str(model_path),
            "-f", audio_path,
            "--output-json",
            "--language", "en",
            "--threads", "4",
            "--print-progress", "false",
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            logger.error(f"whisper.cpp error: {stderr.decode()}")
            raise RuntimeError("Transcription failed")

        # Parse JSON output from whisper.cpp
        result = json.loads(stdout.decode())
        segments = []
        for seg in result.get("transcription", []):
            segments.append(TranscriptionSegment(
                start=seg["offsets"]["from"] / 1000.0,
                end=seg["offsets"]["to"] / 1000.0,
                text=seg["text"],
            ))
        return segments

    async def _transcribe_python(self, audio_path: str) -> list[TranscriptionSegment]:
        if not self._faster_whisper_model:
            raise RuntimeError("No transcription backend available")

        loop = asyncio.get_event_loop()

        def _run():
            segments_iter, info = self._faster_whisper_model.transcribe(
                audio_path,
                beam_size=5,
                language="en",
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
            )
            return list(segments_iter)

        raw_segments = await loop.run_in_executor(None, _run)

        return [
            TranscriptionSegment(
                start=seg.start,
                end=seg.end,
                text=seg.text,
            )
            for seg in raw_segments
        ]

    def is_available(self) -> bool:
        if not self._use_python_fallback:
            return WHISPER_BIN.exists()
        return self._faster_whisper_model is not None
