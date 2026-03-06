from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .models import (
    WarehouseInboundItem,
    WarehouseInboundVoucher,
    WarehouseIntegrationEvent,
    WarehouseItem,
    WarehouseOutboundItem,
    WarehouseOutboundVoucher,
    WarehouseStockCount,
    WarehouseStockCountLine,
    WarehouseStockBalance,
    WarehouseStockLedger,
    WarehouseSupplier,
    WarehouseSupplierItem,
)
from .tx import transaction_scope

OUTBOUND_REASON_OPTIONS: tuple[tuple[str, str], ...] = (
    ("kitchen_supply", "تموين المطبخ"),
    # Legacy compatibility: old clients may still submit this reason code.
    ("operational_use", "استخدام تشغيلي (legacy)"),
)
OUTBOUND_REASON_LABELS = {code: label for code, label in OUTBOUND_REASON_OPTIONS}
WAREHOUSE_INTEGRATION_BATCH_LIMIT = 500


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


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_item_ids(item_ids: list[int]) -> list[int]:
    normalized = [int(item_id) for item_id in item_ids]
    if any(item_id <= 0 for item_id in normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="معرف الصنف يجب أن يكون أكبر من صفر.")
    if len(normalized) != len(set(normalized)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن تكرار نفس الصنف.",
        )
    return normalized


def _assert_supplier_item_ids_exist(db: Session, *, item_ids: list[int]) -> None:
    if not item_ids:
        return
    found_ids = set(
        int(item_id)
        for item_id in db.execute(select(WarehouseItem.id).where(WarehouseItem.id.in_(item_ids))).scalars().all()
    )
    missing = [item_id for item_id in item_ids if item_id not in found_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"الصنف #{missing[0]} غير موجود في المخزون.",
        )


def _serialize_supplier(supplier: WarehouseSupplier, *, supplied_item_ids: list[int]) -> dict[str, object]:
    return {
        "id": int(supplier.id),
        "name": str(supplier.name),
        "phone": supplier.phone,
        "email": supplier.email,
        "address": supplier.address,
        "payment_term_days": int(supplier.payment_term_days or 0),
        "credit_limit": float(supplier.credit_limit) if supplier.credit_limit is not None else None,
        "quality_rating": float(supplier.quality_rating or 0),
        "lead_time_days": int(supplier.lead_time_days or 0),
        "notes": supplier.notes,
        "active": bool(supplier.active),
        "supplied_item_ids": supplied_item_ids,
        "created_at": supplier.created_at,
        "updated_at": supplier.updated_at,
    }


def _voucher_date_key(value: datetime) -> str:
    return value.strftime("%Y%m%d")


def _build_inbound_no(voucher_id: int, posted_at: datetime) -> str:
    return f"IN-{_voucher_date_key(posted_at)}-{voucher_id:06d}"


def _build_outbound_no(voucher_id: int, posted_at: datetime) -> str:
    return f"OUT-{_voucher_date_key(posted_at)}-{voucher_id:06d}"


def _build_stock_count_no(count_id: int, counted_at: datetime) -> str:
    return f"CNT-{_voucher_date_key(counted_at)}-{count_id:06d}"


def _resolve_outbound_reason(reason_code: str) -> tuple[str, str]:
    normalized = _normalize_optional_text(reason_code)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="رمز سبب الصرف مطلوب.")
    label = OUTBOUND_REASON_LABELS.get(normalized)
    if label is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="رمز سبب الصرف غير مدعوم.")
    return normalized, label


