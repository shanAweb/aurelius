"""
Google Calendar Integration
OAuth2 login + background sync to detect upcoming meetings.
"""

import asyncio
import json
import logging
import os
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, parse_qs

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = logging.getLogger("aurelius.calendar")

# OAuth runs against a loopback (http://localhost) redirect and requests both
# identity and calendar scopes. Relax oauthlib's https-only and exact-scope
# checks, which otherwise reject loopback redirects and Google's scope echo.
os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

# Identity scopes let "Continue with Google" double as sign-in; the calendar
# scope is granted in the same consent, so the account is synced automatically.
SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/calendar.readonly",
]
REDIRECT_PORT = 8766
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/oauth/callback"

DATA_DIR = Path(os.environ.get("AURELIUS_DATA", Path.home() / ".aurelius"))
TOKEN_FILE = DATA_DIR / "google_token.json"
CREDENTIALS_FILE = DATA_DIR / "google_credentials.json"

# Built-in OAuth client (for open-source distribution)
# Users can also supply their own in DATA_DIR
BUNDLED_CLIENT_ID = os.environ.get("AURELIUS_GOOGLE_CLIENT_ID", "")
BUNDLED_CLIENT_SECRET = os.environ.get("AURELIUS_GOOGLE_CLIENT_SECRET", "")


class CalendarEvent:
    def __init__(self, raw: dict):
        self.id = raw.get("id", "")
        self.title = raw.get("summary", "Untitled Meeting")
        self.description = raw.get("description", "")
        self.location = raw.get("location", "")
        self.start = self._parse_time(raw.get("start", {}))
        self.end = self._parse_time(raw.get("end", {}))
        self.attendees = [a.get("email", "") for a in raw.get("attendees", [])]
        self.meet_link = self._extract_meet_link(raw)
        self.raw = raw

    def _parse_time(self, t: dict) -> Optional[datetime]:
        if "dateTime" in t:
            return datetime.fromisoformat(t["dateTime"].replace("Z", "+00:00"))
        if "date" in t:
            return datetime.fromisoformat(t["date"]).replace(tzinfo=timezone.utc)
        return None

    def _extract_meet_link(self, raw: dict) -> Optional[str]:
        for entry in raw.get("conferenceData", {}).get("entryPoints", []):
            if entry.get("entryPointType") == "video":
                return entry.get("uri")
        desc = raw.get("description", "")
        if "meet.google.com" in desc:
            for word in desc.split():
                if "meet.google.com" in word:
                    return word.strip()
        return None

    def starts_in_minutes(self) -> Optional[float]:
        if not self.start:
            return None
        now = datetime.now(timezone.utc)
        delta = (self.start - now).total_seconds() / 60
        return delta

    def is_happening_now(self) -> bool:
        now = datetime.now(timezone.utc)
        if not self.start or not self.end:
            return False
        return self.start <= now <= self.end

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "location": self.location,
            "start": self.start.isoformat() if self.start else None,
            "end": self.end.isoformat() if self.end else None,
            "attendees": self.attendees,
            "meet_link": self.meet_link,
            "starts_in_minutes": self.starts_in_minutes(),
            "is_happening_now": self.is_happening_now(),
        }


