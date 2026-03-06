import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, inspect as sa_inspect, or_, select, text
from sqlalchemy.orm import Session

from .database import Base
from .enums import (
    DriverStatus,
    PaymentStatus,
    ProductKind,
    ResourceScope,
    ResourceMovementType,
    TableStatus,
    UserRole,
)
from .models import (
    DeliveryAssignment,
    DeliveryDriver,
    Expense,
    ExpenseCostCenter,
    FinancialTransaction,
    Order,
    Product,
    ProductCategory,
    Resource,
    ResourceMovement,
    RestaurantTable,
    SystemSetting,
    User,
)
from .security import hash_password

KITCHEN_SCOPE = ResourceScope.KITCHEN.value
DEFAULT_EXPENSE_COST_CENTER_CODE = "GENERAL"
DEFAULT_EXPENSE_COST_CENTER_NAME = "عام"


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _first_user_by_role(db: Session, role: str) -> User | None:
    return db.execute(
        select(User).where(User.role == role).order_by(User.id.asc()).limit(1)
    ).scalar_one_or_none()


def _first_user_id_by_role(db: Session, role: str) -> int | None:
    return db.execute(
        select(User.id).where(User.role == role).order_by(User.id.asc()).limit(1)
    ).scalars().first()


def _ensure_column(db: Session, table: str, column: str, definition: str) -> None:
    table_info = db.execute(text(f"PRAGMA table_info({table})")).all()
    existing = {row[1] for row in table_info}
    if column not in existing:
        db.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))


def _ensure_unique_index(db: Session, table: str, index_name: str, column: str) -> None:
    indexes = db.execute(text(f"PRAGMA index_list({table})")).all()
    existing = {row[1] for row in indexes}
    if index_name not in existing:
        db.execute(
            text(
                f"CREATE UNIQUE INDEX {index_name} ON {table}({column}) "
                f"WHERE {column} IS NOT NULL"
            )
        )


def _assert_schema_matches_models(db: Session) -> None:
    inspector = sa_inspect(db.bind)
    existing_tables = set(inspector.get_table_names())
    expected_tables = set(Base.metadata.tables.keys())

    missing_tables = sorted(expected_tables - existing_tables)
    if missing_tables:
        raise RuntimeError(
            "Production schema contract violation: missing tables detected. "
            f"Apply migrations before startup. missing={missing_tables}"
        )

    missing_columns: list[str] = []
    for table_name, table in Base.metadata.tables.items():
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        expected_columns = {column.name for column in table.columns}
        missing = sorted(expected_columns - existing_columns)
        if missing:
            missing_columns.append(f"{table_name}: {', '.join(missing)}")

    if missing_columns:
        raise RuntimeError(
            "Production schema contract violation: missing columns detected. "
            f"Apply migrations before startup. missing={missing_columns}"
        )


def _ensure_expense_cost_centers_table(db: Session) -> None:
    db.execute(
        text(
            "CREATE TABLE IF NOT EXISTS expense_cost_centers ("
            "id INTEGER PRIMARY KEY, "
            "code VARCHAR(40) NOT NULL UNIQUE, "
            "name VARCHAR(120) NOT NULL UNIQUE, "
            "active BOOLEAN NOT NULL DEFAULT 1, "
            "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
    )
    db.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_cost_centers_code "
            "ON expense_cost_centers(code)"
        )
    )
    db.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_cost_centers_name "
            "ON expense_cost_centers(name)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_expense_cost_centers_active "
            "ON expense_cost_centers(active)"
        )
    )


