from __future__ import annotations

import base64
import shutil
from datetime import UTC, date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import Float, and_, case, cast, delete, func, or_, select, text, update
from sqlalchemy.orm import Session, joinedload

from ..config import load_settings
from ..database import DATABASE_PATH, engine
from ..enums import (
    DeliveryAssignmentStatus,
    DriverStatus,
    FinancialTransactionType,
    OrderStatus,
    OrderType,
    PaymentStatus,
    ProductKind,
    TableStatus,
    UserRole,
)
from ..lifecycle import can_transition
from ..models import (
    DeliveryAssignment,
    DeliveryDriver,
    Expense,
    ExpenseAttachment,
    ExpenseCostCenter,
    FinancialTransaction,
    Order,
    OrderCostEntry,
    OrderItem,
    OrderTransitionLog,
    Product,
    ProductCategory,
    RefreshToken,
    RestaurantTable,
    ResourceMovement,
    ShiftClosure,
    SecurityAuditEvent,
    SystemAuditLog,
    SystemSetting,
    User,
    WarehouseInboundVoucher,
    WarehouseItem,
    WarehouseOutboundVoucher,
    WarehouseStockBalance,
    WarehouseStockCount,
    WarehouseStockLedger,
)
from ..permissions import (
    ROLE_DEFAULT_PERMISSIONS,
    effective_permissions,
    normalize_overrides_for_role,
    parse_permission_overrides,
    permissions_catalog,
    role_assignable_permissions,
    serialize_permission_overrides,
)
from ..schemas import CreateOrderInput
from ..security import (
    REFRESH_TOKEN_TTL_DAYS,
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password_details,
)
from ..text_sanitizer import sanitize_text
from ..tx import transaction_scope

