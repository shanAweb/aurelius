"""
Meeting detector — runs in the background and does two things:

1. Instant-meeting detection: watches the CoreAudio mic-in-use signal and, when
   the mic goes active while we're not already recording, offers to record
   (Granola/Fireflies style). The UI shows an "Invite Aurelius?" popup; nothing
   records until the user accepts.

2. Silence-based auto-stop: while a recording is active, ends it once audio has
   been silent for SILENCE_TIMEOUT seconds ("voice totally gone").
"""

import asyncio
import logging
import os

from detection.coreaudio import is_available, mic_in_use
from routes.events import broadcast_event
from routes.recording import end_recording

logger = logging.getLogger("aurelius.detection")

POLL_INTERVAL = float(os.environ.get("AURELIUS_DETECT_INTERVAL", "3"))      # seconds
REQUIRED_STREAK = 2                                                         # ~6s of mic use before offering
MIC_RELEASE_STREAK = 2                                                      # ~6s of mic idle → meeting over
SILENCE_TIMEOUT = float(os.environ.get("AURELIUS_SILENCE_TIMEOUT", "120"))  # silence fallback → auto-stop


class MeetingDetector:
    def __init__(self, app):
        self.app = app
        self._armed = True        # may we offer an instant meeting?
        self._offered = False     # already offered for the current mic session
        self._streak = 0          # consecutive mic-in-use polls (for offering)
        # Per-recording end-detection state:
        self._rec_id = None       # meeting_id of the recording we're tracking
        self._mic_seen = False    # has the mic been in use during this recording?
        self._idle_streak = 0     # consecutive mic-idle polls while recording

    async def watch_loop(self):
        if is_available():
            logger.info("Meeting detector started (instant detection + silence auto-stop)")
        else:
            logger.info("Meeting detector started (silence auto-stop only; CoreAudio unavailable)")
        while True:
            try:
                await self._tick()
            except Exception as e:
                logger.error(f"Meeting detector error: {e}")
            await asyncio.sleep(POLL_INTERVAL)

    async def _tick(self):
        session = self.app.state.audio_manager.active_session
        recording = session is not None and session.is_recording
        in_use = mic_in_use()  # True / False / None (undeterminable)

        if recording:
            # Don't offer instant meetings while capturing; disarm so we won't
            # re-offer the moment this recording ends (mic must go idle first).
            self._armed = False
            self._offered = False
            self._streak = 0

            # Reset end-detection state when a new recording begins.
            if session.meeting_id != self._rec_id:
                self._rec_id = session.meeting_id
                self._mic_seen = False
                self._idle_streak = 0

            if in_use is True:
                self._mic_seen = True
                self._idle_streak = 0
            elif in_use is False:
                self._idle_streak += 1

            # Mic released → the meeting app let go of the mic = meeting over.
            # Only trust this once the mic has actually been in use this session
            # (so a calendar auto-start doesn't stop before the user joins).
            mic_released = (
                self._mic_seen and in_use is False
                and self._idle_streak >= MIC_RELEASE_STREAK
            )
            if mic_released:
                logger.info(f"Auto-stopping {session.meeting_id}: mic released (meeting ended)")
                await end_recording(self.app, session.meeting_id, reason="mic_released")
            elif session.seconds_since_voice() >= SILENCE_TIMEOUT:
                logger.info(f"Auto-stopping {session.meeting_id}: silent >{SILENCE_TIMEOUT:.0f}s")
                await end_recording(self.app, session.meeting_id, reason="silence")
            return

        # Not recording.
        self._rec_id = None

        if in_use is None:
            return  # couldn't determine (non-macOS / no device)

        if not in_use:
            # Mic idle → re-arm for the next meeting.
            self._armed = True
            self._offered = False
            self._streak = 0
            return

        # Mic in use and we're not recording.
        self._streak += 1
        if self._armed and not self._offered and self._streak >= REQUIRED_STREAK:
            self._offered = True
            self._armed = False
            logger.info("Instant meeting detected (mic in use) — offering to record")
            await broadcast_event({"type": "instant_meeting_detected"})
