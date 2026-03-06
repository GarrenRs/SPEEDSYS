from . import shared as _shared
from ..guards.financial_invariant_guard import assert_financial_invariants
from ..repositories.financial_repository import (
    count_daily_transactions,
    create_financial_transaction,
    delete_expense_transactions,
    fetch_expense_by_id,
    find_latest_expense_transaction,
    find_latest_order_transaction_by_type,
    sum_daily_transactions,
    update_order_payment_if_unpaid_and_delivered,
)

globals().update({name: getattr(_shared, name) for name in _shared.__all__})


def _mark_cash_paid(db: Session, order: Order, amount_received: float | None, user_id: int) -> dict[str, float | str | datetime | int]:
    if amount_received is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="المبلغ المستلم مطلوب للدع النقدي")
    if amount_received < order.total:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="المبلغ المستلم أقل من قيمة الطلب")

    change_amount = amount_received - order.total
    create_financial_transaction(
        db,
        order_id=int(order.id),
        expense_id=None,
        amount=float(order.total),
        tx_type=FinancialTransactionType.SALE.value,
        created_by=user_id,
        note="Cash order payment recorded.",
    )
    return {
        "payment_status": PaymentStatus.PAID.value,
        "paid_at": datetime.now(UTC),
        "paid_by": user_id,
        "amount_received": amount_received,
        "change_amount": change_amount,
        "payment_method": "cash",
    }

def collect_order_payment(
    db: Session,
    *,
    order_id: int,
    collected_by: int,
    amount_received: float | None = None,
) -> Order:
    with transaction_scope(db):
        order = get_order_or_404(db, order_id)
        if order.type == OrderType.DINE_IN.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="تحصيل طلبات الصالة يتم عبر تسوية جلسة الطاولة.",
            )
        if order.status != OrderStatus.DELIVERED.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="لا يمكن تحصيل طلب غير مكتمل أو غير مُسلَّم.",
            )
        if order.payment_status == PaymentStatus.PAID.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="تم تحصيل هذا الطلب مسبقًا.")

        payment_values = _mark_cash_paid(db, order, amount_received, collected_by)
        updated_rows = update_order_payment_if_unpaid_and_delivered(
            db,
            order_id=int(order.id),
            delivered_status=OrderStatus.DELIVERED.value,
            paid_status=PaymentStatus.PAID.value,
            payment_values=payment_values,
        )
        if updated_rows != 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="حدث تعارض أثناء التحصيل، يرجى إعادة المحاولة.",
            )
        collected_amount = float(payment_values.get("amount_received") or order.total)
        _record_system_audit(
            db,
            module="financial",
            action="collect_order_payment",
            entity_type="order",
            entity_id=order.id,
            user_id=collected_by,
            description=f"تحصيل نقدي للطلب #{order.id} بإجمالي {collected_amount:.2f} د.ج.",
        )
    assert_financial_invariants(db)
    return get_order_or_404(db, order_id)

def refund_order(
    db: Session,
    *,
    order_id: int,
    refunded_by: int,
    note: str | None = None,
) -> Order:
    normalized_note = _normalize_optional_text(note)
    with transaction_scope(db):
        order = get_order_or_404(db, order_id)
        if order.status != OrderStatus.DELIVERED.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="لا يمكن تنفيذ الاسترجاع إلا بعد تسليم الطلب.",
            )

        existing_refund_tx = find_latest_order_transaction_by_type(
            db,
            order_id=int(order.id),
            tx_type=FinancialTransactionType.REFUND.value,
        )
        if existing_refund_tx is not None and order.payment_status == PaymentStatus.REFUNDED.value:
            return order
        if order.payment_status != PaymentStatus.PAID.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="لا يمكن تنفيذ الاسترجاع لطلب غير مدفوع.",
            )
        order.payment_status = PaymentStatus.REFUNDED.value
        order.paid_by = refunded_by
        order.paid_at = datetime.now(UTC)

        if existing_refund_tx is None:
            refund_note = f"استرجاع الطلب #{order.id}"
            if normalized_note:
                refund_note = f"{refund_note} | {normalized_note}"
            create_financial_transaction(
                db,
                order_id=int(order.id),
                expense_id=None,
                amount=float(order.total or 0.0),
                tx_type=FinancialTransactionType.REFUND.value,
                created_by=refunded_by,
                note=refund_note,
            )

        _record_system_audit(
            db,
            module="financial",
            action="refund_order",
            entity_type="order",
            entity_id=order.id,
            user_id=refunded_by,
            description=f"Refund order #{order.id} for {float(order.total or 0.0):.2f} without warehouse movement.",
        )

    assert_financial_invariants(db)
    return get_order_or_404(db, order_id)