def _assert_unique_item_lines(item_ids: list[int]) -> None:
    if len(item_ids) != len(set(item_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن تكرار نفس الصنف في السند.",
        )


def _get_or_create_balance(db: Session, *, item_id: int) -> WarehouseStockBalance:
    balance = db.execute(
        select(WarehouseStockBalance).where(WarehouseStockBalance.item_id == item_id)
    ).scalar_one_or_none()
    if balance is not None:
        return balance
    balance = WarehouseStockBalance(
        item_id=item_id,
        quantity=0.0,
        avg_unit_cost=0.0,
        updated_at=datetime.now(UTC),
    )
    db.add(balance)
    db.flush()
    return balance


def _parse_integration_payload(payload_json: str) -> dict[str, object]:
    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid integration payload JSON: {exc.msg}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Integration payload must be a JSON object")
    return payload


def _require_int_payload_field(payload: dict[str, object], field_name: str) -> int:
    raw_value = payload.get(field_name)
    if raw_value is None:
        raise ValueError(f"Missing payload field '{field_name}'")
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Payload field '{field_name}' must be an integer") from exc
    if value <= 0:
        raise ValueError(f"Payload field '{field_name}' must be > 0")
    return value


def _handle_warehouse_inbound_posted(
    db: Session,
    event: WarehouseIntegrationEvent,
    payload: dict[str, object],
) -> None:
    if event.source_type != "wh_inbound_voucher":
        raise ValueError("Inbound event source_type mismatch")
    voucher_id = _require_int_payload_field(payload, "voucher_id")
    if voucher_id != int(event.source_id):
        raise ValueError("Inbound event source_id mismatch with payload")
    voucher_exists = db.execute(
        select(WarehouseInboundVoucher.id).where(WarehouseInboundVoucher.id == int(event.source_id))
    ).scalar_one_or_none()
    if voucher_exists is None:
        raise ValueError("Inbound voucher source does not exist")
    ledger_count = int(
        db.execute(
            select(func.count(WarehouseStockLedger.id)).where(
                WarehouseStockLedger.source_type == "wh_inbound_voucher",
                WarehouseStockLedger.source_id == int(event.source_id),
                WarehouseStockLedger.movement_kind == "inbound",
            )
        ).scalar_one()
        or 0
    )
    if ledger_count <= 0:
        raise ValueError("Inbound voucher has no stock ledger rows")


def _handle_warehouse_outbound_posted(
    db: Session,
    event: WarehouseIntegrationEvent,
    payload: dict[str, object],
) -> None:
    if event.source_type != "wh_outbound_voucher":
        raise ValueError("Outbound event source_type mismatch")
    voucher_id = _require_int_payload_field(payload, "voucher_id")
    if voucher_id != int(event.source_id):
        raise ValueError("Outbound event source_id mismatch with payload")
    voucher_exists = db.execute(
        select(WarehouseOutboundVoucher.id).where(WarehouseOutboundVoucher.id == int(event.source_id))
    ).scalar_one_or_none()
    if voucher_exists is None:
        raise ValueError("Outbound voucher source does not exist")
    ledger_count = int(
        db.execute(
            select(func.count(WarehouseStockLedger.id)).where(
                WarehouseStockLedger.source_type == "wh_outbound_voucher",
                WarehouseStockLedger.source_id == int(event.source_id),
                WarehouseStockLedger.movement_kind == "outbound",
            )
        ).scalar_one()
        or 0
    )
    if ledger_count <= 0:
        raise ValueError("Outbound voucher has no stock ledger rows")


def _handle_warehouse_stock_count_settled(
    db: Session,
    event: WarehouseIntegrationEvent,
    payload: dict[str, object],
) -> None:
    if event.source_type != "wh_stock_count":
        raise ValueError("Stock-count event source_type mismatch")
    count_id = _require_int_payload_field(payload, "count_id")
    if count_id != int(event.source_id):
        raise ValueError("Stock-count event source_id mismatch with payload")
    count_status = db.execute(
        select(WarehouseStockCount.status).where(WarehouseStockCount.id == int(event.source_id))
    ).scalar_one_or_none()
    if count_status is None:
        raise ValueError("Stock-count source does not exist")
    if str(count_status) != "settled":
        raise ValueError("Stock-count source is not settled")


WAREHOUSE_INTEGRATION_EVENT_HANDLERS: dict[
    str, Callable[[Session, WarehouseIntegrationEvent, dict[str, object]], None]
] = {
    "warehouse_inbound_posted": _handle_warehouse_inbound_posted,
    "warehouse_outbound_posted": _handle_warehouse_outbound_posted,
    "warehouse_stock_count_settled": _handle_warehouse_stock_count_settled,
}


def consume_pending_warehouse_integration_events(
    db: Session,
    *,
    limit: int = 200,
) -> dict[str, int]:
    capped_limit = max(1, min(int(limit), WAREHOUSE_INTEGRATION_BATCH_LIMIT))
    db.flush()
    pending_events = db.execute(
        select(WarehouseIntegrationEvent)
        .where(WarehouseIntegrationEvent.status == "pending")
        .order_by(WarehouseIntegrationEvent.created_at.asc(), WarehouseIntegrationEvent.id.asc())
        .limit(capped_limit)
    ).scalars().all()
    processed_count = 0
    failed_count = 0

    for event in pending_events:
        try:
            payload = _parse_integration_payload(str(event.payload_json))
            handler = WAREHOUSE_INTEGRATION_EVENT_HANDLERS.get(str(event.event_type))
            if handler is None:
                raise ValueError(f"Unsupported integration event type '{event.event_type}'")
            handler(db, event, payload)
            event.status = "processed"
            event.processed_at = datetime.now(UTC)
            event.last_error = None
            processed_count += 1
        except Exception as exc:
            event.status = "failed"
            event.processed_at = datetime.now(UTC)
            event.last_error = str(exc)[:255]
            failed_count += 1

    return {
        "scanned": len(pending_events),
        "processed": processed_count,
        "failed": failed_count,
    }


def list_warehouse_suppliers(
    db: Session,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> list[dict[str, object]]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=500)
    stmt = (
        select(WarehouseSupplier)
        .order_by(WarehouseSupplier.name.asc(), WarehouseSupplier.id.asc())
        .offset(safe_offset)
    )
    if safe_limit is not None:
        stmt = stmt.limit(safe_limit)
    suppliers = db.execute(stmt).scalars().all()
    if not suppliers:
        return []
    supplier_ids = [int(supplier.id) for supplier in suppliers]
    rows = db.execute(
        select(WarehouseSupplierItem.supplier_id, WarehouseSupplierItem.item_id).where(
            WarehouseSupplierItem.supplier_id.in_(supplier_ids)
        )
    ).all()
    links: dict[int, list[int]] = defaultdict(list)
    for row in rows:
        links[int(row.supplier_id)].append(int(row.item_id))
    for supplier_id in links:
        links[supplier_id].sort()
    return [
        _serialize_supplier(supplier, supplied_item_ids=links.get(int(supplier.id), []))
        for supplier in suppliers
    ]


def list_warehouse_outbound_reasons() -> list[dict[str, str]]:
    return [{"code": code, "label": label} for code, label in OUTBOUND_REASON_OPTIONS]


def create_warehouse_supplier(
    db: Session,
    *,
    name: str,
    phone: str | None,
    email: str | None,
    address: str | None,
    payment_term_days: int,
    credit_limit: float | None,
    quality_rating: float,
    lead_time_days: int,
    notes: str | None,
    active: bool,
    supplied_item_ids: list[int],
) -> dict[str, object]:
    normalized_name = _normalize_optional_text(name)
    if not normalized_name or len(normalized_name) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم المورد يجب أن يحتوي حرفين على الأقل.")
    existing = db.execute(
        select(WarehouseSupplier).where(func.lower(WarehouseSupplier.name) == normalized_name.lower())
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم المورد مستخدم بالفعل.")
    normalized_item_ids = _normalize_item_ids(supplied_item_ids)
    _assert_supplier_item_ids_exist(db, item_ids=normalized_item_ids)

    supplier = WarehouseSupplier(
        name=normalized_name,
        phone=_normalize_optional_text(phone),
        email=_normalize_optional_text(email),
        address=_normalize_optional_text(address),
        payment_term_days=max(0, int(payment_term_days)),
        credit_limit=float(credit_limit) if credit_limit is not None else None,
        quality_rating=min(5.0, max(0.0, float(quality_rating))),
        lead_time_days=max(0, int(lead_time_days)),
        notes=_normalize_optional_text(notes),
        active=active,
        updated_at=datetime.now(UTC),
    )
    with transaction_scope(db):
        db.add(supplier)
        db.flush()
        for item_id in normalized_item_ids:
            db.add(
                WarehouseSupplierItem(
                    supplier_id=int(supplier.id),
                    item_id=item_id,
                )
            )
    return _serialize_supplier(supplier, supplied_item_ids=normalized_item_ids)


def update_warehouse_supplier(
    db: Session,
    *,
    supplier_id: int,
    name: str,
    phone: str | None,
    email: str | None,
    address: str | None,
    payment_term_days: int,
    credit_limit: float | None,
    quality_rating: float,
    lead_time_days: int,
    notes: str | None,
    active: bool,
    supplied_item_ids: list[int],
) -> dict[str, object]:
    supplier = db.execute(
        select(WarehouseSupplier).where(WarehouseSupplier.id == supplier_id)
    ).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المورد غير موجود.")

    normalized_name = _normalize_optional_text(name)
    if not normalized_name or len(normalized_name) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم المورد يجب أن يحتوي حرفين على الأقل.")

    duplicate = db.execute(
        select(WarehouseSupplier).where(
            func.lower(WarehouseSupplier.name) == normalized_name.lower(),
            WarehouseSupplier.id != supplier_id,
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم المورد مستخدم بالفعل.")
    normalized_item_ids = _normalize_item_ids(supplied_item_ids)
    _assert_supplier_item_ids_exist(db, item_ids=normalized_item_ids)

    with transaction_scope(db):
        supplier.name = normalized_name
        supplier.phone = _normalize_optional_text(phone)
        supplier.email = _normalize_optional_text(email)
        supplier.address = _normalize_optional_text(address)
        supplier.payment_term_days = max(0, int(payment_term_days))
        supplier.credit_limit = float(credit_limit) if credit_limit is not None else None
        supplier.quality_rating = min(5.0, max(0.0, float(quality_rating)))
        supplier.lead_time_days = max(0, int(lead_time_days))
        supplier.notes = _normalize_optional_text(notes)
        supplier.active = active
        supplier.updated_at = datetime.now(UTC)
        db.execute(
            delete(WarehouseSupplierItem).where(WarehouseSupplierItem.supplier_id == supplier_id)
        )
        for item_id in normalized_item_ids:
            db.add(
                WarehouseSupplierItem(
                    supplier_id=supplier_id,
                    item_id=item_id,
                )
            )
    return _serialize_supplier(supplier, supplied_item_ids=normalized_item_ids)


def list_warehouse_items(
    db: Session,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> list[WarehouseItem]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=500)
    stmt = (
        select(WarehouseItem)
        .order_by(WarehouseItem.name.asc(), WarehouseItem.id.asc())
        .offset(safe_offset)
    )
    if safe_limit is not None:
        stmt = stmt.limit(safe_limit)
    return db.execute(stmt).scalars().all()


def create_warehouse_item(
    db: Session,
    *,
    name: str,
    unit: str,
    alert_threshold: float,
    active: bool,
) -> WarehouseItem:
    supplier_count = int(
        db.execute(
            select(func.count(WarehouseSupplier.id)).where(WarehouseSupplier.active.is_(True))
        ).scalar_one()
        or 0
    )
    if supplier_count <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن إنشاء صنف قبل إضافة مورد نشط واحد على الأقل.",
        )

    normalized_name = _normalize_optional_text(name)
    if not normalized_name or len(normalized_name) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم الصنف يجب أن يحتوي حرفين على الأقل.")
    normalized_unit = _normalize_optional_text(unit)
    if not normalized_unit:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="وحدة القياس مطلوبة.")
    duplicate = db.execute(
        select(WarehouseItem).where(func.lower(WarehouseItem.name) == normalized_name.lower())
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم الصنف مستخدم بالفعل.")

    item = WarehouseItem(
        name=normalized_name,
        unit=normalized_unit,
        alert_threshold=max(0.0, float(alert_threshold)),
        active=active,
        updated_at=datetime.now(UTC),
    )
    with transaction_scope(db):
        db.add(item)
        db.flush()
        db.add(
            WarehouseStockBalance(
                item_id=item.id,
                quantity=0.0,
                avg_unit_cost=0.0,
                updated_at=datetime.now(UTC),
            )
        )
    return item


def update_warehouse_item(
    db: Session,
    *,
    item_id: int,
    name: str,
    unit: str,
    alert_threshold: float,
    active: bool,
) -> WarehouseItem:
    item = db.execute(select(WarehouseItem).where(WarehouseItem.id == item_id)).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الصنف غير موجود.")

    normalized_name = _normalize_optional_text(name)
    if not normalized_name or len(normalized_name) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم الصنف يجب أن يحتوي حرفين على الأقل.")
    normalized_unit = _normalize_optional_text(unit)
    if not normalized_unit:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="وحدة القياس مطلوبة.")

    duplicate = db.execute(
        select(WarehouseItem).where(
            func.lower(WarehouseItem.name) == normalized_name.lower(),
            WarehouseItem.id != item_id,
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم الصنف مستخدم بالفعل.")

    with transaction_scope(db):
        item.name = normalized_name
        item.unit = normalized_unit
        item.alert_threshold = max(0.0, float(alert_threshold))
        item.active = active
        item.updated_at = datetime.now(UTC)
        _get_or_create_balance(db, item_id=item.id)
    return item


def list_warehouse_balances(
    db: Session,
    *,
    only_low: bool = False,
    offset: int = 0,
    limit: int | None = None,
) -> list[dict[str, object]]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=1000)
    quantity_expr = func.coalesce(WarehouseStockBalance.quantity, 0.0)
    stmt = (
        select(
            WarehouseItem.id.label("item_id"),
            WarehouseItem.name.label("item_name"),
            WarehouseItem.unit,
            WarehouseItem.alert_threshold,
            WarehouseItem.active,
            quantity_expr.label("quantity"),
        )
        .select_from(WarehouseItem)
        .outerjoin(WarehouseStockBalance, WarehouseStockBalance.item_id == WarehouseItem.id)
        .order_by(WarehouseItem.name.asc(), WarehouseItem.id.asc())
        .offset(safe_offset)
    )
    if safe_limit is not None:
        stmt = stmt.limit(safe_limit)
    if only_low:
        stmt = stmt.where(quantity_expr <= WarehouseItem.alert_threshold)
    rows = db.execute(stmt).all()
    payload: list[dict[str, object]] = []
    for row in rows:
        quantity = float(row.quantity or 0)
        threshold = float(row.alert_threshold or 0)
        is_low = quantity <= threshold
        if only_low and not is_low:
            continue
        payload.append(
            {
                "item_id": int(row.item_id),
                "item_name": str(row.item_name),
                "unit": str(row.unit),
                "alert_threshold": threshold,
                "active": bool(row.active),
                "quantity": quantity,
                "is_low": is_low,
            }
        )
    return payload


def _compose_inbound_payloads(db: Session, voucher_ids: list[int]) -> dict[int, dict[str, object]]:
    if not voucher_ids:
        return {}
    item_rows = db.execute(
        select(
            WarehouseInboundItem.voucher_id,
            WarehouseInboundItem.item_id,
            WarehouseItem.name.label("item_name"),
            WarehouseInboundItem.quantity,
            WarehouseInboundItem.unit_cost,
        )
        .join(WarehouseItem, WarehouseItem.id == WarehouseInboundItem.item_id)
        .where(WarehouseInboundItem.voucher_id.in_(voucher_ids))
        .order_by(WarehouseInboundItem.id.asc())
    ).all()
    grouped: dict[int, dict[str, object]] = defaultdict(
        lambda: {"total_quantity": 0.0, "total_cost": 0.0, "items": []}
    )
    for row in item_rows:
        quantity = float(row.quantity or 0)
        unit_cost = float(row.unit_cost or 0)
        line_total = quantity * unit_cost
        target = grouped[int(row.voucher_id)]
        target["total_quantity"] = float(target["total_quantity"]) + quantity
        target["total_cost"] = float(target["total_cost"]) + line_total
        target["items"].append(
            {
                "item_id": int(row.item_id),
                "item_name": str(row.item_name),
                "quantity": quantity,
                "unit_cost": unit_cost,
                "line_total": line_total,
            }
        )
    return grouped


def _compose_outbound_payloads(db: Session, voucher_ids: list[int]) -> dict[int, dict[str, object]]:
    if not voucher_ids:
        return {}
    cost_rows = db.execute(
        select(
            WarehouseStockLedger.source_id.label("voucher_id"),
            WarehouseStockLedger.item_id,
            WarehouseStockLedger.unit_cost,
            WarehouseStockLedger.line_value,
        ).where(
            WarehouseStockLedger.source_type == "wh_outbound_voucher",
            WarehouseStockLedger.source_id.in_(voucher_ids),
            WarehouseStockLedger.movement_kind == "outbound",
        )
    ).all()
    cost_map = {
        (int(row.voucher_id), int(row.item_id)): (
            float(row.unit_cost or 0),
            abs(float(row.line_value or 0)),
        )
        for row in cost_rows
    }
    item_rows = db.execute(
        select(
            WarehouseOutboundItem.voucher_id,
            WarehouseOutboundItem.item_id,
            WarehouseItem.name.label("item_name"),
            WarehouseOutboundItem.quantity,
        )
        .join(WarehouseItem, WarehouseItem.id == WarehouseOutboundItem.item_id)
        .where(WarehouseOutboundItem.voucher_id.in_(voucher_ids))
        .order_by(WarehouseOutboundItem.id.asc())
    ).all()
    grouped: dict[int, dict[str, object]] = defaultdict(
        lambda: {"total_quantity": 0.0, "total_cost": 0.0, "items": []}
    )
    for row in item_rows:
        quantity = float(row.quantity or 0)
        unit_cost, line_total = cost_map.get((int(row.voucher_id), int(row.item_id)), (0.0, 0.0))
        target = grouped[int(row.voucher_id)]
        target["total_quantity"] = float(target["total_quantity"]) + quantity
        target["total_cost"] = float(target["total_cost"]) + line_total
        target["items"].append(
            {
                "item_id": int(row.item_id),
                "item_name": str(row.item_name),
                "quantity": quantity,
                "unit_cost": unit_cost,
                "line_total": line_total,
            }
        )
    return grouped


def list_warehouse_inbound_vouchers(
    db: Session,
    *,
    offset: int = 0,
    limit: int = 100,
) -> list[dict[str, object]]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=500)
    rows = db.execute(
        select(
            WarehouseInboundVoucher.id,
            WarehouseInboundVoucher.voucher_no,
            WarehouseInboundVoucher.supplier_id,
            WarehouseSupplier.name.label("supplier_name"),
            WarehouseInboundVoucher.reference_no,
            WarehouseInboundVoucher.note,
            WarehouseInboundVoucher.posted_at,
            WarehouseInboundVoucher.received_by,
        )
        .join(WarehouseSupplier, WarehouseSupplier.id == WarehouseInboundVoucher.supplier_id)
        .order_by(WarehouseInboundVoucher.posted_at.desc(), WarehouseInboundVoucher.id.desc())
        .offset(safe_offset)
        .limit(safe_limit or 100)
    ).all()
    ids = [int(row.id) for row in rows]
    grouped = _compose_inbound_payloads(db, ids)
    payload: list[dict[str, object]] = []
    for row in rows:
        summary = grouped.get(int(row.id), {"total_quantity": 0.0, "total_cost": 0.0, "items": []})
        payload.append(
            {
                "id": int(row.id),
                "voucher_no": row.voucher_no,
                "supplier_id": int(row.supplier_id),
                "supplier_name": row.supplier_name,
                "reference_no": row.reference_no,
                "note": row.note,
                "posted_at": row.posted_at,
                "received_by": int(row.received_by),
                "total_quantity": float(summary["total_quantity"]),
                "total_cost": float(summary["total_cost"]),
                "items": summary["items"],
            }
        )
    return payload


def list_warehouse_outbound_vouchers(
    db: Session,
    *,
    offset: int = 0,
    limit: int = 100,
) -> list[dict[str, object]]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=500)
    rows = db.execute(
        select(
            WarehouseOutboundVoucher.id,
            WarehouseOutboundVoucher.voucher_no,
            WarehouseOutboundVoucher.reason_code,
            WarehouseOutboundVoucher.reason,
            WarehouseOutboundVoucher.note,
            WarehouseOutboundVoucher.posted_at,
            WarehouseOutboundVoucher.issued_by,
        )
        .order_by(WarehouseOutboundVoucher.posted_at.desc(), WarehouseOutboundVoucher.id.desc())
        .offset(safe_offset)
        .limit(safe_limit or 100)
    ).all()
    ids = [int(row.id) for row in rows]
    grouped = _compose_outbound_payloads(db, ids)
    payload: list[dict[str, object]] = []
    for row in rows:
        summary = grouped.get(int(row.id), {"total_quantity": 0.0, "total_cost": 0.0, "items": []})
        payload.append(
            {
                "id": int(row.id),
                "voucher_no": row.voucher_no,
                "reason_code": row.reason_code,
                "reason": row.reason,
                "note": row.note,
                "posted_at": row.posted_at,
                "issued_by": int(row.issued_by),
                "total_quantity": float(summary["total_quantity"]),
                "total_cost": float(summary["total_cost"]),
                "items": summary["items"],
            }
        )
    return payload


def get_warehouse_inbound_voucher(db: Session, *, voucher_id: int) -> dict[str, object]:
    rows = db.execute(
        select(
            WarehouseInboundVoucher.id,
            WarehouseInboundVoucher.voucher_no,
            WarehouseInboundVoucher.supplier_id,
            WarehouseSupplier.name.label("supplier_name"),
            WarehouseInboundVoucher.reference_no,
            WarehouseInboundVoucher.note,
            WarehouseInboundVoucher.posted_at,
            WarehouseInboundVoucher.received_by,
        )
        .join(WarehouseSupplier, WarehouseSupplier.id == WarehouseInboundVoucher.supplier_id)
        .where(WarehouseInboundVoucher.id == voucher_id)
    ).all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="سند الوارد غير موجود.")
    grouped = _compose_inbound_payloads(db, [voucher_id])
    row = rows[0]
    summary = grouped.get(voucher_id, {"total_quantity": 0.0, "total_cost": 0.0, "items": []})
    return {
        "id": int(row.id),
        "voucher_no": row.voucher_no,
        "supplier_id": int(row.supplier_id),
        "supplier_name": row.supplier_name,
        "reference_no": row.reference_no,
        "note": row.note,
        "posted_at": row.posted_at,
        "received_by": int(row.received_by),
        "total_quantity": float(summary["total_quantity"]),
        "total_cost": float(summary["total_cost"]),
        "items": summary["items"],
    }


