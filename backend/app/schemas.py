import re
from datetime import date, datetime
from pydantic import BaseModel, Field, model_validator

from .enums import (
    DeliveryAssignmentStatus,
    DriverStatus,
    FinancialTransactionType,
    OrderStatus,
    OrderType,
    PaymentStatus,
    ProductKind,
    TableStatus,
    UserRole,
)

PHONE_PATTERN = re.compile(r"^[0-9\u0660-\u0669+\-()\s]{6,40}$")


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.strip().split())
    return normalized or None


def _validate_phone_format(phone: str) -> None:
    if not PHONE_PATTERN.fullmatch(phone):
        raise ValueError("صيغة رقم الهاتف غير صحيحة.")
    digit_count = sum(1 for char in phone if char.isdigit())
    if digit_count < 6:
        raise ValueError("رقم الهاتف يجب أن يحتوي 6 أرقام على الأقل.")


class UserOut(BaseModel):
    id: int
    name: str
    username: str
    role: UserRole
    active: bool
    permissions_effective: list[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class LoginInput(BaseModel):
    username: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=4, max_length=120)
    role: UserRole


class RefreshInput(BaseModel):
    refresh_token: str = Field(min_length=20)


class TokenPairOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class AuthSessionOut(BaseModel):
    user: UserOut
    token_type: str = "cookie"


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    price: float = Field(gt=0)
    kind: ProductKind = ProductKind.SELLABLE
    available: bool = True
    category_id: int = Field(gt=0)


class ProductUpdate(ProductCreate):
    is_archived: bool | None = None


class ProductOut(BaseModel):
    id: int
    name: str
    description: str | None
    price: float
    kind: ProductKind
    available: bool
    category: str
    category_id: int
    image_path: str | None
    is_archived: bool

    model_config = {"from_attributes": True}


class PublicProductOut(BaseModel):
    id: int
    name: str
    description: str | None
    price: float
    category: str
    image_path: str | None

    model_config = {"from_attributes": True}


class ProductsPageOut(BaseModel):
    items: list[ProductOut]
    total: int
    page: int
    page_size: int


class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    active: bool = True
    sort_order: int = Field(default=0, ge=0)


class ProductCategoryUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    active: bool
    sort_order: int = Field(default=0, ge=0)


class ProductCategoryOut(BaseModel):
    id: int
    name: str
    active: bool
    sort_order: int

    model_config = {"from_attributes": True}


class ProductImageInput(BaseModel):
    mime_type: str
    data_base64: str = Field(min_length=20)


class TableOut(BaseModel):
    id: int
    qr_code: str
    status: TableStatus

    model_config = {"from_attributes": True}


class ManagerTableOut(TableOut):
    total_orders_count: int
    has_active_session: bool
    active_orders_count: int
    unsettled_orders_count: int
    unpaid_total: float


class TableCreateInput(BaseModel):
    status: TableStatus = TableStatus.AVAILABLE


class TableUpdateInput(BaseModel):
    status: TableStatus


class TableSessionSettlementInput(BaseModel):
    amount_received: float | None = Field(default=None, gt=0)


class CreateOrderItemInput(BaseModel):
    product_id: int
    quantity: int = Field(ge=1)


class CreateOrderInput(BaseModel):
    type: OrderType
    table_id: int | None = Field(default=None, gt=0)
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=255)
    items: list[CreateOrderItemInput] = Field(min_length=1)

    @model_validator(mode="after")
    def check_required_fields(self) -> "CreateOrderInput":
        self.phone = _normalize_optional_text(self.phone)
        self.address = _normalize_optional_text(self.address)
        self.notes = _normalize_optional_text(self.notes)

        if self.phone is not None:
            _validate_phone_format(self.phone)

        if self.type == OrderType.DINE_IN and not self.table_id:
            raise ValueError("رقم الطاولة مطلوب للطلبات الداخلية.")
        if self.type in (OrderType.TAKEAWAY, OrderType.DELIVERY) and not self.phone:
            raise ValueError("رقم الهاتف مطلوب لهذا النوع من الطلبات.")
        if self.type == OrderType.DELIVERY and not self.address:
            raise ValueError("عنوان التوصيل مطلوب.")
        if self.type == OrderType.DELIVERY and self.address is not None and len(self.address) < 5:
            raise ValueError("عنوان التوصيل يجب أن يكون 5 أحرف على الأقل.")
        return self


