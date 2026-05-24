"""
Microphone-in-use detection via CoreAudio (macOS), using ctypes — no extra deps.

We scan every audio device that has input streams and check
`kAudioDevicePropertyDeviceIsRunningSomewhere` on it. That property is true
whenever any process holds an active session on that device — the same signal
Granola/Fireflies use to notice ad-hoc meetings. It fires for native apps and
browser tabs (Meet/Zoom-web), and (because we only look at *input* devices) does
NOT fire for media playback, which only uses audio output.

We scan all input devices rather than just the default one: with BlackHole or an
aggregate device installed, the mic a meeting app grabs is often not the system
default input.

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
_SCOPE_INPUT = _fourcc("inpt")
_ELEMENT_MAIN = 0
_SEL_DEVICES = _fourcc("dev#")                # kAudioHardwarePropertyDevices
_SEL_DEFAULT_INPUT = _fourcc("dIn ")          # kAudioHardwarePropertyDefaultInputDevice
_SEL_RUNNING_SOMEWHERE = _fourcc("gone")      # kAudioDevicePropertyDeviceIsRunningSomewhere
_SEL_STREAMS = _fourcc("stm#")                # kAudioDevicePropertyStreams

_lib = None
_unavailable = False


def _load():
    global _lib, _unavailable
    if _lib is not None or _unavailable:
        return _lib
    try:
        path = ctypes.util.find_library("CoreAudio") or \
            "/System/Library/Frameworks/CoreAudio.framework/CoreAudio"
        lib = ctypes.CDLL(path)
        lib.AudioObjectGetPropertyData.restype = ctypes.c_int32
        lib.AudioObjectGetPropertyData.argtypes = [
            ctypes.c_uint32, ctypes.POINTER(_AudioObjectPropertyAddress),
            ctypes.c_uint32, ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_uint32), ctypes.c_void_p,
        ]
        lib.AudioObjectGetPropertyDataSize.restype = ctypes.c_int32
        lib.AudioObjectGetPropertyDataSize.argtypes = [
            ctypes.c_uint32, ctypes.POINTER(_AudioObjectPropertyAddress),
            ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32),
        ]
        _lib = lib
    except Exception as e:
        _unavailable = True
        logger.warning(f"CoreAudio unavailable; instant-meeting detection disabled: {e}")
    return _lib


def _prop_size(object_id: int, selector: int, scope: int) -> int:
    lib = _load()
    addr = _AudioObjectPropertyAddress(selector, scope, _ELEMENT_MAIN)
    size = ctypes.c_uint32(0)
    status = lib.AudioObjectGetPropertyDataSize(
        ctypes.c_uint32(object_id), ctypes.byref(addr), 0, None, ctypes.byref(size)
    )
    if status != 0:
        raise OSError(f"GetPropertyDataSize failed (status={status})")
    return size.value


def _get_uint32(object_id: int, selector: int, scope: int = _SCOPE_GLOBAL) -> int:
    lib = _load()
    addr = _AudioObjectPropertyAddress(selector, scope, _ELEMENT_MAIN)
    out = ctypes.c_uint32(0)
    size = ctypes.c_uint32(ctypes.sizeof(ctypes.c_uint32))
    status = lib.AudioObjectGetPropertyData(
        ctypes.c_uint32(object_id), ctypes.byref(addr), 0, None,
        ctypes.byref(size), ctypes.cast(ctypes.byref(out), ctypes.c_void_p),
    )
    if status != 0:
        raise OSError(f"GetPropertyData failed (status={status})")
    return out.value


def _list_devices() -> list[int]:
    lib = _load()
    addr = _AudioObjectPropertyAddress(_SEL_DEVICES, _SCOPE_GLOBAL, _ELEMENT_MAIN)
    size = ctypes.c_uint32(_prop_size(_K_SYSTEM_OBJECT, _SEL_DEVICES, _SCOPE_GLOBAL))
    n = size.value // ctypes.sizeof(ctypes.c_uint32)
    if n == 0:
        return []
    arr = (ctypes.c_uint32 * n)()
    status = lib.AudioObjectGetPropertyData(
        ctypes.c_uint32(_K_SYSTEM_OBJECT), ctypes.byref(addr), 0, None,
        ctypes.byref(size), ctypes.cast(arr, ctypes.c_void_p),
    )
    if status != 0:
        raise OSError(f"device list failed (status={status})")
    return list(arr)


def _has_input(device_id: int) -> bool:
    try:
        return _prop_size(device_id, _SEL_STREAMS, _SCOPE_INPUT) > 0
    except Exception:
        return False


def _device_running(device_id: int) -> bool:
    try:
        return bool(_get_uint32(device_id, _SEL_RUNNING_SOMEWHERE))
    except Exception:
        return False


def mic_in_use() -> Optional[bool]:
    """
    True if any input-capable audio device is currently in use by some process,
    False if none are, None if it couldn't be determined (non-macOS / error).
    """
    if _load() is None:
        return None
    try:
        for dev in _list_devices():
            if _has_input(dev) and _device_running(dev):
                return True
        return False
    except Exception as e:
        logger.debug(f"mic_in_use() check failed: {e}")
        return None


def is_available() -> bool:
    return _load() is not None
