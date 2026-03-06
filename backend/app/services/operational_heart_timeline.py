from . import shared as _shared

globals().update({name: getattr(_shared, name) for name in _shared.__all__})


def _operational_heart_domain_from_status(status_value: str) -> str:
    if status_value in {OrderStatus.SENT_TO_KITCHEN.value, OrderStatus.IN_PREPARATION.value, OrderStatus.READY.value}:
        return "kitchen"
    if status_value in {OrderStatus.OUT_FOR_DELIVERY.value, OrderStatus.DELIVERY_FAILED.value}:
        return "delivery"
    return "orders"


def _operational_heart_module_route(module: str) -> str | None:
    routes = {
        "orders": "/manager/orders",
        "kitchen": "/manager/kitchen-monitor",
        "delivery": "/manager/delivery-team",
        "financial": "/manager/financial",
        "expenses": "/manager/expenses",
        "tables": "/manager/tables",
        "users": "/manager/users",
        "settings": "/manager/settings",
        "warehouse": "/manager/warehouse",
    }
    return routes.get(module)


def build_operational_heart_timeline(
    db: Session,
    *,
    limit: int = OPERATIONAL_HEART_TIMELINE_LIMIT,
) -> list[dict[str, object]]:
    safe_limit = min(max(int(limit), 1), 100)
    per_source_limit = max(8, min(30, safe_limit))
    rows: list[dict[str, object]] = []

    transition_rows = db.execute(
        select(
            OrderTransitionLog.id.label("id"),
            OrderTransitionLog.order_id.label("order_id"),
            OrderTransitionLog.from_status.label("from_status"),
            OrderTransitionLog.to_status.label("to_status"),
            OrderTransitionLog.performed_by.label("performed_by"),
            OrderTransitionLog.timestamp.label("timestamp"),
        )
        .order_by(OrderTransitionLog.timestamp.desc())
        .limit(per_source_limit)
    ).all()
    for item in transition_rows:
        to_status = str(item.to_status)
        rows.append(
            {
                "timestamp": item.timestamp,
                "domain": _operational_heart_domain_from_status(to_status),
                "title": f"انتقال حالة الطلب #{int(item.order_id)}",
                "description": f"{item.from_status} -> {item.to_status} بواسطة المستخدم #{int(item.performed_by)}",
                "action_route": ORDER_STATUS_ACTION_ROUTE.get(to_status, "/manager/orders"),
                "order_id": int(item.order_id),
                "entity_id": int(item.id),
            }
        )

    tx_type_label = {
        FinancialTransactionType.SALE.value: "مبيعات",
        FinancialTransactionType.REFUND.value: "مرتجع",
        FinancialTransactionType.EXPENSE.value: "مصرو",
    }
    financial_rows = db.execute(
        select(
            FinancialTransaction.id.label("id"),
            FinancialTransaction.order_id.label("order_id"),
            FinancialTransaction.type.label("type"),
            FinancialTransaction.amount.label("amount"),
            FinancialTransaction.note.label("note"),
            FinancialTransaction.created_at.label("created_at"),
        )
        .order_by(FinancialTransaction.created_at.desc())
        .limit(per_source_limit)
    ).all()
    for item in financial_rows:
        label = tx_type_label.get(str(item.type), str(item.type))
        base_description = f"مبلغ {float(item.amount or 0.0):.2f} د.ج"
        if item.order_id is not None:
            base_description += f" | الطلب #{int(item.order_id)}"
        if item.note:
            base_description += f" | {str(item.note)}"
        rows.append(
            {
                "timestamp": item.created_at,
                "domain": "financial",
                "title": f"حركة مالية ({label})",
                "description": base_description,
                "action_route": "/manager/financial",
                "order_id": int(item.order_id) if item.order_id is not None else None,
                "entity_id": int(item.id),
            }
        )

    expense_rows = db.execute(
        select(
            Expense.id.label("id"),
            Expense.title.label("title"),
            Expense.status.label("status"),
            Expense.amount.label("amount"),
            Expense.created_at.label("created_at"),
            Expense.reviewed_at.label("reviewed_at"),
        )
        .order_by(Expense.created_at.desc())
        .limit(per_source_limit)
    ).all()
    for item in expense_rows:
        timestamp = item.reviewed_at if item.reviewed_at is not None else item.created_at
        rows.append(
            {
                "timestamp": timestamp,
                "domain": "expenses",
                "title": f"مصرو ({str(item.status)})",
                "description": f"{str(item.title)} | مبلغ {float(item.amount or 0.0):.2f} د.ج",
                "action_route": "/manager/expenses",
                "order_id": None,
                "entity_id": int(item.id),
            }
        )

    warehouse_rows = db.execute(
        select(
            WarehouseStockLedger.id.label("id"),
            WarehouseStockLedger.movement_kind.label("movement_kind"),
            WarehouseStockLedger.source_type.label("source_type"),
            WarehouseStockLedger.quantity.label("quantity"),
            WarehouseStockLedger.note.label("note"),
            WarehouseStockLedger.created_at.label("created_at"),
        )
        .order_by(WarehouseStockLedger.created_at.desc())
        .limit(per_source_limit)
    ).all()
    for item in warehouse_rows:
        movement_kind = str(item.movement_kind)
        movement_label = "دخول" if movement_kind == "inbound" else "خروج"
        description = f"كمية {float(item.quantity or 0.0):.2f}"
        if item.note:
            description += f" | {str(item.note)}"
        rows.append(
            {
                "timestamp": item.created_at,
                "domain": "warehouse",
                "title": f"حركة مخزون ({movement_label})",
                "description": description,
                "action_route": "/manager/warehouse",
                "order_id": None,
                "entity_id": int(item.id),
            }
        )

    table_rows = db.execute(
        select(
            Order.table_id.label("table_id"),
            func.count(Order.id).label("orders_count"),
            func.max(Order.created_at).label("last_activity_at"),
            func.coalesce(
                func.sum(
                    case(
                        (Order.payment_status != PaymentStatus.PAID.value, func.coalesce(Order.total, 0.0)),
                        else_=0.0,
                    )
                ),
                0.0,
            ).label("unpaid_total"),
        )
        .where(
            Order.table_id.is_not(None),
            _table_session_open_condition(),
        )
        .group_by(Order.table_id)
        .order_by(func.max(Order.created_at).desc())
        .limit(min(per_source_limit, 10))
    ).all()
    for item in table_rows:
        if item.last_activity_at is None:
            continue
        rows.append(
            {
                "timestamp": item.last_activity_at,
                "domain": "tables",
                "title": f"جلسة طاولة #{int(item.table_id)}",
                "description": (
                    f"طلبات نشطة: {int(item.orders_count or 0)}"
                    f" | غير مسدد: {float(item.unpaid_total or 0.0):.2f} د.ج"
                ),
                "action_route": "/manager/tables",
                "order_id": None,
                "entity_id": int(item.table_id),
            }
        )

    system_rows = db.execute(
        select(
            SystemAuditLog.id.label("id"),
            SystemAuditLog.module.label("module"),
            SystemAuditLog.action.label("action"),
            SystemAuditLog.description.label("description"),
            SystemAuditLog.entity_id.label("entity_id"),
            SystemAuditLog.timestamp.label("timestamp"),
        )
        .order_by(SystemAuditLog.timestamp.desc())
        .limit(per_source_limit)
    ).all()
    for item in system_rows:
        module = str(item.module)
        rows.append(
            {
                "timestamp": item.timestamp,
                "domain": module if module in {"orders", "kitchen", "delivery", "financial", "warehouse", "tables", "expenses"} else "system",
                "title": f"سجل نظام ({module})",
                "description": str(item.description),
                "action_route": _operational_heart_module_route(module),
                "order_id": None,
                "entity_id": int(item.entity_id) if item.entity_id is not None else int(item.id),
            }
        )

    rows.sort(
        key=lambda row: row["timestamp"] if isinstance(row["timestamp"], datetime) else datetime.min,
        reverse=True,
    )
    return rows[:safe_limit]
