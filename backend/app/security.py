import base64
import hashlib
import hmac
import json
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError

from .config import load_settings

SETTINGS = load_settings()
JWT_ALG = SETTINGS.jwt_alg
JWT_ACTIVE_KID = SETTINGS.jwt_active_kid
JWT_KEYRING = SETTINGS.jwt_keyring
ACCESS_TOKEN_TTL_MINUTES = SETTINGS.access_token_ttl_minutes
REFRESH_TOKEN_TTL_DAYS = SETTINGS.refresh_token_ttl_days

_LEGACY_SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
_JWT_DIGESTS: dict[str, str] = {
    "HS256": "sha256",
    "HS512": "sha512",
}
_PASSWORD_HASHER = PasswordHasher(
    time_cost=SETTINGS.password_argon2_time_cost,
    memory_cost=SETTINGS.password_argon2_memory_cost_kib,
    parallelism=SETTINGS.password_argon2_parallelism,
    hash_len=SETTINGS.password_argon2_hash_len,
    salt_len=SETTINGS.password_argon2_salt_len,
)


class PasswordVerificationResult(NamedTuple):
    is_valid: bool
    needs_upgrade: bool
    was_legacy_sha256: bool


def _legacy_sha256(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _is_legacy_sha256_hash(password_hash: str) -> bool:
    return bool(_LEGACY_SHA256_PATTERN.fullmatch(password_hash.strip()))


def hash_password(password: str) -> str:
    return _PASSWORD_HASHER.hash(password)


def verify_password_details(password: str, password_hash: str | None) -> PasswordVerificationResult:
    normalized_hash = (password_hash or "").strip()
    if not normalized_hash:
        return PasswordVerificationResult(False, False, False)

    if normalized_hash.startswith("$argon2"):
        try:
            valid = _PASSWORD_HASHER.verify(normalized_hash, password)
        except VerifyMismatchError:
            return PasswordVerificationResult(False, False, False)
        except (InvalidHash, VerificationError):
            return PasswordVerificationResult(False, False, False)

        if not valid:
            return PasswordVerificationResult(False, False, False)
        needs_upgrade = _PASSWORD_HASHER.check_needs_rehash(normalized_hash)
        return PasswordVerificationResult(True, needs_upgrade, False)

    if _is_legacy_sha256_hash(normalized_hash):
        if not SETTINGS.allow_legacy_password_login:
            return PasswordVerificationResult(False, False, True)
        legacy_digest = _legacy_sha256(password)
        is_valid = hmac.compare_digest(legacy_digest, normalized_hash.lower())
        return PasswordVerificationResult(is_valid, is_valid, True)

    return PasswordVerificationResult(False, False, False)


def verify_password(password: str, password_hash: str) -> bool:
    return verify_password_details(password, password_hash).is_valid


def hash_refresh_token(token: str) -> str:
    return hashlib.blake2b(token.encode("utf-8"), digest_size=32).hexdigest()


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(64)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(message: bytes, *, secret: str) -> str:
    digest_name = _JWT_DIGESTS.get(JWT_ALG)
    if digest_name is None:
        raise ValueError("unsupported_jwt_algorithm")
    digest = hmac.new(secret.encode("utf-8"), message, digest_name).digest()
    return _b64url_encode(digest)


def create_access_token(*, user_id: int, role: str, username: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "role": role,
        "username": username,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)).timestamp()),
        "alg": JWT_ALG,
    }
    header = {"typ": "JWT", "alg": JWT_ALG, "kid": JWT_ACTIVE_KID}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = _sign(signing_input, secret=JWT_KEYRING[JWT_ACTIVE_KID])
    return f"{header_b64}.{payload_b64}.{signature}"


def decode_access_token(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("invalid_token_format")
    header_b64, payload_b64, signature = parts
    try:
        header_raw = _b64url_decode(header_b64)
        header = json.loads(header_raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("invalid_token_header")

    token_alg = str(header.get("alg") or "")
    if token_alg != JWT_ALG:
        raise ValueError("invalid_token_algorithm")
    kid = str(header.get("kid") or JWT_ACTIVE_KID)
    secret = JWT_KEYRING.get(kid)
    if secret is None:
        raise ValueError("unknown_token_key")

    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected_signature = _sign(signing_input, secret=secret)
    if not hmac.compare_digest(signature, expected_signature):
        raise ValueError("invalid_token_signature")

    payload_raw = _b64url_decode(payload_b64)
    payload = json.loads(payload_raw.decode("utf-8"))
    if payload.get("type") != "access":
        raise ValueError("invalid_token_type")
    if datetime.now(UTC).timestamp() > int(payload.get("exp", 0)):
        raise ValueError("token_expired")
    return payload