class CalendarSync:
    """
    Syncs Google Calendar and watches for upcoming meetings.
    Emits events when a meeting is about to start (2 min warning).
    """

    POLL_INTERVAL = 60  # seconds between checks
    ALERT_MINUTES = 2   # alert this many minutes before meeting starts

    def __init__(self):
        self._service = None
        self._creds: Optional[Credentials] = None
        self._upcoming: list[CalendarEvent] = []
        self._alerted_ids: set[str] = set()
        self._on_meeting_starting: list = []  # callbacks
        self._load_credentials()

    def _load_credentials(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if TOKEN_FILE.exists():
            try:
                self._creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
                if self._creds and self._creds.expired and self._creds.refresh_token:
                    self._creds.refresh(Request())
                    self._save_token()
                if self._creds and self._creds.valid:
                    self._build_service()
                    logger.info("Google Calendar credentials loaded")
            except Exception as e:
                logger.warning(f"Failed to load saved credentials: {e}")

    def reload_credentials(self):
        """Re-read the saved token (e.g. after the auth flow wrote a new one)."""
        self._creds = None
        self._service = None
        self._load_credentials()

    def _save_token(self):
        if self._creds:
            TOKEN_FILE.write_text(self._creds.to_json())

    def _build_service(self):
        self._service = build("calendar", "v3", credentials=self._creds, cache_discovery=False)

    def is_authenticated(self) -> bool:
        return self._service is not None and self._creds is not None and self._creds.valid

    async def start_oauth_flow(self) -> str:
        """
        Connect-calendar flow (user is already signed in). Returns auth URL.
        """
        return await self._begin_flow(on_complete=None)

    async def start_login_flow(self, on_complete) -> str:
        """
        "Continue with Google" sign-in. Same consent grants calendar access,
        so the account is synced automatically. `on_complete(userinfo)` is
        awaited once the token is exchanged.
        """
        return await self._begin_flow(on_complete=on_complete)

    async def _begin_flow(self, on_complete=None) -> str:
        client_config = self._get_client_config()
        section = client_config.get("installed") or client_config.get("web") or {}
        if not section.get("client_id"):
            raise RuntimeError(
                "No Google OAuth client configured. Set AURELIUS_GOOGLE_CLIENT_ID / "
                "AURELIUS_GOOGLE_CLIENT_SECRET or drop google_credentials.json in ~/.aurelius."
            )
        flow = Flow.from_client_config(
            client_config,
            scopes=SCOPES,
            redirect_uri=REDIRECT_URI,
        )
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
        )

        # Start local callback server
        asyncio.create_task(self._run_callback_server(flow, on_complete))
        return auth_url

    async def _run_callback_server(self, flow: Flow, on_complete=None):
        """Runs a temporary local HTTP server to catch the OAuth callback."""
        result_code: list[Optional[str]] = [None]

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parsed = urlparse(self.path)
                params = parse_qs(parsed.query)
                if "code" in params:
                    result_code[0] = params["code"][0]
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write(b"""
                        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
                        <h2>&#10003; Aurelius connected to Google Calendar</h2>
                        <p>You can close this window and return to Aurelius.</p>
                        </body></html>
                    """)
                else:
                    self.send_response(400)
                    self.end_headers()

            def log_message(self, *args):
                pass  # suppress HTTP logs

        server = HTTPServer(("localhost", REDIRECT_PORT), Handler)
        server.timeout = 120  # 2 min timeout

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, server.handle_request)

        if result_code[0]:
            try:
                await loop.run_in_executor(None, lambda: flow.fetch_token(code=result_code[0]))
                self._creds = flow.credentials
                self._save_token()
                self._build_service()
                logger.info("Google OAuth completed successfully")
                if on_complete is not None:
                    userinfo = await loop.run_in_executor(None, self._fetch_userinfo)
                    await on_complete(userinfo)
            except Exception as e:
                logger.error(f"OAuth token exchange failed: {e}")

    def _fetch_userinfo(self) -> dict:
        """Fetch the signed-in Google account's profile (id, email, name, picture)."""
        oauth2 = build("oauth2", "v2", credentials=self._creds, cache_discovery=False)
        return oauth2.userinfo().get().execute()

    def _get_client_config(self) -> dict:
        if CREDENTIALS_FILE.exists():
            return json.loads(CREDENTIALS_FILE.read_text())
        # Read at call time so values from backend/.env (loaded at startup) apply.
        return {
            "installed": {
                "client_id": os.environ.get("AURELIUS_GOOGLE_CLIENT_ID", ""),
                "client_secret": os.environ.get("AURELIUS_GOOGLE_CLIENT_SECRET", ""),
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [REDIRECT_URI],
            }
        }

    def disconnect(self):
        self._creds = None
        self._service = None
        if TOKEN_FILE.exists():
            TOKEN_FILE.unlink()
        logger.info("Google Calendar disconnected")

    async def get_upcoming_events(self, hours_ahead: int = 24) -> list[CalendarEvent]:
        """Fetch upcoming events from all calendars."""
        if not self._service:
            return []

        try:
            now = datetime.now(timezone.utc)
            time_max = now + timedelta(hours=hours_ahead)

            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._service.events().list(
                    calendarId="primary",
                    timeMin=now.isoformat(),
                    timeMax=time_max.isoformat(),
                    maxResults=50,
                    singleEvents=True,
                    orderBy="startTime",
                ).execute()
            )

            events = [CalendarEvent(e) for e in result.get("items", [])]
            self._upcoming = events
            return events

        except HttpError as e:
            logger.error(f"Calendar API error: {e}")
            return []

    def on_meeting_starting(self, callback):
        """Register a callback for when a meeting is about to start."""
        self._on_meeting_starting.append(callback)

    async def watch_loop(self):
        """Background loop that polls calendar and fires callbacks."""
        logger.info("Calendar watch loop started")
        while True:
            try:
                if self.is_authenticated():
                    events = await self.get_upcoming_events(hours_ahead=2)
                    for event in events:
                        mins = event.starts_in_minutes()
                        if mins is not None and 0 <= mins <= self.ALERT_MINUTES:
                            if event.id not in self._alerted_ids:
                                self._alerted_ids.add(event.id)
                                logger.info(f"Meeting starting soon: {event.title}")
                                for cb in self._on_meeting_starting:
                                    try:
                                        await cb(event)
                                    except Exception as e:
                                        logger.error(f"Calendar callback error: {e}")
            except Exception as e:
                logger.error(f"Calendar watch loop error: {e}")

            await asyncio.sleep(self.POLL_INTERVAL)
