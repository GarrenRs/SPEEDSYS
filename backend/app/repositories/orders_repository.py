from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..models import Order, OrderTransitionLog, Product


def fetch_available_sellable_products(
    db: Session,
    *,
    product_ids: list[int],
    sellable_kind: str,
) -> list[Product]:
    return (
        db.execute(
            select(Product).where(
                Product.id.in_(product_ids),
                Product.available.is_(True),
                Product.is_archived.is_(False),
                Product.kind == sellable_kind,
            )
        )
        .scalars()
        .all()
    )


def update_order_status_if_current_matches(
    db: Session,
    *,
    order_id: int,
    current_status: str,
    values: dict[str, object],
) -> int:
    result = db.execute(
        update(Order)
        .where(Order.id == order_id, Order.status == current_status)
        .values(**values)
    )
    return int(result.rowcount or 0)


def fetch_sent_to_kitchen_timestamps(db: Session, *, order_ids: list[int], sent_to_kitchen_status: str) -> dict[int, object]:
    rows = (
        db.execute(
            select(
                OrderTransitionLog.order_id,
                func.min(OrderTransitionLog.timestamp).label("sent_to_kitchen_at"),
            )
            .where(
                OrderTransitionLog.order_id.in_(order_ids),
                OrderTransitionLog.to_status == sent_to_kitchen_status,
            )
            .group_by(OrderTransitionLog.order_id)
        )
        .all()
    )
    return {int(row.order_id): row.sent_to_kitchen_at for row in rows}

