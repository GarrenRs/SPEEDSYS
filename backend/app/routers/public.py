from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..enums import ProductKind
from ..models import Order, Product, RestaurantTable
from ..schemas import (
    CreateOrderInput,
    DeliverySettingsOut,
    OperationalCapabilitiesOut,
    OrderOut,
    PublicProductOut,
    TableOut,
    TableSessionOut,
)
from ..services import (
    create_order as create_order_service,
    get_delivery_fee_setting,
    get_operational_capabilities,
    get_table_session_snapshot,
)

router = APIRouter(prefix="/public", tags=["public"])
DEFAULT_PUBLIC_PAGE_SIZE = 24
MAX_PUBLIC_PAGE_SIZE = 100


@router.get("/products", response_model=list[PublicProductOut])
def list_public_products(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PUBLIC_PAGE_SIZE, ge=1, le=MAX_PUBLIC_PAGE_SIZE),
    db: Session = Depends(get_db),
) -> list[Product]:
    offset = (page - 1) * page_size
    return db.execute(
        select(Product)
        .where(
            Product.available.is_(True),
            Product.is_archived.is_(False),
            Product.kind == ProductKind.SELLABLE.value,
        )
        .order_by(Product.id.asc())
        .offset(offset)
        .limit(page_size)
    ).scalars().all()


@router.get("/tables", response_model=list[TableOut])
def list_tables(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PUBLIC_PAGE_SIZE, ge=1, le=MAX_PUBLIC_PAGE_SIZE),
    db: Session = Depends(get_db),
) -> list[RestaurantTable]:
    return db.execute(
        select(RestaurantTable)
        .order_by(RestaurantTable.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars().all()


@router.get("/tables/{table_id}/session", response_model=TableSessionOut)
def get_public_table_session(table_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    return get_table_session_snapshot(db, table_id=table_id)


@router.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(payload: CreateOrderInput, db: Session = Depends(get_db)) -> Order:
    capabilities = get_operational_capabilities(db)
    if not capabilities["kitchen_enabled"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(capabilities["kitchen_block_reason"] or "Kitchen is currently unavailable."),
        )
    return create_order_service(db, payload=payload, source_actor="public")


@router.get("/delivery/settings", response_model=DeliverySettingsOut)
def public_delivery_settings(db: Session = Depends(get_db)) -> DeliverySettingsOut:
    return DeliverySettingsOut(delivery_fee=get_delivery_fee_setting(db))


@router.get("/operational-capabilities", response_model=OperationalCapabilitiesOut)
def public_operational_capabilities(db: Session = Depends(get_db)) -> dict[str, object]:
    return get_operational_capabilities(db)