SETTINGS = load_settings()
PRODUCT_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "static" / "uploads" / "products"
EXPENSE_ATTACHMENT_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "static" / "uploads" / "expenses"
MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_EXPENSE_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024
ALLOWED_EXPENSE_ATTACHMENT_TYPES: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
DEFAULT_EXPENSE_COST_CENTER_CODE = "GENERAL"
DEFAULT_EXPENSE_COST_CENTER_NAME = "عام"
DELIVERY_FEE_SETTING_KEY = "delivery_fee"
DELIVERY_MIN_ORDER_SETTING_KEY = "delivery_min_order_amount"
DELIVERY_AUTO_NOTIFY_SETTING_KEY = "delivery_auto_notify_team"
BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"
PROTECTED_PRODUCT_CATEGORY_NAMES = {"\u0639\u0627\u0645"}
PROTECTED_PRODUCT_CATEGORY_NAMES_LOWER = {item.lower() for item in PROTECTED_PRODUCT_CATEGORY_NAMES}
TERMINAL_ORDER_STATUSES = (
    OrderStatus.DELIVERED.value,
    OrderStatus.CANCELED.value,
    OrderStatus.DELIVERY_FAILED.value,
)
ORDER_STATUS_ACTION_ROUTE: dict[str, str] = {
    OrderStatus.CREATED.value: "/manager/orders?status=CREATED",
    OrderStatus.CONFIRMED.value: "/manager/orders?status=CONFIRMED",
    OrderStatus.SENT_TO_KITCHEN.value: "/manager/kitchen-monitor",
    OrderStatus.IN_PREPARATION.value: "/manager/kitchen-monitor",
    OrderStatus.READY.value: "/manager/orders?status=READY",
    OrderStatus.OUT_FOR_DELIVERY.value: "/manager/delivery-team",
    OrderStatus.DELIVERY_FAILED.value: "/manager/orders?status=DELIVERY_FAILED",
    OrderStatus.DELIVERED.value: "/manager/orders?status=DELIVERED",
    OrderStatus.CANCELED.value: "/manager/orders?status=CANCELED",
}
OPERATIONAL_HEART_QUEUE_CONFIG: list[dict[str, object]] = [
    {
        "key": "created",
        "label": "بانتظار التأكيد",
        "statuses": (OrderStatus.CREATED.value,),
        "sla_seconds": 5 * 60,
        "action_route": "/manager/orders?status=CREATED",
    },
    {
        "key": "confirmed",
        "label": "مؤكد بانتظار المطبخ",
        "statuses": (OrderStatus.CONFIRMED.value,),
        "sla_seconds": 7 * 60,
        "action_route": "/manager/orders?status=CONFIRMED",
    },
    {
        "key": "kitchen",
        "label": "داخل المطبخ",
        "statuses": (OrderStatus.SENT_TO_KITCHEN.value, OrderStatus.IN_PREPARATION.value),
        "sla_seconds": 20 * 60,
        "action_route": "/manager/kitchen-monitor",
    },
    {
        "key": "ready",
        "label": "جاهز للتسليم",
        "statuses": (OrderStatus.READY.value,),
        "sla_seconds": 10 * 60,
        "action_route": "/manager/orders?status=READY",
    },
    {
        "key": "out_for_delivery",
        "label": "خارج للتوصيل",
        "statuses": (OrderStatus.OUT_FOR_DELIVERY.value,),
        "sla_seconds": 30 * 60,
        "action_route": "/manager/delivery-team",
    },
]
OPERATIONAL_HEART_TIMELINE_LIMIT = 24
OPERATIONAL_HEART_KITCHEN_WAIT_WARN_SECONDS = 10 * 60
OPERATIONAL_HEART_KITCHEN_WAIT_CRITICAL_SECONDS = 20 * 60
OPERATIONAL_HEART_FINANCIAL_VARIANCE_WARN = 200.0
OPERATIONAL_HEART_FINANCIAL_VARIANCE_CRITICAL = 1000.0
OPERATIONAL_HEART_EXPENSE_HIGH_VALUE_CRITICAL = 50000.0
OPERATIONAL_HEART_EXPENSE_PENDING_TOTAL_CRITICAL = 150000.0
OPERATIONAL_HEART_CONTRACT_VERSION = "2.1"
KITCHEN_DISABLED_MESSAGE = "نظام المطبخ مغلق: لا يوجد مستخدم مطبخ نشط. أضف مستخدمًا بدور مطبخ أولًا."
DELIVERY_DISABLED_MESSAGE = "نظام التوصيل مغلق: لا يوجد عنصر توصيل نشط. أضف مستخدمًا بدور توصيل أولًا."
ORDER_CANCELLATION_REASONS: dict[str, str] = {
    "customer_request": "طلب العميل",
    "duplicate_order": "طلب مكرر",
    "item_unavailable": "نفاد صنف",
    "payment_issue": "تعذر الدفع",
    "operational_issue": "ظرف تشغيلي",
}
EMERGENCY_DELIVERY_FAIL_REASONS: dict[str, str] = {
    "delivery_service_disabled": "تعذر تشغيل خدمة التوصيل",
    "no_driver_available": "عدم توفر سائق توصيل",
    "address_issue": "تعذر الوصول إلى العنوان",
    "customer_unreachable": "تعذر التواصل مع العميل",
    "operational_emergency": "طارئ تشغيلي",
}
OPERATIONAL_SETTINGS_CATALOG: dict[str, dict[str, object]] = {
    "deployment_mode": {
        "default": "on-prem",
        "description": "وضع التشغيل المحلي الداخلي فقط",
        "editable": False,
    },
    "payment_method": {
        "default": "cash_only",
        "description": "طريقة الدفع المعتمدة: نقدي فقط",
        "editable": False,
    },
    "order_polling_ms": {
        "default": "5000",
        "description": "فاصل تحديث بيانات الطلبات بالواجهة",
        "editable": True,
    },
    "audit_logs": {
        "default": "enabled",
        "description": "تسجيل جميع انتقالات الحالات والعمليات الحساسة",
        "editable": True,
    },
}
PASSWORD_MIN_LENGTH = 8
LOGIN_MAX_FAILED_ATTEMPTS = SETTINGS.login_max_failed_attempts
LOGIN_LOCKOUT_MINUTES = SETTINGS.login_lockout_minutes
MAX_ACTIVE_REFRESH_SESSIONS_PER_USER = 3
WEAK_PASSWORD_VALUES = {
    "12345678",
    "password",
    "password123",
    "admin1234",
    "qwerty123",
    "manager123",
    "kitchen123",
    "delivery123",
}
SYSTEM_ORDER_ACTOR_PREFIX = "__actor__:"
SYSTEM_ORDER_ACTORS: dict[str, dict[str, str]] = {
    "public": {
        "username": "__actor__:public",
        "name": "Public",
    },
    "anonymous": {
        "username": "__actor__:anonymous",
        "name": "Anonymous",
    },
    "system": {
        "username": "__actor__:system",
        "name": "System",
    },
}

