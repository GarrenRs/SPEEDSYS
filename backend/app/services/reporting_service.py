from . import shared as _shared

globals().update({name: getattr(_shared, name) for name in _shared.__all__})


def daily_report(
    db: Session,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> list[dict[str, float | str]]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=3650)
    sales_sub = (
        select(
            func.date(FinancialTransaction.created_at, "localtime").label("day"),
            func.sum(FinancialTransaction.amount).label("sales"),
        )
        .where(FinancialTransaction.type == FinancialTransactionType.SALE.value)
        .group_by(func.date(FinancialTransaction.created_at, "localtime"))
        .subquery()
    )
    expense_sub = (
        select(
            func.date(FinancialTransaction.created_at, "localtime").label("day"),
            func.sum(FinancialTransaction.amount).label("expenses"),
        )
        .where(FinancialTransaction.type == FinancialTransactionType.EXPENSE.value)
        .group_by(func.date(FinancialTransaction.created_at, "localtime"))
        .subquery()
    )

    days_sub = select(sales_sub.c.day.label("day")).union(
        select(expense_sub.c.day.label("day"))
    ).subquery()

    days_stmt = (
        select(
            days_sub.c.day.label("day"),
            func.coalesce(sales_sub.c.sales, 0.0).label("sales"),
            func.coalesce(expense_sub.c.expenses, 0.0).label("expenses"),
        )
        .select_from(
            days_sub
            .outerjoin(sales_sub, days_sub.c.day == sales_sub.c.day)
            .outerjoin(expense_sub, days_sub.c.day == expense_sub.c.day)
        )
        .order_by(days_sub.c.day.desc())
        .offset(safe_offset)
    )
    if safe_limit is not None:
        days_stmt = days_stmt.limit(safe_limit)
    days = db.execute(days_stmt).all()

    result: list[dict[str, float | str]] = []
    for row in days:
        net = float(row.sales or 0) - float(row.expenses or 0)
        result.append({"day": row.day, "sales": float(row.sales or 0), "expenses": float(row.expenses or 0), "net": net})
    return result

def monthly_report(
    db: Session,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> list[dict[str, float | str]]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=1200)
    monthly_stmt = (
        select(
            func.strftime("%Y-%m", FinancialTransaction.created_at, "localtime").label("month"),
            func.sum(
                case(
                    (FinancialTransaction.type == FinancialTransactionType.SALE.value, FinancialTransaction.amount),
                    else_=0.0,
                )
            ).label("sales"),
            func.sum(
                case(
                    (FinancialTransaction.type == FinancialTransactionType.EXPENSE.value, FinancialTransaction.amount),
                    else_=0.0,
                )
            ).label("expenses"),
        )
        .group_by(func.strftime("%Y-%m", FinancialTransaction.created_at, "localtime"))
        .order_by(text("month DESC"))
        .offset(safe_offset)
    )
    if safe_limit is not None:
        monthly_stmt = monthly_stmt.limit(safe_limit)
    sales = db.execute(monthly_stmt).all()
    return [
        {
            "month": row.month,
            "sales": float(row.sales or 0),
            "expenses": float(row.expenses or 0),
            "net": float(row.sales or 0) - float(row.expenses or 0),
        }
        for row in sales
    ]

def report_by_order_type(db: Session) -> list[dict[str, float | str | int]]:
    rows = db.execute(
        select(
            Order.type.label("order_type"),
            func.count(Order.id).label("orders_count"),
            func.sum(Order.total).label("sales"),
        )
        .where(Order.status == OrderStatus.DELIVERED.value)
        .group_by(Order.type)
    ).all()
    return [
        {"order_type": row.order_type, "orders_count": int(row.orders_count or 0), "sales": float(row.sales or 0)}
        for row in rows
    ]