def _ensure_schema_compatibility(db: Session) -> None:
    _ensure_column(db, "users", "username", "VARCHAR(120)")
    _ensure_column(db, "users", "password_hash", "VARCHAR(255)")
    _ensure_column(db, "users", "active", "BOOLEAN DEFAULT 1")
    _ensure_column(db, "users", "failed_login_attempts", "INTEGER DEFAULT 0")
    _ensure_column(db, "users", "locked_until", "DATETIME")
    _ensure_column(db, "users", "last_failed_login_at", "DATETIME")
    _ensure_column(db, "users", "permission_overrides_json", "TEXT")
    _ensure_column(db, "users", "created_at", "DATETIME")
    db.execute(text("UPDATE users SET failed_login_attempts = COALESCE(failed_login_attempts, 0)"))

    _ensure_column(db, "products", "description", "TEXT")
    _ensure_column(db, "products", "image_path", "VARCHAR(255)")
    _ensure_column(db, "products", "is_archived", "BOOLEAN DEFAULT 0")
    _ensure_column(db, "products", "kind", "VARCHAR(20) DEFAULT 'sellable'")
    _ensure_column(db, "products", "category_id", "INTEGER")
    db.execute(
        text(
            "UPDATE products SET kind = CASE LOWER(kind) "
            "WHEN 'sellable' THEN 'sellable' "
            "WHEN 'internal' THEN 'internal' "
            "ELSE 'sellable' END "
            "WHERE kind IS NULL OR TRIM(kind) = '' OR LOWER(kind) NOT IN ('sellable', 'internal')"
        )
    )

    _ensure_column(db, "resources", "unit", "VARCHAR(32) DEFAULT 'unit'")
    _ensure_column(db, "resources", "active", "BOOLEAN DEFAULT 1")
    _ensure_column(db, "resources", "scope", f"VARCHAR(16) DEFAULT '{KITCHEN_SCOPE}'")
    db.execute(
        text(
            "UPDATE resources SET scope = CASE LOWER(scope) "
            "WHEN 'kitchen' THEN 'kitchen' "
            "WHEN 'stock' THEN 'stock' "
            "ELSE :fallback END "
            "WHERE scope IS NULL OR TRIM(scope) = '' OR LOWER(scope) NOT IN ('kitchen', 'stock')"
        ),
        {"fallback": KITCHEN_SCOPE},
    )

    _ensure_column(db, "orders", "payment_status", f"VARCHAR(32) DEFAULT '{PaymentStatus.UNPAID.value}'")
    _ensure_column(db, "orders", "paid_at", "DATETIME")
    _ensure_column(db, "orders", "paid_by", "INTEGER")
    _ensure_column(db, "orders", "amount_received", "FLOAT")
    _ensure_column(db, "orders", "change_amount", "FLOAT")
    _ensure_column(db, "orders", "payment_method", "VARCHAR(16) DEFAULT 'cash'")
    _ensure_column(db, "orders", "subtotal", "FLOAT DEFAULT 0")
    _ensure_column(db, "orders", "delivery_fee", "FLOAT DEFAULT 0")
    _ensure_column(db, "orders", "delivery_team_notified_at", "DATETIME")
    _ensure_column(db, "orders", "delivery_team_notified_by", "INTEGER")
    _ensure_column(db, "financial_transactions", "expense_id", "INTEGER")

    _ensure_column(db, "delivery_drivers", "user_id", "INTEGER")
    _ensure_unique_index(db, "delivery_drivers", "ux_delivery_drivers_user_id", "user_id")

    _ensure_column(db, "financial_transactions", "order_id", "INTEGER")
    _ensure_column(db, "financial_transactions", "created_by", "INTEGER")
    _ensure_column(db, "financial_transactions", "created_at", "DATETIME")
    _ensure_column(db, "financial_transactions", "note", "VARCHAR(255)")
    _ensure_column(db, "financial_transactions", "type", "VARCHAR(32) DEFAULT 'sale'")
    _ensure_column(db, "financial_transactions", "amount", "FLOAT DEFAULT 0")
    _ensure_column(db, "financial_transactions", "expense_id", "INTEGER")
    db.execute(
        text(
            "UPDATE financial_transactions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP)"
        )
    )
    db.execute(
        text(
            "UPDATE financial_transactions SET created_by = COALESCE(created_by, 1)"
        )
    )

    _ensure_expense_cost_centers_table(db)
    default_center = db.execute(
        select(ExpenseCostCenter).where(ExpenseCostCenter.code == DEFAULT_EXPENSE_COST_CENTER_CODE)
    ).scalar_one_or_none()
    if default_center is None:
        default_center = ExpenseCostCenter(
            code=DEFAULT_EXPENSE_COST_CENTER_CODE,
            name=DEFAULT_EXPENSE_COST_CENTER_NAME,
            active=True,
        )
        db.add(default_center)
        db.flush()

    _ensure_column(db, "expenses", "status", "VARCHAR(20) DEFAULT 'pending'")
    _ensure_column(db, "expenses", "reviewed_by", "INTEGER")
    _ensure_column(db, "expenses", "reviewed_at", "DATETIME")
    _ensure_column(db, "expenses", "review_note", "VARCHAR(255)")
    _ensure_column(db, "expenses", "cost_center_id", "INTEGER")
    db.execute(
        text("UPDATE expenses SET cost_center_id = COALESCE(cost_center_id, :center_id)"),
        {"center_id": int(default_center.id)},
    )
    db.execute(
        text(
            "UPDATE expenses SET status = CASE "
            "WHEN id IN (SELECT expense_id FROM financial_transactions "
            "          WHERE type = 'expense' AND expense_id IS NOT NULL) THEN 'approved' "
            "ELSE COALESCE(NULLIF(status, ''), 'pending') END"
        )
    )
    db.execute(
        text(
            "UPDATE expenses SET reviewed_by = COALESCE(reviewed_by, created_by), "
            "reviewed_at = COALESCE(reviewed_at, created_at) "
            "WHERE status = 'approved'"
        )
    )

    _ensure_column(db, "resource_movements", "type", f"VARCHAR(32) DEFAULT '{ResourceMovementType.ADJUST.value}'")
    _ensure_column(db, "resource_movements", "delta", "FLOAT DEFAULT 0")
    _ensure_column(db, "resource_movements", "quantity", "FLOAT DEFAULT 0")
    _ensure_column(db, "resource_movements", "created_by", "INTEGER DEFAULT 1")
    db.execute(
        text(
            "UPDATE resource_movements SET quantity = ABS(delta) "
            "WHERE quantity IS NULL OR quantity = 0"
        )
    )
    db.execute(
        text(
            "UPDATE resource_movements SET type = CASE "
            "WHEN delta > 0 THEN 'add' "
            "WHEN delta < 0 THEN 'deduct' "
            "ELSE 'adjust' END "
            "WHERE type IS NULL OR type = '' OR type = 'adjust'"
        )
    )
    db.execute(
        text(
            "UPDATE resource_movements SET delta = CASE "
            "WHEN type = 'add' THEN ABS(COALESCE(quantity, 0)) "
            "WHEN type = 'deduct' THEN -ABS(COALESCE(quantity, 0)) "
            "ELSE COALESCE(quantity, 0) END "
            "WHERE delta IS NULL OR delta = 0"
        )
    )

    _ensure_column(db, "wh_suppliers", "payment_term_days", "INTEGER DEFAULT 0")
    _ensure_column(db, "wh_suppliers", "credit_limit", "FLOAT")
    _ensure_column(db, "wh_suppliers", "quality_rating", "FLOAT DEFAULT 3")
    _ensure_column(db, "wh_suppliers", "lead_time_days", "INTEGER DEFAULT 0")
    _ensure_column(db, "wh_suppliers", "notes", "VARCHAR(255)")
    db.execute(text("UPDATE wh_suppliers SET payment_term_days = COALESCE(payment_term_days, 0)"))
    db.execute(text("UPDATE wh_suppliers SET quality_rating = COALESCE(quality_rating, 3)"))
    db.execute(text("UPDATE wh_suppliers SET lead_time_days = COALESCE(lead_time_days, 0)"))

    _ensure_column(db, "wh_stock_balances", "avg_unit_cost", "FLOAT DEFAULT 0")
    db.execute(text("UPDATE wh_stock_balances SET avg_unit_cost = COALESCE(avg_unit_cost, 0)"))

    _ensure_column(db, "wh_outbound_vouchers", "reason_code", "VARCHAR(64) DEFAULT 'operational_use'")
    db.execute(
        text(
            "UPDATE wh_outbound_vouchers SET reason_code = COALESCE(NULLIF(reason_code, ''), 'operational_use')"
        )
    )

    _ensure_column(db, "wh_stock_ledger", "unit_cost", "FLOAT DEFAULT 0")
    _ensure_column(db, "wh_stock_ledger", "line_value", "FLOAT DEFAULT 0")
    _ensure_column(db, "wh_stock_ledger", "running_avg_cost", "FLOAT DEFAULT 0")
    db.execute(text("UPDATE wh_stock_ledger SET unit_cost = COALESCE(unit_cost, 0)"))
    db.execute(text("UPDATE wh_stock_ledger SET line_value = COALESCE(line_value, 0)"))
    db.execute(text("UPDATE wh_stock_ledger SET running_avg_cost = COALESCE(running_avg_cost, 0)"))

    db.commit()