def _table_session_open_condition():
    return or_(
        Order.status.notin_(TERMINAL_ORDER_STATUSES),
        and_(
            Order.status == OrderStatus.DELIVERED.value,
            Order.payment_status != PaymentStatus.PAID.value,
        ),
    )

def get_order_or_404(db: Session, order_id: int) -> Order:
    order = db.execute(
        select(Order).where(Order.id == order_id).options(joinedload(Order.items))
    ).unique().scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الطلب غير موجود")
    return order

def get_table_or_404(db: Session, table_id: int) -> RestaurantTable:
    table = db.execute(select(RestaurantTable).where(RestaurantTable.id == table_id)).scalar_one_or_none()
    if not table:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الطاولة غير موجودة")
    return table

def get_user_or_404(db: Session, user_id: int) -> User:
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المستخدم غير موجود.")
    return user

def _normalize_offset_limit(
    *,
    offset: int = 0,
    limit: int | None = None,
    max_limit: int = 500,
) -> tuple[int, int | None]:
    safe_offset = max(0, int(offset))
    if limit is None:
        return safe_offset, None
    safe_limit = max(1, min(int(limit), max_limit))
    return safe_offset, safe_limit

def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)

def _parse_non_negative_float(value: str, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if parsed < 0:
        return default
    return parsed

def _parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default

def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.split()).strip()
    return normalized or None

def _resolve_standard_reason(
    *,
    reason_code: str | None,
    reasons_map: dict[str, str],
    error_detail: str,
) -> str:
    normalized_code = _normalize_optional_text(reason_code)
    if not normalized_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_detail)
    label = reasons_map.get(normalized_code)
    if label is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_detail)
    return label

def _compose_reason_text(reason_label: str, reason_note: str | None) -> str:
    normalized_note = _normalize_optional_text(reason_note)
    if not normalized_note:
        return reason_label
    return f"{reason_label} - {normalized_note}"

def _record_transition(
    db: Session,
    *,
    order_id: int,
    from_status: str,
    to_status: str,
    user_id: int,
) -> None:
    db.add(
        OrderTransitionLog(
            order_id=order_id,
            from_status=from_status,
            to_status=to_status,
            performed_by=user_id,
        )
    )

def _record_system_audit(
    db: Session,
    *,
    module: str,
    action: str,
    entity_type: str,
    entity_id: int | None,
    user_id: int,
    description: str,
) -> None:
    clean_description = sanitize_text(description, fallback="حدث نظامي")
    db.add(
        SystemAuditLog(
            module=module,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            description=clean_description[:255],
            performed_by=user_id,
        )
    )

def _normalize_security_text(value: str | None, *, max_length: int = 255) -> str | None:
    if value is None:
        return None
    normalized = sanitize_text(str(value), fallback="")
    normalized = " ".join(normalized.strip().split())
    if not normalized:
        return None
    return normalized[:max_length]

def record_security_event(
    db: Session,
    *,
    event_type: str,
    success: bool,
    severity: str = "info",
    username: str | None = None,
    role: str | None = None,
    user_id: int | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    detail: str | None = None,
) -> None:
    with transaction_scope(db):
        db.add(
            SecurityAuditEvent(
                event_type=event_type,
                success=bool(success),
                severity=severity,
                username=_normalize_security_text(username, max_length=120),
                role=_normalize_security_text(role, max_length=40),
                user_id=user_id,
                ip_address=_normalize_security_text(ip_address, max_length=64),
                user_agent=_normalize_security_text(user_agent, max_length=255),
                detail=_normalize_security_text(detail, max_length=255),
            )
        )

def _operational_heart_threshold_severity(*, value: float, warn: float, critical: float) -> str:
    if value >= critical:
        return "critical"
    if value >= warn:
        return "warning"
    return "info"

# Application-layer orchestration helpers used to avoid direct domain-to-domain imports.
def app_get_delivery_fee_setting(db: Session) -> float:
    from ..orchestration.service_bridge import app_get_delivery_fee_setting as _app_get_delivery_fee_setting

    return _app_get_delivery_fee_setting(db)