def profitability_report(
    db: Session,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, object]:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="تاريخ البداية يجب أن يكون قبل تاريخ النهاية.")

    cogs_by_order_item_sub = (
        select(
            OrderCostEntry.order_item_id.label("order_item_id"),
            func.sum(OrderCostEntry.cogs_amount).label("actual_cost"),
        )
        .group_by(OrderCostEntry.order_item_id)
        .subquery()
    )

    product_name_expr = func.coalesce(Product.name, OrderItem.product_name)
    category_name_expr = func.coalesce(Product.category, "غير مصنف")

    stmt = (
        select(
            OrderItem.product_id.label("product_id"),
            product_name_expr.label("product_name"),
            category_name_expr.label("category_name"),
            func.sum(OrderItem.quantity).label("quantity_sold"),
            func.sum(cast(OrderItem.quantity, Float) * OrderItem.price).label("revenue"),
            func.sum(func.coalesce(cogs_by_order_item_sub.c.actual_cost, 0.0)).label("actual_cost"),
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .outerjoin(Product, Product.id == OrderItem.product_id)
        .outerjoin(cogs_by_order_item_sub, cogs_by_order_item_sub.c.order_item_id == OrderItem.id)
        .where(
            Order.status == OrderStatus.DELIVERED.value,
            Order.payment_status != PaymentStatus.REFUNDED.value,
        )
    )
    if start_date is not None:
        stmt = stmt.where(func.date(Order.created_at, "localtime") >= start_date.isoformat())
    if end_date is not None:
        stmt = stmt.where(func.date(Order.created_at, "localtime") <= end_date.isoformat())

    stmt = stmt.group_by(
        OrderItem.product_id,
        product_name_expr,
        category_name_expr,
    )
    rows = db.execute(stmt).all()

    by_products: list[dict[str, object]] = []
    category_bucket: dict[str, dict[str, float]] = {}
    total_quantity_sold = 0
    total_revenue = 0.0
    total_estimated_cost = 0.0

    for row in rows:
        quantity_sold = int(row.quantity_sold or 0)
        revenue = float(row.revenue or 0.0)
        actual_cost = float(row.actual_cost or 0.0)
        estimated_unit_cost = (actual_cost / quantity_sold) if quantity_sold > 0 else 0.0
        estimated_cost = actual_cost
        gross_profit = revenue - estimated_cost
        margin_percent = (gross_profit / revenue * 100.0) if revenue > 0 else 0.0

        product_payload = {
            "product_id": int(row.product_id),
            "product_name": str(row.product_name),
            "category_name": str(row.category_name),
            "quantity_sold": quantity_sold,
            "revenue": round(revenue, 2),
            "estimated_unit_cost": round(estimated_unit_cost, 4),
            "estimated_cost": round(estimated_cost, 2),
            "gross_profit": round(gross_profit, 2),
            "margin_percent": round(margin_percent, 2),
        }
        by_products.append(product_payload)

        category_key = str(row.category_name)
        bucket = category_bucket.get(category_key)
        if bucket is None:
            bucket = {"quantity_sold": 0.0, "revenue": 0.0, "estimated_cost": 0.0}
            category_bucket[category_key] = bucket
        bucket["quantity_sold"] += quantity_sold
        bucket["revenue"] += revenue
        bucket["estimated_cost"] += estimated_cost

        total_quantity_sold += quantity_sold
        total_revenue += revenue
        total_estimated_cost += estimated_cost

    by_products.sort(key=lambda item: (float(item["gross_profit"]), float(item["revenue"])), reverse=True)

    by_categories: list[dict[str, object]] = []
    for category_name, metrics in category_bucket.items():
        revenue = float(metrics["revenue"])
        estimated_cost = float(metrics["estimated_cost"])
        gross_profit = revenue - estimated_cost
        margin_percent = (gross_profit / revenue * 100.0) if revenue > 0 else 0.0
        by_categories.append(
            {
                "category_name": category_name,
                "quantity_sold": int(metrics["quantity_sold"]),
                "revenue": round(revenue, 2),
                "estimated_cost": round(estimated_cost, 2),
                "gross_profit": round(gross_profit, 2),
                "margin_percent": round(margin_percent, 2),
            }
        )
    by_categories.sort(key=lambda item: (float(item["gross_profit"]), float(item["revenue"])), reverse=True)

    total_gross_profit = total_revenue - total_estimated_cost
    total_margin_percent = (total_gross_profit / total_revenue * 100.0) if total_revenue > 0 else 0.0

    return {
        "start_date": start_date,
        "end_date": end_date,
        "total_quantity_sold": total_quantity_sold,
        "total_revenue": round(total_revenue, 2),
        "total_estimated_cost": round(total_estimated_cost, 2),
        "total_gross_profit": round(total_gross_profit, 2),
        "total_margin_percent": round(total_margin_percent, 2),
        "by_products": by_products,
        "by_categories": by_categories,
    }

def _period_financial_metrics(
    db: Session,
    *,
    start_date: date,
    end_date: date,
    label: str,
) -> dict[str, object]:
    sales = db.execute(
        select(func.coalesce(func.sum(FinancialTransaction.amount), 0.0)).where(
            FinancialTransaction.type == FinancialTransactionType.SALE.value,
            func.date(FinancialTransaction.created_at, "localtime") >= start_date.isoformat(),
            func.date(FinancialTransaction.created_at, "localtime") <= end_date.isoformat(),
        )
    ).scalar_one()
    expenses = db.execute(
        select(func.coalesce(func.sum(FinancialTransaction.amount), 0.0)).where(
            FinancialTransaction.type == FinancialTransactionType.EXPENSE.value,
            func.date(FinancialTransaction.created_at, "localtime") >= start_date.isoformat(),
            func.date(FinancialTransaction.created_at, "localtime") <= end_date.isoformat(),
        )
    ).scalar_one()
    delivered_orders_count = db.execute(
        select(func.count(Order.id)).where(
            Order.status == OrderStatus.DELIVERED.value,
            func.date(Order.created_at, "localtime") >= start_date.isoformat(),
            func.date(Order.created_at, "localtime") <= end_date.isoformat(),
        )
    ).scalar_one()
    delivered_orders_total = db.execute(
        select(func.coalesce(func.sum(Order.total), 0.0)).where(
            Order.status == OrderStatus.DELIVERED.value,
            func.date(Order.created_at, "localtime") >= start_date.isoformat(),
            func.date(Order.created_at, "localtime") <= end_date.isoformat(),
        )
    ).scalar_one()

    sales_value = float(sales or 0.0)
    expenses_value = float(expenses or 0.0)
    delivered_count = int(delivered_orders_count or 0)
    delivered_total_value = float(delivered_orders_total or 0.0)

    avg_order_value = (delivered_total_value / delivered_count) if delivered_count > 0 else 0.0
    return {
        "label": label,
        "start_date": start_date,
        "end_date": end_date,
        "days_count": ((end_date - start_date).days + 1),
        "sales": round(sales_value, 2),
        "expenses": round(expenses_value, 2),
        "net": round(sales_value - expenses_value, 2),
        "delivered_orders_count": delivered_count,
        "avg_order_value": round(avg_order_value, 2),
    }

def period_comparison_report(
    db: Session,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, object]:
    effective_end = end_date or date.today()
    effective_start = start_date or (effective_end - timedelta(days=6))
    if effective_start > effective_end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="تاريخ البداية يجب أن يكون قبل تاريخ النهاية")

    days_count = (effective_end - effective_start).days + 1
    previous_end = effective_start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=days_count - 1)

    current_period = _period_financial_metrics(
        db,
        start_date=effective_start,
        end_date=effective_end,
        label="الفترة الحالية",
    )
    previous_period = _period_financial_metrics(
        db,
        start_date=previous_start,
        end_date=previous_end,
        label="الفترة السابقة",
    )

    def build_delta(metric_key: str, metric_label: str) -> dict[str, object]:
        current_value = float(current_period[metric_key])
        previous_value = float(previous_period[metric_key])
        absolute_change = current_value - previous_value
        if previous_value == 0:
            change_percent: float | None = None
        else:
            change_percent = (absolute_change / previous_value) * 100.0
        return {
            "metric": metric_label,
            "current_value": round(current_value, 2),
            "previous_value": round(previous_value, 2),
            "absolute_change": round(absolute_change, 2),
            "change_percent": round(change_percent, 2) if change_percent is not None else None,
        }

    deltas = [
        build_delta("sales", "المبيعات"),
        build_delta("expenses", "المصروفات"),
        build_delta("net", "الصافي"),
        build_delta("delivered_orders_count", "عدد الطلبات المسلّمة"),
        build_delta("avg_order_value", "متوسط قيمة الطلب"),
    ]
    return {
        "current_period": current_period,
        "previous_period": previous_period,
        "deltas": deltas,
    }

