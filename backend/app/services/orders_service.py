from . import shared as _shared
from ..repositories.orders_repository import (
    fetch_available_sellable_products,
    fetch_sent_to_kitchen_timestamps,
    update_order_status_if_current_matches,
)

globals().update({name: getattr(_shared, name) for name in _shared.__all__})


def create_order(
    db: Session,
    *,
    payload: CreateOrderInput,
    created_by: int | None = None,
    source_actor: str = "system",
) -> Order:
    if payload.type == OrderType.DELIVERY:
        app_ensure_delivery_operational(db)

    product_ids = [item.product_id for item in payload.items]
    products = fetch_available_sellable_products(
        db,
        product_ids=product_ids,
        sellable_kind=ProductKind.SELLABLE.value,
    )
    product_map = {product.id: product for product in products}

    missing_products = [pid for pid in product_ids if pid not in product_map]
    if missing_products:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"هذه المنتجات غير متاحة: {missing_products}",
        )

    table: RestaurantTable | None = None
    if payload.table_id is not None:
        table = get_table_or_404(db, payload.table_id)

    actor_id = app_resolve_order_creator_id(db, created_by, fallback_actor=source_actor)
    delivery_policy = (
        app_get_delivery_policy_settings(db)
        if payload.type == OrderType.DELIVERY
        else {"min_order_amount": 0.0, "auto_notify_team": False}
    )
    fixed_delivery_fee = app_get_delivery_fee_setting(db) if payload.type == OrderType.DELIVERY else 0.0
    with transaction_scope(db):
        order = Order(
            type=payload.type.value,
            status=OrderStatus.CREATED.value,
            table_id=payload.table_id,
            phone=payload.phone,
            address=payload.address,
            notes=payload.notes,
            subtotal=0,
            delivery_fee=fixed_delivery_fee,
            payment_status=PaymentStatus.UNPAID.value,
            payment_method="cash",
        )
        db.add(order)
        db.flush()

        subtotal = 0.0
        for raw_item in payload.items:
            product = product_map[raw_item.product_id]
            line_total = product.price * raw_item.quantity
            subtotal += line_total
            db.add(
                OrderItem(
                    order_id=order.id,
                    product_id=product.id,
                    quantity=raw_item.quantity,
                    price=product.price,
                    product_name=product.name,
                )
            )

        order.subtotal = subtotal
        if payload.type == OrderType.DELIVERY and subtotal < float(delivery_policy["min_order_amount"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"الحد الأدنى لطلبات التوصيل هو {float(delivery_policy['min_order_amount']):.2f} د.ج.",
            )
        order.total = subtotal + fixed_delivery_fee
        if payload.type == OrderType.DINE_IN and table is not None:
            table.status = TableStatus.OCCUPIED.value
        if actor_id is not None:
            _record_transition(
                db,
                order_id=order.id,
                from_status=OrderStatus.CREATED.value,
                to_status=OrderStatus.CREATED.value,
                user_id=actor_id,
            )

    return get_order_or_404(db, order.id)

def ensure_transition_allowed(current: str, target: OrderStatus, order_type: str) -> None:
    try:
        current_status = OrderStatus(current)
        order_type_value = OrderType(order_type)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="حالة الطلب غير صالحة.") from error

    if not can_transition(current_status, target, order_type_value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"لا يمكن الانتقال من {current_status.value} إلى {target.value}.",
        )

def transition_order(
    db: Session,
    *,
    order_id: int,
    target_status: OrderStatus,
    performed_by: int,
    amount_received: float | None = None,
    collect_payment: bool = True,
    reason_code: str | None = None,
    reason_note: str | None = None,
) -> Order:
    with transaction_scope(db):
        order = get_order_or_404(db, order_id)
        ensure_transition_allowed(order.status, target_status, order.type)
        if target_status in (OrderStatus.SENT_TO_KITCHEN, OrderStatus.IN_PREPARATION, OrderStatus.READY):
            app_ensure_kitchen_operational(db)
        if target_status in (OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERY_FAILED):
            app_ensure_delivery_operational(db)

        update_values: dict[str, object] = {"status": target_status.value}
        cancellation_reason_text: str | None = None

        if target_status == OrderStatus.CANCELED:
            reason_label = _resolve_standard_reason(
                reason_code=reason_code,
                reasons_map=ORDER_CANCELLATION_REASONS,
                error_detail="سبب إلغاء الطلب مطلوب ويجب أن يكون ضمن الأسباب المعتمدة.",
            )
            cancellation_reason_text = _compose_reason_text(reason_label, reason_note)
            current_notes = _normalize_optional_text(order.notes)
            reason_line = f"سبب الإلغاء: {cancellation_reason_text}"
            update_values["notes"] = f"{current_notes}\n{reason_line}" if current_notes else reason_line
        elif reason_code is not None or reason_note is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="سبب الانتقال يُستخدم فقط عند إلغاء الطلب.",
            )
        if target_status != OrderStatus.DELIVERED and amount_received is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="المبلغ المستلم يُستخدم فقط عند تسليم الطلب.",
            )
        if target_status != OrderStatus.DELIVERED and collect_payment is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="خيار التحصيل مرتبط فقط بعملية تسليم الطلب.",
            )

        if target_status == OrderStatus.DELIVERED:
            if not collect_payment and amount_received is not None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="لا يمكن إدخال مبلغ مستلم عند تعطيل التحصيل أثناء التسليم.",
                )
            if order.type == OrderType.DINE_IN.value:
                # Dine-in orders are paid at table-session settlement, not per-order delivery.
                pass
            elif collect_payment:
                update_values.update(app_mark_cash_paid(db, order, amount_received, performed_by))
        if (
            target_status == OrderStatus.IN_PREPARATION
            and order.type == OrderType.DELIVERY.value
            and order.delivery_team_notified_at is None
        ):
            delivery_policy = app_get_delivery_policy_settings(db)
            if delivery_policy["auto_notify_team"] and app_count_active_delivery_users(db) > 0:
                update_values["delivery_team_notified_at"] = datetime.now(UTC)
                update_values["delivery_team_notified_by"] = performed_by

        updated_rows = update_order_status_if_current_matches(
            db,
            order_id=int(order.id),
            current_status=order.status,
            values=update_values,
        )
        if updated_rows != 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="حدث تعارض أثناء تحديث حالة الطلب، يرجى إعادة المحاولة.",
            )

        _record_transition(
            db,
            order_id=order.id,
            from_status=order.status,
            to_status=target_status.value,
            user_id=performed_by,
        )
        if target_status == OrderStatus.CANCELED and cancellation_reason_text is not None:
            _record_system_audit(
                db,
                module="orders",
                action="cancel_order",
                entity_type="order",
                entity_id=order.id,
                user_id=performed_by,
                description=f"إلغاء الطلب #{order.id} | السبب: {cancellation_reason_text}",
            )
        if order.type == OrderType.DINE_IN.value and order.table_id is not None:
            app_refresh_table_occupancy_state(db, table_id=order.table_id)

    return get_order_or_404(db, order_id)

def attach_sent_to_kitchen_at(db: Session, orders: list[Order]) -> list[Order]:
    if not orders:
        return orders

    order_ids = [order.id for order in orders]
    sent_map = fetch_sent_to_kitchen_timestamps(
        db,
        order_ids=order_ids,
        sent_to_kitchen_status=OrderStatus.SENT_TO_KITCHEN.value,
    )

    for order in orders:
        setattr(order, "sent_to_kitchen_at", sent_map.get(order.id))
    return orders