class ManagerCreateOrderInput(BaseModel):
    type: OrderType
    table_id: int | None = Field(default=None, gt=0)
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=255)
    items: list[CreateOrderItemInput] = Field(min_length=1)

    @model_validator(mode="after")
    def check_required_fields(self) -> "ManagerCreateOrderInput":
        self.phone = _normalize_optional_text(self.phone)
        self.address = _normalize_optional_text(self.address)
        self.notes = _normalize_optional_text(self.notes)

        if self.phone is not None:
            _validate_phone_format(self.phone)

        if self.type == OrderType.DINE_IN and not self.table_id:
            raise ValueError("رقم الطاولة مطلوب للطلبات الداخلية.")
        if self.type == OrderType.DELIVERY and not self.phone:
            raise ValueError("رقم الهاتف مطلوب لطلبات التوصيل.")
        if self.type == OrderType.DELIVERY and not self.address:
            raise ValueError("عنوان التوصيل مطلوب.")
        if self.type == OrderType.DELIVERY and self.address is not None and len(self.address) < 5:
            raise ValueError("عنوان التوصيل يجب أن يكون 5 أحرف على الأقل.")
        return self


class OrderItemOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    price: float
    product_name: str

    model_config = {"from_attributes": True}


class OrderOut(BaseModel):
    id: int
    type: OrderType
    status: OrderStatus
    table_id: int | None
    phone: str | None
    address: str | None
    subtotal: float
    delivery_fee: float
    total: float
    created_at: datetime
    notes: str | None
    payment_status: PaymentStatus
    paid_at: datetime | None
    paid_by: int | None
    amount_received: float | None
    change_amount: float | None
    payment_method: str
    delivery_team_notified_at: datetime | None
    delivery_team_notified_by: int | None
    sent_to_kitchen_at: datetime | None = None
    items: list[OrderItemOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class TableSessionOut(BaseModel):
    table: TableOut
    has_active_session: bool
    total_orders: int
    active_orders_count: int
    unsettled_orders_count: int
    unpaid_total: float
    latest_order_status: OrderStatus | None
    orders: list[OrderOut] = Field(default_factory=list)


class TableSessionSettlementOut(BaseModel):
    table_id: int
    settled_order_ids: list[int]
    settled_total: float
    amount_received: float
    change_amount: float
    table_status: TableStatus


class OrderTransitionInput(BaseModel):
    target_status: OrderStatus
    amount_received: float | None = Field(default=None, gt=0)
    collect_payment: bool = True
    reason_code: str | None = Field(default=None, min_length=2, max_length=80)
    reason_note: str | None = Field(default=None, max_length=255)


class EmergencyDeliveryFailInput(BaseModel):
    reason_code: str = Field(min_length=2, max_length=80)
    reason_note: str | None = Field(default=None, max_length=255)


class OrderPaymentCollectionInput(BaseModel):
    amount_received: float | None = Field(default=None, gt=0)


class OrderRefundInput(BaseModel):
    note: str | None = Field(default=None, max_length=255)


class OrdersPageOut(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int


class KitchenMonitorSummaryOut(BaseModel):
    sent_to_kitchen: int
    in_preparation: int
    ready: int
    oldest_order_wait_seconds: int
    avg_prep_minutes_today: float
    warehouse_issued_quantity_today: float = 0.0
    warehouse_issue_vouchers_today: int = 0
    warehouse_issued_items_today: int = 0


class KitchenOrdersPageOut(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int
    summary: KitchenMonitorSummaryOut


class DashboardOut(BaseModel):
    created: int
    confirmed: int
    sent_to_kitchen: int
    in_preparation: int
    ready: int
    out_for_delivery: int
    delivered: int
    delivery_failed: int
    canceled: int
    active_orders: int
    today_sales: float
    today_expenses: float
    today_net: float


class OperationalHeartMetaOut(BaseModel):
    generated_at: datetime
    local_business_date: date
    refresh_recommended_ms: int = Field(ge=1000, le=30000)
    contract_version: str = Field(default="2.1", min_length=1, max_length=16)


class OperationalHeartCapabilitiesOut(BaseModel):
    kitchen_enabled: bool
    delivery_enabled: bool
    kitchen_active_users: int
    delivery_active_users: int
    kitchen_block_reason: str | None
    delivery_block_reason: str | None


class OperationalHeartKpisOut(BaseModel):
    active_orders: int
    ready_orders: int
    today_sales: float
    today_expenses: float
    today_net: float
    avg_prep_minutes_today: float
    oldest_kitchen_wait_seconds: int


class OperationalHeartQueueOut(BaseModel):
    key: str
    label: str
    count: int
    oldest_age_seconds: int
    aged_over_sla_count: int
    sla_seconds: int
    action_route: str


class OperationalHeartIncidentOut(BaseModel):
    code: str
    severity: str
    title: str
    message: str
    count: int
    oldest_age_seconds: int | None = None
    action_route: str


class OperationalHeartTimelineItemOut(BaseModel):
    timestamp: datetime
    domain: str
    title: str
    description: str
    action_route: str | None = None
    order_id: int | None = None
    entity_id: int | None = None


class OperationalHeartFinancialControlOut(BaseModel):
    severity: str = "info"
    action_route: str = "/manager/financial"
    shift_closed_today: bool = False
    latest_shift_variance: float = 0.0
    sales_transactions_today: int = 0
    expense_transactions_today: int = 0
    today_net: float = 0.0


class OperationalHeartWarehouseControlOut(BaseModel):
    severity: str = "info"
    action_route: str = "/manager/warehouse"
    active_items: int = 0
    low_stock_items: int = 0
    pending_stock_counts: int = 0
    inbound_today: float = 0.0
    outbound_today: float = 0.0


class OperationalHeartTablesControlOut(BaseModel):
    severity: str = "info"
    action_route: str = "/manager/tables"
    active_sessions: int = 0
    blocked_settlement_tables: int = 0
    unpaid_orders: int = 0
    unpaid_total: float = 0.0


class OperationalHeartExpensesControlOut(BaseModel):
    severity: str = "info"
    action_route: str = "/manager/expenses"
    pending_approvals: int = 0
    pending_amount: float = 0.0
    rejected_today: int = 0
    high_value_pending_amount: float = 0.0


class OperationalHeartReconciliationOut(BaseModel):
    key: str
    label: str
    ok: bool
    severity: str = "info"
    detail: str
    action_route: str


class OperationalHeartOut(BaseModel):
    meta: OperationalHeartMetaOut
    capabilities: OperationalHeartCapabilitiesOut
    kpis: OperationalHeartKpisOut
    queues: list[OperationalHeartQueueOut]
    incidents: list[OperationalHeartIncidentOut]
    timeline: list[OperationalHeartTimelineItemOut]
    financial_control: OperationalHeartFinancialControlOut = Field(default_factory=OperationalHeartFinancialControlOut)
    warehouse_control: OperationalHeartWarehouseControlOut = Field(default_factory=OperationalHeartWarehouseControlOut)
    tables_control: OperationalHeartTablesControlOut = Field(default_factory=OperationalHeartTablesControlOut)
    expenses_control: OperationalHeartExpensesControlOut = Field(default_factory=OperationalHeartExpensesControlOut)
    reconciliations: list[OperationalHeartReconciliationOut] = Field(default_factory=list)


class FinancialTransactionOut(BaseModel):
    id: int
    order_id: int | None
    expense_id: int | None
    amount: float
    type: FinancialTransactionType
    created_by: int
    created_at: datetime
    note: str | None

    model_config = {"from_attributes": True}


class ShiftClosureCreate(BaseModel):
    opening_cash: float = Field(ge=0, default=0)
    actual_cash: float = Field(ge=0)
    note: str | None = Field(default=None, max_length=255)


class ShiftClosureOut(BaseModel):
    id: int
    business_date: date
    opening_cash: float
    sales_total: float
    refunds_total: float
    expenses_total: float
    expected_cash: float
    actual_cash: float
    variance: float
    transactions_count: int
    note: str | None
    closed_by: int
    closed_at: datetime

    model_config = {"from_attributes": True}


class ExpenseCostCenterCreate(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    active: bool = True


class ExpenseCostCenterUpdate(ExpenseCostCenterCreate):
    pass


class ExpenseCostCenterOut(BaseModel):
    id: int
    code: str
    name: str
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=2, max_length=60)
    cost_center_id: int = Field(gt=0)
    amount: float = Field(gt=0)
    note: str | None = Field(default=None, max_length=255)


class ExpenseUpdate(ExpenseCreate):
    pass


class ExpenseReviewInput(BaseModel):
    note: str | None = Field(default=None, max_length=255)


class ExpenseAttachmentCreate(BaseModel):
    file_name: str | None = Field(default=None, max_length=180)
    mime_type: str = Field(min_length=8, max_length=80)
    data_base64: str = Field(min_length=20)


class ExpenseAttachmentOut(BaseModel):
    id: int
    expense_id: int
    file_name: str
    file_url: str
    mime_type: str
    size_bytes: int
    uploaded_by: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ExpenseOut(BaseModel):
    id: int
    title: str
    category: str
    cost_center_id: int
    cost_center_name: str | None
    amount: float
    note: str | None
    status: str
    reviewed_by: int | None
    reviewed_at: datetime | None
    review_note: str | None
    attachments: list[ExpenseAttachmentOut] = Field(default_factory=list)
    created_by: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DeliveryDriverCreate(BaseModel):
    user_id: int = Field(gt=0)
    phone: str = Field(min_length=5, max_length=40)
    vehicle: str | None = Field(default=None, max_length=120)
    commission_rate: float = Field(ge=0, le=100, default=0)
    active: bool = True


class DeliveryDriverUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=5, max_length=40)
    vehicle: str | None = Field(default=None, max_length=120)
    commission_rate: float = Field(ge=0, le=100)
    active: bool
    status: DriverStatus


class DeliveryDriverOut(BaseModel):
    id: int
    user_id: int
    name: str
    phone: str
    status: DriverStatus
    vehicle: str | None
    commission_rate: float
    active: bool

    model_config = {"from_attributes": True}


class DeliveryTeamNotifyInput(BaseModel):
    order_id: int


class DeliveryAssignmentOut(BaseModel):
    id: int
    order_id: int
    driver_id: int
    assigned_at: datetime
    departed_at: datetime | None
    delivered_at: datetime | None
    status: DeliveryAssignmentStatus

    model_config = {"from_attributes": True}


class DeliverySettingsOut(BaseModel):
    delivery_fee: float


class DeliverySettingsUpdate(BaseModel):
    delivery_fee: float = Field(ge=0)


class DeliveryPolicySettingsOut(BaseModel):
    min_order_amount: float
    auto_notify_team: bool


class DeliveryPolicySettingsUpdate(BaseModel):
    min_order_amount: float = Field(ge=0)
    auto_notify_team: bool


class OperationalSettingOut(BaseModel):
    key: str
    value: str
    description: str
    editable: bool


class OperationalSettingUpdate(BaseModel):
    key: str = Field(min_length=2, max_length=64)
    value: str = Field(min_length=1, max_length=255)


class OperationalCapabilitiesOut(BaseModel):
    kitchen_enabled: bool
    delivery_enabled: bool
    kitchen_active_users: int
    delivery_active_users: int
    kitchen_block_reason: str | None = None
    delivery_block_reason: str | None = None


class KitchenRuntimeSettingsOut(BaseModel):
    order_polling_ms: int = Field(ge=3000, le=60000)


class DeliveryHistoryOut(BaseModel):
    assignment_id: int
    order_id: int
    assignment_status: DeliveryAssignmentStatus
    order_status: OrderStatus
    assigned_at: datetime
    departed_at: datetime | None
    delivered_at: datetime | None
    order_subtotal: float
    delivery_fee: float
    order_total: float
    phone: str | None
    address: str | None


class ReportDailyRow(BaseModel):
    day: str
    sales: float
    expenses: float
    net: float


class ReportMonthlyRow(BaseModel):
    month: str
    sales: float
    expenses: float
    net: float


class ReportByTypeRow(BaseModel):
    order_type: OrderType
    orders_count: int
    sales: float


class ReportPerformance(BaseModel):
    avg_prep_minutes: float


class ReportProfitabilityProductRow(BaseModel):
    product_id: int
    product_name: str
    category_name: str
    quantity_sold: int
    revenue: float
    estimated_unit_cost: float
    estimated_cost: float
    gross_profit: float
    margin_percent: float


class ReportProfitabilityCategoryRow(BaseModel):
    category_name: str
    quantity_sold: int
    revenue: float
    estimated_cost: float
    gross_profit: float
    margin_percent: float


class ReportProfitabilityOut(BaseModel):
    start_date: date | None
    end_date: date | None
    total_quantity_sold: int
    total_revenue: float
    total_estimated_cost: float
    total_gross_profit: float
    total_margin_percent: float
    by_products: list[ReportProfitabilityProductRow] = Field(default_factory=list)
    by_categories: list[ReportProfitabilityCategoryRow] = Field(default_factory=list)


class ReportPeriodMetrics(BaseModel):
    label: str
    start_date: date
    end_date: date
    days_count: int
    sales: float
    expenses: float
    net: float
    delivered_orders_count: int
    avg_order_value: float


class ReportPeriodDeltaRow(BaseModel):
    metric: str
    current_value: float
    previous_value: float
    absolute_change: float
    change_percent: float | None


class ReportPeriodComparisonOut(BaseModel):
    current_period: ReportPeriodMetrics
    previous_period: ReportPeriodMetrics
    deltas: list[ReportPeriodDeltaRow] = Field(default_factory=list)


class ReportPeakHourRow(BaseModel):
    hour_label: str
    orders_count: int
    sales: float
    avg_order_value: float
    avg_prep_minutes: float


class ReportPeakHoursPerformanceOut(BaseModel):
    start_date: date
    end_date: date
    days_count: int
    peak_hour: str | None
    peak_orders_count: int
    peak_sales: float
    overall_avg_prep_minutes: float
    by_hours: list[ReportPeakHourRow] = Field(default_factory=list)


class OrderTransitionLogOut(BaseModel):
    id: int
    order_id: int
    from_status: OrderStatus
    to_status: OrderStatus
    performed_by: int
    timestamp: datetime

    model_config = {"from_attributes": True}


class SystemAuditLogOut(BaseModel):
    id: int
    module: str
    action: str
    entity_type: str
    entity_id: int | None
    description: str
    performed_by: int
    timestamp: datetime

    model_config = {"from_attributes": True}


class SecurityAuditEventOut(BaseModel):
    id: int
    event_type: str
    success: bool
    severity: str
    username: str | None
    role: UserRole | None = None
    user_id: int | None
    ip_address: str | None
    user_agent: str | None
    detail: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AccountProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    password: str | None = Field(default=None, min_length=8, max_length=120)


class AccountSessionOut(BaseModel):
    id: int
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    is_active: bool


class AccountSessionsRevokeOut(BaseModel):
    revoked_count: int


class SystemBackupOut(BaseModel):
    filename: str
    size_bytes: int
    created_at: datetime


class SystemBackupRestoreInput(BaseModel):
    filename: str = Field(min_length=4, max_length=255)
    confirm_phrase: str = Field(min_length=3, max_length=32)


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=120)
    role: UserRole
    active: bool = True
    delivery_phone: str | None = Field(default=None, min_length=5, max_length=40)
    delivery_vehicle: str | None = Field(default=None, max_length=120)
    delivery_commission_rate: float | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def validate_delivery_fields(self) -> "UserCreate":
        if self.role == UserRole.DELIVERY and not self.delivery_phone:
            raise ValueError("رقم هاتف التوصيل مطلوب لمستخدم التوصيل.")
        return self


class UserUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    role: UserRole
    active: bool
    password: str | None = Field(default=None, min_length=8, max_length=120)
    delivery_phone: str | None = Field(default=None, min_length=5, max_length=40)
    delivery_vehicle: str | None = Field(default=None, max_length=120)
    delivery_commission_rate: float | None = Field(default=None, ge=0, le=100)


class PermissionCatalogItemOut(BaseModel):
    code: str
    label: str
    description: str
    roles: list[UserRole] = Field(default_factory=list)
    default_enabled: bool


class UserPermissionsOut(BaseModel):
    user_id: int
    username: str
    role: UserRole
    default_permissions: list[str] = Field(default_factory=list)
    allow_overrides: list[str] = Field(default_factory=list)
    deny_overrides: list[str] = Field(default_factory=list)
    effective_permissions: list[str] = Field(default_factory=list)


class UserPermissionsUpdate(BaseModel):
    allow: list[str] = Field(default_factory=list)
    deny: list[str] = Field(default_factory=list)


class WarehouseSupplierCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    payment_term_days: int = Field(ge=0, le=365, default=0)
    credit_limit: float | None = Field(default=None, ge=0)
    quality_rating: float = Field(ge=0, le=5, default=3)
    lead_time_days: int = Field(ge=0, le=365, default=0)
    notes: str | None = Field(default=None, max_length=255)
    active: bool = True
    supplied_item_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def ensure_unique_supplied_item_ids(self) -> "WarehouseSupplierCreate":
        normalized_ids = [int(item_id) for item_id in self.supplied_item_ids]
        if any(item_id <= 0 for item_id in normalized_ids):
            raise ValueError("معرف الصنف يجب أن يكون أكبر من صفر.")
        if len(normalized_ids) != len(set(normalized_ids)):
            raise ValueError("لا يمكن تكرار نفس الصنف في قائمة التوريد.")
        self.supplied_item_ids = normalized_ids
        return self


class WarehouseSupplierUpdate(WarehouseSupplierCreate):
    pass


class WarehouseSupplierOut(BaseModel):
    id: int
    name: str
    phone: str | None
    email: str | None
    address: str | None
    payment_term_days: int
    credit_limit: float | None
    quality_rating: float
    lead_time_days: int
    notes: str | None
    active: bool
    supplied_item_ids: list[int] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WarehouseItemCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    unit: str = Field(min_length=1, max_length=32)
    alert_threshold: float = Field(ge=0, default=0)
    active: bool = True


class WarehouseItemUpdate(WarehouseItemCreate):
    pass


class WarehouseItemOut(BaseModel):
    id: int
    name: str
    unit: str
    alert_threshold: float
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WarehouseStockBalanceOut(BaseModel):
    item_id: int
    item_name: str
    unit: str
    alert_threshold: float
    active: bool
    quantity: float
    is_low: bool


class WarehouseInboundItemInput(BaseModel):
    item_id: int
    quantity: float = Field(gt=0)
    unit_cost: float = Field(ge=0, default=0)


class WarehouseOutboundItemInput(BaseModel):
    item_id: int
    quantity: float = Field(gt=0)


class WarehouseInboundVoucherCreate(BaseModel):
    supplier_id: int
    reference_no: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=255)
    idempotency_key: str | None = Field(default=None, max_length=80)
    items: list[WarehouseInboundItemInput] = Field(min_length=1)


