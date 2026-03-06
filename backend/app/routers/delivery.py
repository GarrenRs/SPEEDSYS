from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import exists, select
from sqlalchemy.orm import Session, joinedload

from ..dependencies import get_db, require_roles, require_route_capability
from ..enums import DeliveryAssignmentStatus, OrderStatus, OrderType, UserRole
from ..models import DeliveryAssignment, Order, User
from ..schemas import DeliveryAssignmentOut, DeliveryHistoryOut, OrderOut, OrderTransitionInput
from ..services import (
    claim_delivery_order,
    complete_delivery,
    get_delivery_driver_for_user,
    start_delivery,
)

router = APIRouter(
    prefix="/delivery",
    tags=["delivery"],
    dependencies=[Depends(require_route_capability)],
)
DEFAULT_DELIVERY_PAGE_SIZE = 30
MAX_DELIVERY_PAGE_SIZE = 100


@router.get("/assignments", response_model=list[DeliveryAssignmentOut])
def my_assignments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_DELIVERY_PAGE_SIZE, ge=1, le=MAX_DELIVERY_PAGE_SIZE),
    current_user: User = Depends(require_roles(UserRole.DELIVERY, UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[DeliveryAssignment]:
    offset = (page - 1) * page_size
    if current_user.role == UserRole.MANAGER.value:
        return db.execute(
            select(DeliveryAssignment)
            .order_by(DeliveryAssignment.assigned_at.desc(), DeliveryAssignment.id.desc())
            .offset(offset)
            .limit(page_size)
        ).scalars().all()

    try:
        driver = get_delivery_driver_for_user(db, user_id=current_user.id, require_active=False)
    except HTTPException as error:
        if error.status_code == 400:
            return []
        raise
    return db.execute(
        select(DeliveryAssignment)
        .where(
            DeliveryAssignment.driver_id == driver.id,
            DeliveryAssignment.status.in_(
                [
                    DeliveryAssignmentStatus.ASSIGNED.value,
                    DeliveryAssignmentStatus.DEPARTED.value,
                ]
            ),
        )
        .order_by(DeliveryAssignment.assigned_at.desc(), DeliveryAssignment.id.desc())
        .offset(offset)
        .limit(page_size)
    ).scalars().all()


@router.get("/orders", response_model=list[OrderOut])
def delivery_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_DELIVERY_PAGE_SIZE, ge=1, le=MAX_DELIVERY_PAGE_SIZE),
    current_user: User = Depends(require_roles(UserRole.DELIVERY, UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[Order]:
    offset = (page - 1) * page_size
    active_statuses = [
        DeliveryAssignmentStatus.ASSIGNED.value,
        DeliveryAssignmentStatus.DEPARTED.value,
    ]
    active_assignment_exists = exists(
        select(DeliveryAssignment.id).where(
            DeliveryAssignment.order_id == Order.id,
            DeliveryAssignment.status.in_(active_statuses),
        )
    )
    pending_unassigned_condition = (
        (Order.status == OrderStatus.IN_PREPARATION.value)
        & Order.delivery_team_notified_at.is_not(None)
        & ~active_assignment_exists
    )

    if current_user.role == UserRole.MANAGER.value:
        visibility_condition = active_assignment_exists | pending_unassigned_condition
    else:
        try:
            driver = get_delivery_driver_for_user(db, user_id=current_user.id, require_active=False)
        except HTTPException as error:
            if error.status_code == 400:
                return []
            raise
        my_active_assignment_exists = exists(
            select(DeliveryAssignment.id).where(
                DeliveryAssignment.order_id == Order.id,
                DeliveryAssignment.driver_id == driver.id,
                DeliveryAssignment.status.in_(active_statuses),
            )
        )
        visibility_condition = my_active_assignment_exists | pending_unassigned_condition

    return db.execute(
        select(Order)
        .where(
            Order.type == OrderType.DELIVERY.value,
            visibility_condition,
        )
        .options(joinedload(Order.items))
        .order_by(Order.created_at.asc(), Order.id.asc())
        .offset(offset)
        .limit(page_size)
    ).unique().scalars().all()


@router.post("/orders/{order_id}/claim", response_model=DeliveryAssignmentOut)
def claim_order(
    order_id: int,
    current_user: User = Depends(require_roles(UserRole.DELIVERY)),
    db: Session = Depends(get_db),
) -> DeliveryAssignment:
    return claim_delivery_order(db, order_id=order_id, actor_id=current_user.id)


@router.post("/orders/{order_id}/depart", response_model=OrderOut)
def depart_order(
    order_id: int,
    current_user: User = Depends(require_roles(UserRole.DELIVERY)),
    db: Session = Depends(get_db),
) -> Order:
    return start_delivery(db, order_id=order_id, actor_id=current_user.id)


@router.post("/orders/{order_id}/delivered", response_model=OrderOut)
def mark_delivered(
    order_id: int,
    payload: OrderTransitionInput,
    current_user: User = Depends(require_roles(UserRole.DELIVERY)),
    db: Session = Depends(get_db),
) -> Order:
    return complete_delivery(
        db,
        order_id=order_id,
        actor_id=current_user.id,
        success=True,
        amount_received=payload.amount_received,
    )


@router.post("/orders/{order_id}/failed", response_model=OrderOut)
def mark_failed(
    order_id: int,
    current_user: User = Depends(require_roles(UserRole.DELIVERY)),
    db: Session = Depends(get_db),
) -> Order:
    return complete_delivery(
        db,
        order_id=order_id,
        actor_id=current_user.id,
        success=False,
    )


@router.get("/history", response_model=list[DeliveryHistoryOut])
def delivery_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_DELIVERY_PAGE_SIZE, ge=1, le=MAX_DELIVERY_PAGE_SIZE),
    current_user: User = Depends(require_roles(UserRole.DELIVERY)),
    db: Session = Depends(get_db),
) -> list[DeliveryHistoryOut]:
    try:
        driver = get_delivery_driver_for_user(db, user_id=current_user.id, require_active=False)
    except HTTPException as error:
        if error.status_code == 400:
            return []
        raise

    rows = db.execute(
        select(DeliveryAssignment, Order)
        .join(Order, Order.id == DeliveryAssignment.order_id)
        .where(
            DeliveryAssignment.driver_id == driver.id,
            DeliveryAssignment.status.in_(
                [
                    DeliveryAssignmentStatus.DELIVERED.value,
                    DeliveryAssignmentStatus.FAILED.value,
                ]
            ),
        )
        .order_by(DeliveryAssignment.delivered_at.desc(), DeliveryAssignment.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return [
        DeliveryHistoryOut(
            assignment_id=assignment.id,
            order_id=order.id,
            assignment_status=DeliveryAssignmentStatus(assignment.status),
            order_status=OrderStatus(order.status),
            assigned_at=assignment.assigned_at,
            departed_at=assignment.departed_at,
            delivered_at=assignment.delivered_at,
            order_subtotal=order.subtotal,
            delivery_fee=order.delivery_fee,
            order_total=order.total,
            phone=order.phone,
            address=order.address,
        )
        for assignment, order in rows
    ]