def peak_hours_performance_report(
    db: Session,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, object]:
    effective_end = end_date or date.today()
    effective_start = start_date or (effective_end - timedelta(days=13))
    if effective_start > effective_end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="تاريخ البداية يجب أن يكون قبل تاريخ النهاية")

    order_rows = db.execute(
        select(
            func.strftime("%H", Order.created_at, "localtime").label("hour"),
            func.count(Order.id).label("orders_count"),
            func.sum(Order.total).label("sales"),
        )
        .where(
            Order.status == OrderStatus.DELIVERED.value,
            func.date(Order.created_at, "localtime") >= effective_start.isoformat(),
            func.date(Order.created_at, "localtime") <= effective_end.isoformat(),
        )
        .group_by(func.strftime("%H", Order.created_at, "localtime"))
        .order_by(func.strftime("%H", Order.created_at, "localtime").asc())
    ).all()

    sent_sub = (
        select(
            OrderTransitionLog.order_id,
            func.min(OrderTransitionLog.timestamp).label("sent_at"),
        )
        .where(OrderTransitionLog.to_status == OrderStatus.SENT_TO_KITCHEN.value)
        .group_by(OrderTransitionLog.order_id)
        .subquery()
    )
    ready_sub = (
        select(
            OrderTransitionLog.order_id,
            func.min(OrderTransitionLog.timestamp).label("ready_at"),
        )
        .where(OrderTransitionLog.to_status == OrderStatus.READY.value)
        .group_by(OrderTransitionLog.order_id)
        .subquery()
    )

    prep_rows = db.execute(
        select(
            func.strftime("%H", sent_sub.c.sent_at, "localtime").label("hour"),
            func.avg((func.julianday(ready_sub.c.ready_at) - func.julianday(sent_sub.c.sent_at)) * 24 * 60).label("avg_prep"),
        )
        .select_from(sent_sub.join(ready_sub, sent_sub.c.order_id == ready_sub.c.order_id).join(Order, Order.id == sent_sub.c.order_id))
        .where(
            ready_sub.c.ready_at > sent_sub.c.sent_at,
            func.date(Order.created_at, "localtime") >= effective_start.isoformat(),
            func.date(Order.created_at, "localtime") <= effective_end.isoformat(),
        )
        .group_by(func.strftime("%H", sent_sub.c.sent_at, "localtime"))
    ).all()

    overall_avg_prep = db.execute(
        select(
            func.avg((func.julianday(ready_sub.c.ready_at) - func.julianday(sent_sub.c.sent_at)) * 24 * 60)
        )
        .select_from(sent_sub.join(ready_sub, sent_sub.c.order_id == ready_sub.c.order_id).join(Order, Order.id == sent_sub.c.order_id))
        .where(
            ready_sub.c.ready_at > sent_sub.c.sent_at,
            func.date(Order.created_at, "localtime") >= effective_start.isoformat(),
            func.date(Order.created_at, "localtime") <= effective_end.isoformat(),
        )
    ).scalar_one()

    prep_by_hour: dict[str, float] = {
        str(row.hour or "00").zfill(2): float(row.avg_prep or 0.0)
        for row in prep_rows
    }

    by_hours: list[dict[str, object]] = []
    for row in order_rows:
        hour = str(row.hour or "00").zfill(2)
        orders_count = int(row.orders_count or 0)
        sales = float(row.sales or 0.0)
        avg_order_value = (sales / orders_count) if orders_count > 0 else 0.0
        by_hours.append(
            {
                "hour_label": f"{hour}:00 - {hour}:59",
                "orders_count": orders_count,
                "sales": round(sales, 2),
                "avg_order_value": round(avg_order_value, 2),
                "avg_prep_minutes": round(prep_by_hour.get(hour, 0.0), 2),
            }
        )

    peak_row = max(
        by_hours,
        key=lambda item: (int(item["orders_count"]), float(item["sales"])),
        default=None,
    )
    return {
        "start_date": effective_start,
        "end_date": effective_end,
        "days_count": (effective_end - effective_start).days + 1,
        "peak_hour": str(peak_row["hour_label"]) if peak_row is not None else None,
        "peak_orders_count": int(peak_row["orders_count"]) if peak_row is not None else 0,
        "peak_sales": round(float(peak_row["sales"]), 2) if peak_row is not None else 0.0,
        "overall_avg_prep_minutes": round(float(overall_avg_prep or 0.0), 2),
        "by_hours": by_hours,
    }

