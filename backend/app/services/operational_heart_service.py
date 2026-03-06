from . import shared as _shared

globals().update({name: getattr(_shared, name) for name in _shared.__all__})
from .operational_heart_timeline import build_operational_heart_timeline


def _operational_heart_severity_from_age(
    *,
    age_seconds: int,
    warn_seconds: int,
    critical_seconds: int,
) -> str:
    if age_seconds >= critical_seconds:
        return "critical"
    if age_seconds >= warn_seconds:
        return "warning"
    return "info"

def _build_operational_heart_queues(db: Session, *, now_utc: datetime) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for config in OPERATIONAL_HEART_QUEUE_CONFIG:
        statuses = tuple(str(status) for status in tuple(config["statuses"]))
        count = int(
            db.execute(
                select(func.count(Order.id)).where(Order.status.in_(statuses))
            ).scalar_one()
            or 0
        )
        oldest_created_at = db.execute(
            select(func.min(Order.created_at)).where(Order.status.in_(statuses))
        ).scalar_one()
        oldest_age_seconds = 0
        if oldest_created_at is not None:
            oldest_age_seconds = max(0, int((now_utc - _as_utc(oldest_created_at)).total_seconds()))

        sla_seconds = int(config["sla_seconds"])
        aged_cutoff = now_utc - timedelta(seconds=sla_seconds)
        aged_over_sla_count = int(
            db.execute(
                select(func.count(Order.id)).where(
                    Order.status.in_(statuses),
                    Order.created_at <= aged_cutoff,
                )
            ).scalar_one()
            or 0
        )
        rows.append(
            {
                "key": str(config["key"]),
                "label": str(config["label"]),
                "count": count,
                "oldest_age_seconds": oldest_age_seconds,
                "aged_over_sla_count": aged_over_sla_count,
                "sla_seconds": sla_seconds,
                "action_route": str(config["action_route"]),
            }
        )
    return rows

