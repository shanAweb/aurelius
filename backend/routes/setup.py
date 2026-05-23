"""
Setup Routes — checks and installs bundled dependencies on first launch
Handles: whisper.cpp binary, llama.cpp binary, BlackHole driver, model downloads
"""

import asyncio
import hashlib
import logging
import os
import platform
import shutil
import subprocess
import urllib.request
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger("aurelius.setup")
router = APIRouter()

RESOURCES_DIR = Path(os.environ.get("AURELIUS_RESOURCES", Path(__file__).parent.parent.parent / "resources"))
MODELS_DIR = RESOURCES_DIR / "models"
BIN_DIR = RESOURCES_DIR / "bin"
DRIVERS_DIR = RESOURCES_DIR / "drivers"

# Model download URLs (Hugging Face)
MODEL_URLS = {
    "ggml-base.en.bin": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    "mistral-7b-instruct-v0.3.Q4_K_M.gguf": "https://huggingface.co/MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3.Q4_K_M.gguf",
    "llama-3.2-3b-instruct.Q4_K_M.gguf": "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
}

MODEL_SIZES_MB = {
    "ggml-base.en.bin": 74,
    "mistral-7b-instruct-v0.3.Q4_K_M.gguf": 4368,
    "llama-3.2-3b-instruct.Q4_K_M.gguf": 1880,
}

# Download progress tracking
_download_progress: dict[str, dict] = {}


# ─── Status Check ─────────────────────────────────────────────────────────────

@router.get("/status")
async def get_setup_status():
    """Returns status of all dependencies needed for Aurelius to run."""
    return {
        "whisper_binary": _check_binary("whisper-cpp"),
        "llama_binary": _check_binary("llama-cli"),
        "whisper_model": _check_model("ggml-base.en.bin"),
        "llm_model": _check_any_llm_model(),
        "blackhole": _check_blackhole(),
        "microphone_permission": await _check_mic_permission(),
        "python_whisper_fallback": _check_python_package("faster_whisper"),
        "python_llama_fallback": _check_python_package("llama_cpp"),
        "python_diarization": _check_python_package("pyannote.audio"),
        "ready": _is_ready(),
    }


def _check_binary(name: str) -> dict:
    path = BIN_DIR / name
    exists = path.exists() and os.access(path, os.X_OK)
    return {"available": exists, "path": str(path) if exists else None}


def _check_model(name: str) -> dict:
    path = MODELS_DIR / name
    exists = path.exists() and path.stat().st_size > 1_000_000
    return {
        "available": exists,
        "path": str(path) if exists else None,
        "size_mb": MODEL_SIZES_MB.get(name, 0),
    }


def _check_any_llm_model() -> dict:
    for name in MODEL_URLS:
        if "gguf" in name:
            result = _check_model(name)
            if result["available"]:
                return {**result, "model_name": name}
    return {"available": False, "model_name": None}


def _check_blackhole() -> dict:
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        for d in devices:
            if "blackhole" in str(d.get("name", "")).lower():
                return {"available": True, "device_name": d["name"]}
        return {"available": False}
    except Exception:
        return {"available": False, "error": "sounddevice not available"}


async def _check_mic_permission() -> dict:
    if platform.system() != "Darwin":
        return {"granted": True}
    try:
        result = subprocess.run(
            ["python3", "-c", "import AVFoundation; print('ok')"],
            capture_output=True, text=True, timeout=3
        )
        return {"granted": True}
    except Exception:
        return {"granted": True}  # Assume granted; Electron handles this


def _check_python_package(package: str) -> bool:
    try:
        __import__(package.replace("-", "_").replace(".", "_").split("_")[0])
        return True
    except ImportError:
        return False


def _is_ready() -> bool:
    whisper_ok = _check_binary("whisper-cpp")["available"] or _check_python_package("faster_whisper")
    llm_ok = _check_binary("llama-cli")["available"] or _check_python_package("llama_cpp")
    whisper_model_ok = _check_model("ggml-base.en.bin")["available"]
    llm_model_ok = _check_any_llm_model()["available"]
    return whisper_ok and llm_ok and whisper_model_ok and llm_model_ok


# ─── Model Download ───────────────────────────────────────────────────────────

class DownloadRequest(BaseModel):
    model_name: str


@router.post("/download-model")
async def download_model(req: DownloadRequest):
    if req.model_name not in MODEL_URLS:
        return {"error": f"Unknown model: {req.model_name}"}

    dest = MODELS_DIR / req.model_name
    if dest.exists() and dest.stat().st_size > 1_000_000:
        return {"status": "already_downloaded", "path": str(dest)}

    # Start download in background
    asyncio.create_task(_download_model_task(req.model_name))
    return {"status": "downloading", "model_name": req.model_name}


@router.get("/download-progress/{model_name}")
async def get_download_progress(model_name: str):
    progress = _download_progress.get(model_name, {"status": "not_started"})
    return progress


async def _download_model_task(model_name: str):
    url = MODEL_URLS[model_name]
    dest = MODELS_DIR / model_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")

    _download_progress[model_name] = {"status": "downloading", "percent": 0, "error": None}
    logger.info(f"Downloading {model_name} from {url}")

    try:
        loop = asyncio.get_event_loop()

        def _download():
            def _progress(block_count, block_size, total_size):
                if total_size > 0:
                    percent = min(100, int(block_count * block_size * 100 / total_size))
                    downloaded_mb = block_count * block_size / 1_048_576
                    _download_progress[model_name] = {
                        "status": "downloading",
                        "percent": percent,
                        "downloaded_mb": round(downloaded_mb, 1),
                        "total_mb": round(total_size / 1_048_576, 1),
                    }

            urllib.request.urlretrieve(url, str(tmp), reporthook=_progress)
            shutil.move(str(tmp), str(dest))

        await loop.run_in_executor(None, _download)
        _download_progress[model_name] = {"status": "complete", "percent": 100, "path": str(dest)}
        logger.info(f"Downloaded {model_name} to {dest}")

    except Exception as e:
        _download_progress[model_name] = {"status": "error", "error": str(e)}
        logger.error(f"Download failed for {model_name}: {e}")
        if tmp.exists():
            tmp.unlink()


# ─── BlackHole Install ────────────────────────────────────────────────────────

@router.post("/install-blackhole")
async def install_blackhole():
    """Install bundled BlackHole .pkg using macOS installer."""
    pkg_path = DRIVERS_DIR / "BlackHole2ch.pkg"

    if not pkg_path.exists():
        return {"error": "BlackHole installer not bundled", "pkg_path": str(pkg_path)}

    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e",
            f'do shell script "installer -pkg \\"{pkg_path}\\" -target /" with administrator privileges',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode == 0:
            return {"status": "installed"}
        else:
            return {"status": "error", "error": stderr.decode()}

    except Exception as e:
        return {"status": "error", "error": str(e)}
