from . import shared as _shared
from .orders_service import ensure_transition_allowed

globals().update({name: getattr(_shared, name) for name in _shared.__all__})


def get_delivery_driver_for_user(db: Session, *, user_id: int, require_active: bool = True) -> DeliveryDriver:
    driver = db.execute(select(DeliveryDriver).where(DeliveryDriver.user_id == user_id)).scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لا يوجد ملف سائق توصيل مرتبط بهذا المستخدم.")
    if require_active and (not driver.active or driver.status == DriverStatus.INACTIVE.value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="سائق التوصيل غير نشط.")
    return driver

def notify_delivery_team(
    db: Session,
    *,
    order_id: int,
    actor_id: int,
) -> Order:
    app_ensure_delivery_operational(db)
    with transaction_scope(db):
        order = get_order_or_404(db, order_id)
        if order.type != OrderType.DELIVERY.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الطلب ليس من نوع التوصيل.")
        if order.status != OrderStatus.IN_PREPARATION.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="تنبيه فريق التوصيل متاح فقط أثناء التحضير.")

        active_assignment = db.execute(
            select(DeliveryAssignment)
            .where(
                DeliveryAssignment.order_id == order_id,
                DeliveryAssignment.status.in_(
                    [
                        DeliveryAssignmentStatus.ASSIGNED.value,
                        DeliveryAssignmentStatus.DEPARTED.value,
                    ]
                ),
            )
            .order_by(DeliveryAssignment.id.desc())
        ).scalar_one_or_none()

        if active_assignment:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="تم تنبيه فريق التوصيل مسبقًا لهذا الطلب.",
            )

        order.delivery_team_notified_at = datetime.now(UTC)
        order.delivery_team_notified_by = actor_id
    return get_order_or_404(db, order_id)

def claim_delivery_order(
    db: Session,
    *,
    order_id: int,
    actor_id: int,
) -> DeliveryAssignment:
    app_ensure_delivery_operational(db)
    with transaction_scope(db):
        driver = get_delivery_driver_for_user(db, user_id=actor_id, require_active=True)
        order = get_order_or_404(db, order_id)
        if order.type != OrderType.DELIVERY.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الطلب ليس من نوع التوصيل.")
        if order.status != OrderStatus.IN_PREPARATION.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="التقاط الطلب متاح فقط أثناء التحضير.")
        if order.delivery_team_notified_at is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لم يتم تنبيه فريق التوصيل لهذا الطلب.")

        active_assignment = db.execute(
            select(DeliveryAssignment)
            .where(
                DeliveryAssignment.order_id == order_id,
                DeliveryAssignment.status.in_(
                    [
                        DeliveryAssignmentStatus.ASSIGNED.value,
                        DeliveryAssignmentStatus.DEPARTED.value,
                    ]
                ),
            )
            .order_by(DeliveryAssignment.id.desc())
        ).scalar_one_or_none()
        if active_assignment:
            if active_assignment.driver_id == driver.id:
                return active_assignment
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="تم التقاط الطلب بواسطة سائق آخر.")

        if driver.status == DriverStatus.BUSY.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="سائق التوصيل مشغول بطلب آخر.")

        reserved = db.execute(
            update(Order)
            .where(
                Order.id == order_id,
                Order.status == OrderStatus.IN_PREPARATION.value,
                Order.delivery_team_notified_at.is_not(None),
            )
            .values(delivery_team_notified_at=None)
        )
        if reserved.rowcount != 1:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="تم التقاط الطلب بواسطة سائق آخر.")

        assignment = DeliveryAssignment(
            order_id=order_id,
            driver_id=driver.id,
            status=DeliveryAssignmentStatus.ASSIGNED.value,
        )
        db.add(assignment)
        db.flush()
        driver.status = DriverStatus.BUSY.value
    return assignment

def start_delivery(db: Session, *, order_id: int, actor_id: int) -> Order:
    app_ensure_delivery_operational(db)
    with transaction_scope(db):
        order = get_order_or_404(db, order_id)
        if order.type != OrderType.DELIVERY.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الطلب ليس من نوع التوصيل.")
        driver = get_delivery_driver_for_user(db, user_id=actor_id, require_active=True)

        assignment = db.execute(
            select(DeliveryAssignment)
            .where(
                DeliveryAssignment.order_id == order_id,
                DeliveryAssignment.driver_id == driver.id,
                DeliveryAssignment.status == DeliveryAssignmentStatus.ASSIGNED.value,
            )
            .order_by(DeliveryAssignment.id.desc())
        ).scalar_one_or_none()
        if not assignment:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="هذا الطلب غير مُسند إلى هذا السائق.")

        ensure_transition_allowed(order.status, OrderStatus.OUT_FOR_DELIVERY, order.type)
        result = db.execute(
            update(Order)
            .where(Order.id == order_id, Order.status == order.status)
            .values(status=OrderStatus.OUT_FOR_DELIVERY.value)
        )
        if result.rowcount != 1:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="تعذر تحديث حالة الطلب.")

        assignment.status = DeliveryAssignmentStatus.DEPARTED.value
        assignment.departed_at = datetime.now(UTC)

        driver.status = DriverStatus.BUSY.value

        _record_transition(
            db,
            order_id=order_id,
            from_status=order.status,
            to_status=OrderStatus.OUT_FOR_DELIVERY.value,
            user_id=actor_id,
        )

    return get_order_or_404(db, order_id)