def get_warehouse_outbound_voucher(db: Session, *, voucher_id: int) -> dict[str, object]:
    rows = db.execute(
        select(
            WarehouseOutboundVoucher.id,
            WarehouseOutboundVoucher.voucher_no,
            WarehouseOutboundVoucher.reason_code,
            WarehouseOutboundVoucher.reason,
            WarehouseOutboundVoucher.note,
            WarehouseOutboundVoucher.posted_at,
            WarehouseOutboundVoucher.issued_by,
        ).where(WarehouseOutboundVoucher.id == voucher_id)
    ).all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="سند المنصرف غير موجود.")
    grouped = _compose_outbound_payloads(db, [voucher_id])
    row = rows[0]
    summary = grouped.get(voucher_id, {"total_quantity": 0.0, "total_cost": 0.0, "items": []})
    return {
        "id": int(row.id),
        "voucher_no": row.voucher_no,
        "reason_code": row.reason_code,
        "reason": row.reason,
        "note": row.note,
        "posted_at": row.posted_at,
        "issued_by": int(row.issued_by),
        "total_quantity": float(summary["total_quantity"]),
        "total_cost": float(summary["total_cost"]),
        "items": summary["items"],
    }


def create_warehouse_inbound_voucher(
    db: Session,
    *,
    supplier_id: int,
    reference_no: str | None,
    note: str | None,
    idempotency_key: str | None,
    items: list[tuple[int, float, float]],
    actor_id: int,
) -> dict[str, object]:
    if not items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="يجب إضافة عنصر واحد على الأقل.")
    item_ids = [item_id for item_id, _, _ in items]
    _assert_unique_item_lines(item_ids)

    supplier = db.execute(
        select(WarehouseSupplier).where(WarehouseSupplier.id == supplier_id, WarehouseSupplier.active.is_(True))
    ).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المورد غير موجود أو غير نشط.")

    normalized_idempotency = _normalize_optional_text(idempotency_key)
    if normalized_idempotency:
        existing = db.execute(
            select(WarehouseInboundVoucher.id).where(
                WarehouseInboundVoucher.idempotency_key == normalized_idempotency
            )
        ).scalar_one_or_none()
        if existing is not None:
            return get_warehouse_inbound_voucher(db, voucher_id=int(existing))

    fetched_items = db.execute(
        select(WarehouseItem).where(WarehouseItem.id.in_(item_ids), WarehouseItem.active.is_(True))
    ).scalars().all()
    item_map = {item.id: item for item in fetched_items}
    missing = [item_id for item_id in item_ids if item_id not in item_map]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"الصنف #{missing[0]} غير موجود أو غير نشط.")
    allowed_item_ids = set(
        int(item_id)
        for item_id in db.execute(
            select(WarehouseSupplierItem.item_id).where(WarehouseSupplierItem.supplier_id == supplier_id)
        ).scalars().all()
    )
    if not allowed_item_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن إنشاء سند وارد لمورد بلا أصناف مرتبطة.",
        )
    unlinked_item_ids = [item_id for item_id in item_ids if item_id not in allowed_item_ids]
    if unlinked_item_ids:
        first_unlinked = int(unlinked_item_ids[0])
        item_name = item_map[first_unlinked].name if first_unlinked in item_map else f"#{first_unlinked}"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"الصنف '{item_name}' غير مرتبط بهذا المورد.",
        )

    with transaction_scope(db):
        voucher = WarehouseInboundVoucher(
            voucher_no=f"IN-TMP-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}",
            supplier_id=supplier_id,
            reference_no=_normalize_optional_text(reference_no),
            note=_normalize_optional_text(note),
            idempotency_key=normalized_idempotency,
            received_by=actor_id,
            posted_at=datetime.now(UTC),
        )
        db.add(voucher)
        db.flush()
        voucher.voucher_no = _build_inbound_no(voucher.id, voucher.posted_at)

        total_qty = 0.0
        total_cost = 0.0
        for item_id, quantity, unit_cost in items:
            if quantity <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الكمية يجب أن تكون أكبر من صفر.")
            if unit_cost < 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="سعر الوحدة لا يمكن أن يكون سالبا.")

            balance = _get_or_create_balance(db, item_id=item_id)
            before = float(balance.quantity or 0)
            before_avg_cost = float(balance.avg_unit_cost or 0)
            received_qty = float(quantity)
            received_unit_cost = float(unit_cost)
            after = before + received_qty
            after_total_value = (before * before_avg_cost) + (received_qty * received_unit_cost)
            after_avg_cost = (after_total_value / after) if after > 0 else 0.0
            balance.quantity = after
            balance.avg_unit_cost = after_avg_cost
            balance.updated_at = datetime.now(UTC)

            db.add(
                WarehouseInboundItem(
                    voucher_id=voucher.id,
                    item_id=item_id,
                    quantity=received_qty,
                    unit_cost=received_unit_cost,
                )
            )
            db.add(
                WarehouseStockLedger(
                    item_id=item_id,
                    movement_kind="inbound",
                    source_type="wh_inbound_voucher",
                    source_id=voucher.id,
                    quantity=received_qty,
                    unit_cost=received_unit_cost,
                    line_value=received_qty * received_unit_cost,
                    running_avg_cost=after_avg_cost,
                    balance_before=before,
                    balance_after=after,
                    note=voucher.note or f"سند وارد {voucher.voucher_no}",
                    created_by=actor_id,
                    created_at=datetime.now(UTC),
                )
            )

            total_qty += received_qty
            total_cost += received_qty * received_unit_cost

        db.add(
            WarehouseIntegrationEvent(
                event_type="warehouse_inbound_posted",
                source_type="wh_inbound_voucher",
                source_id=voucher.id,
                payload_json=json.dumps(
                    {
                        "voucher_id": voucher.id,
                        "voucher_no": voucher.voucher_no,
                        "supplier_id": supplier_id,
                        "total_quantity": round(total_qty, 4),
                        "total_cost": round(total_cost, 2),
                    },
                    ensure_ascii=False,
                ),
                status="pending",
            )
        )
        consume_pending_warehouse_integration_events(db)

    return get_warehouse_inbound_voucher(db, voucher_id=voucher.id)