def list_expense_cost_centers(
    db: Session,
    *,
    include_inactive: bool = False,
    offset: int = 0,
    limit: int | None = None,
) -> list[ExpenseCostCenter]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=500)
    stmt = select(ExpenseCostCenter).order_by(ExpenseCostCenter.active.desc(), ExpenseCostCenter.name.asc())
    if not include_inactive:
        stmt = stmt.where(ExpenseCostCenter.active.is_(True))
    stmt = stmt.offset(safe_offset)
    if safe_limit is not None:
        stmt = stmt.limit(safe_limit)
    return db.execute(stmt).scalars().all()

def _normalize_cost_center_code(value: str) -> str:
    normalized = "".join(char for char in value.strip().upper() if char.isalnum() or char in {"_", "-"})
    if len(normalized) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="رمز مركز التكلفة غير صالح.")
    return normalized

def _normalize_cost_center_name(value: str) -> str:
    normalized = " ".join(value.split()).strip()
    if len(normalized) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم مركز التكلفة غير صالح.")
    return normalized

def create_expense_cost_center(
    db: Session,
    *,
    code: str,
    name: str,
    active: bool,
    actor_id: int,
) -> ExpenseCostCenter:
    normalized_code = _normalize_cost_center_code(code)
    normalized_name = _normalize_cost_center_name(name)
    existing = db.execute(
        select(ExpenseCostCenter).where(
            or_(
                func.lower(ExpenseCostCenter.code) == normalized_code.lower(),
                func.lower(ExpenseCostCenter.name) == normalized_name.lower(),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="رمز أو اسم مركز التكلفة موجود مسبقًا.")

    with transaction_scope(db):
        center = ExpenseCostCenter(
            code=normalized_code,
            name=normalized_name,
            active=active,
            updated_at=datetime.now(UTC),
        )
        db.add(center)
        db.flush()
        _record_system_audit(
            db,
            module="expenses",
            action="cost_center_created",
            entity_type="expense_cost_center",
            entity_id=center.id,
            user_id=actor_id,
            description=f"إنشاء مركز تكلفة: {center.name}.",
        )
    return center

def update_expense_cost_center(
    db: Session,
    *,
    center_id: int,
    code: str,
    name: str,
    active: bool,
    actor_id: int,
) -> ExpenseCostCenter:
    center = db.execute(select(ExpenseCostCenter).where(ExpenseCostCenter.id == center_id)).scalar_one_or_none()
    if center is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="مركز التكلفة غير موجود.")

    normalized_code = _normalize_cost_center_code(code)
    normalized_name = _normalize_cost_center_name(name)
    conflict = db.execute(
        select(ExpenseCostCenter).where(
            ExpenseCostCenter.id != center_id,
            or_(
                func.lower(ExpenseCostCenter.code) == normalized_code.lower(),
                func.lower(ExpenseCostCenter.name) == normalized_name.lower(),
            ),
        )
    ).scalar_one_or_none()
    if conflict is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="رمز أو اسم مركز التكلفة مستخدم مسبقًا.")

    if not active:
        has_expenses = db.execute(
            select(func.count(Expense.id)).where(Expense.cost_center_id == center_id)
        ).scalar_one()
        if int(has_expenses or 0) > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="لا يمكن تعطيل مركز تكلفة مرتبط بمصروفات.",
            )

    with transaction_scope(db):
        center.code = normalized_code
        center.name = normalized_name
        center.active = active
        center.updated_at = datetime.now(UTC)
        _record_system_audit(
            db,
            module="expenses",
            action="cost_center_updated",
            entity_type="expense_cost_center",
            entity_id=center.id,
            user_id=actor_id,
            description=f"تحديث مركز تكلفة: {center.name}.",
        )
    return center

def _resolve_expense_cost_center(
    db: Session,
    *,
    center_id: int,
    require_active: bool = True,
) -> ExpenseCostCenter:
    conditions = [ExpenseCostCenter.id == center_id]
    if require_active:
        conditions.append(ExpenseCostCenter.active.is_(True))
    center = db.execute(select(ExpenseCostCenter).where(*conditions)).scalar_one_or_none()
    if center is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="مركز التكلفة غير متاح.")
    return center

def create_expense(
    db: Session,
    *,
    title: str,
    category: str,
    cost_center_id: int,
    amount: float,
    note: str | None,
    created_by: int,
) -> Expense:
    center = _resolve_expense_cost_center(db, center_id=cost_center_id, require_active=True)
    with transaction_scope(db):
        expense = Expense(
            title=title,
            category=category,
            cost_center_id=center.id,
            amount=amount,
            note=note,
            status="pending",
            reviewed_by=None,
            reviewed_at=None,
            review_note=None,
            created_by=created_by,
        )
        db.add(expense)
        db.flush()
        _record_system_audit(
            db,
            module="expenses",
            action="expense_submitted",
            entity_type="expense",
            entity_id=expense.id,
            user_id=created_by,
            description=f"إنشاء مصروف #{expense.id} وربطه بمركز التكلفة {center.name}.",
        )
    return expense

