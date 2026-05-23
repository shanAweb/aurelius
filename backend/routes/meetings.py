"""Meetings route — CRUD for saved meetings, transcripts, notes"""

from fastapi import APIRouter, HTTPException
from db.database import list_meetings, get_meeting, get_transcript, get_notes, delete_meeting

router = APIRouter()

@router.get("/")
async def get_meetings(limit: int = 50, offset: int = 0):
    return await list_meetings(limit=limit, offset=offset)

@router.get("/{meeting_id}")
async def get_meeting_detail(meeting_id: str):
    meeting = await get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

@router.get("/{meeting_id}/transcript")
async def get_meeting_transcript(meeting_id: str):
    segments = await get_transcript(meeting_id)
    return {"meeting_id": meeting_id, "segments": segments}

@router.get("/{meeting_id}/notes")
async def get_meeting_notes(meeting_id: str):
    notes = await get_notes(meeting_id)
    if not notes:
        raise HTTPException(status_code=404, detail="Notes not yet generated")
    return notes

@router.delete("/{meeting_id}")
async def delete_meeting_route(meeting_id: str):
    await delete_meeting(meeting_id)
    return {"deleted": meeting_id}