def _build_operational_heart_incidents(
    *,
    queues: list[dict[str, object]],
    kitchen_summary: dict[str, int | float],
    status_counts: dict[str, int],
) -> list[dict[str, object]]:
    queue_map = {str(row["key"]): row for row in queues}
    incidents: list[dict[str, object]] = []

    created_queue = queue_map.get("created")
    if created_queue and int(created_queue["count"]) > 0:
        age_seconds = int(created_queue["oldest_age_seconds"])
        incidents.append(
            {
                "code": "created_backlog",
                "severity": _operational_heart_severity_from_age(
                    age_seconds=age_seconds,
                    warn_seconds=5 * 60,
                    critical_seconds=15 * 60,
                ),
                "title": "طلبات جديدة بانتظار التأكيد",
                "message": f"{int(created_queue['count'])} طلب بانتظار التأكيد.",
                "count": int(created_queue["count"]),
                "oldest_age_seconds": age_seconds,
                "action_route": str(created_queue["action_route"]),
            }
        )

    confirmed_queue = queue_map.get("confirmed")
    if confirmed_queue and int(confirmed_queue["count"]) > 0:
        age_seconds = int(confirmed_queue["oldest_age_seconds"])
        incidents.append(
            {
                "code": "confirmed_backlog",
                "severity": _operational_heart_severity_from_age(
                    age_seconds=age_seconds,
                    warn_seconds=7 * 60,
                    critical_seconds=15 * 60,
                ),
                "title": "طلبات مؤكدة لم ترسل للمطبخ",
                "message": f"{int(confirmed_queue['count'])} طلب مؤكد بانتظار الإرسال للمطبخ.",
                "count": int(confirmed_queue["count"]),
                "oldest_age_seconds": age_seconds,
                "action_route": str(confirmed_queue["action_route"]),
            }
        )

    kitchen_queue = queue_map.get("kitchen")
    kitchen_wait_seconds = int(kitchen_summary.get("oldest_order_wait_seconds", 0) or 0)
    kitchen_count = int(kitchen_queue["count"]) if kitchen_queue is not None else 0
    if kitchen_count > 0 and kitchen_wait_seconds >= OPERATIONAL_HEART_KITCHEN_WAIT_WARN_SECONDS:
        incidents.append(
            {
                "code": "kitchen_wait_high",
                "severity": _operational_heart_severity_from_age(
                    age_seconds=kitchen_wait_seconds,
                    warn_seconds=OPERATIONAL_HEART_KITCHEN_WAIT_WARN_SECONDS,
                    critical_seconds=OPERATIONAL_HEART_KITCHEN_WAIT_CRITICAL_SECONDS,
                ),
                "title": "تأخير ي طابور المطبخ",
                "message": f"أقدم طلب داخل المطبخ منذ {kitchen_wait_seconds // 60} دقيقة.",
                "count": kitchen_count,
                "oldest_age_seconds": kitchen_wait_seconds,
                "action_route": "/manager/kitchen-monitor",
            }
        )

    ready_queue = queue_map.get("ready")
    if ready_queue and int(ready_queue["count"]) > 0 and int(ready_queue["oldest_age_seconds"]) >= 10 * 60:
        age_seconds = int(ready_queue["oldest_age_seconds"])
        incidents.append(
            {
                "code": "ready_backlog",
                "severity": _operational_heart_severity_from_age(
                    age_seconds=age_seconds,
                    warn_seconds=10 * 60,
                    critical_seconds=20 * 60,
                ),
                "title": "طلبات جاهزة بانتظار الإنهاء",
                "message": f"{int(ready_queue['count'])} طلب جاهز يحتاج تسليمًا أو إغلاقًا.",
                "count": int(ready_queue["count"]),
                "oldest_age_seconds": age_seconds,
                "action_route": str(ready_queue["action_route"]),
            }
        )

    failed_delivery_count = int(status_counts.get(OrderStatus.DELIVERY_FAILED.value, 0))
    if failed_delivery_count > 0:
        incidents.append(
            {
                "code": "delivery_failed",
                "severity": "critical",
                "title": "حالات شل توصيل",
                "message": f"{failed_delivery_count} حالة شل توصيل تحتاج معالجة.",
                "count": failed_delivery_count,
                "oldest_age_seconds": None,
                "action_route": "/manager/orders?status=DELIVERY_FAILED",
            }
        )

    out_delivery_queue = queue_map.get("out_for_delivery")
    if out_delivery_queue and int(out_delivery_queue["count"]) > 0 and int(out_delivery_queue["oldest_age_seconds"]) >= 45 * 60:
        age_seconds = int(out_delivery_queue["oldest_age_seconds"])
        incidents.append(
            {
                "code": "delivery_outbound_long",
                "severity": _operational_heart_severity_from_age(
                    age_seconds=age_seconds,
                    warn_seconds=45 * 60,
                    critical_seconds=90 * 60,
                ),
                "title": "طلبات خرجت للتوصيل منذ وقت طويل",
                "message": f"{int(out_delivery_queue['count'])} طلب قيد التوصيل بزمن مرتع.",
                "count": int(out_delivery_queue["count"]),
                "oldest_age_seconds": age_seconds,
                "action_route": str(out_delivery_queue["action_route"]),
            }
        )

    severity_rank = {"critical": 3, "warning": 2, "info": 1}
    incidents.sort(
        key=lambda row: (
            severity_rank.get(str(row["severity"]), 0),
            int(row["count"]),
            int(row["oldest_age_seconds"] or 0),
        ),
        reverse=True,
    )
    return incidents

def _build_operational_heart_timeline(db: Session, *, limit: int = OPERATIONAL_HEART_TIMELINE_LIMIT) -> list[dict[str, object]]:
    return build_operational_heart_timeline(db, limit=limit)