def prep_performance_report(db: Session) -> float:
    sent_sub = (
        select(
            OrderTransitionLog.order_id,
            func.min(OrderTransitionLog.timestamp).label("sent_at"),
        )
        .where(OrderTransitionLog.to_status == OrderStatus.SENT_TO_KITCHEN.value)
        .group_by(OrderTransitionLog.order_id)
        .subquery()
    )
    ready_sub = (
        select(
            OrderTransitionLog.order_id,
            func.min(OrderTransitionLog.timestamp).label("ready_at"),
        )
        .where(OrderTransitionLog.to_status == OrderStatus.READY.value)
        .group_by(OrderTransitionLog.order_id)
        .subquery()
    )

    avg_minutes = db.execute(
        select(
            func.avg(
                (
                    func.julianday(ready_sub.c.ready_at) - func.julianday(sent_sub.c.sent_at)
                )
                * 24
                * 60
            )
        )
        .select_from(sent_sub.join(ready_sub, sent_sub.c.order_id == ready_sub.c.order_id))
        .where(ready_sub.c.ready_at > sent_sub.c.sent_at)
    ).scalar_one()

    return float(avg_minutes or 0.0)

def kitchen_monitor_summary(db: Session) -> dict[str, int | float]:
    visible_statuses = (
        OrderStatus.SENT_TO_KITCHEN.value,
        OrderStatus.IN_PREPARATION.value,
        OrderStatus.READY.value,
    )

    count_rows = db.execute(
        select(Order.status, func.count(Order.id))
        .where(Order.status.in_(visible_statuses))
        .group_by(Order.status)
    ).all()
    counts = {str(row[0]): int(row[1] or 0) for row in count_rows}

    oldest_sent_at = db.execute(
        select(func.min(OrderTransitionLog.timestamp))
        .join(Order, Order.id == OrderTransitionLog.order_id)
        .where(
            Order.status.in_(visible_statuses),
            OrderTransitionLog.to_status == OrderStatus.SENT_TO_KITCHEN.value,
        )
    ).scalar_one()

    if oldest_sent_at is None:
        oldest_sent_at = db.execute(
            select(func.min(Order.created_at)).where(Order.status.in_(visible_statuses))
        ).scalar_one()

    oldest_order_wait_seconds = 0
    if oldest_sent_at is not None:
        oldest_order_wait_seconds = max(
            0,
            int((datetime.now(UTC) - _as_utc(oldest_sent_at)).total_seconds()),
        )

    today = datetime.now().date().isoformat()
    sent_sub = (
        select(
            OrderTransitionLog.order_id,
            func.min(OrderTransitionLog.timestamp).label("sent_at"),
        )
        .where(OrderTransitionLog.to_status == OrderStatus.SENT_TO_KITCHEN.value)
        .group_by(OrderTransitionLog.order_id)
        .subquery()
    )
    ready_sub = (
        select(
            OrderTransitionLog.order_id,
            func.min(OrderTransitionLog.timestamp).label("ready_at"),
        )
        .where(OrderTransitionLog.to_status == OrderStatus.READY.value)
        .group_by(OrderTransitionLog.order_id)
        .subquery()
    )
    avg_prep_today = db.execute(
        select(
            func.avg(
                (
                    func.julianday(ready_sub.c.ready_at) - func.julianday(sent_sub.c.sent_at)
                )
                * 24
                * 60
            )
        )
        .select_from(sent_sub.join(ready_sub, sent_sub.c.order_id == ready_sub.c.order_id))
        .where(
            ready_sub.c.ready_at > sent_sub.c.sent_at,
            func.date(ready_sub.c.ready_at, "localtime") == today,
        )
    ).scalar_one()

    kitchen_reason_codes = ("kitchen_supply", "operational_use")
    kitchen_outbound_quantity_today = float(
        db.execute(
            select(func.coalesce(func.sum(WarehouseStockLedger.quantity), 0.0))
            .select_from(WarehouseStockLedger)
            .join(
                WarehouseOutboundVoucher,
                and_(
                    WarehouseOutboundVoucher.id == WarehouseStockLedger.source_id,
                    WarehouseStockLedger.source_type == "wh_outbound_voucher",
                ),
            )
            .where(
                WarehouseStockLedger.movement_kind == "outbound",
                WarehouseOutboundVoucher.reason_code.in_(kitchen_reason_codes),
                func.date(WarehouseStockLedger.created_at, "localtime") == today,
            )
        ).scalar_one()
        or 0.0
    )
    kitchen_outbound_vouchers_today = int(
        db.execute(
            select(func.count(WarehouseOutboundVoucher.id)).where(
                WarehouseOutboundVoucher.reason_code.in_(kitchen_reason_codes),
                func.date(WarehouseOutboundVoucher.posted_at, "localtime") == today,
            )
        ).scalar_one()
        or 0
    )
    kitchen_outbound_items_today = int(
        db.execute(
            select(func.count(func.distinct(WarehouseStockLedger.item_id)))
            .select_from(WarehouseStockLedger)
            .join(
                WarehouseOutboundVoucher,
                and_(
                    WarehouseOutboundVoucher.id == WarehouseStockLedger.source_id,
                    WarehouseStockLedger.source_type == "wh_outbound_voucher",
                ),
            )
            .where(
                WarehouseStockLedger.movement_kind == "outbound",
                WarehouseOutboundVoucher.reason_code.in_(kitchen_reason_codes),
                func.date(WarehouseStockLedger.created_at, "localtime") == today,
            )
        ).scalar_one()
        or 0
    )

    return {
        "sent_to_kitchen": counts.get(OrderStatus.SENT_TO_KITCHEN.value, 0),
        "in_preparation": counts.get(OrderStatus.IN_PREPARATION.value, 0),
        "ready": counts.get(OrderStatus.READY.value, 0),
        "oldest_order_wait_seconds": oldest_order_wait_seconds,
        "avg_prep_minutes_today": float(avg_prep_today or 0.0),
        "warehouse_issued_quantity_today": kitchen_outbound_quantity_today,
        "warehouse_issue_vouchers_today": kitchen_outbound_vouchers_today,
        "warehouse_issued_items_today": kitchen_outbound_items_today,
    }