def _ensure_product_categories_table(db: Session) -> None:
    db.execute(
        text(
            "CREATE TABLE IF NOT EXISTS product_categories ("
            "id INTEGER PRIMARY KEY, "
            "name VARCHAR(80) NOT NULL UNIQUE, "
            "active BOOLEAN NOT NULL DEFAULT 1, "
            "sort_order INTEGER NOT NULL DEFAULT 0)"
        )
    )
    db.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_product_categories_name "
            "ON product_categories(name)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_product_categories_sort_order "
            "ON product_categories(sort_order)"
        )
    )
    db.commit()


def _migrate_legacy_product_categories(db: Session, *, allow_schema_mutation: bool) -> None:
    if allow_schema_mutation:
        _ensure_product_categories_table(db)
        _ensure_column(db, "products", "category_id", "INTEGER")

    names = db.execute(
        text(
            "SELECT DISTINCT TRIM(category) AS name "
            "FROM products WHERE category IS NOT NULL AND TRIM(category) <> '' "
            "ORDER BY name ASC"
        )
    ).all()
    for index, row in enumerate(names):
        name = str(row[0]).strip()
        exists = db.execute(select(ProductCategory.id).where(ProductCategory.name == name)).scalar_one_or_none()
        if exists is None:
            db.add(ProductCategory(name=name, active=True, sort_order=index))
    db.commit()

    fallback_name = "غير مصنف"
    fallback = db.execute(select(ProductCategory).where(ProductCategory.name == fallback_name)).scalar_one_or_none()
    if fallback is None:
        fallback = ProductCategory(name=fallback_name, active=True, sort_order=9999)
        db.add(fallback)
        db.commit()

    db.execute(
        text(
            "UPDATE products SET category = :fallback "
            "WHERE category IS NULL OR TRIM(category) = ''"
        ),
        {"fallback": fallback_name},
    )
    db.execute(
        text(
            "UPDATE products SET category_id = ("
            "  SELECT pc.id FROM product_categories pc WHERE pc.name = products.category LIMIT 1"
            ") "
            "WHERE category_id IS NULL"
        )
    )
    db.execute(
        text("UPDATE products SET category_id = :fallback_id WHERE category_id IS NULL"),
        {"fallback_id": fallback.id},
    )
    db.commit()