def _build_operational_heart_financial_control(
    db: Session,
    *,
    local_business_date: date,
    business_day_key: str,
    today_sales: float,
    today_expenses: float,
) -> dict[str, object]:
    shift_closed_today = bool(
        db.execute(
            select(func.count(ShiftClosure.id)).where(ShiftClosure.business_date == local_business_date)
        ).scalar_one()
        or 0
    )
    latest_shift_variance = float(
        db.execute(
            select(ShiftClosure.variance)
            .order_by(ShiftClosure.closed_at.desc(), ShiftClosure.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        or 0.0
    )
    sales_transactions_today = int(
        db.execute(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.type == FinancialTransactionType.SALE.value,
                func.date(FinancialTransaction.created_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0
    )
    expense_transactions_today = int(
        db.execute(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.type == FinancialTransactionType.EXPENSE.value,
                func.date(FinancialTransaction.created_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0
    )
    today_net = float(today_sales - today_expenses)
    severity = _operational_heart_threshold_severity(
        value=abs(latest_shift_variance),
        warn=OPERATIONAL_HEART_FINANCIAL_VARIANCE_WARN,
        critical=OPERATIONAL_HEART_FINANCIAL_VARIANCE_CRITICAL,
    )
    if (
        severity == "info"
        and not shift_closed_today
        and (sales_transactions_today > 0 or expense_transactions_today > 0)
    ):
        severity = "warning"
    if severity != "critical" and today_net < 0 and abs(today_net) >= OPERATIONAL_HEART_FINANCIAL_VARIANCE_WARN:
        severity = "warning"

    return {
        "severity": severity,
        "action_route": "/manager/financial",
        "shift_closed_today": shift_closed_today,
        "latest_shift_variance": latest_shift_variance,
        "sales_transactions_today": sales_transactions_today,
        "expense_transactions_today": expense_transactions_today,
        "today_net": today_net,
    }

def _build_operational_heart_warehouse_control(db: Session, *, business_day_key: str) -> dict[str, object]:
    active_items = int(
        db.execute(select(func.count(WarehouseItem.id)).where(WarehouseItem.active.is_(True))).scalar_one()
        or 0
    )
    low_stock_items = int(
        db.execute(
            select(func.count(WarehouseItem.id))
            .join(WarehouseStockBalance, WarehouseStockBalance.item_id == WarehouseItem.id)
            .where(
                WarehouseItem.active.is_(True),
                WarehouseStockBalance.quantity <= WarehouseItem.alert_threshold,
            )
        ).scalar_one()
        or 0
    )
    pending_stock_counts = int(
        db.execute(
            select(func.count(WarehouseStockCount.id)).where(WarehouseStockCount.status == "pending")
        ).scalar_one()
        or 0
    )
    inbound_today = float(
        db.execute(
            select(func.coalesce(func.sum(WarehouseStockLedger.quantity), 0.0)).where(
                WarehouseStockLedger.movement_kind == "inbound",
                func.date(WarehouseStockLedger.created_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0.0
    )
    outbound_today = float(
        db.execute(
            select(func.coalesce(func.sum(WarehouseStockLedger.quantity), 0.0)).where(
                WarehouseStockLedger.movement_kind == "outbound",
                func.date(WarehouseStockLedger.created_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0.0
    )

    if low_stock_items >= 5 or pending_stock_counts >= 4:
        severity = "critical"
    elif low_stock_items > 0 or pending_stock_counts > 0:
        severity = "warning"
    else:
        severity = "info"

    return {
        "severity": severity,
        "action_route": "/manager/warehouse",
        "active_items": active_items,
        "low_stock_items": low_stock_items,
        "pending_stock_counts": pending_stock_counts,
        "inbound_today": inbound_today,
        "outbound_today": outbound_today,
    }

def _build_operational_heart_tables_control(db: Session) -> dict[str, object]:
    active_sessions = int(
        db.execute(
            select(func.count(func.distinct(Order.table_id))).where(
                Order.table_id.is_not(None),
                _table_session_open_condition(),
            )
        ).scalar_one()
        or 0
    )
    blocked_settlement_tables = int(
        db.execute(
            select(func.count(func.distinct(Order.table_id))).where(
                Order.table_id.is_not(None),
                Order.status.notin_(TERMINAL_ORDER_STATUSES),
            )
        ).scalar_one()
        or 0
    )
    unpaid_orders = int(
        db.execute(
            select(func.count(Order.id)).where(
                Order.table_id.is_not(None),
                Order.payment_status != PaymentStatus.PAID.value,
                _table_session_open_condition(),
            )
        ).scalar_one()
        or 0
    )
    unpaid_total = float(
        db.execute(
            select(func.coalesce(func.sum(Order.total), 0.0)).where(
                Order.table_id.is_not(None),
                Order.payment_status != PaymentStatus.PAID.value,
                _table_session_open_condition(),
            )
        ).scalar_one()
        or 0.0
    )

    if blocked_settlement_tables > 0:
        severity = "critical"
    elif active_sessions > 0 or unpaid_orders > 0 or unpaid_total > 0:
        severity = "warning"
    else:
        severity = "info"

    return {
        "severity": severity,
        "action_route": "/manager/tables",
        "active_sessions": active_sessions,
        "blocked_settlement_tables": blocked_settlement_tables,
        "unpaid_orders": unpaid_orders,
        "unpaid_total": unpaid_total,
    }

def _build_operational_heart_expenses_control(db: Session, *, business_day_key: str) -> dict[str, object]:
    pending_approvals = int(
        db.execute(select(func.count(Expense.id)).where(Expense.status == "pending")).scalar_one() or 0
    )
    pending_amount = float(
        db.execute(
            select(func.coalesce(func.sum(Expense.amount), 0.0)).where(Expense.status == "pending")
        ).scalar_one()
        or 0.0
    )
    rejected_today = int(
        db.execute(
            select(func.count(Expense.id)).where(
                Expense.status == "rejected",
                func.date(Expense.reviewed_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0
    )
    high_value_pending_amount = float(
        db.execute(
            select(func.coalesce(func.max(Expense.amount), 0.0)).where(Expense.status == "pending")
        ).scalar_one()
        or 0.0
    )

    if (
        high_value_pending_amount >= OPERATIONAL_HEART_EXPENSE_HIGH_VALUE_CRITICAL
        or pending_amount >= OPERATIONAL_HEART_EXPENSE_PENDING_TOTAL_CRITICAL
    ):
        severity = "critical"
    elif pending_approvals > 0 or rejected_today > 0:
        severity = "warning"
    else:
        severity = "info"

    return {
        "severity": severity,
        "action_route": "/manager/expenses",
        "pending_approvals": pending_approvals,
        "pending_amount": pending_amount,
        "rejected_today": rejected_today,
        "high_value_pending_amount": high_value_pending_amount,
    }

def _build_operational_heart_reconciliations(
    db: Session,
    *,
    business_day_key: str,
    today_sales: float,
    tables_control: dict[str, object],
    warehouse_control: dict[str, object],
) -> list[dict[str, object]]:
    checks: list[dict[str, object]] = []

    delivered_orders_total_today = float(
        db.execute(
            select(func.coalesce(func.sum(Order.total), 0.0)).where(
                Order.status == OrderStatus.DELIVERED.value,
                func.date(Order.created_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0.0
    )
    sales_parity_diff = float(today_sales - delivered_orders_total_today)
    sales_parity_ok = abs(sales_parity_diff) <= 1.0
    sales_parity_severity = "info"
    if not sales_parity_ok:
        sales_parity_severity = "critical" if abs(sales_parity_diff) >= 100 else "warning"
    checks.append(
        {
            "key": "sales_delivery_financial_parity",
            "label": "تطابق التسليم مع المبيعات المالية",
            "ok": sales_parity_ok,
            "severity": sales_parity_severity,
            "detail": (
                f"مبيعات مالية: {today_sales:.2f} د.ج | "
                f"طلبات مسلّمة: {delivered_orders_total_today:.2f} د.ج | "
                f"الارق: {sales_parity_diff:.2f} د.ج"
            ),
            "action_route": "/manager/financial",
        }
    )

    leaked_dine_in_sales = int(
        db.execute(
            select(func.count(FinancialTransaction.id))
            .join(Order, Order.id == FinancialTransaction.order_id)
            .where(
                FinancialTransaction.type == FinancialTransactionType.SALE.value,
                Order.type == OrderType.DINE_IN.value,
                Order.payment_status != PaymentStatus.PAID.value,
                func.date(FinancialTransaction.created_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0
    )
    active_sessions = int(tables_control.get("active_sessions", 0) or 0)
    unpaid_total = float(tables_control.get("unpaid_total", 0.0) or 0.0)
    dine_in_leak_ok = leaked_dine_in_sales == 0
    checks.append(
        {
            "key": "dine_in_unpaid_financial_leak",
            "label": "تسرب مالي لطلبات الصالة غير المسددة",
            "ok": dine_in_leak_ok,
            "severity": "critical" if not dine_in_leak_ok else "info",
            "detail": (
                f"حركات بيع متسربة: {leaked_dine_in_sales} | "
                f"جلسات نشطة: {active_sessions} | "
                f"إجمالي غير مسدد: {unpaid_total:.2f} د.ج"
            ),
            "action_route": "/manager/tables",
        }
    )

    adjustment_outbound_today = int(
        db.execute(
            select(func.count(WarehouseOutboundVoucher.id)).where(
                WarehouseOutboundVoucher.reason_code.in_(("damage_loss", "inventory_adjustment")),
                func.date(WarehouseOutboundVoucher.posted_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0
    )
    inventory_related_expenses_today = int(
        db.execute(
            select(func.count(Expense.id)).where(
                func.lower(Expense.category).in_(
                    ("inventory_purchase", "inventory_adjustment", "inventory_loss", "damage_loss")
                ),
                func.date(Expense.created_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0
    )
    outbound_today = float(warehouse_control.get("outbound_today", 0.0) or 0.0)
    warehouse_expense_ok = not (
        adjustment_outbound_today > 0 and inventory_related_expenses_today == 0
    )
    checks.append(
        {
            "key": "warehouse_adjustment_expense_parity",
            "label": "تطابق تسويات المخزون مع بنود المصرو",
            "ok": warehouse_expense_ok,
            "severity": "warning" if not warehouse_expense_ok else "info",
            "detail": (
                f"تسويات/اقد مخزوني: {adjustment_outbound_today} | "
                f"مصروات مرتبطة: {inventory_related_expenses_today} | "
                f"صر مخزون اليوم: {outbound_today:.2f}"
            ),
            "action_route": "/manager/warehouse",
        }
    )

    return checks

def operational_heart_dashboard(db: Session) -> dict[str, object]:
    now_utc = datetime.now(UTC)
    local_business_date = datetime.now().date()
    business_day_key = local_business_date.isoformat()

    status_counts = {
        str(row[0]): int(row[1] or 0)
        for row in db.execute(select(Order.status, func.count(Order.id)).group_by(Order.status)).all()
    }
    active_statuses = (
        OrderStatus.CREATED.value,
        OrderStatus.CONFIRMED.value,
        OrderStatus.SENT_TO_KITCHEN.value,
        OrderStatus.IN_PREPARATION.value,
        OrderStatus.READY.value,
        OrderStatus.OUT_FOR_DELIVERY.value,
    )
    active_orders = int(
        db.execute(select(func.count(Order.id)).where(Order.status.in_(active_statuses))).scalar_one() or 0
    )
    today_sales = float(
        db.execute(
            select(func.coalesce(func.sum(FinancialTransaction.amount), 0.0)).where(
                FinancialTransaction.type == FinancialTransactionType.SALE.value,
                func.date(FinancialTransaction.created_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0.0
    )
    today_expenses = float(
        db.execute(
            select(func.coalesce(func.sum(FinancialTransaction.amount), 0.0)).where(
                FinancialTransaction.type == FinancialTransactionType.EXPENSE.value,
                func.date(FinancialTransaction.created_at, "localtime") == business_day_key,
            )
        ).scalar_one()
        or 0.0
    )
    capabilities = get_operational_capabilities(db)
    kitchen_summary = kitchen_monitor_summary(db)
    queues = _build_operational_heart_queues(db, now_utc=now_utc)
    incidents = _build_operational_heart_incidents(
        queues=queues,
        kitchen_summary=kitchen_summary,
        status_counts=status_counts,
    )
    timeline = _build_operational_heart_timeline(db, limit=OPERATIONAL_HEART_TIMELINE_LIMIT)
    financial_control = _build_operational_heart_financial_control(
        db,
        local_business_date=local_business_date,
        business_day_key=business_day_key,
        today_sales=today_sales,
        today_expenses=today_expenses,
    )
    warehouse_control = _build_operational_heart_warehouse_control(db, business_day_key=business_day_key)
    tables_control = _build_operational_heart_tables_control(db)
    expenses_control = _build_operational_heart_expenses_control(db, business_day_key=business_day_key)
    reconciliations = _build_operational_heart_reconciliations(
        db,
        business_day_key=business_day_key,
        today_sales=today_sales,
        tables_control=tables_control,
        warehouse_control=warehouse_control,
    )

    return {
        "meta": {
            "generated_at": now_utc,
            "local_business_date": local_business_date,
            "refresh_recommended_ms": get_order_polling_ms(db),
            "contract_version": OPERATIONAL_HEART_CONTRACT_VERSION,
        },
        "capabilities": {
            "kitchen_enabled": bool(capabilities.get("kitchen_enabled", False)),
            "delivery_enabled": bool(capabilities.get("delivery_enabled", False)),
            "kitchen_active_users": int(capabilities.get("kitchen_active_users", 0) or 0),
            "delivery_active_users": int(capabilities.get("delivery_active_users", 0) or 0),
            "kitchen_block_reason": capabilities.get("kitchen_block_reason"),
            "delivery_block_reason": capabilities.get("delivery_block_reason"),
        },
        "kpis": {
            "active_orders": active_orders,
            "ready_orders": int(status_counts.get(OrderStatus.READY.value, 0)),
            "today_sales": today_sales,
            "today_expenses": today_expenses,
            "today_net": today_sales - today_expenses,
            "avg_prep_minutes_today": float(kitchen_summary.get("avg_prep_minutes_today", 0.0) or 0.0),
            "oldest_kitchen_wait_seconds": int(kitchen_summary.get("oldest_order_wait_seconds", 0) or 0),
        },
        "queues": queues,
        "incidents": incidents,
        "timeline": timeline,
        "financial_control": financial_control,
        "warehouse_control": warehouse_control,
        "tables_control": tables_control,
        "expenses_control": expenses_control,
        "reconciliations": reconciliations,
    }

