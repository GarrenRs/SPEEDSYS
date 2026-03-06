from . import shared as _shared

globals().update({name: getattr(_shared, name) for name in _shared.__all__})


def _validate_password_policy(*, password: str, username: str | None = None) -> None:
    if len(password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"كلمة المرور يجب أن تتكون من {PASSWORD_MIN_LENGTH} أحرف على الأقل",
        )
    if any(char.isspace() for char in password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="كلمة المرور يجب ألا تحتوي على مسافات",
        )
    if not any(char.isalpha() for char in password) or not any(char.isdigit() for char in password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="كلمة المرور يجب أن تحتوي على أحرف وأرقام على الأقل",
        )
    lowered = password.lower()
    if lowered in WEAK_PASSWORD_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="كلمة المرور ضعيفة جدًا. يرجى اختيار كلمة أقوى.",
        )
    if username and username.strip() and username.strip().lower() in lowered:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="كلمة المرور يجب ألا تحتوي على اسم المستخدم.",
        )

def issue_tokens(db: Session, user: User) -> tuple[str, str]:
    access_token = create_access_token(user_id=user.id, role=user.role, username=user.username)
    refresh_token = generate_refresh_token()
    refresh_hash = hash_refresh_token(refresh_token)
    expires_at = datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_TTL_DAYS)

    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            expires_at=expires_at.replace(tzinfo=None),
        )
    )
    db.flush()
    revoked_excess = _enforce_refresh_session_limit(db, user_id=user.id, keep_limit=MAX_ACTIVE_REFRESH_SESSIONS_PER_USER)
    if revoked_excess > 0:
        record_security_event(
            db,
            event_type="session_limit_enforced",
            success=True,
            severity="warning",
            username=user.username,
            role=user.role,
            user_id=user.id,
            detail=f"تم إنهاء {revoked_excess} جلسة قديمة بسبب تجاوز الحد الأقصى للجلسات النشطة.",
        )
    return access_token, refresh_token

def _clear_login_lock_state(user: User) -> None:
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_failed_login_at = None

def _is_login_locked(user: User, *, now: datetime) -> bool:
    return bool(user.locked_until is not None and _as_utc(user.locked_until) > now)

def _register_failed_login_attempt(user: User, *, now: datetime) -> bool:
    attempts = int(user.failed_login_attempts or 0) + 1
    user.failed_login_attempts = attempts
    user.last_failed_login_at = now
    locked = attempts >= LOGIN_MAX_FAILED_ATTEMPTS
    if locked:
        user.locked_until = now + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
        user.failed_login_attempts = 0
    return locked

def login_user(db: Session, username: str, password: str, role: str) -> tuple[User, str, str]:
    now = datetime.now(UTC)
    user = db.execute(
        select(User).where(User.username == username, User.role == role, User.active.is_(True))
    ).scalar_one_or_none()
    if user is not None and _is_login_locked(user, now=now):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=(
                "Account is temporarily locked due to repeated failed logins. "
                f"Retry after {LOGIN_LOCKOUT_MINUTES} minutes."
            ),
        )

    verification = verify_password_details(password, user.password_hash) if user is not None else None
    if not user or verification is None or not verification.is_valid:
        if user is not None:
            with transaction_scope(db):
                locked = _register_failed_login_attempt(user, now=now)
            if locked:
                record_security_event(
                    db,
                    event_type="login_lockout",
                    success=False,
                    severity="critical",
                    username=user.username,
                    role=user.role,
                    user_id=user.id,
                    detail=(
                        f"Account locked for {LOGIN_LOCKOUT_MINUTES} minutes "
                        f"after {LOGIN_MAX_FAILED_ATTEMPTS} failed attempts."
                    ),
                )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid login credentials")

    with transaction_scope(db):
        _clear_login_lock_state(user)
        migrated_legacy_hash = False
        if verification.needs_upgrade:
            user.password_hash = hash_password(password)
            migrated_legacy_hash = verification.was_legacy_sha256
        access_token, refresh_token = issue_tokens(db, user)

    if migrated_legacy_hash:
        record_security_event(
            db,
            event_type="password_hash_migrated",
            success=True,
            severity="info",
            username=user.username,
            role=user.role,
            user_id=user.id,
            detail="Legacy SHA-256 password hash migrated to Argon2id at login.",
        )
    db.refresh(user)
    return user, access_token, refresh_token