def _normalize_legacy_enum_values(db: Session) -> None:
    db.execute(
        text(
            "UPDATE users SET role = CASE LOWER(role) "
            "WHEN 'manager' THEN 'manager' "
            "WHEN 'kitchen' THEN 'kitchen' "
            "WHEN 'delivery' THEN 'delivery' "
            "ELSE role END "
            "WHERE role IS NOT NULL"
        )
    )
    db.execute(
        text(
            "UPDATE tables SET status = CASE UPPER(status) "
            "WHEN 'AVAILABLE' THEN 'available' "
            "WHEN 'OCCUPIED' THEN 'occupied' "
            "WHEN 'RESERVED' THEN 'reserved' "
            "ELSE status END "
            "WHERE status IS NOT NULL"
        )
    )
    db.execute(
        text(
            "UPDATE orders SET type = CASE UPPER(REPLACE(type, '-', '_')) "
            "WHEN 'DINE_IN' THEN 'dine-in' "
            "WHEN 'TAKEAWAY' THEN 'takeaway' "
            "WHEN 'DELIVERY' THEN 'delivery' "
            "ELSE type END "
            "WHERE type IS NOT NULL"
        )
    )
    db.execute(
        text(
            "UPDATE orders SET status = CASE UPPER(status) "
            "WHEN 'CREATED' THEN 'CREATED' "
            "WHEN 'CONFIRMED' THEN 'CONFIRMED' "
            "WHEN 'SENT_TO_KITCHEN' THEN 'SENT_TO_KITCHEN' "
            "WHEN 'IN_PREPARATION' THEN 'IN_PREPARATION' "
            "WHEN 'READY' THEN 'READY' "
            "WHEN 'OUT_FOR_DELIVERY' THEN 'OUT_FOR_DELIVERY' "
            "WHEN 'DELIVERED' THEN 'DELIVERED' "
            "WHEN 'DELIVERY_FAILED' THEN 'DELIVERY_FAILED' "
            "WHEN 'CANCELED' THEN 'CANCELED' "
            "ELSE status END "
            "WHERE status IS NOT NULL"
        )
    )
    db.execute(
        text(
            "UPDATE orders SET payment_status = CASE UPPER(payment_status) "
            "WHEN 'UNPAID' THEN 'unpaid' "
            "WHEN 'PAID' THEN 'paid' "
            "WHEN 'REFUNDED' THEN 'refunded' "
            "ELSE payment_status END "
            "WHERE payment_status IS NOT NULL"
        )
    )
    db.execute(
        text(
            "UPDATE orders SET payment_method = 'cash' "
            "WHERE payment_method IS NULL OR TRIM(payment_method) = ''"
        )
    )
    db.execute(
        text(
            "UPDATE orders SET subtotal = COALESCE(("
            "  SELECT SUM(oi.price * oi.quantity) FROM order_items oi WHERE oi.order_id = orders.id"
            "), total, 0) "
            "WHERE subtotal IS NULL OR subtotal <= 0"
        )
    )
    db.execute(
        text(
            "UPDATE orders SET delivery_fee = CASE "
            "  WHEN type = 'delivery' THEN MAX(COALESCE(total, 0) - COALESCE(subtotal, 0), 0) "
            "  ELSE 0 END "
            "WHERE delivery_fee IS NULL"
        )
    )
    db.execute(
        text(
            "UPDATE orders SET total = COALESCE(subtotal, 0) + COALESCE(delivery_fee, 0) "
            "WHERE total IS NULL"
        )
    )
    db.execute(
        text(
            "UPDATE delivery_drivers SET status = CASE UPPER(status) "
            "WHEN 'AVAILABLE' THEN 'available' "
            "WHEN 'BUSY' THEN 'busy' "
            "WHEN 'INACTIVE' THEN 'inactive' "
            "ELSE status END "
            "WHERE status IS NOT NULL"
        )
    )
    db.execute(
        text(
            "UPDATE delivery_assignments SET status = CASE UPPER(status) "
            "WHEN 'NOTIFIED' THEN 'notified' "
            "WHEN 'ASSIGNED' THEN 'assigned' "
            "WHEN 'DEPARTED' THEN 'departed' "
            "WHEN 'DELIVERED' THEN 'delivered' "
            "WHEN 'FAILED' THEN 'failed' "
            "ELSE status END "
            "WHERE status IS NOT NULL"
        )
    )
    db.execute(
        text(
            "UPDATE financial_transactions SET type = CASE UPPER(type) "
            "WHEN 'SALE' THEN 'sale' "
            "WHEN 'REFUND' THEN 'refund' "
            "WHEN 'EXPENSE' THEN 'expense' "
            "ELSE type END "
            "WHERE type IS NOT NULL"
        )
    )
    db.execute(
        text(
            "UPDATE resource_movements SET type = CASE UPPER(type) "
            "WHEN 'ADD' THEN 'add' "
            "WHEN 'DEDUCT' THEN 'deduct' "
            "WHEN 'ADJUST' THEN 'adjust' "
            "ELSE type END "
            "WHERE type IS NOT NULL"
        )
    )
    db.commit()