def create_warehouse_outbound_voucher(
    db: Session,
    *,
    reason_code: str,
    reason_note: str | None,
    note: str | None,
    idempotency_key: str | None,
    items: list[tuple[int, float]],
    actor_id: int,
) -> dict[str, object]:
    normalized_reason_code, reason_label = _resolve_outbound_reason(reason_code)
    normalized_reason_note = _normalize_optional_text(reason_note)
    if not items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="يجب إضافة عنصر واحد على الأقل.")

    item_ids = [item_id for item_id, _ in items]
    _assert_unique_item_lines(item_ids)

    normalized_idempotency = _normalize_optional_text(idempotency_key)
    if normalized_idempotency:
        existing = db.execute(
            select(WarehouseOutboundVoucher.id).where(
                WarehouseOutboundVoucher.idempotency_key == normalized_idempotency
            )
        ).scalar_one_or_none()
        if existing is not None:
            return get_warehouse_outbound_voucher(db, voucher_id=int(existing))

    fetched_items = db.execute(
        select(WarehouseItem).where(WarehouseItem.id.in_(item_ids), WarehouseItem.active.is_(True))
    ).scalars().all()
    item_map = {item.id: item for item in fetched_items}
    missing = [item_id for item_id in item_ids if item_id not in item_map]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"الصنف #{missing[0]} غير موجود أو غير نشط.")
    inbound_history_item_ids = set(
        int(item_id)
        for item_id in db.execute(
            select(WarehouseStockLedger.item_id)
            .where(
                WarehouseStockLedger.item_id.in_(item_ids),
                WarehouseStockLedger.movement_kind == "inbound",
                WarehouseStockLedger.source_type == "wh_inbound_voucher",
            )
            .distinct()
        ).scalars().all()
    )
    missing_inbound_history = [item_id for item_id in item_ids if item_id not in inbound_history_item_ids]
    if missing_inbound_history:
        first_missing = int(missing_inbound_history[0])
        item_name = item_map[first_missing].name if first_missing in item_map else f"#{first_missing}"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"لا يمكن صرف الصنف '{item_name}' قبل تسجيل وارد له.",
        )

    normalized_note = _normalize_optional_text(note)
    if normalized_reason_note:
        normalized_note = f"{normalized_note} | {normalized_reason_note}" if normalized_note else normalized_reason_note

    with transaction_scope(db):
        voucher = WarehouseOutboundVoucher(
            voucher_no=f"OUT-TMP-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}",
            reason_code=normalized_reason_code,
            reason=reason_label,
            note=normalized_note,
            idempotency_key=normalized_idempotency,
            issued_by=actor_id,
            posted_at=datetime.now(UTC),
        )
        db.add(voucher)
        db.flush()
        voucher.voucher_no = _build_outbound_no(voucher.id, voucher.posted_at)

        total_qty = 0.0
        total_cost = 0.0
        for item_id, quantity in items:
            if quantity <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الكمية يجب أن تكون أكبر من صفر.")

            item_name = item_map[item_id].name
            balance = _get_or_create_balance(db, item_id=item_id)
            before = float(balance.quantity or 0)
            before_avg_cost = float(balance.avg_unit_cost or 0)
            requested = float(quantity)
            if before < requested:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"لا يمكن صرف '{item_name}' لعدم كفاية الرصيد (المتاح: {before:.3f}).",
                )
            after = before - requested
            balance.quantity = after
            balance.avg_unit_cost = 0.0 if after <= 0 else before_avg_cost
            balance.updated_at = datetime.now(UTC)

            db.add(
                WarehouseOutboundItem(
                    voucher_id=voucher.id,
                    item_id=item_id,
                    quantity=requested,
                )
            )
            db.add(
                WarehouseStockLedger(
                    item_id=item_id,
                    movement_kind="outbound",
                    source_type="wh_outbound_voucher",
                    source_id=voucher.id,
                    quantity=requested,
                    unit_cost=before_avg_cost,
                    line_value=-(requested * before_avg_cost),
                    running_avg_cost=float(balance.avg_unit_cost or 0),
                    balance_before=before,
                    balance_after=after,
                    note=voucher.note or reason_label,
                    created_by=actor_id,
                    created_at=datetime.now(UTC),
                )
            )
            total_qty += requested
            total_cost += requested * before_avg_cost

        db.add(
            WarehouseIntegrationEvent(
                event_type="warehouse_outbound_posted",
                source_type="wh_outbound_voucher",
                source_id=voucher.id,
                payload_json=json.dumps(
                    {
                        "voucher_id": voucher.id,
                        "voucher_no": voucher.voucher_no,
                        "reason_code": normalized_reason_code,
                        "reason": reason_label,
                        "total_quantity": round(total_qty, 4),
                        "total_cost": round(total_cost, 2),
                    },
                    ensure_ascii=False,
                ),
                status="pending",
            )
        )
        consume_pending_warehouse_integration_events(db)

    return get_warehouse_outbound_voucher(db, voucher_id=voucher.id)


