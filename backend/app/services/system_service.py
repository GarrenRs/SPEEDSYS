from . import shared as _shared

globals().update({name: getattr(_shared, name) for name in _shared.__all__})


def get_delivery_fee_setting(db: Session) -> float:
    setting = db.execute(
        select(SystemSetting).where(SystemSetting.key == DELIVERY_FEE_SETTING_KEY)
    ).scalar_one_or_none()
    if not setting:
        return 0.0
    return _parse_non_negative_float(setting.value, default=0.0)

def update_delivery_fee_setting(db: Session, *, delivery_fee: float, actor_id: int) -> float:
    value = max(0.0, float(delivery_fee))
    previous_value = get_delivery_fee_setting(db)
    with transaction_scope(db):
        setting = db.execute(
            select(SystemSetting).where(SystemSetting.key == DELIVERY_FEE_SETTING_KEY)
        ).scalar_one_or_none()
        if setting:
            setting.value = f"{value:.2f}"
            setting.updated_at = datetime.now(UTC)
            setting.updated_by = actor_id
        else:
            db.add(
                SystemSetting(
                    key=DELIVERY_FEE_SETTING_KEY,
                    value=f"{value:.2f}",
                    updated_at=datetime.now(UTC),
                    updated_by=actor_id,
                )
            )
        _record_system_audit(
            db,
            module="settings",
            action="update_delivery_fee",
            entity_type="system_setting",
            entity_id=None,
            user_id=actor_id,
            description=f"تحديث رسوم التوصيل من {previous_value:.2f} إلى {value:.2f} د.ج.",
        )
    return value

def get_delivery_policy_settings(db: Session) -> dict[str, object]:
    rows = db.execute(
        select(SystemSetting).where(
            SystemSetting.key.in_(
                [
                    DELIVERY_MIN_ORDER_SETTING_KEY,
                    DELIVERY_AUTO_NOTIFY_SETTING_KEY,
                ]
            )
        )
    ).scalars().all()
    values = {row.key: row.value for row in rows}
    return {
        "min_order_amount": _parse_non_negative_float(values.get(DELIVERY_MIN_ORDER_SETTING_KEY, "0"), default=0.0),
        "auto_notify_team": _parse_bool(values.get(DELIVERY_AUTO_NOTIFY_SETTING_KEY, "false"), default=False),
    }

def update_delivery_policy_settings(
    db: Session,
    *,
    min_order_amount: float,
    auto_notify_team: bool,
    actor_id: int,
) -> dict[str, object]:
    safe_min_order = max(0.0, float(min_order_amount))
    safe_auto_notify = bool(auto_notify_team)
    previous = get_delivery_policy_settings(db)
    with transaction_scope(db):
        settings_map = {
            DELIVERY_MIN_ORDER_SETTING_KEY: f"{safe_min_order:.2f}",
            DELIVERY_AUTO_NOTIFY_SETTING_KEY: "true" if safe_auto_notify else "false",
        }
        for key, value in settings_map.items():
            setting = db.execute(select(SystemSetting).where(SystemSetting.key == key)).scalar_one_or_none()
            if setting:
                setting.value = value
                setting.updated_at = datetime.now(UTC)
                setting.updated_by = actor_id
            else:
                db.add(
                    SystemSetting(
                        key=key,
                        value=value,
                        updated_at=datetime.now(UTC),
                        updated_by=actor_id,
                    )
                )
        _record_system_audit(
            db,
            module="settings",
            action="update_delivery_policy",
            entity_type="system_setting",
            entity_id=None,
            user_id=actor_id,
            description=(
                "تحديث سياسات التوصيل | "
                f"الحد الأدنى: {previous['min_order_amount']:.2f} -> {safe_min_order:.2f} د.ج | "
                f"التبليغ التلقائي: {'مفعل' if previous['auto_notify_team'] else 'غير مفعل'} -> "
                f"{'مفعل' if safe_auto_notify else 'غير مفعل'}"
            ),
        )
    return {
        "min_order_amount": safe_min_order,
        "auto_notify_team": safe_auto_notify,
    }

def list_operational_settings(
    db: Session,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> list[dict[str, object]]:
    keys = list(OPERATIONAL_SETTINGS_CATALOG.keys())
    rows = db.execute(select(SystemSetting).where(SystemSetting.key.in_(keys))).scalars().all()
    values = {row.key: row.value for row in rows}
    output: list[dict[str, object]] = []
    for key, meta in OPERATIONAL_SETTINGS_CATALOG.items():
        output.append(
            {
                "key": key,
                "value": values.get(key, str(meta["default"])),
                "description": str(meta["description"]),
                "editable": bool(meta["editable"]),
            }
        )
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=200)
    if safe_offset <= 0 and safe_limit is None:
        return output
    if safe_limit is None:
        return output[safe_offset:]
    return output[safe_offset:safe_offset + safe_limit]