def _repair_delivered_cash_consistency(db: Session) -> None:
    manager_id = _first_user_id_by_role(db, UserRole.MANAGER.value) or 1

    db.execute(
        text(
            "UPDATE orders SET "
            "payment_status = 'paid', "
            "payment_method = COALESCE(NULLIF(payment_method, ''), 'cash'), "
            "paid_by = COALESCE(paid_by, :manager_id), "
            "paid_at = COALESCE(paid_at, created_at, CURRENT_TIMESTAMP), "
            "amount_received = CASE "
            "  WHEN amount_received IS NULL OR amount_received < total THEN total "
            "  ELSE amount_received END, "
            "change_amount = CASE "
            "  WHEN (CASE WHEN amount_received IS NULL OR amount_received < total THEN total ELSE amount_received END) - total < 0 THEN 0 "
            "  ELSE (CASE WHEN amount_received IS NULL OR amount_received < total THEN total ELSE amount_received END) - total "
            "END "
            "WHERE status = 'DELIVERED' AND type <> 'dine-in' AND COALESCE(payment_status, '') <> 'paid'"
        ),
        {"manager_id": manager_id},
    )

    db.execute(
        text(
            "INSERT INTO financial_transactions (order_id, amount, type, created_by, created_at, note) "
            "SELECT o.id, o.total, 'sale', COALESCE(o.paid_by, :manager_id), COALESCE(o.paid_at, o.created_at, CURRENT_TIMESTAMP), "
            "       'تسوية تلقائية لطلب مُسلّم' "
            "FROM orders o "
            "WHERE o.status = 'DELIVERED' "
            "  AND o.type <> 'dine-in' "
            "  AND NOT EXISTS ("
            "    SELECT 1 FROM financial_transactions f "
            "    WHERE f.order_id = o.id AND f.type = 'sale'"
            "  )"
        ),
        {"manager_id": manager_id},
    )
    db.commit()


