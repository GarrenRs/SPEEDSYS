from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from ..models import Order


def app_get_delivery_fee_setting(db: Session) -> float:
    from ..services.system_service import get_delivery_fee_setting

    return get_delivery_fee_setting(db)


def app_get_delivery_policy_settings(db: Session) -> dict[str, object]:
    from ..services.system_service import get_delivery_policy_settings

    return get_delivery_policy_settings(db)


def app_ensure_delivery_operational(db: Session) -> None:
    from ..services.operational_service import ensure_delivery_operational

    ensure_delivery_operational(db)


def app_ensure_kitchen_operational(db: Session) -> None:
    from ..services.operational_service import ensure_kitchen_operational

    ensure_kitchen_operational(db)


def app_resolve_order_creator_id(db: Session, created_by: int | None, fallback_actor: str) -> int:
    from ..services.operational_service import _resolve_order_creator_id

    return _resolve_order_creator_id(db, created_by, fallback_actor=fallback_actor)


def app_count_active_delivery_users(db: Session) -> int:
    from ..services.operational_service import _count_active_delivery_users

    return _count_active_delivery_users(db)


def app_refresh_table_occupancy_state(db: Session, *, table_id: int) -> None:
    from ..services.session_service import _refresh_table_occupancy_state

    _refresh_table_occupancy_state(db, table_id=table_id)


def app_mark_cash_paid(db: Session, order: Order, amount_received: float | None, user_id: int) -> dict[str, float | str | datetime | int]:
    from ..services.financial_service import _mark_cash_paid

    return _mark_cash_paid(db, order, amount_received, user_id)


def app_save_expense_attachment(*, data_base64: str, mime_type: str, file_name: str | None) -> tuple[str, str, int]:
    from ..services.inventory_service import save_expense_attachment

    return save_expense_attachment(data_base64=data_base64, mime_type=mime_type, file_name=file_name)


def app_validate_password_policy(*, password: str, username: str | None = None) -> None:
    from ..services.auth_service import _validate_password_policy

    _validate_password_policy(password=password, username=username)


def app_revoke_active_refresh_tokens_for_user(db: Session, *, user_id: int) -> int:
    from ..services.auth_service import _revoke_active_refresh_tokens_for_user

    return _revoke_active_refresh_tokens_for_user(db, user_id=user_id)


def app_ensure_delivery_capacity_reduction_allowed(db: Session) -> None:
    from ..services.operational_service import ensure_delivery_capacity_reduction_allowed

    ensure_delivery_capacity_reduction_allowed(db)


def app_ensure_kitchen_capacity_reduction_allowed(db: Session) -> None:
    from ..services.operational_service import ensure_kitchen_capacity_reduction_allowed

    ensure_kitchen_capacity_reduction_allowed(db)


def app_remove_static_file(file_url: str | None) -> None:
    from ..services.inventory_service import _remove_static_file

    _remove_static_file(file_url)


def get_operational_capabilities(db: Session) -> dict[str, object]:
    from ..services.operational_service import get_operational_capabilities as _get_operational_capabilities

    return _get_operational_capabilities(db)


def kitchen_monitor_summary(db: Session) -> dict[str, int | float]:
    from ..services.reporting_service import kitchen_monitor_summary as _kitchen_monitor_summary

    return _kitchen_monitor_summary(db)


def get_order_polling_ms(db: Session) -> int:
    from ..services.system_service import get_order_polling_ms as _get_order_polling_ms

    return _get_order_polling_ms(db)

