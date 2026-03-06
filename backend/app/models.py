from datetime import UTC, date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .enums import (
    DeliveryAssignmentStatus,
    DriverStatus,
    FinancialTransactionType,
    OrderStatus,
    ProductKind,
    ResourceScope,
    OrderType,
    PaymentStatus,
    ResourceMovementType,
    TableStatus,
    UserRole,
)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    username: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(40), nullable=False, index=True, default=UserRole.MANAGER.value)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    last_failed_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    permission_overrides_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now)

    @property
    def permissions_effective(self) -> list[str]:
        from .permissions import effective_permissions

        return sorted(effective_permissions(self.role, self.permission_overrides_json))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now)

    user: Mapped[User] = relationship()


class RestaurantTable(Base):
    __tablename__ = "tables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    qr_code: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default=TableStatus.AVAILABLE.value)

    orders: Mapped[list["Order"]] = relationship(back_populates="table")


class ProductCategory(Base):
    __tablename__ = "product_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    products: Mapped[list["Product"]] = relationship(back_populates="category_ref")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default=ProductKind.SELLABLE.value, index=True)
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("product_categories.id"), nullable=False, index=True)
    image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)

    category_ref: Mapped[ProductCategory] = relationship(back_populates="products")


class Resource(Base):
    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    unit: Mapped[str] = mapped_column(String(32), nullable=False, default="unit")
    alert_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    scope: Mapped[str] = mapped_column(
        String(16), nullable=False, default=ResourceScope.KITCHEN.value, index=True
    )

    movements: Mapped[list["ResourceMovement"]] = relationship(
        back_populates="resource", cascade="all, delete-orphan"
    )


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_status_created_at", "status", "created_at"),
        Index("ix_orders_table_status_created_at", "table_id", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default=OrderStatus.CREATED.value, index=True)
    table_id: Mapped[int | None] = mapped_column(ForeignKey("tables.id"), nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subtotal: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    delivery_fee: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    total: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    payment_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=PaymentStatus.UNPAID.value, index=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    amount_received: Mapped[float | None] = mapped_column(Float, nullable=True)
    change_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    payment_method: Mapped[str] = mapped_column(String(16), nullable=False, default="cash")
    delivery_team_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    delivery_team_notified_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    table: Mapped[RestaurantTable | None] = relationship(back_populates="orders")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    product_name: Mapped[str] = mapped_column(String(120), nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")


class OrderCostEntry(Base):
    __tablename__ = "order_cost_entries"
    __table_args__ = (
        UniqueConstraint("order_id", "order_item_id", name="uq_order_cost_entry_order_item"),
        Index("ix_order_cost_entries_order_created_at", "order_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False, index=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity_sold: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    cogs_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)


class ResourceMovement(Base):
    __tablename__ = "resource_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    resource_id: Mapped[int] = mapped_column(ForeignKey("resources.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False, default=ResourceMovementType.ADJUST.value)
    # Keep legacy compatibility with old schema that requires signed delta.
    delta: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)

    resource: Mapped[Resource] = relationship(back_populates="movements")


class OrderTransitionLog(Base):
    __tablename__ = "order_transitions_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False, index=True)
    from_status: Mapped[str] = mapped_column(String(40), nullable=False)
    to_status: Mapped[str] = mapped_column(String(40), nullable=False)
    performed_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)


class SystemAuditLog(Base):
    __tablename__ = "system_audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    module: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    performed_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)


class SecurityAuditEvent(Base):
    __tablename__ = "security_audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="info", index=True)
    username: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    role: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)