def _repair_table_occupancy_from_orders(db: Session) -> None:
    open_table_ids = {
        int(table_id)
        for table_id in db.execute(
            select(Order.table_id).where(
                Order.table_id.is_not(None),
                Order.type == "dine-in",
                or_(
                    Order.status.notin_(("DELIVERED", "CANCELED", "DELIVERY_FAILED")),
                    and_(
                        Order.status == "DELIVERED",
                        Order.payment_status != PaymentStatus.PAID.value,
                    ),
                ),
            )
        ).scalars().all()
        if table_id is not None
    }

    tables = db.execute(select(RestaurantTable)).scalars().all()
    changed = False
    for table in tables:
        if table.id in open_table_ids:
            if table.status != TableStatus.OCCUPIED.value:
                table.status = TableStatus.OCCUPIED.value
                changed = True
        elif table.status == TableStatus.OCCUPIED.value:
            table.status = TableStatus.AVAILABLE.value
            changed = True

    if changed:
        db.commit()


def _cleanup_refresh_tokens(db: Session) -> None:
    now = datetime.now(UTC)
    revoked_cutoff = now - timedelta(days=14)
    db.execute(
        text(
            "DELETE FROM refresh_tokens "
            "WHERE expires_at < :now "
            "   OR (revoked_at IS NOT NULL AND revoked_at < :revoked_cutoff)"
        ),
        {"now": now, "revoked_cutoff": revoked_cutoff},
    )
    db.commit()


def _cleanup_security_audit_events(db: Session) -> None:
    now = datetime.now(UTC)
    retention_cutoff = now - timedelta(days=120)
    db.execute(
        text(
            "DELETE FROM security_audit_events "
            "WHERE created_at < :retention_cutoff"
        ),
        {"retention_cutoff": retention_cutoff},
    )
    db.commit()


def _development_seed_password(*, env_key: str, fallback: str) -> str:
    value = (os.getenv(env_key) or "").strip()
    return value or fallback


def _seed_default_users_for_development(db: Session) -> None:
    defaults = [
        (
            "manager",
            _development_seed_password(env_key="DEV_MANAGER_PASSWORD", fallback="ChangeMe-Manager-2026!"),
            UserRole.MANAGER.value,
            "مدير النظام",
        ),
        (
            "kitchen",
            _development_seed_password(env_key="DEV_KITCHEN_PASSWORD", fallback="ChangeMe-Kitchen-2026!"),
            UserRole.KITCHEN.value,
            "موظف المطبخ",
        ),
        (
            "delivery",
            _development_seed_password(env_key="DEV_DELIVERY_PASSWORD", fallback="ChangeMe-Delivery-2026!"),
            UserRole.DELIVERY.value,
            "موظف التوصيل",
        ),
    ]

    for username, password, role, name in defaults:
        user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if not user:
            user = _first_user_by_role(db, role)
        if not user:
            db.add(
                User(
                    name=name,
                    username=username,
                    password_hash=hash_password(password),
                    role=role,
                    active=True,
                )
            )
        else:
            user.name = user.name or name
            user.username = user.username or username
            user.password_hash = user.password_hash or hash_password(password)
            user.role = user.role or role
    db.commit()


def _fallback_delivery_phone(*, user_id: int) -> str:
    return f"055{int(user_id) % 10_000_000:07d}"


def _next_delivery_shadow_username(db: Session, *, driver_id: int) -> str:
    base = f"delivery_shadow_{int(driver_id)}"
    candidate = base
    suffix = 1
    while db.execute(select(User.id).where(User.username == candidate)).scalar_one_or_none() is not None:
        suffix += 1
        candidate = f"{base}_{suffix}"
    return candidate


