"""
Audio Capture — CoreAudio + BlackHole integration
Captures both microphone and system audio simultaneously on macOS
"""

import asyncio
import logging
import threading
import time
import wave
import tempfile
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable
import numpy as np

logger = logging.getLogger("aurelius.audio")

try:
    import sounddevice as sd
    SOUNDDEVICE_AVAILABLE = True
except ImportError:
    SOUNDDEVICE_AVAILABLE = False
    logger.warning("sounddevice not available")


SAMPLE_RATE = 16000       # Whisper works best at 16kHz
CHANNELS = 1              # Mono
CHUNK_DURATION = 30       # seconds per chunk for streaming transcription
DTYPE = np.float32

# Audio below this RMS (on the [-1, 1] float stream) counts as silence. Used to
# auto-detect that a meeting has ended ("voice totally gone").
SILENCE_RMS_THRESHOLD = 0.01


class AudioCaptureManager:
    """Manages audio input devices and capture sessions."""

    def __init__(self):
        self.active_session: Optional["AudioCaptureSession"] = None

    def get_devices(self) -> list[dict]:
        """Return all available audio input devices."""
        if not SOUNDDEVICE_AVAILABLE:
            return []
        devices = sd.query_devices()
        inputs = []
        for i, d in enumerate(devices):
            if d["max_input_channels"] > 0:
                inputs.append({
                    "id": i,
                    "name": d["name"],
                    "channels": d["max_input_channels"],
                    "is_blackhole": "blackhole" in d["name"].lower(),
                    "is_default": i == sd.default.device[0],
                })
        return inputs

    def find_blackhole_device(self) -> Optional[int]:
        for dev in self.get_devices():
            if dev["is_blackhole"]:
                return dev["id"]
        return None

    def start_session(
        self,
        meeting_id: str,
        output_dir: str,
        on_chunk: Optional[Callable] = None,
        use_blackhole: bool = True,
    ) -> "AudioCaptureSession":
        if self.active_session and self.active_session.is_recording:
            raise RuntimeError("A recording session is already active")

        blackhole_id = self.find_blackhole_device() if use_blackhole else None
        session = AudioCaptureSession(
            meeting_id=meeting_id,
            output_dir=output_dir,
            blackhole_device_id=blackhole_id,
            on_chunk_callback=on_chunk,
        )
        self.active_session = session
        return session

    def stop_session(self) -> Optional[str]:
        if self.active_session:
            path = self.active_session.stop()
            return path
        return None

    def cleanup(self):
        if self.active_session and self.active_session.is_recording:
            self.active_session.stop()


class AudioCaptureSession:
    """
    A single recording session.
    Merges mic + BlackHole (system audio) into one stream.
    """

    def __init__(
        self,
        meeting_id: str,
        output_dir: str,
        blackhole_device_id: Optional[int] = None,
        on_chunk_callback: Optional[Callable] = None,
    ):
        self.meeting_id = meeting_id
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.blackhole_device_id = blackhole_device_id
        self.on_chunk_callback = on_chunk_callback

        self.is_recording = False
        self._frames: list[np.ndarray] = []
        self._chunk_frames: list[np.ndarray] = []
        self._chunk_sample_count = 0
        self._chunk_index = 0
        self._stream: Optional[sd.InputStream] = None
        self._lock = threading.Lock()
        self._last_voice_ts: float = 0.0  # monotonic time of last above-threshold audio

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.output_path = self.output_dir / f"meeting_{meeting_id}_{timestamp}.wav"
        self.chunks_dir = self.output_dir / f"chunks_{meeting_id}"
        self.chunks_dir.mkdir(exist_ok=True)

    def start(self):
        if not SOUNDDEVICE_AVAILABLE:
            raise RuntimeError("sounddevice library not available")

        self.is_recording = True
        self._last_voice_ts = time.monotonic()
        device = self.blackhole_device_id  # None = default mic

        logger.info(
            f"Starting audio capture — device: {device or 'default mic'}, "
            f"output: {self.output_path}"
        )

        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            device=device,
            blocksize=int(SAMPLE_RATE * 0.1),  # 100ms blocks
            callback=self._audio_callback,
        )
        self._stream.start()

    def _audio_callback(self, indata: np.ndarray, frames: int, time, status):
        if status:
            logger.warning(f"Audio callback status: {status}")

        audio_copy = indata.copy().flatten()

        # Track voice activity for silence-based end-of-meeting detection.
        if audio_copy.size and float(np.sqrt(np.mean(audio_copy ** 2))) >= SILENCE_RMS_THRESHOLD:
            self._last_voice_ts = time.monotonic()

        with self._lock:
            self._frames.append(audio_copy)
            self._chunk_frames.append(audio_copy)
            self._chunk_sample_count += len(audio_copy)

            # Every CHUNK_DURATION seconds, emit a chunk for streaming transcription
            if self._chunk_sample_count >= SAMPLE_RATE * CHUNK_DURATION:
                chunk_audio = np.concatenate(self._chunk_frames)
                self._chunk_frames = []
                self._chunk_sample_count = 0
                chunk_idx = self._chunk_index
                self._chunk_index += 1

                if self.on_chunk_callback:
                    # Fire in a thread so we don't block the audio callback
                    threading.Thread(
                        target=self._emit_chunk,
                        args=(chunk_audio, chunk_idx),
                        daemon=True,
                    ).start()

    def seconds_since_voice(self) -> float:
        """Seconds since audio last exceeded the silence threshold (0 if not recording)."""
        if not self.is_recording or self._last_voice_ts == 0.0:
            return 0.0
        return time.monotonic() - self._last_voice_ts

    def _emit_chunk(self, audio: np.ndarray, chunk_idx: int):
        chunk_path = self.chunks_dir / f"chunk_{chunk_idx:04d}.wav"
        self._save_wav(audio, chunk_path)
        if self.on_chunk_callback:
            self.on_chunk_callback(str(chunk_path), chunk_idx)

    def stop(self) -> str:
        if not self.is_recording:
            return str(self.output_path)

        self.is_recording = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

        with self._lock:
            if self._frames:
                all_audio = np.concatenate(self._frames)
                self._save_wav(all_audio, self.output_path)
                logger.info(f"Saved full recording: {self.output_path}")

            # Flush remaining chunk
            if self._chunk_frames:
                remaining = np.concatenate(self._chunk_frames)
                self._emit_chunk(remaining, self._chunk_index)

        return str(self.output_path)

    def _save_wav(self, audio: np.ndarray, path: Path):
        audio_int16 = (audio * 32767).astype(np.int16)
        with wave.open(str(path), "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio_int16.tobytes())
