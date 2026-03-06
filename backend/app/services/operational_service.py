from . import shared as _shared

globals().update({name: getattr(_shared, name) for name in _shared.__all__})


def _get_or_create_system_order_actor_id(db: Session, *, actor_key: str) -> int:
    actor_meta = SYSTEM_ORDER_ACTORS.get(actor_key, SYSTEM_ORDER_ACTORS["system"])
    existing_id = db.execute(
        select(User.id).where(User.username == actor_meta["username"])
    ).scalars().first()
    if existing_id is not None:
        return int(existing_id)

    with transaction_scope(db):
        existing = db.execute(
            select(User.id).where(User.username == actor_meta["username"])
        ).scalars().first()
        if existing is not None:
            return int(existing)

        actor_user = User(
            name=actor_meta["name"],
            username=actor_meta["username"],
            password_hash=hash_password(f"{uuid4().hex}-system-actor"),
            role=UserRole.MANAGER.value,
            active=False,
        )
        db.add(actor_user)
        db.flush()
        return int(actor_user.id)

def _resolve_order_creator_id(
    db: Session,
    created_by: int | None,
    *,
    fallback_actor: str = "system",
) -> int | None:
    if created_by is not None:
        return created_by
    return _get_or_create_system_order_actor_id(db, actor_key=fallback_actor)

def _count_active_role_users(db: Session, *, role: UserRole) -> int:
    return int(
        db.execute(
            select(func.count(User.id)).where(
                User.role == role.value,
                User.active.is_(True),
            )
        ).scalar_one()
        or 0
    )

def _count_active_delivery_users(db: Session) -> int:
    return int(
        db.execute(
            select(func.count(User.id))
            .select_from(User)
            .join(DeliveryDriver, DeliveryDriver.user_id == User.id)
            .where(
                User.role == UserRole.DELIVERY.value,
                User.active.is_(True),
                DeliveryDriver.active.is_(True),
                DeliveryDriver.status != DriverStatus.INACTIVE.value,
            )
        ).scalar_one()
        or 0
    )

def _has_blocking_orders_for_kitchen_shutdown(db: Session) -> bool:
    blocking_statuses = (
        OrderStatus.SENT_TO_KITCHEN.value,
        OrderStatus.IN_PREPARATION.value,
    )
    return (
        db.execute(
            select(Order.id).where(Order.status.in_(blocking_statuses)).limit(1)
        ).scalar_one_or_none()
        is not None
    )

def _has_blocking_orders_for_delivery_shutdown(db: Session) -> bool:
    blocking_statuses = (
        OrderStatus.SENT_TO_KITCHEN.value,
        OrderStatus.IN_PREPARATION.value,
        OrderStatus.READY.value,
        OrderStatus.OUT_FOR_DELIVERY.value,
    )
    return (
        db.execute(
            select(Order.id)
            .where(
                Order.type == OrderType.DELIVERY.value,
                Order.status.in_(blocking_statuses),
            )
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )

def ensure_kitchen_capacity_reduction_allowed(db: Session) -> None:
    active_kitchen_users = _count_active_role_users(db, role=UserRole.KITCHEN)
    if active_kitchen_users > 1:
        return
    if not _has_blocking_orders_for_kitchen_shutdown(db):
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="لا يمكن تعطيل آخر مستخدم مطبخ نشط مع وجود طلبات قيد المطبخ. عيّن بديلاً أولاً.",
    )

def ensure_delivery_capacity_reduction_allowed(db: Session) -> None:
    active_delivery_users = _count_active_delivery_users(db)
    if active_delivery_users > 1:
        return
    if not _has_blocking_orders_for_delivery_shutdown(db):
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="لا يمكن تعطيل آخر عنصر توصيل نشط مع وجود طلبات توصيل جارية. عيّن بديلاً أولاً.",
    )

def get_operational_capabilities(db: Session) -> dict[str, object]:
    kitchen_active_users = _count_active_role_users(db, role=UserRole.KITCHEN)
    delivery_active_users = _count_active_delivery_users(db)

    kitchen_enabled = kitchen_active_users > 0
    delivery_enabled = delivery_active_users > 0

    return {
        "kitchen_enabled": kitchen_enabled,
        "delivery_enabled": delivery_enabled,
        "kitchen_active_users": kitchen_active_users,
        "delivery_active_users": delivery_active_users,
        "kitchen_block_reason": None if kitchen_enabled else KITCHEN_DISABLED_MESSAGE,
        "delivery_block_reason": None if delivery_enabled else DELIVERY_DISABLED_MESSAGE,
    }

def ensure_kitchen_operational(db: Session) -> None:
    capabilities = get_operational_capabilities(db)
    if capabilities["kitchen_enabled"]:
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=str(capabilities["kitchen_block_reason"] or KITCHEN_DISABLED_MESSAGE),
    )

def ensure_delivery_operational(db: Session) -> None:
    capabilities = get_operational_capabilities(db)
    if capabilities["delivery_enabled"]:
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=str(capabilities["delivery_block_reason"] or DELIVERY_DISABLED_MESSAGE),
    )