class FinancialTransaction(Base):
    __tablename__ = "financial_transactions"
    __table_args__ = (
        Index("ix_financial_transactions_type_created_at", "type", "created_at"),
        Index(
            "ux_financial_transactions_sale_order",
            "order_id",
            unique=True,
            sqlite_where=text("type = 'sale' AND order_id IS NOT NULL"),
        ),
        Index(
            "ux_financial_transactions_refund_order",
            "order_id",
            unique=True,
            sqlite_where=text("type = 'refund' AND order_id IS NOT NULL"),
        ),
        Index(
            "ux_financial_transactions_expense_expense",
            "expense_id",
            unique=True,
            sqlite_where=text("type = 'expense' AND expense_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True, index=True)
    expense_id: Mapped[int | None] = mapped_column(ForeignKey("expenses.id"), nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default=FinancialTransactionType.SALE.value)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ShiftClosure(Base):
    __tablename__ = "shift_closures"
    __table_args__ = (UniqueConstraint("business_date", name="uq_shift_closure_business_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    opening_cash: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sales_total: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    refunds_total: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    expenses_total: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    expected_cash: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    actual_cash: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    variance: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    transactions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    closed_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)


class ExpenseCostCenter(Base):
    __tablename__ = "expense_cost_centers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now)

    expenses: Mapped[list["Expense"]] = relationship(back_populates="cost_center")


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False, default="general")
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cost_center_id: Mapped[int] = mapped_column(ForeignKey("expense_cost_centers.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    review_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now)
    attachments: Mapped[list["ExpenseAttachment"]] = relationship(
        back_populates="expense",
        cascade="all, delete-orphan",
    )
    cost_center: Mapped["ExpenseCostCenter"] = relationship(back_populates="expenses")

    @property
    def cost_center_name(self) -> str | None:
        if self.cost_center is None:
            return None
        return self.cost_center.name


class ExpenseAttachment(Base):
    __tablename__ = "expense_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(180), nullable=False)
    file_url: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)

    expense: Mapped["Expense"] = relationship(back_populates="attachments")


class DeliveryDriver(Base):
    __tablename__ = "delivery_drivers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=DriverStatus.AVAILABLE.value, index=True)
    vehicle: Mapped[str | None] = mapped_column(String(120), nullable=True)
    commission_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)


class DeliveryAssignment(Base):
    __tablename__ = "delivery_assignments"
    __table_args__ = (
        Index("ix_delivery_assignments_driver_status_id", "driver_id", "status", "id"),
        Index("ix_delivery_assignments_order_status_id", "order_id", "status", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False, index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("delivery_drivers.id"), nullable=False, index=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)
    departed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=DeliveryAssignmentStatus.ASSIGNED.value, index=True
    )


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)


class WarehouseSupplier(Base):
    __tablename__ = "wh_suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payment_term_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    credit_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_rating: Mapped[float] = mapped_column(Float, nullable=False, default=3)
    lead_time_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now)
    supplied_items: Mapped[list["WarehouseSupplierItem"]] = relationship(
        back_populates="supplier",
        cascade="all, delete-orphan",
    )


class WarehouseItem(Base):
    __tablename__ = "wh_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    unit: Mapped[str] = mapped_column(String(32), nullable=False, default="unit")
    alert_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now)
    supplier_links: Mapped[list["WarehouseSupplierItem"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
    )


class WarehouseSupplierItem(Base):
    __tablename__ = "wh_supplier_items"
    __table_args__ = (
        UniqueConstraint("supplier_id", "item_id", name="uq_wh_supplier_item"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("wh_suppliers.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("wh_items.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)

    supplier: Mapped[WarehouseSupplier] = relationship(back_populates="supplied_items")
    item: Mapped[WarehouseItem] = relationship(back_populates="supplier_links")


class WarehouseStockBalance(Base):
    __tablename__ = "wh_stock_balances"
    __table_args__ = (UniqueConstraint("item_id", name="uq_wh_stock_balance_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("wh_items.id"), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    avg_unit_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)


class WarehouseInboundVoucher(Base):
    __tablename__ = "wh_inbound_vouchers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    voucher_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("wh_suppliers.id"), nullable=False, index=True)
    reference_no: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True, index=True)
    received_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    posted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)

    items: Mapped[list["WarehouseInboundItem"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan"
    )


class WarehouseInboundItem(Base):
    __tablename__ = "wh_inbound_items"
    __table_args__ = (UniqueConstraint("voucher_id", "item_id", name="uq_wh_inbound_voucher_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    voucher_id: Mapped[int] = mapped_column(ForeignKey("wh_inbound_vouchers.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("wh_items.id"), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    voucher: Mapped[WarehouseInboundVoucher] = relationship(back_populates="items")


class WarehouseOutboundVoucher(Base):
    __tablename__ = "wh_outbound_vouchers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    voucher_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False, default="operational_use", index=True)
    reason: Mapped[str] = mapped_column(String(160), nullable=False)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True, index=True)
    issued_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    posted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)

    items: Mapped[list["WarehouseOutboundItem"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan"
    )


class WarehouseOutboundItem(Base):
    __tablename__ = "wh_outbound_items"
    __table_args__ = (UniqueConstraint("voucher_id", "item_id", name="uq_wh_outbound_voucher_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    voucher_id: Mapped[int] = mapped_column(ForeignKey("wh_outbound_vouchers.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("wh_items.id"), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)

    voucher: Mapped[WarehouseOutboundVoucher] = relationship(back_populates="items")


class WarehouseStockLedger(Base):
    __tablename__ = "wh_stock_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("wh_items.id"), nullable=False, index=True)
    movement_kind: Mapped[str] = mapped_column(String(24), nullable=False, index=True)  # inbound | outbound
    source_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    line_value: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    running_avg_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    balance_before: Mapped[float] = mapped_column(Float, nullable=False)
    balance_after: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)


class WarehouseStockCount(Base):
    __tablename__ = "wh_stock_counts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    count_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    counted_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    counted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)
    settled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    items: Mapped[list["WarehouseStockCountLine"]] = relationship(
        back_populates="count", cascade="all, delete-orphan"
    )


class WarehouseStockCountLine(Base):
    __tablename__ = "wh_stock_count_lines"
    __table_args__ = (UniqueConstraint("count_id", "item_id", name="uq_wh_stock_count_line_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    count_id: Mapped[int] = mapped_column(ForeignKey("wh_stock_counts.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("wh_items.id"), nullable=False, index=True)
    system_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    counted_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    variance_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    variance_value: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    count: Mapped[WarehouseStockCount] = relationship(back_populates="items")


class WarehouseIntegrationEvent(Base):
    __tablename__ = "wh_integration_events"
    __table_args__ = (
        Index("ix_wh_integration_events_status_created_at", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utc_now, index=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(255), nullable=True)

