from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..dependencies import get_db, require_roles, require_route_capability
from ..enums import UserRole
from ..models import User, WarehouseItem
from ..schemas import (
    WarehouseDashboardOut,
    WarehouseInboundVoucherCreate,
    WarehouseInboundVoucherOut,
    WarehouseItemCreate,
    WarehouseItemOut,
    WarehouseItemUpdate,
    WarehouseLedgerOut,
    WarehouseOutboundReasonOut,
    WarehouseOutboundVoucherCreate,
    WarehouseOutboundVoucherOut,
    WarehouseStockCountCreate,
    WarehouseStockCountOut,
    WarehouseStockBalanceOut,
    WarehouseSupplierCreate,
    WarehouseSupplierOut,
    WarehouseSupplierUpdate,
)
from ..warehouse_services import (
    create_warehouse_stock_count,
    create_warehouse_inbound_voucher,
    create_warehouse_item,
    create_warehouse_outbound_voucher,
    create_warehouse_supplier,
    list_warehouse_balances,
    list_warehouse_inbound_vouchers,
    list_warehouse_items,
    list_warehouse_ledger,
    list_warehouse_outbound_reasons,
    list_warehouse_outbound_vouchers,
    list_warehouse_stock_counts,
    settle_warehouse_stock_count,
    list_warehouse_suppliers,
    update_warehouse_item,
    update_warehouse_supplier,
    warehouse_dashboard,
)

router = APIRouter(
    prefix="/manager/warehouse",
    tags=["manager-warehouse"],
    dependencies=[Depends(require_route_capability)],
)
DEFAULT_WAREHOUSE_PAGE_SIZE = 50
MAX_WAREHOUSE_PAGE_SIZE = 200


@router.get("/dashboard", response_model=WarehouseDashboardOut)
def get_warehouse_dashboard(
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return warehouse_dashboard(db)


@router.get("/suppliers", response_model=list[WarehouseSupplierOut])
def get_warehouse_suppliers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_WAREHOUSE_PAGE_SIZE, ge=1, le=MAX_WAREHOUSE_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
 ) -> list[dict[str, object]]:
    return list_warehouse_suppliers(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/suppliers", response_model=WarehouseSupplierOut, status_code=201)
def post_warehouse_supplier(
    payload: WarehouseSupplierCreate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return create_warehouse_supplier(
        db,
        name=payload.name,
        phone=payload.phone,
        email=payload.email,
        address=payload.address,
        payment_term_days=payload.payment_term_days,
        credit_limit=payload.credit_limit,
        quality_rating=payload.quality_rating,
        lead_time_days=payload.lead_time_days,
        notes=payload.notes,
        active=payload.active,
        supplied_item_ids=payload.supplied_item_ids,
    )


@router.put("/suppliers/{supplier_id}", response_model=WarehouseSupplierOut)
def put_warehouse_supplier(
    supplier_id: int,
    payload: WarehouseSupplierUpdate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return update_warehouse_supplier(
        db,
        supplier_id=supplier_id,
        name=payload.name,
        phone=payload.phone,
        email=payload.email,
        address=payload.address,
        payment_term_days=payload.payment_term_days,
        credit_limit=payload.credit_limit,
        quality_rating=payload.quality_rating,
        lead_time_days=payload.lead_time_days,
        notes=payload.notes,
        active=payload.active,
        supplied_item_ids=payload.supplied_item_ids,
    )


@router.get("/items", response_model=list[WarehouseItemOut])
def get_warehouse_items(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_WAREHOUSE_PAGE_SIZE, ge=1, le=MAX_WAREHOUSE_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[WarehouseItem]:
    return list_warehouse_items(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/items", response_model=WarehouseItemOut, status_code=201)
def post_warehouse_item(
    payload: WarehouseItemCreate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> WarehouseItem:
    return create_warehouse_item(
        db,
        name=payload.name,
        unit=payload.unit,
        alert_threshold=payload.alert_threshold,
        active=payload.active,
    )


@router.put("/items/{item_id}", response_model=WarehouseItemOut)
def put_warehouse_item(
    item_id: int,
    payload: WarehouseItemUpdate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> WarehouseItem:
    return update_warehouse_item(
        db,
        item_id=item_id,
        name=payload.name,
        unit=payload.unit,
        alert_threshold=payload.alert_threshold,
        active=payload.active,
    )


@router.get("/balances", response_model=list[WarehouseStockBalanceOut])
def get_warehouse_balances(
    only_low: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_WAREHOUSE_PAGE_SIZE, ge=1, le=MAX_WAREHOUSE_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_warehouse_balances(
        db,
        only_low=only_low,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.get("/ledger", response_model=list[WarehouseLedgerOut])
def get_warehouse_ledger(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_WAREHOUSE_PAGE_SIZE, ge=1, le=1000),
    item_id: int | None = Query(default=None),
    movement_kind: str | None = Query(default=None),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_warehouse_ledger(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
        item_id=item_id,
        movement_kind=movement_kind,
    )


@router.get("/inbound-vouchers", response_model=list[WarehouseInboundVoucherOut])
def get_inbound_vouchers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_WAREHOUSE_PAGE_SIZE, ge=1, le=500),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_warehouse_inbound_vouchers(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/inbound-vouchers", response_model=WarehouseInboundVoucherOut, status_code=201)
def post_inbound_voucher(
    payload: WarehouseInboundVoucherCreate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return create_warehouse_inbound_voucher(
        db,
        supplier_id=payload.supplier_id,
        reference_no=payload.reference_no,
        note=payload.note,
        idempotency_key=payload.idempotency_key,
        items=[(item.item_id, item.quantity, item.unit_cost) for item in payload.items],
        actor_id=current_user.id,
    )


@router.get("/outbound-vouchers", response_model=list[WarehouseOutboundVoucherOut])
def get_outbound_vouchers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_WAREHOUSE_PAGE_SIZE, ge=1, le=500),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_warehouse_outbound_vouchers(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.get("/outbound-reasons", response_model=list[WarehouseOutboundReasonOut])
def get_outbound_reasons(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_WAREHOUSE_PAGE_SIZE, ge=1, le=MAX_WAREHOUSE_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
) -> list[dict[str, str]]:
    offset = (page - 1) * page_size
    rows = list_warehouse_outbound_reasons()
    return rows[offset:offset + page_size]


@router.post("/outbound-vouchers", response_model=WarehouseOutboundVoucherOut, status_code=201)
def post_outbound_voucher(
    payload: WarehouseOutboundVoucherCreate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return create_warehouse_outbound_voucher(
        db,
        reason_code=payload.reason_code,
        reason_note=payload.reason_note,
        note=payload.note,
        idempotency_key=payload.idempotency_key,
        items=[(item.item_id, item.quantity) for item in payload.items],
        actor_id=current_user.id,
    )


@router.get("/stock-counts", response_model=list[WarehouseStockCountOut])
def get_stock_counts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_WAREHOUSE_PAGE_SIZE, ge=1, le=500),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_warehouse_stock_counts(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/stock-counts", response_model=WarehouseStockCountOut, status_code=201)
def post_stock_count(
    payload: WarehouseStockCountCreate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return create_warehouse_stock_count(
        db,
        note=payload.note,
        idempotency_key=payload.idempotency_key,
        items=[(item.item_id, item.counted_quantity) for item in payload.items],
        actor_id=current_user.id,
    )


@router.post("/stock-counts/{count_id}/settle", response_model=WarehouseStockCountOut)
def post_settle_stock_count(
    count_id: int,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return settle_warehouse_stock_count(db, count_id=count_id, actor_id=current_user.id)
