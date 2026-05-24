"""
Microphone-in-use detection via CoreAudio (macOS), using ctypes — no extra deps.

Reads `kAudioDevicePropertyDeviceIsRunningSomewhere` on the default input device.
That property is true whenever *any* process has an active session on the mic,
which is the same signal Granola/Fireflies use to notice ad-hoc meetings: it
fires for both native conferencing apps and browser tabs (Meet/Zoom-web), and
does NOT fire for media playback (which uses audio output, not the mic).

Reading these properties is passive metadata — it does not open the mic, does
not require microphone permission, and does not trigger the macOS "in use" dot.
"""

import ctypes
import ctypes.util
import logging
from typing import Optional

logger = logging.getLogger("aurelius.detection")


class _AudioObjectPropertyAddress(ctypes.Structure):
    _fields_ = [
        ("mSelector", ctypes.c_uint32),
        ("mScope", ctypes.c_uint32),
        ("mElement", ctypes.c_uint32),
    ]


def _fourcc(s: str) -> int:
    return (ord(s[0]) << 24) | (ord(s[1]) << 16) | (ord(s[2]) << 8) | ord(s[3])


# CoreAudio constants
_K_SYSTEM_OBJECT = 1
_SCOPE_GLOBAL = _fourcc("glob")
_ELEMENT_MAIN = 0
_SEL_DEFAULT_INPUT = _fourcc("dIn ")          # kAudioHardwarePropertyDefaultInputDevice
_SEL_RUNNING_SOMEWHERE = _fourcc("gone")      # kAudioDevicePropertyDeviceIsRunningSomewhere

_lib = None
_unavailable = False


def _load() -> Optional[ctypes.CDLL]:
    global _lib, _unavailable
    if _lib is not None or _unavailable:
        return _lib
    try:
        path = ctypes.util.find_library("CoreAudio") or \
            "/System/Library/Frameworks/CoreAudio.framework/CoreAudio"
        lib = ctypes.CDLL(path)
        lib.AudioObjectGetPropertyData.restype = ctypes.c_int32
        lib.AudioObjectGetPropertyData.argtypes = [
            ctypes.c_uint32,                                  # AudioObjectID
            ctypes.POINTER(_AudioObjectPropertyAddress),      # inAddress
            ctypes.c_uint32,                                  # inQualifierDataSize
            ctypes.c_void_p,                                  # inQualifierData
            ctypes.POINTER(ctypes.c_uint32),                  # ioDataSize
            ctypes.POINTER(ctypes.c_uint32),                  # outData
        ]
        _lib = lib
    except Exception as e:
        _unavailable = True
        logger.warning(f"CoreAudio unavailable; instant-meeting detection disabled: {e}")
    return _lib


def _get_uint32(object_id: int, selector: int) -> int:
    lib = _load()
    if lib is None:
        raise OSError("CoreAudio not available")
    addr = _AudioObjectPropertyAddress(selector, _SCOPE_GLOBAL, _ELEMENT_MAIN)
    out = ctypes.c_uint32(0)
    size = ctypes.c_uint32(ctypes.sizeof(ctypes.c_uint32))
    status = lib.AudioObjectGetPropertyData(
        ctypes.c_uint32(object_id), ctypes.byref(addr),
        ctypes.c_uint32(0), None,
        ctypes.byref(size), ctypes.byref(out),
    )
    if status != 0:
        raise OSError(f"AudioObjectGetPropertyData failed (status={status})")
    return out.value


def mic_in_use() -> Optional[bool]:
    """
    True if the default input device is in use by any process, False if idle,
    None if it couldn't be determined (non-macOS, no input device, or error).
    """
    try:
        device_id = _get_uint32(_K_SYSTEM_OBJECT, _SEL_DEFAULT_INPUT)
        if device_id == 0:
            return None  # no default input device
        return bool(_get_uint32(device_id, _SEL_RUNNING_SOMEWHERE))
    except Exception as e:
        logger.debug(f"mic_in_use() check failed: {e}")
        return None


def is_available() -> bool:
    return _load() is not None