def list_warehouse_ledger(
    db: Session,
    *,
    offset: int = 0,
    limit: int = 200,
    item_id: int | None = None,
    movement_kind: str | None = None,
) -> list[dict[str, object]]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=1000)
    stmt = (
        select(
            WarehouseStockLedger.id,
            WarehouseStockLedger.item_id,
            WarehouseItem.name.label("item_name"),
            WarehouseStockLedger.movement_kind,
            WarehouseStockLedger.source_type,
            WarehouseStockLedger.source_id,
            WarehouseStockLedger.quantity,
            WarehouseStockLedger.unit_cost,
            WarehouseStockLedger.line_value,
            WarehouseStockLedger.running_avg_cost,
            WarehouseStockLedger.balance_before,
            WarehouseStockLedger.balance_after,
            WarehouseStockLedger.note,
            WarehouseStockLedger.created_by,
            WarehouseStockLedger.created_at,
        )
        .join(WarehouseItem, WarehouseItem.id == WarehouseStockLedger.item_id)
        .order_by(WarehouseStockLedger.created_at.desc(), WarehouseStockLedger.id.desc())
        .offset(safe_offset)
        .limit(safe_limit or 200)
    )
    if item_id is not None:
        stmt = stmt.where(WarehouseStockLedger.item_id == item_id)
    if movement_kind in {"inbound", "outbound"}:
        stmt = stmt.where(WarehouseStockLedger.movement_kind == movement_kind)

    rows = db.execute(stmt).all()
    return [
        {
            "id": int(row.id),
            "item_id": int(row.item_id),
            "item_name": str(row.item_name),
            "movement_kind": str(row.movement_kind),
            "source_type": str(row.source_type),
            "source_id": int(row.source_id),
            "quantity": float(row.quantity or 0),
            "unit_cost": float(row.unit_cost or 0),
            "line_value": float(row.line_value or 0),
            "running_avg_cost": float(row.running_avg_cost or 0),
            "balance_before": float(row.balance_before or 0),
            "balance_after": float(row.balance_after or 0),
            "note": row.note,
            "created_by": int(row.created_by),
            "created_at": row.created_at,
        }
        for row in rows
    ]


