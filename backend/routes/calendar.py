"""Calendar route — Google Calendar OAuth and event listing"""

import webbrowser
from fastapi import APIRouter, Request

router = APIRouter()

@router.get("/status")
async def calendar_status(request: Request):
    cal = request.app.state.calendar_sync
    return {"connected": cal.is_authenticated()}

@router.post("/connect")
async def connect_calendar(request: Request):
    cal = request.app.state.calendar_sync
    auth_url = await cal.start_oauth_flow()
    return {"auth_url": auth_url}

@router.post("/disconnect")
async def disconnect_calendar(request: Request):
    request.app.state.calendar_sync.disconnect()
    return {"status": "disconnected"}

@router.get("/events")
async def get_events(request: Request, hours: int = 24):
    cal = request.app.state.calendar_sync
    if not cal.is_authenticated():
        return {"connected": False, "events": []}
    events = await cal.get_upcoming_events(hours_ahead=hours)
    return {"connected": True, "events": [e.to_dict() for e in events]}
