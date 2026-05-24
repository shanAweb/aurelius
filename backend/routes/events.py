"""
App-level events WebSocket.

A single channel the backend uses to push UI prompts/notifications to the
renderer (meeting auto-started, instant meeting detected, recording stopped).
The renderer connects once on launch; recording-specific transcript streaming
still uses the per-meeting socket in routes/recording.py.
"""

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("aurelius.events")
router = APIRouter()

_connections: list[WebSocket] = []


async def broadcast_event(event: dict):
    """Send an event to every connected client. Safe to call with none connected."""
    dead = []
    for ws in list(_connections):
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in _connections:
            _connections.remove(ws)
    logger.info(f"event broadcast: {event.get('type')} → {len(_connections)} client(s)")


@router.websocket("/ws")
async def events_websocket(websocket: WebSocket):
    await websocket.accept()
    _connections.append(websocket)
    logger.info(f"events client connected ({len(_connections)} total)")
    try:
        while True:
            # Client doesn't send; keep alive and detect disconnect.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if websocket in _connections:
            _connections.remove(websocket)
        logger.info(f"events client disconnected ({len(_connections)} total)")