def _compose_stock_count_payloads(db: Session, count_ids: list[int]) -> dict[int, dict[str, object]]:
    if not count_ids:
        return {}
    line_rows = db.execute(
        select(
            WarehouseStockCountLine.count_id,
            WarehouseStockCountLine.item_id,
            WarehouseItem.name.label("item_name"),
            WarehouseItem.unit,
            WarehouseStockCountLine.system_quantity,
            WarehouseStockCountLine.counted_quantity,
            WarehouseStockCountLine.variance_quantity,
            WarehouseStockCountLine.unit_cost,
            WarehouseStockCountLine.variance_value,
        )
        .join(WarehouseItem, WarehouseItem.id == WarehouseStockCountLine.item_id)
        .where(WarehouseStockCountLine.count_id.in_(count_ids))
        .order_by(WarehouseStockCountLine.id.asc())
    ).all()
    grouped: dict[int, dict[str, object]] = defaultdict(
        lambda: {
            "total_variance_quantity": 0.0,
            "total_variance_value": 0.0,
            "items": [],
        }
    )
    for row in line_rows:
        variance_quantity = float(row.variance_quantity or 0)
        variance_value = float(row.variance_value or 0)
        target = grouped[int(row.count_id)]
        target["total_variance_quantity"] = float(target["total_variance_quantity"]) + variance_quantity
        target["total_variance_value"] = float(target["total_variance_value"]) + variance_value
        target["items"].append(
            {
                "item_id": int(row.item_id),
                "item_name": str(row.item_name),
                "unit": str(row.unit),
                "system_quantity": float(row.system_quantity or 0),
                "counted_quantity": float(row.counted_quantity or 0),
                "variance_quantity": variance_quantity,
                "unit_cost": float(row.unit_cost or 0),
                "variance_value": variance_value,
            }
        )
    return grouped