class WarehouseOutboundVoucherCreate(BaseModel):
    reason_code: str = Field(min_length=2, max_length=64)
    reason_note: str | None = Field(default=None, max_length=255)
    note: str | None = Field(default=None, max_length=255)
    idempotency_key: str | None = Field(default=None, max_length=80)
    items: list[WarehouseOutboundItemInput] = Field(min_length=1)


class WarehouseOutboundReasonOut(BaseModel):
    code: str
    label: str


class WarehouseInboundVoucherItemOut(BaseModel):
    item_id: int
    item_name: str
    quantity: float
    unit_cost: float
    line_total: float


class WarehouseOutboundVoucherItemOut(BaseModel):
    item_id: int
    item_name: str
    quantity: float
    unit_cost: float
    line_total: float


class WarehouseInboundVoucherOut(BaseModel):
    id: int
    voucher_no: str
    supplier_id: int
    supplier_name: str
    reference_no: str | None
    note: str | None
    posted_at: datetime
    received_by: int
    total_quantity: float
    total_cost: float
    items: list[WarehouseInboundVoucherItemOut]


class WarehouseOutboundVoucherOut(BaseModel):
    id: int
    voucher_no: str
    reason_code: str
    reason: str
    note: str | None
    posted_at: datetime
    issued_by: int
    total_quantity: float
    total_cost: float
    items: list[WarehouseOutboundVoucherItemOut]