def _repair_delivery_driver_links(db: Session) -> None:
    delivery_users = db.execute(
        select(User).where(User.role == UserRole.DELIVERY.value).order_by(User.id.asc())
    ).scalars().all()
    orphan_drivers = list(
        db.execute(
            select(DeliveryDriver)
            .where(DeliveryDriver.user_id.is_(None))
            .order_by(DeliveryDriver.id.asc())
        ).scalars().all()
    )

    changed = False

    for user in delivery_users:
        driver = db.execute(
            select(DeliveryDriver).where(DeliveryDriver.user_id == int(user.id))
        ).scalar_one_or_none()
        if driver is None:
            if orphan_drivers:
                driver = orphan_drivers.pop(0)
                driver.user_id = int(user.id)
            else:
                driver = DeliveryDriver(
                    user_id=int(user.id),
                    name=str(user.name or "").strip() or f"Driver {int(user.id)}",
                    phone=_fallback_delivery_phone(user_id=int(user.id)),
                    status=DriverStatus.AVAILABLE.value if bool(user.active) else DriverStatus.INACTIVE.value,
                    vehicle=None,
                    commission_rate=0.0,
                    active=bool(user.active),
                )
                db.add(driver)
                db.flush()
            changed = True

        desired_name = str(user.name or "").strip() or driver.name
        if driver.name != desired_name:
            driver.name = desired_name
            changed = True

        if not str(driver.phone or "").strip():
            driver.phone = _fallback_delivery_phone(user_id=int(user.id))
            changed = True

        desired_active = bool(user.active)
        if bool(driver.active) != desired_active:
            driver.active = desired_active
            changed = True
        desired_status = DriverStatus.AVAILABLE.value if desired_active else DriverStatus.INACTIVE.value
        if driver.status != desired_status:
            driver.status = desired_status
            changed = True

    for orphan in orphan_drivers:
        has_assignments = (
            db.execute(
                select(DeliveryAssignment.id)
                .where(DeliveryAssignment.driver_id == int(orphan.id))
                .limit(1)
            ).scalar_one_or_none()
            is not None
        )
        if has_assignments:
            shadow_user = User(
                name=str(orphan.name or "").strip() or f"Driver {int(orphan.id)}",
                username=_next_delivery_shadow_username(db, driver_id=int(orphan.id)),
                password_hash=hash_password(f"delivery-shadow-{int(orphan.id)}-seed"),
                role=UserRole.DELIVERY.value,
                active=False,
            )
            db.add(shadow_user)
            db.flush()
            orphan.user_id = int(shadow_user.id)
            orphan.active = False
            orphan.status = DriverStatus.INACTIVE.value
            if not str(orphan.phone or "").strip():
                orphan.phone = _fallback_delivery_phone(user_id=int(shadow_user.id))
        else:
            db.delete(orphan)
        changed = True

    if changed:
        db.commit()


def _seed_tables(db: Session) -> None:
    if db.execute(select(RestaurantTable.id)).first() is None:
        db.add_all(
            [
                RestaurantTable(
                    id=table_id,
                    qr_code=f"/menu?table={table_id}",
                    status=TableStatus.AVAILABLE.value,
                )
                for table_id in range(1, 13)
            ]
        )
        db.commit()


def _seed_resources_and_products(db: Session) -> None:
    manager = _first_user_by_role(db, UserRole.MANAGER.value)
    if manager is None:
        manager = db.execute(select(User).order_by(User.id.asc()).limit(1)).scalar_one_or_none()
    if manager is None:
        raise RuntimeError("Cannot seed resources/products without at least one user")

    def ensure_category(name: str, sort_order: int = 0) -> ProductCategory:
        category = db.execute(select(ProductCategory).where(ProductCategory.name == name)).scalar_one_or_none()
        if category:
            return category
        category = ProductCategory(name=name, active=True, sort_order=sort_order)
        db.add(category)
        db.flush()
        return category

    if db.execute(select(Resource.id)).first() is None:
        kitchen_resources = [
            Resource(name="لحم", quantity=40, alert_threshold=10, unit="كغ", active=True, scope=KITCHEN_SCOPE),
            Resource(name="بطاطا", quantity=25, alert_threshold=8, unit="كغ", active=True, scope=KITCHEN_SCOPE),
            Resource(name="دجاج", quantity=30, alert_threshold=7, unit="كغ", active=True, scope=KITCHEN_SCOPE),
            Resource(name="خبز", quantity=50, alert_threshold=15, unit="رغيف", active=True, scope=KITCHEN_SCOPE),
            Resource(name="صلصة", quantity=60, alert_threshold=20, unit="علبة", active=True, scope=KITCHEN_SCOPE),
        ]
        db.add_all(kitchen_resources)
        db.flush()
        db.add_all(
            [
                ResourceMovement(
                    resource_id=resource.id,
                    type=ResourceMovementType.ADD.value,
                    delta=resource.quantity,
                    quantity=resource.quantity,
                    reason="رصيد ابتدائي",
                    created_by=manager.id,
                )
                for resource in kitchen_resources
            ]
        )
        db.commit()

    if db.execute(select(Product.id)).first() is None:
        products = [
            Product(
                name="برغر لحم",
                description="برغر لحم مع صلصة خاصة",
                price=12.0,
                available=True,
                kind=ProductKind.SELLABLE.value,
                category="برغر",
                is_archived=False,
            ),
            Product(
                name="برغر دجاج",
                description="برغر دجاج مع خس وطماطم",
                price=9.0,
                available=True,
                kind=ProductKind.SELLABLE.value,
                category="برغر",
                is_archived=False,
            ),
            Product(
                name="شاورما دجاج",
                description="شاورما دجاج طازج",
                price=6.5,
                available=True,
                kind=ProductKind.SELLABLE.value,
                category="شاورما",
                is_archived=False,
            ),
            Product(
                name="عصير برتقال",
                description="عصير طبيعي طازج",
                price=5.5,
                available=True,
                kind=ProductKind.SELLABLE.value,
                category="عصائر",
                is_archived=False,
            ),
            Product(
                name="مياه معدنية",
                description="مياه معدنية باردة",
                price=3.0,
                available=True,
                kind=ProductKind.SELLABLE.value,
                category="مشروبات",
                is_archived=False,
            ),
        ]
        category_sort: dict[str, int] = {}
        next_sort = 0
        for product in products:
            category_name = product.category or "غير مصنف"
            if category_name not in category_sort:
                category_sort[category_name] = next_sort
                next_sort += 1
            category = ensure_category(category_name, sort_order=category_sort[category_name])
            product.category = category.name
            product.category_id = category.id
        db.add_all(products)
        db.flush()
        db.commit()