def refresh_user_tokens(db: Session, refresh_token: str) -> tuple[User, str, str]:
    token_hash = hash_refresh_token(refresh_token)
    record = db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    ).scalar_one_or_none()
    if not record or record.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="رمز التحديث غير صالح")
    if _as_utc(record.expires_at) < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="انتهت صلاحية رمز التحديث")

    user = db.execute(select(User).where(User.id == record.user_id, User.active.is_(True))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="المستخدم غير صالح")

    with transaction_scope(db):
        record.revoked_at = datetime.now(UTC)
        access_token, next_refresh_token = issue_tokens(db, user)
    return user, access_token, next_refresh_token

def revoke_refresh_token(db: Session, refresh_token: str) -> tuple[int | None, bool]:
    token_hash = hash_refresh_token(refresh_token)
    token = db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash)).scalar_one_or_none()
    if not token:
        return None, False
    was_revoked = token.revoked_at is not None
    with transaction_scope(db):
        if not was_revoked:
            token.revoked_at = datetime.now(UTC)
    return token.user_id, not was_revoked

def _active_refresh_tokens_for_user(db: Session, *, user_id: int) -> list[RefreshToken]:
    now = datetime.now(UTC)
    return db.execute(
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at >= now,
        )
        .order_by(RefreshToken.created_at.desc(), RefreshToken.id.desc())
    ).scalars().all()

def _revoke_active_refresh_tokens_for_user(db: Session, *, user_id: int) -> int:
    rows = _active_refresh_tokens_for_user(db, user_id=user_id)
    if not rows:
        return 0
    now = datetime.now(UTC)
    for row in rows:
        row.revoked_at = now
    return len(rows)

def _enforce_refresh_session_limit(db: Session, *, user_id: int, keep_limit: int) -> int:
    active_rows = _active_refresh_tokens_for_user(db, user_id=user_id)
    if len(active_rows) <= keep_limit:
        return 0
    now = datetime.now(UTC)
    rows_to_revoke = active_rows[keep_limit:]
    for row in rows_to_revoke:
        row.revoked_at = now
    return len(rows_to_revoke)

def list_user_refresh_sessions(
    db: Session,
    *,
    user_id: int,
    offset: int = 0,
    limit: int | None = None,
) -> list[dict[str, object]]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=200)
    stmt = (
        select(RefreshToken)
        .where(RefreshToken.user_id == user_id)
        .order_by(RefreshToken.created_at.desc(), RefreshToken.id.desc())
        .offset(safe_offset)
    )
    if safe_limit is not None:
        stmt = stmt.limit(safe_limit)
    rows = db.execute(stmt).scalars().all()
    now = datetime.now(UTC)
    sessions: list[dict[str, object]] = []
    for row in rows:
        sessions.append(
            {
                "id": row.id,
                "created_at": row.created_at,
                "expires_at": row.expires_at,
                "revoked_at": row.revoked_at,
                "is_active": row.revoked_at is None and _as_utc(row.expires_at) >= now,
            }
        )
    return sessions

def revoke_user_refresh_sessions(db: Session, *, user_id: int, actor_id: int) -> int:
    with transaction_scope(db):
        revoked_count = _revoke_active_refresh_tokens_for_user(db, user_id=user_id)
        if revoked_count == 0:
            return 0
        _record_system_audit(
            db,
            module="settings",
            action="revoke_sessions",
            entity_type="user",
            entity_id=user_id,
            user_id=actor_id,
            description=f"إنهاء جميع جلسات حساب المستخدم #{user_id} بعدد {revoked_count} جلسة.",
        )
        target_user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
        actor_user = db.execute(select(User).where(User.id == actor_id)).scalar_one_or_none()
        record_security_event(
            db,
            event_type="sessions_revoked_all",
            success=True,
            severity="warning",
            username=target_user.username if target_user else None,
            role=target_user.role if target_user else None,
            user_id=user_id,
            detail=(
                f"تم إنهاء جميع الجلسات ({revoked_count}) بواسطة "
                f"{actor_user.username if actor_user else f'#{actor_id}'}."
            ),
        )
        return revoked_count