class WarehouseLedgerOut(BaseModel):
    id: int
    item_id: int
    item_name: str
    movement_kind: str
    source_type: str
    source_id: int
    quantity: float
    unit_cost: float
    line_value: float
    running_avg_cost: float
    balance_before: float
    balance_after: float
    note: str | None
    created_by: int
    created_at: datetime


class WarehouseStockCountItemInput(BaseModel):
    item_id: int
    counted_quantity: float = Field(ge=0)


class WarehouseStockCountCreate(BaseModel):
    note: str | None = Field(default=None, max_length=255)
    idempotency_key: str | None = Field(default=None, max_length=80)
    items: list[WarehouseStockCountItemInput] = Field(min_length=1)


class WarehouseStockCountItemOut(BaseModel):
    item_id: int
    item_name: str
    unit: str
    system_quantity: float
    counted_quantity: float
    variance_quantity: float
    unit_cost: float
    variance_value: float


class WarehouseStockCountOut(BaseModel):
    id: int
    count_no: str
    note: str | None
    status: str
    counted_by: int
    counted_at: datetime
    settled_by: int | None
    settled_at: datetime | None
    total_variance_quantity: float
    total_variance_value: float
    items: list[WarehouseStockCountItemOut]


class WarehouseDashboardOut(BaseModel):
    active_items: int
    active_suppliers: int
    low_stock_items: int
    inbound_today: float
    outbound_today: float