def _seed_delivery_drivers(db: Session) -> None:
    _repair_delivery_driver_links(db)

def _seed_delivery_fee_setting(db: Session) -> None:
    exists_setting = db.execute(
        select(SystemSetting.key).where(SystemSetting.key == "delivery_fee")
    ).scalar_one_or_none()
    if exists_setting:
        return
    db.add(
        SystemSetting(
            key="delivery_fee",
            value="0.00",
            updated_by=_first_user_id_by_role(db, UserRole.MANAGER.value),
        )
    )
    db.commit()


def _link_legacy_expenses_to_transactions(db: Session) -> None:
    expense_transactions = db.execute(
        select(FinancialTransaction).where(
            FinancialTransaction.type == "expense",
            FinancialTransaction.expense_id.is_(None),
        )
    ).scalars().all()
    if not expense_transactions:
        return
    expenses = db.execute(select(Expense)).scalars().all()
    if not expenses:
        return

    linked_expense_ids: set[int] = set()
    for tx in expense_transactions:
        tx_time = _as_utc(tx.created_at) if tx.created_at is not None else datetime.now(UTC)
        candidates = [
            expense
            for expense in expenses
            if expense.created_at is not None
            and abs((_as_utc(expense.created_at) - tx_time).total_seconds()) <= 70
            and abs(float(expense.amount or 0) - float(tx.amount or 0)) < 0.0001
        ]
        if not candidates:
            continue
        best = min(candidates, key=lambda expense: abs((_as_utc(expense.created_at) - tx_time).total_seconds()))
        tx.expense_id = best.id
        linked_expense_ids.add(int(best.id))
    if linked_expense_ids:
        for expense in expenses:
            if int(expense.id) not in linked_expense_ids:
                continue
            expense.status = "approved"
            expense.reviewed_by = expense.reviewed_by or expense.created_by
            expense.reviewed_at = expense.reviewed_at or expense.created_at
    db.commit()


def _run_common_bootstrap(db: Session, *, allow_schema_mutation: bool) -> None:
    if allow_schema_mutation:
        _ensure_schema_compatibility(db)
    else:
        _assert_schema_matches_models(db)

    _migrate_legacy_product_categories(db, allow_schema_mutation=allow_schema_mutation)
    _normalize_legacy_enum_values(db)
    _repair_delivery_driver_links(db)
    _repair_delivered_cash_consistency(db)
    _repair_table_occupancy_from_orders(db)
    _cleanup_refresh_tokens(db)
    _cleanup_security_audit_events(db)
    _link_legacy_expenses_to_transactions(db)


def seed_development_data(db: Session) -> None:
    _run_common_bootstrap(db, allow_schema_mutation=True)
    _seed_default_users_for_development(db)
    _seed_tables(db)
    _seed_resources_and_products(db)
    # Legacy inventory bootstrap is intentionally disabled.
    # Warehouse V2 runs on an isolated model and should not be coupled to old stock bootstrap.
    _seed_delivery_drivers(db)
    _seed_delivery_fee_setting(db)


def bootstrap_production_data(db: Session) -> None:
    _run_common_bootstrap(db, allow_schema_mutation=False)


def seed_initial_data(db: Session) -> None:
    seed_development_data(db)