def get_order_polling_ms(db: Session) -> int:
    default_raw = str(OPERATIONAL_SETTINGS_CATALOG["order_polling_ms"]["default"])
    try:
        default_value = int(default_raw)
    except (TypeError, ValueError):
        default_value = 5000

    setting = db.execute(select(SystemSetting).where(SystemSetting.key == "order_polling_ms")).scalar_one_or_none()
    raw_value = setting.value if setting is not None else default_raw
    try:
        parsed = int(str(raw_value).strip())
    except (TypeError, ValueError):
        return default_value
    if parsed < 3000 or parsed > 60000:
        return default_value
    return parsed

def _normalize_operational_setting_value(*, key: str, value: str) -> str:
    normalized_value = _normalize_optional_text(value)
    if not normalized_value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="قيمة الإعداد مطلوبة.")

    if key == "order_polling_ms":
        try:
            polling_ms = int(normalized_value)
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="قيمة فاصل التحديث غير صالحة.") from error
        if polling_ms < 3000 or polling_ms > 60000:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="فاصل التحديث يجب أن يكون بين 3000 و 60000 مللي ثانية.",
            )
        return str(polling_ms)

    if key == "audit_logs":
        allowed = {"enabled", "disabled"}
        lowered = normalized_value.lower()
        if lowered not in allowed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="قيمة سجل التدقيق يجب أن تكون enabled أو disabled.")
        return lowered

    return normalized_value

def update_operational_setting(
    db: Session,
    *,
    key: str,
    value: str,
    actor_id: int,
) -> dict[str, object]:
    config = OPERATIONAL_SETTINGS_CATALOG.get(key)
    if config is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الإعداد غير موجود.")
    if not bool(config["editable"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="هذا الإعداد للقراءة فقط.")

    normalized_value = _normalize_operational_setting_value(key=key, value=value)
    with transaction_scope(db):
        setting = db.execute(select(SystemSetting).where(SystemSetting.key == key)).scalar_one_or_none()
        previous_value = setting.value if setting else str(config["default"])
        if setting:
            setting.value = normalized_value
            setting.updated_at = datetime.now(UTC)
            setting.updated_by = actor_id
        else:
            db.add(
                SystemSetting(
                    key=key,
                    value=normalized_value,
                    updated_at=datetime.now(UTC),
                    updated_by=actor_id,
                )
            )
        _record_system_audit(
            db,
            module="settings",
            action="update_operational_setting",
            entity_type="system_setting",
            entity_id=None,
            user_id=actor_id,
            description=f"تحديث الإعداد {key} من {previous_value} إلى {normalized_value}",
        )
    return {
        "key": key,
        "value": normalized_value,
        "description": str(config["description"]),
        "editable": bool(config["editable"]),
    }

def _backup_file_row(path: Path) -> dict[str, object]:
    stats = path.stat()
    return {
        "filename": path.name,
        "size_bytes": int(stats.st_size),
        "created_at": datetime.fromtimestamp(stats.st_mtime, UTC),
    }

def list_system_backups(
    *,
    offset: int = 0,
    limit: int | None = None,
) -> list[dict[str, object]]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    rows = [item for item in BACKUP_DIR.glob("*.sqlite3") if item.is_file()]
    rows.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=200)
    if safe_limit is None:
        selected = rows[safe_offset:]
    else:
        selected = rows[safe_offset:safe_offset + safe_limit]
    return [_backup_file_row(item) for item in selected]

def create_system_backup(db: Session, *, actor_id: int) -> dict[str, object]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    backup_file = BACKUP_DIR / f"restaurant_backup_{timestamp}.sqlite3"
    shutil.copy2(DATABASE_PATH, backup_file)
    with transaction_scope(db):
        _record_system_audit(
            db,
            module="settings",
            action="create_backup",
            entity_type="system_backup",
            entity_id=None,
            user_id=actor_id,
            description=f"إنشاء نسخة احتياطية للنظام باسم {backup_file.name}",
        )
    return _backup_file_row(backup_file)

def restore_system_backup(
    db: Session,
    *,
    filename: str,
    confirm_phrase: str,
    actor_id: int,
) -> dict[str, object]:
    if confirm_phrase != "RESTORE":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="عبارة التأكيد غير صحيحة.")

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_file = (BACKUP_DIR / filename).resolve()
    if not backup_file.exists() or not backup_file.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ملف النسخة الاحتياطية غير موجود.")
    if backup_file.suffix.lower() != ".sqlite3":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="نوع الملف غير مدعوم للاستعادة.")
    if BACKUP_DIR.resolve() not in backup_file.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="مسار ملف النسخة الاحتياطية غير صالح.")

    engine.dispose()
    shutil.copy2(backup_file, DATABASE_PATH)
    with transaction_scope(db):
        _record_system_audit(
            db,
            module="settings",
            action="restore_backup",
            entity_type="system_backup",
            entity_id=None,
            user_id=actor_id,
            description=f"استعادة نسخة احتياطية للنظام من الملف {backup_file.name}",
        )
    return _backup_file_row(backup_file)