def list_warehouse_stock_counts(
    db: Session,
    *,
    offset: int = 0,
    limit: int = 100,
) -> list[dict[str, object]]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=500)
    rows = db.execute(
        select(
            WarehouseStockCount.id,
            WarehouseStockCount.count_no,
            WarehouseStockCount.note,
            WarehouseStockCount.status,
            WarehouseStockCount.counted_by,
            WarehouseStockCount.counted_at,
            WarehouseStockCount.settled_by,
            WarehouseStockCount.settled_at,
        )
        .order_by(WarehouseStockCount.counted_at.desc(), WarehouseStockCount.id.desc())
        .offset(safe_offset)
        .limit(safe_limit or 100)
    ).all()
    ids = [int(row.id) for row in rows]
    grouped = _compose_stock_count_payloads(db, ids)
    payload: list[dict[str, object]] = []
    for row in rows:
        summary = grouped.get(
            int(row.id),
            {"total_variance_quantity": 0.0, "total_variance_value": 0.0, "items": []},
        )
        payload.append(
            {
                "id": int(row.id),
                "count_no": str(row.count_no),
                "note": row.note,
                "status": str(row.status),
                "counted_by": int(row.counted_by),
                "counted_at": row.counted_at,
                "settled_by": int(row.settled_by) if row.settled_by is not None else None,
                "settled_at": row.settled_at,
                "total_variance_quantity": float(summary["total_variance_quantity"]),
                "total_variance_value": float(summary["total_variance_value"]),
                "items": summary["items"],
            }
        )
    return payload


def get_warehouse_stock_count(db: Session, *, count_id: int) -> dict[str, object]:
    row = db.execute(
        select(
            WarehouseStockCount.id,
            WarehouseStockCount.count_no,
            WarehouseStockCount.note,
            WarehouseStockCount.status,
            WarehouseStockCount.counted_by,
            WarehouseStockCount.counted_at,
            WarehouseStockCount.settled_by,
            WarehouseStockCount.settled_at,
        ).where(WarehouseStockCount.id == count_id)
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="جرد المخزون غير موجود.")
    grouped = _compose_stock_count_payloads(db, [count_id])
    summary = grouped.get(
        int(row.id),
        {"total_variance_quantity": 0.0, "total_variance_value": 0.0, "items": []},
    )
    return {
        "id": int(row.id),
        "count_no": str(row.count_no),
        "note": row.note,
        "status": str(row.status),
        "counted_by": int(row.counted_by),
        "counted_at": row.counted_at,
        "settled_by": int(row.settled_by) if row.settled_by is not None else None,
        "settled_at": row.settled_at,
        "total_variance_quantity": float(summary["total_variance_quantity"]),
        "total_variance_value": float(summary["total_variance_value"]),
        "items": summary["items"],
    }


