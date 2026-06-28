"""
DAS Trader Pro — symbol routing via Win32 window messages.

The DAS CMD API (port 9910) only supports order routing — it cannot change
the montage window symbol. We instead find the DAS montage window directly
and send the ticker text via Windows WM_SETTEXT + WM_KEYDOWN(Enter).

This works without needing DAS to be focused or in the foreground.

Setup:
  No special DAS configuration required beyond having DAS running.
  The montage window this targets is the one whose window title matches
  DAS_WINDOW_TITLE in config (default: first DAS montage found).
"""
import logging
import time
import ctypes
import ctypes.wintypes

log = logging.getLogger(__name__)

# Win32 message constants
WM_SETTEXT   = 0x000C
WM_KEYDOWN   = 0x0100
WM_KEYUP     = 0x0101
VK_RETURN    = 0x0D
VK_DELETE    = 0x2E

# SendMessage (synchronous — waits for the target window to process)
_user32 = ctypes.windll.user32


def _find_das_process_windows() -> list[int]:
    """Return HWNDs of all top-level windows belonging to the DAS process."""
    import psutil, win32process, win32gui

    # Find PID(s) of das.exe
    das_pids: set[int] = set()
    for proc in psutil.process_iter(["pid", "name"]):
        if "das" in proc.info["name"].lower():
            das_pids.add(proc.info["pid"])

    if not das_pids:
        log.debug("DAS process not found")
        return []

    found: list[int] = []

    def _cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        if pid in das_pids:
            found.append(hwnd)

    win32gui.EnumWindows(_cb, None)
    return found


def _find_symbol_edit(parent_hwnd: int) -> int | None:
    """Find the first visible Edit child control in a DAS window."""
    import win32gui, win32con

    candidates: list[int] = []

    def _cb(hwnd, _):
        cls = win32gui.GetClassName(hwnd)
        if cls.lower() == "edit" and win32gui.IsWindowVisible(hwnd):
            candidates.append(hwnd)

    win32gui.EnumChildWindows(parent_hwnd, _cb, None)

    if not candidates:
        return None

    # Prefer the first (topmost) edit control — DAS montage symbol box is usually first
    return candidates[0]


def _send_symbol_to_hwnd(edit_hwnd: int, ticker: str) -> bool:
    """Set text in an edit control and press Enter via Win32 messages."""
    import win32api, win32con, win32gui

    ticker = ticker.upper().strip()
    # WM_SETTEXT sets the content of the edit box
    result = _user32.SendMessageW(edit_hwnd, WM_SETTEXT, 0, ticker)
    if result == 0:
        log.warning(f"WM_SETTEXT returned 0 for hwnd={edit_hwnd}")

    time.sleep(0.05)

    # Post Enter key to confirm symbol change
    win32api.PostMessage(edit_hwnd, WM_KEYDOWN, VK_RETURN, 0)
    win32api.PostMessage(edit_hwnd, WM_KEYUP,   VK_RETURN, 0)

    log.info(f"Symbol set via Win32: hwnd={edit_hwnd} ticker={ticker}")
    return True


def set_symbol(ticker: str) -> bool:
    """
    Change the symbol in the DAS montage window.
    Returns True if the window was found and message was sent.
    """
    try:
        import win32gui
        das_windows = _find_das_process_windows()
        if not das_windows:
            log.warning("DAS Trader not running or not found")
            return False

        for hwnd in das_windows:
            title = win32gui.GetWindowText(hwnd)
            edit = _find_symbol_edit(hwnd)
            if edit:
                log.debug(f"Targeting DAS window: {title!r} hwnd={hwnd} edit={edit}")
                return _send_symbol_to_hwnd(edit, ticker)

        log.warning("No DAS montage with editable symbol box found")
        return False

    except Exception as e:
        log.error(f"DAS Win32 symbol change failed: {e}")
        return False


def is_connected() -> bool:
    """Return True if the DAS process is running."""
    try:
        return len(_find_das_process_windows()) > 0
    except Exception:
        return False


def raw_test(command: str) -> dict:
    """
    Debug: list DAS windows and their edit controls.
    The `command` argument is used as ticker for a live test when it starts with 'SYMBOL '.
    """
    try:
        import win32gui
        das_windows = _find_das_process_windows()
        windows_info = []
        for hwnd in das_windows:
            title = win32gui.GetWindowText(hwnd)
            edit = _find_symbol_edit(hwnd)
            windows_info.append({"hwnd": hwnd, "title": title, "edit_hwnd": edit})

        result = {"das_windows": windows_info, "count": len(das_windows)}

        # If caller wants a live symbol test
        if command.upper().startswith("SYMBOL "):
            ticker = command.split(" ", 1)[1].strip()
            ok = set_symbol(ticker)
            result["symbol_test"] = {"ticker": ticker, "success": ok}

        return result
    except Exception as e:
        return {"error": str(e)}
