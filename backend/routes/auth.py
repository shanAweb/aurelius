"""
Auth Routes — local email/password accounts + "Continue with Google".

This is a local-first app: there is no cloud user store. Accounts live in the
local SQLite db. Google sign-in reuses the calendar OAuth flow, so signing in
with Google also grants calendar access and syncs it automatically.
"""

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from db.database import (
    create_user,
    delete_setting,
    get_setting,
    get_user_by_email,
    get_user_by_id,
    hash_password,
    set_setting,
    touch_last_login,
    upsert_google_user,
    verify_password,
)

logger = logging.getLogger("aurelius.auth")
router = APIRouter()

CURRENT_USER_KEY = "current_user_id"


def _public_user(u: dict) -> dict:
    """Strip secrets before returning a user to the client."""
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name"),
        "provider": u["provider"],
        "picture": u.get("picture"),
    }


class SignupReq(BaseModel):
    name: str = ""
    email: str
    password: str


class LoginReq(BaseModel):
    email: str
    password: str


@router.post("/signup")
async def signup(req: SignupReq):
    email = req.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if await get_user_by_email(email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    name = req.name.strip() or email.split("@")[0]
    user = await create_user(
        email=email, name=name, password_hash=hash_password(req.password), provider="local"
    )
    await set_setting(CURRENT_USER_KEY, user["id"])
    return {"user": _public_user(user)}


@router.post("/login")
async def login(req: LoginReq):
    email = req.email.strip().lower()
    user = await get_user_by_email(email)
    if not user or not user.get("password_hash") or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    await touch_last_login(user["id"])
    await set_setting(CURRENT_USER_KEY, user["id"])
    return {"user": _public_user(user)}


@router.post("/logout")
async def logout():
    await delete_setting(CURRENT_USER_KEY)
    return {"status": "logged_out"}


@router.get("/me")
async def me():
    uid = await get_setting(CURRENT_USER_KEY)
    if not uid:
        return {"user": None}
    user = await get_user_by_id(uid)
    return {"user": _public_user(user) if user else None}


@router.post("/google")
async def google_login(request: Request):
    """Begin Google sign-in. Returns an auth URL the client opens in the browser."""
    cal = request.app.state.calendar_sync

    async def on_complete(userinfo: dict):
        email = (userinfo.get("email") or "").strip().lower()
        if not email:
            logger.error("Google sign-in returned no email; aborting account creation")
            return
        user = await upsert_google_user(
            email=email, name=userinfo.get("name"), picture=userinfo.get("picture")
        )
        await set_setting(CURRENT_USER_KEY, user["id"])
        logger.info(f"Google sign-in completed for {email}")

    try:
        auth_url = await cal.start_login_flow(on_complete)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not start Google sign-in: {e}")
    return {"auth_url": auth_url}