def complete_delivery(
    db: Session,
    *,
    order_id: int,
    actor_id: int,
    success: bool,
    amount_received: float | None = None,
) -> Order:
    app_ensure_delivery_operational(db)
    with transaction_scope(db):
        order = get_order_or_404(db, order_id)
        driver = get_delivery_driver_for_user(db, user_id=actor_id, require_active=False)
        assignment = db.execute(
            select(DeliveryAssignment)
            .where(
                DeliveryAssignment.order_id == order_id,
                DeliveryAssignment.driver_id == driver.id,
                DeliveryAssignment.status == DeliveryAssignmentStatus.DEPARTED.value,
            )
            .order_by(DeliveryAssignment.id.desc())
        ).scalar_one_or_none()
        if not assignment:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="لا يمكن إنهاء طلب غير تابع لك أو خارج مسار التوصيل.")

        target = OrderStatus.DELIVERED if success else OrderStatus.DELIVERY_FAILED
        ensure_transition_allowed(order.status, target, order.type)

        update_values: dict[str, object] = {"status": target.value}
        if target == OrderStatus.DELIVERED:
            # Delivery staff cannot override collected total: always settle with server-side order total.
            update_values.update(app_mark_cash_paid(db, order, order.total, actor_id))
            assignment.status = DeliveryAssignmentStatus.DELIVERED.value
            assignment.delivered_at = datetime.now(UTC)
        else:
            assignment.status = DeliveryAssignmentStatus.FAILED.value
            assignment.delivered_at = datetime.now(UTC)

        result = db.execute(
            update(Order)
            .where(Order.id == order_id, Order.status == order.status)
            .values(**update_values)
        )
        if result.rowcount != 1:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="تعذر تحديث حالة الطلب.")

        driver.status = DriverStatus.AVAILABLE.value if driver.active else DriverStatus.INACTIVE.value

        _record_transition(
            db,
            order_id=order_id,
            from_status=order.status,
            to_status=target.value,
            user_id=actor_id,
        )
    return get_order_or_404(db, order_id)

def emergency_fail_delivery_order(
    db: Session,
    *,
    order_id: int,
    performed_by: int,
    reason_code: str,
    reason_note: str | None = None,
) -> Order:
    capabilities = get_operational_capabilities(db)
    if capabilities["delivery_enabled"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="الإغلاق الطارئ لطلبات التوصيل متاح فقط عند تعطيل نظام التوصيل.",
        )

    with transaction_scope(db):
        order = get_order_or_404(db, order_id)
        if order.type != OrderType.DELIVERY.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الطلب ليس من نوع التوصيل.")
        if order.status in TERMINAL_ORDER_STATUSES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الطلب مُغلق بالفعل.")
        if order.status not in (
            OrderStatus.IN_PREPARATION.value,
            OrderStatus.READY.value,
            OrderStatus.OUT_FOR_DELIVERY.value,
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="الإغلاق الطارئ متاح فقط للطلبات النشطة داخل مسار التوصيل.",
            )
        reason_label = _resolve_standard_reason(
            reason_code=reason_code,
            reasons_map=EMERGENCY_DELIVERY_FAIL_REASONS,
            error_detail="سبب الإغلاق الطارئ مطلوب ويجب أن يكون ضمن الأسباب المعتمدة.",
        )
        emergency_reason_text = _compose_reason_text(reason_label, reason_note)
        current_notes = _normalize_optional_text(order.notes)

        active_assignment = db.execute(
            select(DeliveryAssignment)
            .where(
                DeliveryAssignment.order_id == order_id,
                DeliveryAssignment.status.in_(
                    [
                        DeliveryAssignmentStatus.ASSIGNED.value,
                        DeliveryAssignmentStatus.DEPARTED.value,
                    ]
                ),
            )
            .order_by(DeliveryAssignment.id.desc())
        ).scalar_one_or_none()

        if active_assignment is not None:
            active_assignment.status = DeliveryAssignmentStatus.FAILED.value
            active_assignment.delivered_at = datetime.now(UTC)
            driver = db.execute(
                select(DeliveryDriver).where(DeliveryDriver.id == active_assignment.driver_id)
            ).scalar_one_or_none()
            if driver is not None:
                driver.status = DriverStatus.AVAILABLE.value if driver.active else DriverStatus.INACTIVE.value

        result = db.execute(
            update(Order)
            .where(Order.id == order.id, Order.status == order.status)
            .values(
                status=OrderStatus.DELIVERY_FAILED.value,
                delivery_team_notified_at=None,
                notes=(
                    f"{current_notes}\nسبب الإغلاق الطارئ للتوصيل: {emergency_reason_text}"
                    if current_notes
                    else f"سبب الإغلاق الطارئ للتوصيل: {emergency_reason_text}"
                ),
            )
        )
        if result.rowcount != 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="حدث تعارض أثناء الإغلاق الطارئ، يرجى إعادة المحاولة.",
            )

        _record_transition(
            db,
            order_id=order.id,
            from_status=order.status,
            to_status=OrderStatus.DELIVERY_FAILED.value,
            user_id=performed_by,
        )
        _record_system_audit(
            db,
            module="delivery",
            action="emergency_fail_order",
            entity_type="order",
            entity_id=order.id,
            user_id=performed_by,
            description=f"إغلاق طارئ لطلب التوصيل #{order.id} | السبب: {emergency_reason_text}",
        )

    return get_order_or_404(db, order_id)
