from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, asc, cast, desc, func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..dependencies import get_db, require_roles, require_route_capability
from ..enums import OrderStatus, UserRole
from ..models import Order, User
from ..schemas import KitchenOrdersPageOut, KitchenRuntimeSettingsOut, OrderOut
from ..services import attach_sent_to_kitchen_at, get_order_polling_ms, kitchen_monitor_summary, transition_order

router = APIRouter(
    prefix="/kitchen",
    tags=["kitchen"],
    dependencies=[Depends(require_route_capability)],
)
DEFAULT_KITCHEN_PAGE_SIZE = 24
MAX_KITCHEN_PAGE_SIZE = 100


def _extract_order_id_search(value: str) -> int | None:
    digits_only = "".join(char for char in value if char.isdigit())
    if not digits_only:
        return None
    return int(digits_only.lstrip("0") or "0")


@router.get("/orders", response_model=list[OrderOut])
def kitchen_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_KITCHEN_PAGE_SIZE, ge=1, le=MAX_KITCHEN_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.KITCHEN)),
    db: Session = Depends(get_db),
) -> list[Order]:
    visible_statuses = (
        OrderStatus.SENT_TO_KITCHEN.value,
        OrderStatus.IN_PREPARATION.value,
        OrderStatus.READY.value,
    )
    orders = db.execute(
        select(Order)
        .where(Order.status.in_(visible_statuses))
        .options(joinedload(Order.items))
        .order_by(Order.created_at.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().scalars().all()
    return attach_sent_to_kitchen_at(db, orders)


@router.get("/orders/paged", response_model=KitchenOrdersPageOut)
def kitchen_orders_paged(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
    search: str | None = Query(default=None),
    sort_by: Literal["created_at", "total", "status", "id"] = "created_at",
    sort_direction: Literal["asc", "desc"] = "asc",
    _: User = Depends(require_roles(UserRole.KITCHEN)),
    db: Session = Depends(get_db),
) -> KitchenOrdersPageOut:
    visible_statuses = (
        OrderStatus.SENT_TO_KITCHEN.value,
        OrderStatus.IN_PREPARATION.value,
        OrderStatus.READY.value,
    )
    conditions = [Order.status.in_(visible_statuses)]

    normalized_search = (search or "").strip()
    if normalized_search:
        like_value = f"%{normalized_search}%"
        maybe_order_id = _extract_order_id_search(normalized_search)
        search_terms = [
            cast(Order.id, String).ilike(like_value),
            Order.type.ilike(like_value),
            Order.status.ilike(like_value),
            Order.phone.ilike(like_value),
            Order.address.ilike(like_value),
            Order.notes.ilike(like_value),
        ]
        if maybe_order_id is not None:
            search_terms.append(Order.id == maybe_order_id)
        conditions.append(or_(*search_terms))

    total = int(db.execute(select(func.count(Order.id)).where(*conditions)).scalar_one() or 0)

    sort_map = {
        "created_at": Order.created_at,
        "total": Order.total,
        "status": Order.status,
        "id": Order.id,
    }
    direction = asc if sort_direction == "asc" else desc
    sort_column = sort_map[sort_by]

    items = db.execute(
        select(Order)
        .where(*conditions)
        .options(joinedload(Order.items))
        .order_by(direction(sort_column), asc(Order.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().scalars().all()

    return KitchenOrdersPageOut(
        items=attach_sent_to_kitchen_at(db, items),
        total=total,
        page=page,
        page_size=page_size,
        summary=kitchen_monitor_summary(db),
    )


@router.get("/runtime-settings", response_model=KitchenRuntimeSettingsOut)
def kitchen_runtime_settings(
    _: User = Depends(require_roles(UserRole.KITCHEN)),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    return {"order_polling_ms": get_order_polling_ms(db)}


@router.post("/orders/{order_id}/start", response_model=OrderOut)
def start_preparation(
    order_id: int,
    current_user: User = Depends(require_roles(UserRole.KITCHEN)),
    db: Session = Depends(get_db),
) -> Order:
    return transition_order(
        db,
        order_id=order_id,
        target_status=OrderStatus.IN_PREPARATION,
        performed_by=current_user.id,
    )


@router.post("/orders/{order_id}/ready", response_model=OrderOut)
def mark_ready(
    order_id: int,
    current_user: User = Depends(require_roles(UserRole.KITCHEN)),
    db: Session = Depends(get_db),
) -> Order:
    return transition_order(
        db,
        order_id=order_id,
        target_status=OrderStatus.READY,
        performed_by=current_user.id,
    )
