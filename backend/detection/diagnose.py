"""
Mic-in-use diagnostic. Run WHILE you're in a meeting (mic active):

    cd backend && ./aurenv/bin/python -m detection.diagnose

Prints every audio device, whether it has input streams, and whether CoreAudio
reports it as "running somewhere" (in use). Helps confirm instant-meeting
detection sees your mic.
"""

import ctypes
import ctypes.util

from detection import coreaudio as ca


def _device_name(device_id: int) -> str:
    """Best-effort human-readable name via CoreFoundation; falls back to id."""
    try:
        lib = ca._load()
        cf = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))
        cf.CFStringGetCString.restype = ctypes.c_bool
        cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
        cf.CFRelease.argtypes = [ctypes.c_void_p]
        addr = ca._AudioObjectPropertyAddress(ca._fourcc("lnam"), ca._SCOPE_GLOBAL, ca._ELEMENT_MAIN)
        cfstr = ctypes.c_void_p(0)
        size = ctypes.c_uint32(ctypes.sizeof(ctypes.c_void_p))
        st = lib.AudioObjectGetPropertyData(
            ctypes.c_uint32(device_id), ctypes.byref(addr), 0, None,
            ctypes.byref(size), ctypes.cast(ctypes.byref(cfstr), ctypes.c_void_p),
        )
        if st != 0 or not cfstr.value:
            return f"device {device_id}"
        buf = ctypes.create_string_buffer(256)
        ok = cf.CFStringGetCString(cfstr, buf, 256, 0x08000100)  # kCFStringEncodingUTF8
        cf.CFRelease(cfstr)
        return buf.value.decode("utf-8", "replace") if ok else f"device {device_id}"
    except Exception:
        return f"device {device_id}"


def main():
    print("CoreAudio available:", ca.is_available())
    try:
        default_in = ca._get_uint32(ca._K_SYSTEM_OBJECT, ca._SEL_DEFAULT_INPUT)
    except Exception as e:
        default_in = None
        print("default input query FAILED:", e)

    devices = ca._list_devices()
    print(f"\n{'id':>5}  {'input?':6}  {'running?':8}  name")
    print("-" * 60)
    for dev in devices:
        is_in = ca._has_input(dev)
        running = ca._device_running(dev)
        marker = "  <-- DEFAULT INPUT" if dev == default_in else ""
        print(f"{dev:>5}  {str(is_in):6}  {str(running):8}  {_device_name(dev)}{marker}")

    print("-" * 60)
    print("default input device id:", default_in)
    print("mic_in_use() ->", ca.mic_in_use(), "  (True = a meeting/mic is active)")


if __name__ == "__main__":
    main()