def app_get_delivery_policy_settings(db: Session) -> dict[str, object]:
    from ..orchestration.service_bridge import app_get_delivery_policy_settings as _app_get_delivery_policy_settings

    return _app_get_delivery_policy_settings(db)

def app_ensure_delivery_operational(db: Session) -> None:
    from ..orchestration.service_bridge import app_ensure_delivery_operational as _app_ensure_delivery_operational

    _app_ensure_delivery_operational(db)

def app_ensure_kitchen_operational(db: Session) -> None:
    from ..orchestration.service_bridge import app_ensure_kitchen_operational as _app_ensure_kitchen_operational

    _app_ensure_kitchen_operational(db)

def app_resolve_order_creator_id(db: Session, created_by: int | None, fallback_actor: str) -> int:
    from ..orchestration.service_bridge import app_resolve_order_creator_id as _app_resolve_order_creator_id

    return _app_resolve_order_creator_id(db, created_by, fallback_actor=fallback_actor)

def app_count_active_delivery_users(db: Session) -> int:
    from ..orchestration.service_bridge import app_count_active_delivery_users as _app_count_active_delivery_users

    return _app_count_active_delivery_users(db)

def app_refresh_table_occupancy_state(db: Session, *, table_id: int) -> None:
    from ..orchestration.service_bridge import app_refresh_table_occupancy_state as _app_refresh_table_occupancy_state

    _app_refresh_table_occupancy_state(db, table_id=table_id)

def app_mark_cash_paid(db: Session, order: Order, amount_received: float | None, user_id: int) -> dict[str, float | str | datetime | int]:
    from ..orchestration.service_bridge import app_mark_cash_paid as _app_mark_cash_paid

    return _app_mark_cash_paid(db, order, amount_received, user_id)

def app_save_expense_attachment(*, data_base64: str, mime_type: str, file_name: str | None) -> tuple[str, str, int]:
    from ..orchestration.service_bridge import app_save_expense_attachment as _app_save_expense_attachment

    return _app_save_expense_attachment(data_base64=data_base64, mime_type=mime_type, file_name=file_name)

def app_validate_password_policy(*, password: str, username: str | None = None) -> None:
    from ..orchestration.service_bridge import app_validate_password_policy as _app_validate_password_policy

    _app_validate_password_policy(password=password, username=username)

def app_revoke_active_refresh_tokens_for_user(db: Session, *, user_id: int) -> int:
    from ..orchestration.service_bridge import app_revoke_active_refresh_tokens_for_user as _app_revoke_active_refresh_tokens_for_user

    return _app_revoke_active_refresh_tokens_for_user(db, user_id=user_id)

def app_ensure_delivery_capacity_reduction_allowed(db: Session) -> None:
    from ..orchestration.service_bridge import app_ensure_delivery_capacity_reduction_allowed as _app_ensure_delivery_capacity_reduction_allowed

    _app_ensure_delivery_capacity_reduction_allowed(db)

def app_ensure_kitchen_capacity_reduction_allowed(db: Session) -> None:
    from ..orchestration.service_bridge import app_ensure_kitchen_capacity_reduction_allowed as _app_ensure_kitchen_capacity_reduction_allowed

    _app_ensure_kitchen_capacity_reduction_allowed(db)

def app_remove_static_file(file_url: str | None) -> None:
    from ..orchestration.service_bridge import app_remove_static_file as _app_remove_static_file

    _app_remove_static_file(file_url)

def get_operational_capabilities(db: Session) -> dict[str, object]:
    from ..orchestration.service_bridge import get_operational_capabilities as _get_operational_capabilities

    return _get_operational_capabilities(db)

def kitchen_monitor_summary(db: Session) -> dict[str, int | float]:
    from ..orchestration.service_bridge import kitchen_monitor_summary as _kitchen_monitor_summary

    return _kitchen_monitor_summary(db)

def get_order_polling_ms(db: Session) -> int:
    from ..orchestration.service_bridge import get_order_polling_ms as _get_order_polling_ms

    return _get_order_polling_ms(db)

# Keep compatibility for "from .shared import *" after extracting from monolith:
# export helper symbols including underscored utilities used by domain modules.
__all__ = [name for name in globals() if not name.startswith("__")]
