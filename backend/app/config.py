import json
import os
from dataclasses import dataclass

from .env_loader import load_local_env_file


@dataclass(frozen=True)
class AppSettings:
    app_env: str
    is_production: bool
    debug: bool
    secret_key: str
    cors_allow_origins: tuple[str, ...]
    expose_diagnostic_endpoints: bool
    jwt_alg: str
    jwt_active_kid: str
    jwt_keyring: dict[str, str]
    access_token_ttl_minutes: int
    refresh_token_ttl_days: int
    password_argon2_time_cost: int
    password_argon2_memory_cost_kib: int
    password_argon2_parallelism: int
    password_argon2_hash_len: int
    password_argon2_salt_len: int
    allow_legacy_password_login: bool
    login_max_failed_attempts: int
    login_lockout_minutes: int
    migration_version_table: str
    schema_expected_revision: str | None


def _parse_int_env(name: str, default: int, *, min_value: int = 1) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"Invalid integer for {name}: {raw!r}") from error
    if value < min_value:
        raise RuntimeError(f"{name} must be >= {min_value}")
    return value


def _load_jwt_keyring(*, active_kid: str, is_production: bool) -> dict[str, str]:
    keyring_raw = (os.getenv("JWT_KEYRING_JSON") or "").strip()
    secret_raw = (os.getenv("JWT_SECRET") or "").strip()

    keyring: dict[str, str] = {}
    if keyring_raw:
        try:
            parsed = json.loads(keyring_raw)
        except json.JSONDecodeError as error:
            raise RuntimeError("JWT_KEYRING_JSON must be valid JSON object") from error
        if not isinstance(parsed, dict):
            raise RuntimeError("JWT_KEYRING_JSON must be a JSON object")
        for kid, secret in parsed.items():
            if not isinstance(kid, str) or not kid.strip():
                raise RuntimeError("JWT key id must be non-empty string")
            if not isinstance(secret, str) or not secret.strip():
                raise RuntimeError(f"JWT secret for kid={kid!r} must be non-empty string")
            keyring[kid.strip()] = secret.strip()

    if secret_raw and active_kid not in keyring:
        keyring[active_kid] = secret_raw

    if not keyring:
        raise RuntimeError("JWT secret is required. Set JWT_SECRET or JWT_KEYRING_JSON.")
    if active_kid not in keyring:
        raise RuntimeError(f"JWT active kid {active_kid!r} is missing in keyring.")

    if is_production:
        for kid, secret in keyring.items():
            if len(secret) < 32:
                raise RuntimeError(f"JWT secret for kid={kid!r} is too short for production.")
    return keyring


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or ("true" if default else "false")).strip().lower()
    if raw in {"1", "true", "yes", "on", "debug", "dev", "development"}:
        return True
    if raw in {"0", "false", "no", "off", "release", "prod", "production"}:
        return False
    raise RuntimeError(f"Invalid boolean for {name}: {raw!r}")


def _parse_csv_env(name: str) -> tuple[str, ...]:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return tuple()
    return tuple(segment.strip() for segment in raw.split(",") if segment.strip())


def _resolve_secret_key(*, jwt_keyring: dict[str, str], active_kid: str) -> str:
    # No hardcoded default is allowed. Fallback uses active JWT key material.
    explicit_secret = (os.getenv("SECRET_KEY") or "").strip()
    if explicit_secret:
        return explicit_secret
    return jwt_keyring[active_kid]


def load_settings() -> AppSettings:
    load_local_env_file()
    app_env = (os.getenv("APP_ENV") or "development").strip().lower()
    is_production = app_env == "production"
    requested_debug = _parse_bool_env("DEBUG", False)
    debug = False if is_production else requested_debug
    active_kid = (os.getenv("JWT_ACTIVE_KID") or "v1").strip() or "v1"
    jwt_alg = (os.getenv("JWT_ALG") or "HS512").strip().upper()
    if jwt_alg not in {"HS256", "HS512"}:
        raise RuntimeError("JWT_ALG must be HS256 or HS512.")
    jwt_keyring = _load_jwt_keyring(active_kid=active_kid, is_production=is_production)
    secret_key = _resolve_secret_key(jwt_keyring=jwt_keyring, active_kid=active_kid)
    raw_cors = _parse_csv_env("CORS_ALLOW_ORIGINS")
    if is_production:
        cors_allow_origins = raw_cors
    else:
        cors_allow_origins = raw_cors or (
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        )
    expose_diagnostic_endpoints = False if is_production else _parse_bool_env("EXPOSE_DIAGNOSTIC_ENDPOINTS", True)
    settings = AppSettings(
        app_env=app_env,
        is_production=is_production,
        debug=debug,
        secret_key=secret_key,
        cors_allow_origins=cors_allow_origins,
        expose_diagnostic_endpoints=expose_diagnostic_endpoints,
        jwt_alg=jwt_alg,
        jwt_active_kid=active_kid,
        jwt_keyring=jwt_keyring,
        access_token_ttl_minutes=_parse_int_env("ACCESS_TOKEN_TTL_MINUTES", 30),
        refresh_token_ttl_days=_parse_int_env("REFRESH_TOKEN_TTL_DAYS", 14),
        password_argon2_time_cost=_parse_int_env("PASSWORD_ARGON2_TIME_COST", 3),
        password_argon2_memory_cost_kib=_parse_int_env("PASSWORD_ARGON2_MEMORY_COST_KIB", 65536),
        password_argon2_parallelism=_parse_int_env("PASSWORD_ARGON2_PARALLELISM", 4),
        password_argon2_hash_len=_parse_int_env("PASSWORD_ARGON2_HASH_LEN", 32),
        password_argon2_salt_len=_parse_int_env("PASSWORD_ARGON2_SALT_LEN", 16),
        allow_legacy_password_login=_parse_bool_env("ALLOW_LEGACY_PASSWORD_LOGIN", False),
        login_max_failed_attempts=_parse_int_env("LOGIN_MAX_FAILED_ATTEMPTS", 20),
        login_lockout_minutes=_parse_int_env("LOGIN_LOCKOUT_MINUTES", 15),
        migration_version_table=(os.getenv("MIGRATION_VERSION_TABLE") or "alembic_version").strip(),
        schema_expected_revision=(os.getenv("SCHEMA_EXPECTED_REVISION") or "").strip() or None,
    )
    if settings.is_production:
        if settings.debug:
            raise RuntimeError("DEBUG must be disabled in production.")
        if len(settings.secret_key) < 32:
            raise RuntimeError("SECRET_KEY must be >= 32 characters in production.")
        if settings.password_argon2_time_cost < 3:
            raise RuntimeError("PASSWORD_ARGON2_TIME_COST must be >= 3 in production.")
        if settings.password_argon2_memory_cost_kib < 65536:
            raise RuntimeError("PASSWORD_ARGON2_MEMORY_COST_KIB must be >= 65536 in production.")
        if settings.password_argon2_parallelism < 2:
            raise RuntimeError("PASSWORD_ARGON2_PARALLELISM must be >= 2 in production.")
        if settings.allow_legacy_password_login:
            raise RuntimeError("ALLOW_LEGACY_PASSWORD_LOGIN must be disabled in production.")
    return settings
