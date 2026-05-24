"""
Database — SQLite via aiosqlite
Stores meetings, transcripts, notes, and settings locally.
"""

import asyncio
import hashlib
import json
import logging
import os
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiosqlite

logger = logging.getLogger("aurelius.db")

DATA_DIR = Path(os.environ.get("AURELIUS_DATA", Path.home() / ".aurelius"))
DB_PATH = DATA_DIR / "aurelius.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',  -- 'calendar' | 'manual'
    calendar_event_id TEXT,
    started_at TEXT,
    ended_at TEXT,
    duration_seconds INTEGER,
    audio_path TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled|recording|processing|done|error
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    start_seconds REAL NOT NULL,
    end_seconds REAL NOT NULL,
    speaker TEXT,
    text TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL UNIQUE,
    meeting_summary TEXT,
    key_decisions TEXT,       -- JSON array
    action_items TEXT,        -- JSON array
    topics_discussed TEXT,    -- JSON array
    open_questions TEXT,      -- JSON array
    concerns_raised TEXT,     -- JSON array
    participants TEXT,        -- JSON array
    next_steps TEXT,
    sentiment TEXT,
    keywords TEXT,            -- JSON array
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT,                         -- null for Google-only accounts
    provider TEXT NOT NULL DEFAULT 'local',     -- 'local' | 'google'
    picture TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
"""


async def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        await db.commit()
    logger.info(f"Database initialized at {DB_PATH}")


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


# ─── Meeting CRUD ─────────────────────────────────────────────────────────────

async def create_meeting(meeting_id: str, title: str, source: str = "manual",
                          calendar_event_id: Optional[str] = None) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            "INSERT INTO meetings (id, title, source, calendar_event_id) VALUES (?, ?, ?, ?)",
            (meeting_id, title, source, calendar_event_id)
        )
        await db.commit()
        async with db.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)) as cur:
            row = await cur.fetchone()
            return dict(row)


async def update_meeting(meeting_id: str, **kwargs) -> Optional[dict]:
    allowed = {"title", "started_at", "ended_at", "duration_seconds",
                "audio_path", "status"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return None

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [meeting_id]

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(f"UPDATE meetings SET {set_clause} WHERE id = ?", values)
        await db.commit()
        async with db.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def get_meeting(meeting_id: str) -> Optional[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def list_meetings(limit: int = 50, offset: int = 0) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM meetings ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset)
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def delete_meeting(meeting_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
        await db.commit()


# ─── Transcript CRUD ──────────────────────────────────────────────────────────

async def save_transcript_segments(meeting_id: str, segments: list[dict]):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executemany(
            """INSERT INTO transcripts
               (meeting_id, segment_index, start_seconds, end_seconds, speaker, text)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (meeting_id, i, s["start"], s["end"], s.get("speaker"), s["text"])
                for i, s in enumerate(segments)
            ]
        )
        await db.commit()


async def get_transcript(meeting_id: str) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY segment_index",
            (meeting_id,)
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


# ─── Notes CRUD ───────────────────────────────────────────────────────────────

async def save_notes(meeting_id: str, notes: dict):
    json_fields = ["key_decisions", "action_items", "topics_discussed",
                    "open_questions", "concerns_raised", "participants", "keywords"]
    values = {k: json.dumps(notes.get(k, [])) if k in json_fields else notes.get(k, "")
              for k in ["meeting_summary", "key_decisions", "action_items", "topics_discussed",
                        "open_questions", "concerns_raised", "participants", "next_steps",
                        "sentiment", "keywords"]}

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO notes (meeting_id, meeting_summary, key_decisions, action_items,
                topics_discussed, open_questions, concerns_raised, participants,
                next_steps, sentiment, keywords)
            VALUES (:meeting_id, :meeting_summary, :key_decisions, :action_items,
                :topics_discussed, :open_questions, :concerns_raised, :participants,
                :next_steps, :sentiment, :keywords)
            ON CONFLICT(meeting_id) DO UPDATE SET
                meeting_summary = excluded.meeting_summary,
                key_decisions = excluded.key_decisions,
                action_items = excluded.action_items,
                topics_discussed = excluded.topics_discussed,
                open_questions = excluded.open_questions,
                concerns_raised = excluded.concerns_raised,
                participants = excluded.participants,
                next_steps = excluded.next_steps,
                sentiment = excluded.sentiment,
                keywords = excluded.keywords,
                generated_at = datetime('now')
        """, {"meeting_id": meeting_id, **values})
        await db.commit()


async def get_notes(meeting_id: str) -> Optional[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM notes WHERE meeting_id = ?", (meeting_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            result = dict(row)
            for field in ["key_decisions", "action_items", "topics_discussed",
                          "open_questions", "concerns_raised", "participants", "keywords"]:
                try:
                    result[field] = json.loads(result[field] or "[]")
                except Exception:
                    result[field] = []
            return result


# ─── Settings (key/value) ─────────────────────────────────────────────────────

async def set_setting(key: str, value: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO settings (key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                              updated_at = datetime('now')""",
            (key, value),
        )
        await db.commit()


async def get_setting(key: str) -> Optional[str]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM settings WHERE key = ?", (key,)) as cur:
            row = await cur.fetchone()
            return row[0] if row else None


async def delete_setting(key: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM settings WHERE key = ?", (key,))
        await db.commit()


# ─── Password hashing (PBKDF2, stdlib only) ───────────────────────────────────

_PBKDF2_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return secrets.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ─── User CRUD ────────────────────────────────────────────────────────────────

async def create_user(email: str, name: Optional[str], password_hash: Optional[str] = None,
                       provider: str = "local", picture: Optional[str] = None) -> dict:
    user_id = uuid.uuid4().hex
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """INSERT INTO users (id, email, name, password_hash, provider, picture, last_login_at)
               VALUES (?, ?, ?, ?, ?, ?, datetime('now'))""",
            (user_id, email.lower(), name, password_hash, provider, picture),
        )
        await db.commit()
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            return dict(await cur.fetchone())


async def get_user_by_email(email: str) -> Optional[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def get_user_by_id(user_id: str) -> Optional[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def touch_last_login(user_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", (user_id,))
        await db.commit()


async def upsert_google_user(email: str, name: Optional[str], picture: Optional[str]) -> dict:
    """Create a Google-backed user, or update an existing account's profile + login time."""
    existing = await get_user_by_email(email)
    if existing:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                """UPDATE users SET name = COALESCE(?, name),
                                    picture = COALESCE(?, picture),
                                    last_login_at = datetime('now')
                   WHERE id = ?""",
                (name, picture, existing["id"]),
            )
            await db.commit()
            async with db.execute("SELECT * FROM users WHERE id = ?", (existing["id"],)) as cur:
                return dict(await cur.fetchone())
    return await create_user(email=email, name=name, password_hash=None,
                             provider="google", picture=picture)