def create_warehouse_stock_count(
    db: Session,
    *,
    note: str | None,
    idempotency_key: str | None,
    items: list[tuple[int, float]],
    actor_id: int,
) -> dict[str, object]:
    if not items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="يجب إضافة عنصر واحد على الأقل.")
    item_ids = [item_id for item_id, _ in items]
    _assert_unique_item_lines(item_ids)

    normalized_idempotency = _normalize_optional_text(idempotency_key)
    if normalized_idempotency:
        existing = db.execute(
            select(WarehouseStockCount.id).where(WarehouseStockCount.idempotency_key == normalized_idempotency)
        ).scalar_one_or_none()
        if existing is not None:
            return get_warehouse_stock_count(db, count_id=int(existing))

    fetched_items = db.execute(select(WarehouseItem).where(WarehouseItem.id.in_(item_ids))).scalars().all()
    item_map = {item.id: item for item in fetched_items}
    missing = [item_id for item_id in item_ids if item_id not in item_map]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"الصنف #{missing[0]} غير موجود أو غير نشط.")

    with transaction_scope(db):
        count_doc = WarehouseStockCount(
            count_no=f"CNT-TMP-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}",
            note=_normalize_optional_text(note),
            idempotency_key=normalized_idempotency,
            status="pending",
            counted_by=actor_id,
            counted_at=datetime.now(UTC),
        )
        db.add(count_doc)
        db.flush()
        count_doc.count_no = _build_stock_count_no(count_doc.id, count_doc.counted_at)

        for item_id, counted_quantity in items:
            counted_qty = float(counted_quantity)
            if counted_qty < 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الكمية المعدودة لا يمكن أن تكون سالبة.")
            balance = _get_or_create_balance(db, item_id=item_id)
            system_qty = float(balance.quantity or 0)
            unit_cost = float(balance.avg_unit_cost or 0)
            variance_qty = counted_qty - system_qty
            variance_value = variance_qty * unit_cost
            db.add(
                WarehouseStockCountLine(
                    count_id=count_doc.id,
                    item_id=item_id,
                    system_quantity=system_qty,
                    counted_quantity=counted_qty,
                    variance_quantity=variance_qty,
                    unit_cost=unit_cost,
                    variance_value=variance_value,
                )
            )

    return get_warehouse_stock_count(db, count_id=count_doc.id)


def settle_warehouse_stock_count(db: Session, *, count_id: int, actor_id: int) -> dict[str, object]:
    count_doc = db.execute(select(WarehouseStockCount).where(WarehouseStockCount.id == count_id)).scalar_one_or_none()
    if count_doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="جرد المخزون غير موجود.")
    if count_doc.status == "settled":
        return get_warehouse_stock_count(db, count_id=count_id)
    if count_doc.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لا يمكن تسوية جرد ليس في حالة pending.")

    lines = db.execute(
        select(WarehouseStockCountLine).where(WarehouseStockCountLine.count_id == count_id)
    ).scalars().all()

    with transaction_scope(db):
        total_variance_qty = 0.0
        total_variance_value = 0.0
        for line in lines:
            variance_qty = float(line.variance_quantity or 0)
            if abs(variance_qty) < 0.0000001:
                continue

            balance = _get_or_create_balance(db, item_id=int(line.item_id))
            before_qty = float(balance.quantity or 0)
            before_avg_cost = float(balance.avg_unit_cost or 0)
            after_qty = before_qty + variance_qty
            if after_qty < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="تسوية الجرد ستؤدي إلى رصيد سالب.",
                )

            if variance_qty > 0:
                unit_cost = float(line.unit_cost or before_avg_cost)
                movement_kind = "inbound"
                line_value = abs(variance_qty) * unit_cost
                after_total_value = (before_qty * before_avg_cost) + line_value
                after_avg_cost = (after_total_value / after_qty) if after_qty > 0 else 0.0
            else:
                unit_cost = before_avg_cost if before_avg_cost > 0 else float(line.unit_cost or 0)
                movement_kind = "outbound"
                line_value = -(abs(variance_qty) * unit_cost)
                after_avg_cost = 0.0 if after_qty <= 0 else before_avg_cost

            balance.quantity = after_qty
            balance.avg_unit_cost = after_avg_cost
            balance.updated_at = datetime.now(UTC)

            db.add(
                WarehouseStockLedger(
                    item_id=int(line.item_id),
                    movement_kind=movement_kind,
                    source_type="wh_stock_count",
                    source_id=count_doc.id,
                    quantity=abs(variance_qty),
                    unit_cost=unit_cost,
                    line_value=line_value,
                    running_avg_cost=after_avg_cost,
                    balance_before=before_qty,
                    balance_after=after_qty,
                    note=count_doc.note or f"تسوية جرد {count_doc.count_no}",
                    created_by=actor_id,
                    created_at=datetime.now(UTC),
                )
            )
            total_variance_qty += variance_qty
            total_variance_value += line_value

        count_doc.status = "settled"
        count_doc.settled_by = actor_id
        count_doc.settled_at = datetime.now(UTC)

        db.add(
            WarehouseIntegrationEvent(
                event_type="warehouse_stock_count_settled",
                source_type="wh_stock_count",
                source_id=count_doc.id,
                payload_json=json.dumps(
                    {
                        "count_id": count_doc.id,
                        "count_no": count_doc.count_no,
                        "total_variance_quantity": round(total_variance_qty, 4),
                        "total_variance_value": round(total_variance_value, 2),
                    },
                    ensure_ascii=False,
                ),
                status="pending",
            )
        )
        consume_pending_warehouse_integration_events(db)

    return get_warehouse_stock_count(db, count_id=count_doc.id)


def warehouse_dashboard(db: Session) -> dict[str, object]:
    active_items = int(
        db.execute(select(func.count(WarehouseItem.id)).where(WarehouseItem.active.is_(True))).scalar_one()
        or 0
    )
    active_suppliers = int(
        db.execute(
            select(func.count(WarehouseSupplier.id)).where(WarehouseSupplier.active.is_(True))
        ).scalar_one()
        or 0
    )

    with transaction_scope(db):
        item_ids = db.execute(select(WarehouseItem.id)).scalars().all()
        for item_id in item_ids:
            _get_or_create_balance(db, item_id=int(item_id))

    low_stock_items = int(
        db.execute(
            select(func.count(WarehouseItem.id))
            .join(WarehouseStockBalance, WarehouseStockBalance.item_id == WarehouseItem.id)
            .where(
                WarehouseItem.active.is_(True),
                WarehouseStockBalance.quantity <= WarehouseItem.alert_threshold,
            )
        ).scalar_one()
        or 0
    )

    today_key = datetime.now().strftime("%Y-%m-%d")
    inbound_today = float(
        db.execute(
            select(func.coalesce(func.sum(WarehouseStockLedger.quantity), 0.0))
            .where(
                WarehouseStockLedger.movement_kind == "inbound",
                func.date(WarehouseStockLedger.created_at, "localtime") == today_key,
            )
        ).scalar_one()
        or 0.0
    )
    outbound_today = float(
        db.execute(
            select(func.coalesce(func.sum(WarehouseStockLedger.quantity), 0.0))
            .where(
                WarehouseStockLedger.movement_kind == "outbound",
                func.date(WarehouseStockLedger.created_at, "localtime") == today_key,
            )
        ).scalar_one()
        or 0.0
    )

    return {
        "active_items": active_items,
        "active_suppliers": active_suppliers,
        "low_stock_items": low_stock_items,
        "inbound_today": inbound_today,
        "outbound_today": outbound_today,
    }



