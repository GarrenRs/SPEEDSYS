from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

_REPLACEMENT_CHAR = "\uFFFD"
_MARKER_PATTERN = re.compile(r"(?:Ã.|Ø.|Ù.|ï¿½|Â.)")
_ARABIC_PATTERN = re.compile(r"[\u0600-\u06FF]")
_EXTENDED_LATIN_PATTERN = re.compile(r"[\u00C0-\u00FF]")
_READABLE_PATTERN = re.compile(r"^[\u0600-\u06FFA-Za-z0-9\s:,.()\[\]\{\}\-_/\\|]+$")


def _looks_corrupted(value: str) -> bool:
    raw = value.strip()
    if not raw:
        return False
    if _REPLACEMENT_CHAR in raw:
        return True
    if _MARKER_PATTERN.search(raw):
        return True
    extended_count = len(_EXTENDED_LATIN_PATTERN.findall(raw))
    if extended_count >= 2 and not _ARABIC_PATTERN.search(raw):
        return True
    return False


def _decode_utf8_from_latin1(value: str) -> str | None:
    try:
        decoded = value.encode("latin-1", errors="ignore").decode("utf-8", errors="ignore").strip()
        return decoded or None
    except Exception:
        return None


def _is_safe_char(char: str) -> bool:
    code = ord(char)
    is_arabic = 0x0600 <= code <= 0x06FF
    is_ascii_alnum = ("a" <= char <= "z") or ("A" <= char <= "Z") or ("0" <= char <= "9")
    return is_arabic or is_ascii_alnum or char in " :,.()[]{}-_/\\|"


def _cleanup(value: str) -> str:
    out_chars: list[str] = []
    for char in value:
        if _is_safe_char(char):
            out_chars.append(char)
        else:
            out_chars.append(" ")
    return " ".join("".join(out_chars).split()).strip()


def _is_safe_display_text(value: str) -> bool:
    if not value or not _READABLE_PATTERN.match(value):
        return False
    return bool(re.search(r"[\u0600-\u06FFA-Za-z0-9]", value))


def sanitize_text(value: object, fallback: str = "-") -> str:
    if not isinstance(value, str):
        return fallback
    raw = value.strip()
    if not raw:
        return fallback
    if not _looks_corrupted(raw):
        return raw

    decoded = _decode_utf8_from_latin1(raw)
    if decoded and not _looks_corrupted(decoded) and _is_safe_display_text(decoded):
        return decoded
    if decoded:
        decoded_twice = _decode_utf8_from_latin1(decoded)
        if decoded_twice:
            decoded = decoded_twice
        decoded_clean = _cleanup(decoded)
        if len(decoded_clean) >= 2 and not _looks_corrupted(decoded_clean) and _is_safe_display_text(decoded_clean):
            return decoded_clean

    raw_clean = _cleanup(raw)
    if len(raw_clean) >= 2 and not _looks_corrupted(raw_clean) and _is_safe_display_text(raw_clean):
        return raw_clean
    return fallback


def sanitize_payload(value: object, fallback: str = "-") -> object:
    if isinstance(value, str):
        return sanitize_text(value, fallback=fallback)
    if isinstance(value, Mapping):
        return {key: sanitize_payload(item, fallback=fallback) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return [sanitize_payload(item, fallback=fallback) for item in value]
    return value
