from __future__ import annotations

import os
import sys
from collections import deque
from functools import lru_cache
from pathlib import Path

if sys.platform == "win32":
    import ctypes
    import winreg
else:  # pragma: no cover - non-Windows fallback
    ctypes = None  # type: ignore[assignment]
    winreg = None  # type: ignore[assignment]


_ACE_REGISTRY_KEYS = (
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\AntiCheatExpert")
    if winreg is not None
    else None,
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\AntiCheatExpert")
    if winreg is not None
    else None,
)

_COMMON_GAME_DIR_SUFFIXES = (
    Path("Hypergryph Launcher") / "games" / "Endfield Game",
    Path("shi") / "Hypergryph Launcher" / "games" / "Endfield Game",
)
_GAME_EXE_NAME = "Endfield.exe"
_GAME_DLL_NAME = "GameAssembly.dll"
_LOCAL_DRIVE_TYPES = {2, 3, 6}
_PRIORITY_SEARCH_TOKENS = (
    ("endfield", 100),
    ("hypergryph", 40),
    ("launcher", 20),
    ("games", 10),
    ("game", 5),
)
_SKIP_RECURSIVE_DIR_NAMES = frozenset(
    {
        "$recycle.bin",
        "$winreagent",
        ".git",
        ".hg",
        ".idea",
        ".venv",
        "__pycache__",
        "config.msi",
        "node_modules",
        "perflogs",
        "recovery",
        "system volume information",
        "windows",
    }
)


def _clean_display_icon(raw_value: str) -> str:
    value = str(raw_value or "").strip().strip('"').strip("'")
    if not value:
        return ""
    lower_value = value.lower()
    exe_index = lower_value.find(".exe")
    if exe_index >= 0:
        return value[: exe_index + 4]
    return value


def _candidate_game_dirs_from_display_icon(display_icon: str) -> list[Path]:
    cleaned = _clean_display_icon(display_icon)
    if not cleaned:
        return []
    candidates: list[Path] = []
    icon_path = Path(cleaned)
    icon_parts = [part.casefold() for part in icon_path.parts]
    if "endfield game".casefold() in icon_parts:
        endfield_index = icon_parts.index("endfield game".casefold())
        candidates.append(Path(*icon_path.parts[: endfield_index + 1]))
    if icon_path.parent.name.casefold() == "anticheatexpert" and icon_path.parent.parent.name:
        candidates.append(icon_path.parent.parent)
    deduped: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate).casefold()
        if key not in seen:
            seen.add(key)
            deduped.append(candidate)
    return deduped


def _is_endfield_game_dir(path: Path) -> bool:
    return (path / _GAME_EXE_NAME).exists() and (path / _GAME_DLL_NAME).exists()


def _resolve_game_dir(path: Path) -> Path | None:
    if not _is_endfield_game_dir(path):
        return None
    try:
        return path.resolve()
    except OSError:
        return path


def _registry_candidate_game_dirs() -> list[Path]:
    if winreg is None:
        return []

    registry_candidates: list[Path] = []
    for candidate in _ACE_REGISTRY_KEYS:
        if candidate is None:
            continue
        root, subkey = candidate
        try:
            with winreg.OpenKey(root, subkey) as key:
                display_icon, _ = winreg.QueryValueEx(key, "DisplayIcon")
        except OSError:
            continue
        registry_candidates.extend(_candidate_game_dirs_from_display_icon(str(display_icon)))
    return registry_candidates


def _drive_type(root: Path) -> int | None:
    if ctypes is None:
        return None
    try:
        return int(ctypes.windll.kernel32.GetDriveTypeW(str(root)))
    except Exception:
        return None


def _is_searchable_drive(root: Path) -> bool:
    drive_type = _drive_type(root)
    return drive_type is None or drive_type in _LOCAL_DRIVE_TYPES


def _iter_drive_roots() -> list[Path]:
    roots: list[Path] = []
    if sys.platform == "win32":
        for drive_ord in range(ord("C"), ord("Z") + 1):
            root = Path(f"{chr(drive_ord)}:/")
            if root.exists() and _is_searchable_drive(root):
                roots.append(root)
    else:  # pragma: no cover - Windows is the supported packet capture target.
        roots.append(Path("/"))
    return roots


def _candidate_game_dirs_from_common_paths() -> list[Path]:
    candidates: list[Path] = []
    for root in _iter_drive_roots():
        for suffix in _COMMON_GAME_DIR_SUFFIXES:
            candidates.append(root / suffix)
    return candidates


def _unique_paths(paths: list[Path]) -> list[Path]:
    deduped: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = str(path).casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(path)
    return deduped


def _dir_search_priority(name: str) -> int:
    lowered = name.casefold()
    return sum(weight for token, weight in _PRIORITY_SEARCH_TOKENS if token in lowered)


def _is_reparse_directory(path: Path) -> bool:
    try:
        if path.is_symlink():
            return True
    except OSError:
        return True
    is_junction = getattr(path, "is_junction", None)
    if callable(is_junction):
        try:
            return bool(is_junction())
        except OSError:
            return True
    return False


def _should_skip_recursive_dir(path: Path) -> bool:
    name = path.name.casefold()
    if name in _SKIP_RECURSIVE_DIR_NAMES:
        return True
    return _is_reparse_directory(path)


def _search_drive_for_game_dir(root: Path) -> Path | None:
    queue: deque[Path] = deque([root])
    while queue:
        current = queue.popleft()
        resolved = _resolve_game_dir(current)
        if resolved is not None:
            return resolved
        try:
            with os.scandir(current) as entries:
                priority_dirs: list[Path] = []
                regular_dirs: list[Path] = []
                for entry in entries:
                    child = Path(entry.path)
                    try:
                        if entry.is_file(follow_symlinks=False):
                            if entry.name.casefold() == _GAME_EXE_NAME.casefold():
                                resolved = _resolve_game_dir(child.parent)
                                if resolved is not None:
                                    return resolved
                            continue
                        if not entry.is_dir(follow_symlinks=False):
                            continue
                    except OSError:
                        continue
                    if _should_skip_recursive_dir(child):
                        continue
                    if _dir_search_priority(entry.name) > 0:
                        priority_dirs.append(child)
                    else:
                        regular_dirs.append(child)
        except OSError:
            continue
        for child in reversed(priority_dirs):
            queue.appendleft(child)
        for child in regular_dirs:
            queue.append(child)
    return None


def _detect_game_exe_path_uncached() -> Path | None:
    for game_dir in _unique_paths(_registry_candidate_game_dirs() + _candidate_game_dirs_from_common_paths()):
        resolved = _resolve_game_dir(game_dir)
        if resolved is not None:
            return (resolved / _GAME_EXE_NAME).resolve()

    for root in _iter_drive_roots():
        resolved = _search_drive_for_game_dir(root)
        if resolved is not None:
            return (resolved / _GAME_EXE_NAME).resolve()
    return None


@lru_cache(maxsize=1)
def _detect_game_exe_path_cached() -> Path | None:
    return _detect_game_exe_path_uncached()


def detect_game_exe_path(refresh: bool = False) -> Path | None:
    if refresh:
        _detect_game_exe_path_cached.cache_clear()
    return _detect_game_exe_path_cached()


def detect_game_dll_dir(refresh: bool = False) -> Path | None:
    exe_path = detect_game_exe_path(refresh=refresh)
    if exe_path is None:
        return None
    dll_dir = exe_path.parent
    if (dll_dir / _GAME_DLL_NAME).exists():
        return dll_dir.resolve()
    return None