def update_expense(
    db: Session,
    *,
    expense_id: int,
    title: str,
    category: str,
    cost_center_id: int,
    amount: float,
    note: str | None,
    updated_by: int,
) -> Expense:
    expense = fetch_expense_by_id(db, expense_id=expense_id)
    if not expense:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المصروف غير موجود.")
    if expense.status == "approved":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن تعديل مصروف تمت الموافقة عليه.",
        )
    center = _resolve_expense_cost_center(db, center_id=cost_center_id, require_active=True)
    with transaction_scope(db):
        expense.title = title
        expense.category = category
        expense.cost_center_id = center.id
        expense.amount = amount
        expense.note = note
        expense.status = "pending"
        expense.reviewed_by = None
        expense.reviewed_at = None
        expense.review_note = None
        expense.updated_at = datetime.now(UTC)
        delete_expense_transactions(db, expense_id=expense_id)
        _record_system_audit(
            db,
            module="expenses",
            action="expense_resubmitted",
            entity_type="expense",
            entity_id=expense.id,
            user_id=updated_by,
            description=f"إعادة إرسال مصروف #{expense.id} وربطه بمركز التكلفة {center.name}.",
        )
    assert_financial_invariants(db)
    return expense

def approve_expense(
    db: Session,
    *,
    expense_id: int,
    approved_by: int,
    note: str | None,
) -> Expense:
    expense = fetch_expense_by_id(db, expense_id=expense_id)
    if not expense:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المصروف غير موجود.")
    if expense.status == "approved":
        return expense

    with transaction_scope(db):
        expense.status = "approved"
        expense.reviewed_by = approved_by
        expense.reviewed_at = datetime.now(UTC)
        expense.review_note = note
        expense.updated_at = datetime.now(UTC)
        center_name = expense.cost_center.name if expense.cost_center is not None else "غير محدد"

        tx = find_latest_expense_transaction(
            db,
            expense_id=expense_id,
            tx_type=FinancialTransactionType.EXPENSE.value,
        )
        if tx:
            tx.amount = expense.amount
            tx.created_by = approved_by
            tx.note = f"Expense approved: {expense.title} | Cost center: {center_name}"
        else:
            create_financial_transaction(
                db,
                order_id=None,
                expense_id=int(expense.id),
                amount=float(expense.amount),
                tx_type=FinancialTransactionType.EXPENSE.value,
                created_by=approved_by,
                note=f"Expense approved: {expense.title} | Cost center: {center_name}",
            )

        _record_system_audit(
            db,
            module="expenses",
            action="expense_approved",
            entity_type="expense",
            entity_id=expense.id,
            user_id=approved_by,
            description=f"اعتماد مصروف #{expense.id} لمركز التكلفة {center_name}.",
        )
    assert_financial_invariants(db)
    return expense

def reject_expense(
    db: Session,
    *,
    expense_id: int,
    rejected_by: int,
    note: str | None,
) -> Expense:
    expense = fetch_expense_by_id(db, expense_id=expense_id)
    if not expense:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المصروف غير موجود.")
    if expense.status == "approved":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن رفض مصروف تمت الموافقة عليه.",
        )

    with transaction_scope(db):
        expense.status = "rejected"
        expense.reviewed_by = rejected_by
        expense.reviewed_at = datetime.now(UTC)
        expense.review_note = note
        expense.updated_at = datetime.now(UTC)
        delete_expense_transactions(db, expense_id=expense_id)
        _record_system_audit(
            db,
            module="expenses",
            action="expense_rejected",
            entity_type="expense",
            entity_id=expense.id,
            user_id=rejected_by,
            description=f"رفض مصروف #{expense.id}.",
        )
    assert_financial_invariants(db)
    return expense

def create_expense_attachment(
    db: Session,
    *,
    expense_id: int,
    file_name: str | None,
    mime_type: str,
    data_base64: str,
    uploaded_by: int,
) -> ExpenseAttachment:
    expense = fetch_expense_by_id(db, expense_id=expense_id)
    if not expense:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المصروف غير موجود.")
    if expense.status == "approved":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لا يمكن تعديل المرفقات بعد اعتماد المصروف.")

    file_url, final_name, size_bytes = app_save_expense_attachment(
        data_base64=data_base64,
        mime_type=mime_type,
        file_name=file_name,
    )

    try:
        with transaction_scope(db):
            attachment = ExpenseAttachment(
                expense_id=expense.id,
                file_name=final_name,
                file_url=file_url,
                mime_type=mime_type,
                size_bytes=size_bytes,
                uploaded_by=uploaded_by,
            )
            db.add(attachment)
            db.flush()
            _record_system_audit(
                db,
                module="expenses",
                action="expense_attachment_added",
                entity_type="expense",
                entity_id=expense.id,
                user_id=uploaded_by,
                description=f"إضافة مرفق للمصروف #{expense.id}.",
            )
    except Exception:
        app_remove_static_file(file_url)
        raise
    return attachment

