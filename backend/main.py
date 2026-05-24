"""
Aurelius Backend — FastAPI server
Handles: audio capture, transcription, diarization, summarization, calendar
"""

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env first, so modules that read env vars at import time
# (e.g. Google OAuth client id/secret, AURELIUS_DATA) see the values.
load_dotenv(Path(__file__).resolve().parent / ".env")

import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from audio.capture import AudioCaptureManager  # noqa: E402
from calendar_sync.google_calendar import CalendarSync
from db.database import init_db
from routes import meetings, recording, calendar, setup, health, auth

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("aurelius")

# ─── App Lifespan ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Aurelius backend starting up...")
    await init_db()

    # Start calendar sync background task
    calendar_sync = CalendarSync()
    sync_task = asyncio.create_task(calendar_sync.watch_loop())
    app.state.calendar_sync = calendar_sync
    app.state.audio_manager = AudioCaptureManager()

    logger.info("Aurelius backend ready on port 8765")
    yield

    # Cleanup
    sync_task.cancel()
    app.state.audio_manager.cleanup()
    logger.info("Aurelius backend shut down cleanly")


# ─── App Init ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Aurelius Backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "app://.", "file://"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(health.router)
app.include_router(auth.router, prefix="/auth")
app.include_router(meetings.router, prefix="/meetings")
app.include_router(recording.router, prefix="/recording")
app.include_router(calendar.router, prefix="/calendar")
app.include_router(setup.router, prefix="/setup")


if __name__ == "__main__":
    port = int(os.environ.get("AURELIUS_PORT", 8765))
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=port,
        log_level="info",
        reload=False,
    )
