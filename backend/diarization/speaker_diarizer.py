"""
Speaker Diarization — pyannote.audio
Labels each transcription segment with a speaker ID (Speaker A, Speaker B, etc.)
Runs fully locally, no API key needed.
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger("aurelius.diarization")

RESOURCES_DIR = Path(os.environ.get("AURELIUS_RESOURCES", Path(__file__).parent.parent.parent / "resources"))
DIARIZATION_MODEL_DIR = RESOURCES_DIR / "models" / "pyannote"


class SpeakerSegment:
    def __init__(self, start: float, end: float, speaker: str):
        self.start = start
        self.end = end
        self.speaker = speaker  # e.g. "SPEAKER_00", "SPEAKER_01"


class SpeakerDiarizer:
    """
    Identifies who spoke when in an audio file.
    Maps pyannote speaker labels to human-readable names (Speaker A, B, C...).
    """

    SPEAKER_NAMES = [
        "Speaker A", "Speaker B", "Speaker C", "Speaker D",
        "Speaker E", "Speaker F", "Speaker G", "Speaker H",
    ]

    def __init__(self):
        self._pipeline = None
        self._available = False
        self._init_pipeline()

    def _init_pipeline(self):
        try:
            from pyannote.audio import Pipeline
            import torch

            model_path = DIARIZATION_MODEL_DIR / "speaker-diarization-3.1"

            if model_path.exists():
                self._pipeline = Pipeline.from_pretrained(str(model_path))
            else:
                # Will download on first use — we cache to resources/models/pyannote
                logger.info("Diarization model not found locally — will download on first use")
                self._pipeline = Pipeline.from_pretrained(
                    "pyannote/speaker-diarization-3.1",
                    cache_dir=str(DIARIZATION_MODEL_DIR),
                )

            # Use Apple Silicon MPS if available
            if torch.backends.mps.is_available():
                self._pipeline = self._pipeline.to(torch.device("mps"))
                logger.info("Diarization using Apple Silicon MPS")
            elif torch.cuda.is_available():
                self._pipeline = self._pipeline.to(torch.device("cuda"))

            self._available = True
            logger.info("Speaker diarization pipeline ready")

        except ImportError:
            logger.warning("pyannote.audio not installed — speaker diarization disabled")
        except Exception as e:
            logger.warning(f"Diarization init failed: {e} — continuing without speaker labels")

    async def diarize(self, audio_path: str) -> list[SpeakerSegment]:
        """Run diarization on a full audio file. Returns speaker segments with timestamps."""
        if not self._available or not self._pipeline:
            logger.warning("Diarization unavailable — returning empty speaker list")
            return []

        loop = asyncio.get_event_loop()

        def _run():
            diarization = self._pipeline(audio_path)
            segments = []
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                segments.append(SpeakerSegment(
                    start=turn.start,
                    end=turn.end,
                    speaker=speaker,
                ))
            return segments

        try:
            return await loop.run_in_executor(None, _run)
        except Exception as e:
            logger.error(f"Diarization failed: {e}")
            return []

    def assign_speakers_to_transcript(
        self,
        transcript_segments: list,
        speaker_segments: list[SpeakerSegment],
    ) -> list:
        """
        Merges diarization results into transcript segments.
        Each transcript segment gets labelled with the dominant speaker.
        """
        if not speaker_segments:
            # No diarization — assign everyone as "Speaker A"
            for seg in transcript_segments:
                seg.speaker = "Speaker A"
            return transcript_segments

        # Build speaker name mapping (SPEAKER_00 → Speaker A, etc.)
        unique_speakers = list(dict.fromkeys(s.speaker for s in speaker_segments))
        speaker_map = {
            raw: self.SPEAKER_NAMES[i] if i < len(self.SPEAKER_NAMES) else f"Speaker {i+1}"
            for i, raw in enumerate(unique_speakers)
        }

        for t_seg in transcript_segments:
            # Find dominant speaker during this transcript segment
            overlap_counts: dict[str, float] = {}
            for d_seg in speaker_segments:
                overlap_start = max(t_seg.start, d_seg.start)
                overlap_end = min(t_seg.end, d_seg.end)
                overlap = overlap_end - overlap_start
                if overlap > 0:
                    name = speaker_map[d_seg.speaker]
                    overlap_counts[name] = overlap_counts.get(name, 0) + overlap

            if overlap_counts:
                t_seg.speaker = max(overlap_counts, key=overlap_counts.get)
            else:
                t_seg.speaker = "Speaker A"

        return transcript_segments

    @property
    def is_available(self) -> bool:
        return self._available