def delete_expense_attachment(
    db: Session,
    *,
    expense_id: int,
    attachment_id: int,
    deleted_by: int,
) -> None:
    expense = fetch_expense_by_id(db, expense_id=expense_id)
    if not expense:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المصروف غير موجود.")
    if expense.status == "approved":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لا يمكن تعديل المرفقات بعد اعتماد المصروف.")

    attachment = db.execute(
        select(ExpenseAttachment).where(
            ExpenseAttachment.id == attachment_id,
            ExpenseAttachment.expense_id == expense_id,
        )
    ).scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المرفق غير موجود.")

    file_url = attachment.file_url
    with transaction_scope(db):
        db.delete(attachment)
        _record_system_audit(
            db,
            module="expenses",
            action="expense_attachment_deleted",
            entity_type="expense",
            entity_id=expense.id,
            user_id=deleted_by,
            description=f"حذف مرفق من المصروف #{expense.id}.",
        )
    app_remove_static_file(file_url)

def delete_expense(db: Session, *, expense_id: int) -> None:
    expense = fetch_expense_by_id(db, expense_id=expense_id)
    if not expense:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المصروف غير موجود.")
    if expense.status == "approved":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن حذف مصروف تمت الموافقة عليه.",
        )
    attachments = db.execute(
        select(ExpenseAttachment).where(ExpenseAttachment.expense_id == expense_id)
    ).scalars().all()
    file_urls = [attachment.file_url for attachment in attachments]
    with transaction_scope(db):
        delete_expense_transactions(db, expense_id=expense_id)
        for attachment in attachments:
            db.delete(attachment)
        db.delete(expense)
    for file_url in file_urls:
        app_remove_static_file(file_url)
    assert_financial_invariants(db)

def list_shift_closures(
    db: Session,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> list[ShiftClosure]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=500)
    stmt = (
        select(ShiftClosure)
        .order_by(ShiftClosure.business_date.desc(), ShiftClosure.closed_at.desc())
        .offset(safe_offset)
    )
    if safe_limit is not None:
        stmt = stmt.limit(safe_limit)
    return db.execute(stmt).scalars().all()

def close_cash_shift(
    db: Session,
    *,
    closed_by: int,
    opening_cash: float,
    actual_cash: float,
    note: str | None = None,
) -> ShiftClosure:
    business_date = datetime.now().date()
    existing = db.execute(select(ShiftClosure).where(ShiftClosure.business_date == business_date)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="تم إغلاق الوردية لهذا اليوم مسبقًا.")

    safe_opening_cash = max(0.0, float(opening_cash))
    safe_actual_cash = max(0.0, float(actual_cash))

    business_day_key = business_date.isoformat()
    sales_total = sum_daily_transactions(
        db,
        business_day_key=business_day_key,
        tx_type=FinancialTransactionType.SALE.value,
    )
    refunds_total = sum_daily_transactions(
        db,
        business_day_key=business_day_key,
        tx_type=FinancialTransactionType.REFUND.value,
    )
    expenses_total = sum_daily_transactions(
        db,
        business_day_key=business_day_key,
        tx_type=FinancialTransactionType.EXPENSE.value,
    )
    transactions_count = count_daily_transactions(db, business_day_key=business_day_key)

    expected_cash = safe_opening_cash + sales_total - refunds_total - expenses_total
    variance = safe_actual_cash - expected_cash

    with transaction_scope(db):
        closure = ShiftClosure(
            business_date=business_date,
            opening_cash=safe_opening_cash,
            sales_total=sales_total,
            refunds_total=refunds_total,
            expenses_total=expenses_total,
            expected_cash=expected_cash,
            actual_cash=safe_actual_cash,
            variance=variance,
            transactions_count=transactions_count,
            note=_normalize_optional_text(note),
            closed_by=closed_by,
            closed_at=datetime.now(UTC),
        )
        db.add(closure)
        db.flush()
        _record_system_audit(
            db,
            module="financial",
            action="close_shift",
            entity_type="shift_closure",
            entity_id=closure.id,
            user_id=closed_by,
            description=(
                f"إغلاق وردية {business_date.isoformat()} | "
                f"النقد المتوقع: {expected_cash:.2f} د.ج | النقد الفعلي: {safe_actual_cash:.2f} د.ج | الفارق: {variance:.2f} د.ج."
            ),
        )
    assert_financial_invariants(db)
    return closure
