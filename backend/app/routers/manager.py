from datetime import date, datetime

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, asc, cast, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..dependencies import get_db, require_roles, require_route_capability
from ..enums import (
    DriverStatus,
    FinancialTransactionType,
    OrderStatus,
    OrderType,
    ProductKind,
    UserRole,
)
from ..models import (
    DeliveryDriver,
    Expense,
    ExpenseCostCenter,
    FinancialTransaction,
    Order,
    OrderTransitionLog,
    Product,
    ProductCategory,
    ShiftClosure,
    SecurityAuditEvent,
    SystemAuditLog,
    User,
)
from ..schemas import (
    AccountProfileUpdate,
    AccountSessionOut,
    AccountSessionsRevokeOut,
    DashboardOut,
    CreateOrderInput,
    ManagerCreateOrderInput,
    DeliveryDriverCreate,
    DeliveryDriverOut,
    DeliveryDriverUpdate,
    DeliveryPolicySettingsOut,
    DeliveryPolicySettingsUpdate,
    DeliverySettingsOut,
    DeliverySettingsUpdate,
    DeliveryTeamNotifyInput,
    EmergencyDeliveryFailInput,
    OperationalSettingOut,
    OperationalSettingUpdate,
    OperationalCapabilitiesOut,
    ExpenseAttachmentCreate,
    ExpenseAttachmentOut,
    ExpenseCostCenterCreate,
    ExpenseCostCenterOut,
    ExpenseCostCenterUpdate,
    ExpenseCreate,
    ExpenseOut,
    ExpenseReviewInput,
    ExpenseUpdate,
    FinancialTransactionOut,
    KitchenOrdersPageOut,
    OrderOut,
    OperationalHeartOut,
    OrderPaymentCollectionInput,
    OrderRefundInput,
    OrdersPageOut,
    OrderTransitionInput,
    OrderTransitionLogOut,
    ProductCategoryCreate,
    ProductCategoryOut,
    ProductCategoryUpdate,
    ProductCreate,
    PermissionCatalogItemOut,
    ProductOut,
    ProductImageInput,
    ProductsPageOut,
    ProductUpdate,
    ReportByTypeRow,
    ReportDailyRow,
    ReportMonthlyRow,
    ReportPeakHoursPerformanceOut,
    ReportPeriodComparisonOut,
    ReportPerformance,
    ReportProfitabilityOut,
    ShiftClosureCreate,
    ShiftClosureOut,
    SecurityAuditEventOut,
    SystemBackupOut,
    SystemBackupRestoreInput,
    SystemAuditLogOut,
    ManagerTableOut,
    TableCreateInput,
    TableUpdateInput,
    TableSessionOut,
    TableSessionSettlementInput,
    TableSessionSettlementOut,
    UserCreate,
    UserPermissionsOut,
    UserPermissionsUpdate,
    UserOut,
    UserUpdate,
)
from ..services import (
    SYSTEM_ORDER_ACTOR_PREFIX,
    attach_sent_to_kitchen_at,
    archive_product_service,
    delete_product_permanently_service,
    create_product_service,
    approve_expense,
    create_expense_attachment,
    create_expense_cost_center,
    create_expense,
    create_table_service,
    create_product_category_service,
    create_user,
    daily_report,
    delete_user_permanently,
    emergency_fail_delivery_order,
    ensure_delivery_capacity_reduction_allowed,
    delete_table_service,
    delete_expense_attachment,
    delete_expense,
    delete_product_category_service,
    monthly_report,
    notify_delivery_team,
    close_cash_shift,
    get_delivery_policy_settings,
    get_delivery_fee_setting,
    get_operational_capabilities,
    kitchen_monitor_summary,
    list_product_categories_service,
    list_expense_cost_centers,
    list_operational_settings,
    list_system_backups,
    list_tables_with_session_summary,
    list_user_refresh_sessions,
    prep_performance_report,
    period_comparison_report,
    peak_hours_performance_report,
    profitability_report,
    operational_heart_dashboard,
    refund_order,
    revoke_user_refresh_sessions,
    list_shift_closures,
    report_by_order_type,
    reject_expense,
    create_order,
    collect_order_payment,
    list_active_table_sessions,
    get_table_session_snapshot,
    settle_table_session,
    transition_order,
    update_table_service,
    update_product_category_service,
    update_product_service,
    upload_product_image_service,
    update_delivery_fee_setting,
    update_delivery_policy_settings,
    update_operational_setting,
    create_system_backup,
    restore_system_backup,
    update_expense,
    update_expense_cost_center,
    get_user_permissions_profile,
    list_permissions_catalog,
    update_user,
    update_user_permissions_profile,
)
from ..tx import transaction_scope

router = APIRouter(prefix="/manager", tags=["manager"], dependencies=[Depends(require_route_capability)])
DEFAULT_LIST_PAGE_SIZE = 50
MAX_LIST_PAGE_SIZE = 200
MAX_AUDIT_PAGE_SIZE = 500


def _extract_order_id_search(value: str) -> int | None:
    digits_only = "".join(char for char in value if char.isdigit())
    if not digits_only:
        return None
    return int(digits_only.lstrip("0") or "0")


def _manager_table_row_or_404(db: Session, table_id: int) -> dict[str, object]:
    rows = list_tables_with_session_summary(db, table_ids=[table_id])
    for row in rows:
        if int(row["id"]) == table_id:
            return row
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الطاولة غير موجودة")


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> DashboardOut:
    counts = {
        row[0]: row[1]
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
    active_orders = db.execute(
        select(func.count(Order.id)).where(Order.status.in_(active_statuses))
    ).scalar_one()
    today = datetime.now().date().isoformat()
    today_sales = db.execute(
        select(func.coalesce(func.sum(FinancialTransaction.amount), 0.0)).where(
            FinancialTransaction.type == FinancialTransactionType.SALE.value,
            func.date(FinancialTransaction.created_at, "localtime") == today,
        )
    ).scalar_one()
    today_expenses = db.execute(
        select(func.coalesce(func.sum(FinancialTransaction.amount), 0.0)).where(
            FinancialTransaction.type == FinancialTransactionType.EXPENSE.value,
            func.date(FinancialTransaction.created_at, "localtime") == today,
        )
    ).scalar_one()

    return DashboardOut(
        created=counts.get(OrderStatus.CREATED.value, 0),
        confirmed=counts.get(OrderStatus.CONFIRMED.value, 0),
        sent_to_kitchen=counts.get(OrderStatus.SENT_TO_KITCHEN.value, 0),
        in_preparation=counts.get(OrderStatus.IN_PREPARATION.value, 0),
        ready=counts.get(OrderStatus.READY.value, 0),
        out_for_delivery=counts.get(OrderStatus.OUT_FOR_DELIVERY.value, 0),
        delivered=counts.get(OrderStatus.DELIVERED.value, 0),
        delivery_failed=counts.get(OrderStatus.DELIVERY_FAILED.value, 0),
        canceled=counts.get(OrderStatus.CANCELED.value, 0),
        active_orders=active_orders,
        today_sales=float(today_sales or 0),
        today_expenses=float(today_expenses or 0),
        today_net=float(today_sales or 0) - float(today_expenses or 0),
    )


@router.get("/dashboard/operational-heart", response_model=OperationalHeartOut)
def dashboard_operational_heart(
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return operational_heart_dashboard(db)


@router.get("/operational-capabilities", response_model=OperationalCapabilitiesOut)
def manager_operational_capabilities(
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return get_operational_capabilities(db)


@router.get("/orders", response_model=list[OrderOut])
def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[Order]:
    offset = (page - 1) * page_size
    return db.execute(
        select(Order)
        .options(joinedload(Order.items))
        .order_by(Order.created_at.desc(), Order.id.desc())
        .offset(offset)
        .limit(page_size)
    ).unique().scalars().all()


@router.get("/tables", response_model=list[ManagerTableOut])
def manager_list_tables(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_tables_with_session_summary(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/tables", response_model=ManagerTableOut, status_code=status.HTTP_201_CREATED)
def manager_create_table(
    payload: TableCreateInput,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    created = create_table_service(db, status_value=payload.status)
    return _manager_table_row_or_404(db, created.id)


@router.put("/tables/{table_id}", response_model=ManagerTableOut)
def manager_update_table(
    table_id: int,
    payload: TableUpdateInput,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    updated = update_table_service(db, table_id=table_id, status_value=payload.status)
    return _manager_table_row_or_404(db, updated.id)


@router.delete("/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
def manager_delete_table(
    table_id: int,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> None:
    delete_table_service(db, table_id=table_id)


@router.post("/orders/manual", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def manager_create_manual_order(
    payload: ManagerCreateOrderInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Order:
    return create_order(
        db,
        payload=payload,
        created_by=current_user.id,
    )


@router.get("/orders/paged", response_model=OrdersPageOut)
def list_orders_paged(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=100),
    search: str | None = Query(default=None),
    sort_by: Literal["created_at", "total", "status", "id"] = "created_at",
    sort_direction: Literal["asc", "desc"] = "desc",
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    order_type: OrderType | None = Query(default=None),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> OrdersPageOut:
    conditions = []
    if status_filter is not None:
        conditions.append(Order.status == status_filter.value)
    if order_type is not None:
        conditions.append(Order.type == order_type.value)

    normalized_search = (search or "").strip()
    if normalized_search:
        like_value = f"%{normalized_search}%"
        maybe_order_id = _extract_order_id_search(normalized_search)
        search_terms = [
            cast(Order.id, String).ilike(like_value),
            Order.phone.ilike(like_value),
            Order.address.ilike(like_value),
            Order.notes.ilike(like_value),
            Order.type.ilike(like_value),
            Order.status.ilike(like_value),
        ]
        if maybe_order_id is not None:
            search_terms.append(Order.id == maybe_order_id)
        conditions.append(
            or_(*search_terms)
        )

    total_stmt = select(func.count(Order.id))
    if conditions:
        total_stmt = total_stmt.where(*conditions)
    total = int(db.execute(total_stmt).scalar_one() or 0)

    sort_map = {
        "created_at": Order.created_at,
        "total": Order.total,
        "status": Order.status,
        "id": Order.id,
    }
    sort_column = sort_map[sort_by]
    direction = asc if sort_direction == "asc" else desc

    stmt = select(Order).options(joinedload(Order.items))
    if conditions:
        stmt = stmt.where(*conditions)
    stmt = stmt.order_by(direction(sort_column), desc(Order.id))
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)

    items = db.execute(stmt).unique().scalars().all()
    return OrdersPageOut(items=items, total=total, page=page, page_size=page_size)


@router.get("/kitchen/orders", response_model=list[OrderOut])
def manager_kitchen_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[Order]:
    visible_statuses = (
        OrderStatus.SENT_TO_KITCHEN.value,
        OrderStatus.IN_PREPARATION.value,
        OrderStatus.READY.value,
    )
    orders = db.execute(
        select(Order)
        .where(Order.status.in_(visible_statuses))
        .options(joinedload(Order.items))
        .order_by(Order.created_at.desc(), Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().scalars().all()
    return attach_sent_to_kitchen_at(db, orders)


@router.get("/kitchen/orders/paged", response_model=KitchenOrdersPageOut)
def manager_kitchen_orders_paged(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    sort_by: Literal["created_at", "total", "status", "id"] = "created_at",
    sort_direction: Literal["asc", "desc"] = "desc",
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> KitchenOrdersPageOut:
    visible_statuses = (
        OrderStatus.SENT_TO_KITCHEN.value,
        OrderStatus.IN_PREPARATION.value,
        OrderStatus.READY.value,
    )
    conditions = [Order.status.in_(visible_statuses)]

    normalized_search = (search or "").strip()
    if normalized_search:
        like_value = f"%{normalized_search}%"
        maybe_order_id = _extract_order_id_search(normalized_search)
        search_terms = [
            cast(Order.id, String).ilike(like_value),
            Order.type.ilike(like_value),
            Order.status.ilike(like_value),
            Order.phone.ilike(like_value),
            Order.address.ilike(like_value),
            Order.notes.ilike(like_value),
        ]
        if maybe_order_id is not None:
            search_terms.append(Order.id == maybe_order_id)
        conditions.append(
            or_(*search_terms)
        )

    total = int(db.execute(select(func.count(Order.id)).where(*conditions)).scalar_one() or 0)

    sort_map = {
        "created_at": Order.created_at,
        "total": Order.total,
        "status": Order.status,
        "id": Order.id,
    }
    direction = asc if sort_direction == "asc" else desc
    sort_column = sort_map[sort_by]

    items = db.execute(
        select(Order)
        .where(*conditions)
        .options(joinedload(Order.items))
        .order_by(direction(sort_column), desc(Order.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().scalars().all()

    return KitchenOrdersPageOut(
        items=attach_sent_to_kitchen_at(db, items),
        total=total,
        page=page,
        page_size=page_size,
        summary=kitchen_monitor_summary(db),
    )


@router.post("/orders/{order_id}/transition", response_model=OrderOut)
def manager_transition_order(
    order_id: int,
    payload: OrderTransitionInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Order:
    manager_allowed_targets = {
        OrderStatus.CONFIRMED,
        OrderStatus.SENT_TO_KITCHEN,
        OrderStatus.CANCELED,
        OrderStatus.DELIVERED,
    }
    if payload.target_status not in manager_allowed_targets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="لا تملك صلاحية تنفيذ هذا الانتقال")

    if payload.target_status == OrderStatus.DELIVERED:
        order_type_value = db.execute(select(Order.type).where(Order.id == order_id)).scalar_one_or_none()
        if order_type_value == OrderType.DELIVERY.value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="لا يمكن للمدير إنهاء طلب توصيل مباشرة من هذه الشاشة",
            )

    return transition_order(
        db,
        order_id=order_id,
        target_status=payload.target_status,
        performed_by=current_user.id,
        amount_received=payload.amount_received,
        collect_payment=payload.collect_payment,
        reason_code=payload.reason_code,
        reason_note=payload.reason_note,
    )


@router.post("/orders/{order_id}/collect-payment", response_model=OrderOut)
def manager_collect_payment(
    order_id: int,
    payload: OrderPaymentCollectionInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Order:
    return collect_order_payment(
        db,
        order_id=order_id,
        collected_by=current_user.id,
        amount_received=payload.amount_received,
    )


@router.post("/orders/{order_id}/refund", response_model=OrderOut)
def manager_refund_order(
    order_id: int,
    payload: OrderRefundInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Order:
    return refund_order(
        db,
        order_id=order_id,
        refunded_by=current_user.id,
        note=payload.note,
    )


@router.post("/orders/{order_id}/emergency-delivery-fail", response_model=OrderOut)
def manager_emergency_delivery_fail(
    order_id: int,
    payload: EmergencyDeliveryFailInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Order:
    return emergency_fail_delivery_order(
        db,
        order_id=order_id,
        performed_by=current_user.id,
        reason_code=payload.reason_code,
        reason_note=payload.reason_note,
    )


@router.get("/table-sessions", response_model=list[TableSessionOut])
def manager_list_table_sessions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_active_table_sessions(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.get("/tables/{table_id}/session", response_model=TableSessionOut)
def manager_get_table_session(
    table_id: int,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return get_table_session_snapshot(db, table_id=table_id)


@router.post("/tables/{table_id}/settle-session", response_model=TableSessionSettlementOut)
def manager_settle_session(
    table_id: int,
    payload: TableSessionSettlementInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return settle_table_session(
        db,
        table_id=table_id,
        performed_by=current_user.id,
        amount_received=payload.amount_received,
    )


@router.get("/products", response_model=list[ProductOut])
def list_products(
    kind: Literal["all", "sellable", "internal"] = Query(default="all"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[Product]:
    stmt = select(Product)
    if kind == ProductKind.SELLABLE.value:
        stmt = stmt.where(Product.kind == ProductKind.SELLABLE.value)
    elif kind == ProductKind.INTERNAL.value:
        stmt = stmt.where(Product.kind == ProductKind.INTERNAL.value)
    return db.execute(
        stmt.order_by(Product.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().scalars().all()


@router.get("/categories", response_model=list[ProductCategoryOut])
def list_categories(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[ProductCategory]:
    return list_product_categories_service(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/categories", response_model=ProductCategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: ProductCategoryCreate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> ProductCategory:
    return create_product_category_service(
        db,
        name=payload.name,
        active=payload.active,
        sort_order=payload.sort_order,
    )


@router.put("/categories/{category_id}", response_model=ProductCategoryOut)
def update_category(
    category_id: int,
    payload: ProductCategoryUpdate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> ProductCategory:
    return update_product_category_service(
        db,
        category_id=category_id,
        name=payload.name,
        active=payload.active,
        sort_order=payload.sort_order,
    )


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> None:
    delete_product_category_service(db, category_id=category_id)


@router.get("/products/paged", response_model=ProductsPageOut)
def list_products_paged(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=100),
    search: str | None = Query(default=None),
    sort_by: Literal["id", "name", "category", "price", "available"] = "id",
    sort_direction: Literal["asc", "desc"] = "desc",
    archive_state: Literal["all", "active", "archived"] = Query(default="all"),
    kind: Literal["all", "sellable", "internal"] = Query(default="all"),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> ProductsPageOut:
    conditions = []
    if archive_state == "active":
        conditions.append(Product.is_archived.is_(False))
    elif archive_state == "archived":
        conditions.append(Product.is_archived.is_(True))
    if kind == ProductKind.SELLABLE.value:
        conditions.append(Product.kind == ProductKind.SELLABLE.value)
    elif kind == ProductKind.INTERNAL.value:
        conditions.append(Product.kind == ProductKind.INTERNAL.value)

    normalized_search = (search or "").strip()
    if normalized_search:
        like_value = f"%{normalized_search}%"
        conditions.append(
            or_(
                cast(Product.id, String).ilike(like_value),
                Product.name.ilike(like_value),
                Product.category.ilike(like_value),
                Product.description.ilike(like_value),
            )
        )

    total_stmt = select(func.count(Product.id))
    if conditions:
        total_stmt = total_stmt.where(*conditions)
    total = int(db.execute(total_stmt).scalar_one() or 0)

    sort_map = {
        "id": Product.id,
        "name": Product.name,
        "category": Product.category,
        "price": Product.price,
        "available": Product.available,
    }
    direction = asc if sort_direction == "asc" else desc
    sort_column = sort_map[sort_by]

    stmt = select(Product)
    if conditions:
        stmt = stmt.where(*conditions)
    stmt = stmt.order_by(direction(sort_column), desc(Product.id))
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    items = db.execute(stmt).unique().scalars().all()
    return ProductsPageOut(items=items, total=total, page=page, page_size=page_size)


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Product:
    return create_product_service(
        db,
        name=payload.name,
        description=payload.description,
        price=payload.price,
        kind=payload.kind,
        available=payload.available,
        category_id=payload.category_id,
    )


@router.put("/products/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Product:
    return update_product_service(
        db,
        product_id=product_id,
        name=payload.name,
        description=payload.description,
        price=payload.price,
        kind=payload.kind,
        available=payload.available,
        category_id=payload.category_id,
        is_archived=payload.is_archived,
    )


@router.post("/products/{product_id}/image", response_model=ProductOut)
def upload_product_image(
    product_id: int,
    payload: ProductImageInput,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Product:
    return upload_product_image_service(
        db,
        product_id=product_id,
        data_base64=payload.data_base64,
        mime_type=payload.mime_type,
    )


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_product(
    product_id: int,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> None:
    archive_product_service(db, product_id=product_id)


@router.delete("/products/{product_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
def delete_product_permanently(
    product_id: int,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> None:
    delete_product_permanently_service(db, product_id=product_id)



@router.get("/drivers", response_model=list[DeliveryDriverOut])
def list_drivers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[DeliveryDriver]:
    return db.execute(
        select(DeliveryDriver)
        .where(DeliveryDriver.user_id.is_not(None))
        .order_by(DeliveryDriver.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars().all()


@router.post("/drivers", response_model=DeliveryDriverOut, status_code=status.HTTP_201_CREATED)
def create_driver(
    payload: DeliveryDriverCreate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> DeliveryDriver:
    user = db.execute(select(User).where(User.id == payload.user_id)).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المستخدم غير موجود")
    if user.role != UserRole.DELIVERY.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لا يمكن ربط السائق إلا بمستخدم دور توصيل")
    existing = db.execute(select(DeliveryDriver).where(DeliveryDriver.user_id == payload.user_id)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="هذا المستخدم مرتبط بالفعل بسائق توصيل")

    driver = DeliveryDriver(
        user_id=int(user.id),
        name=user.name,
        phone=payload.phone,
        vehicle=payload.vehicle,
        commission_rate=payload.commission_rate,
        active=payload.active,
        status=DriverStatus.AVAILABLE.value if payload.active else DriverStatus.INACTIVE.value,
    )
    with transaction_scope(db):
        db.add(driver)
    return driver


@router.put("/drivers/{driver_id}", response_model=DeliveryDriverOut)
def update_driver(
    driver_id: int,
    payload: DeliveryDriverUpdate,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> DeliveryDriver:
    driver = db.execute(select(DeliveryDriver).where(DeliveryDriver.id == driver_id)).scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="سائق التوصيل غير موجود")
    linked_user = db.execute(select(User).where(User.id == driver.user_id)).scalar_one_or_none()
    if linked_user and linked_user.role == UserRole.DELIVERY.value and linked_user.active:
        old_counts_as_delivery = driver.active and str(driver.status) != DriverStatus.INACTIVE.value
        new_counts_as_delivery = payload.active and payload.status != DriverStatus.INACTIVE
        if old_counts_as_delivery and not new_counts_as_delivery:
            ensure_delivery_capacity_reduction_allowed(db)
    with transaction_scope(db):
        driver.name = payload.name
        driver.phone = payload.phone
        driver.vehicle = payload.vehicle
        driver.commission_rate = payload.commission_rate
        driver.active = payload.active
        driver.status = payload.status.value
    return driver


@router.post("/delivery/team-notify", response_model=OrderOut)
def notify_team(
    payload: DeliveryTeamNotifyInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Order:
    return notify_delivery_team(
        db,
        order_id=payload.order_id,
        actor_id=current_user.id,
    )


@router.get("/delivery/settings", response_model=DeliverySettingsOut)
def get_delivery_settings(
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> DeliverySettingsOut:
    return DeliverySettingsOut(delivery_fee=get_delivery_fee_setting(db))


@router.put("/delivery/settings", response_model=DeliverySettingsOut)
def update_delivery_settings(
    payload: DeliverySettingsUpdate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> DeliverySettingsOut:
    value = update_delivery_fee_setting(db, delivery_fee=payload.delivery_fee, actor_id=current_user.id)
    return DeliverySettingsOut(delivery_fee=value)


@router.get("/delivery/policies", response_model=DeliveryPolicySettingsOut)
def get_delivery_policies(
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> DeliveryPolicySettingsOut:
    values = get_delivery_policy_settings(db)
    return DeliveryPolicySettingsOut(
        min_order_amount=float(values["min_order_amount"]),
        auto_notify_team=bool(values["auto_notify_team"]),
    )


@router.put("/delivery/policies", response_model=DeliveryPolicySettingsOut)
def update_delivery_policies(
    payload: DeliveryPolicySettingsUpdate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> DeliveryPolicySettingsOut:
    values = update_delivery_policy_settings(
        db,
        min_order_amount=payload.min_order_amount,
        auto_notify_team=payload.auto_notify_team,
        actor_id=current_user.id,
    )
    return DeliveryPolicySettingsOut(
        min_order_amount=float(values["min_order_amount"]),
        auto_notify_team=bool(values["auto_notify_team"]),
    )


@router.put("/account/profile", response_model=UserOut)
def update_manager_account_profile(
    payload: AccountProfileUpdate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> User:
    return update_user(
        db,
        user_id=current_user.id,
        name=payload.name,
        role=current_user.role,
        active=current_user.active,
        password=payload.password,
        delivery_phone=None,
        delivery_vehicle=None,
        delivery_commission_rate=None,
        actor_id=current_user.id,
        allow_manager_self_update=True,
    )


@router.get("/account/sessions", response_model=list[AccountSessionOut])
def list_manager_account_sessions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_user_refresh_sessions(
        db,
        user_id=current_user.id,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/account/sessions/revoke-all", response_model=AccountSessionsRevokeOut)
def revoke_manager_account_sessions(
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> AccountSessionsRevokeOut:
    revoked_count = revoke_user_refresh_sessions(db, user_id=current_user.id, actor_id=current_user.id)
    return AccountSessionsRevokeOut(revoked_count=revoked_count)


@router.get("/settings/operational", response_model=list[OperationalSettingOut])
def get_operational_settings(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_operational_settings(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.put("/settings/operational", response_model=OperationalSettingOut)
def update_operational_settings(
    payload: OperationalSettingUpdate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return update_operational_setting(
        db,
        key=payload.key,
        value=payload.value,
        actor_id=current_user.id,
    )


@router.get("/system/backups", response_model=list[SystemBackupOut])
def get_system_backups(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_system_backups(
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/system/backups/create", response_model=SystemBackupOut)
def create_backup(
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return create_system_backup(db, actor_id=current_user.id)


@router.post("/system/backups/restore", response_model=SystemBackupOut)
def restore_backup(
    payload: SystemBackupRestoreInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return restore_system_backup(
        db,
        filename=payload.filename,
        confirm_phrase=payload.confirm_phrase,
        actor_id=current_user.id,
    )


@router.get("/financial/transactions", response_model=list[FinancialTransactionOut])
def list_financial_transactions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[FinancialTransaction]:
    offset = (page - 1) * page_size
    return db.execute(
        select(FinancialTransaction).order_by(FinancialTransaction.created_at.desc())
        .offset(offset)
        .limit(page_size)
    ).scalars().all()


@router.get("/financial/shift-closures", response_model=list[ShiftClosureOut])
def list_financial_shift_closures(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[ShiftClosure]:
    return list_shift_closures(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/financial/shift-closures", response_model=ShiftClosureOut, status_code=status.HTTP_201_CREATED)
def create_financial_shift_closure(
    payload: ShiftClosureCreate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> ShiftClosure:
    return close_cash_shift(
        db,
        closed_by=current_user.id,
        opening_cash=payload.opening_cash,
        actual_cash=payload.actual_cash,
        note=payload.note,
    )


@router.get("/expenses/cost-centers", response_model=list[ExpenseCostCenterOut])
def list_expense_cost_centers_endpoint(
    include_inactive: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[ExpenseCostCenter]:
    return list_expense_cost_centers(
        db,
        include_inactive=include_inactive,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.post("/expenses/cost-centers", response_model=ExpenseCostCenterOut, status_code=status.HTTP_201_CREATED)
def create_expense_cost_center_endpoint(
    payload: ExpenseCostCenterCreate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> ExpenseCostCenter:
    return create_expense_cost_center(
        db,
        code=payload.code,
        name=payload.name,
        active=payload.active,
        actor_id=current_user.id,
    )


@router.put("/expenses/cost-centers/{center_id}", response_model=ExpenseCostCenterOut)
def update_expense_cost_center_endpoint(
    center_id: int,
    payload: ExpenseCostCenterUpdate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> ExpenseCostCenter:
    return update_expense_cost_center(
        db,
        center_id=center_id,
        code=payload.code,
        name=payload.name,
        active=payload.active,
        actor_id=current_user.id,
    )


@router.get("/expenses", response_model=list[ExpenseOut])
def list_expenses(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[Expense]:
    offset = (page - 1) * page_size
    return (
        db.execute(
            select(Expense)
            .options(joinedload(Expense.attachments), joinedload(Expense.cost_center))
            .order_by(Expense.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        .unique()
        .scalars()
        .all()
    )


@router.post("/expenses", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
def create_expense_endpoint(
    payload: ExpenseCreate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Expense:
    return create_expense(
        db,
        title=payload.title,
        category=payload.category,
        cost_center_id=payload.cost_center_id,
        amount=payload.amount,
        note=payload.note,
        created_by=current_user.id,
    )


@router.put("/expenses/{expense_id}", response_model=ExpenseOut)
def update_expense_endpoint(
    expense_id: int,
    payload: ExpenseUpdate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Expense:
    return update_expense(
        db,
        expense_id=expense_id,
        title=payload.title,
        category=payload.category,
        cost_center_id=payload.cost_center_id,
        amount=payload.amount,
        note=payload.note,
        updated_by=current_user.id,
    )


@router.post("/expenses/{expense_id}/approve", response_model=ExpenseOut)
def approve_expense_endpoint(
    expense_id: int,
    payload: ExpenseReviewInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Expense:
    return approve_expense(
        db,
        expense_id=expense_id,
        approved_by=current_user.id,
        note=payload.note,
    )


@router.post("/expenses/{expense_id}/reject", response_model=ExpenseOut)
def reject_expense_endpoint(
    expense_id: int,
    payload: ExpenseReviewInput,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> Expense:
    return reject_expense(
        db,
        expense_id=expense_id,
        rejected_by=current_user.id,
        note=payload.note,
    )


@router.post("/expenses/{expense_id}/attachments", response_model=ExpenseAttachmentOut, status_code=status.HTTP_201_CREATED)
def create_expense_attachment_endpoint(
    expense_id: int,
    payload: ExpenseAttachmentCreate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> ExpenseAttachmentOut:
    return create_expense_attachment(
        db,
        expense_id=expense_id,
        file_name=payload.file_name,
        mime_type=payload.mime_type,
        data_base64=payload.data_base64,
        uploaded_by=current_user.id,
    )


@router.delete("/expenses/{expense_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense_attachment_endpoint(
    expense_id: int,
    attachment_id: int,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> None:
    delete_expense_attachment(
        db,
        expense_id=expense_id,
        attachment_id=attachment_id,
        deleted_by=current_user.id,
    )


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense_endpoint(
    expense_id: int,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> None:
    delete_expense(db, expense_id=expense_id)


@router.get("/reports/daily", response_model=list[ReportDailyRow])
def report_daily(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_AUDIT_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, float | str]]:
    return daily_report(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.get("/reports/monthly", response_model=list[ReportMonthlyRow])
def report_monthly(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_AUDIT_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, float | str]]:
    return monthly_report(
        db,
        offset=(page - 1) * page_size,
        limit=page_size,
    )


@router.get("/reports/by-order-type", response_model=list[ReportByTypeRow])
def report_order_type(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_AUDIT_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[dict[str, float | str | int]]:
    rows = report_by_order_type(db)
    offset = (page - 1) * page_size
    return rows[offset:offset + page_size]


@router.get("/reports/performance", response_model=ReportPerformance)
def report_performance(
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> ReportPerformance:
    return ReportPerformance(avg_prep_minutes=prep_performance_report(db))


@router.get("/reports/profitability", response_model=ReportProfitabilityOut)
def report_profitability(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return profitability_report(db, start_date=start_date, end_date=end_date)


@router.get("/reports/period-comparison", response_model=ReportPeriodComparisonOut)
def report_period_comparison(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return period_comparison_report(db, start_date=start_date, end_date=end_date)


@router.get("/reports/peak-hours-performance", response_model=ReportPeakHoursPerformanceOut)
def report_peak_hours_performance(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return peak_hours_performance_report(db, start_date=start_date, end_date=end_date)


@router.get("/users", response_model=list[UserOut])
def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[User]:
    return db.execute(
        select(User)
        .where(~User.username.like(f"{SYSTEM_ORDER_ACTOR_PREFIX}%"))
        .order_by(User.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars().all()


@router.get("/users/permissions/catalog", response_model=list[PermissionCatalogItemOut])
def list_users_permissions_catalog(
    role: UserRole | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_LIST_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
) -> list[dict[str, object]]:
    items = list_permissions_catalog(role=role.value if role else None)
    offset = (page - 1) * page_size
    return items[offset:offset + page_size]


@router.get("/users/{user_id}/permissions", response_model=UserPermissionsOut)
def get_user_permissions_endpoint(
    user_id: int,
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return get_user_permissions_profile(db, user_id=user_id)


@router.put("/users/{user_id}/permissions", response_model=UserPermissionsOut)
def update_user_permissions_endpoint(
    user_id: int,
    payload: UserPermissionsUpdate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return update_user_permissions_profile(
        db,
        user_id=user_id,
        allow=payload.allow,
        deny=payload.deny,
        actor_id=current_user.id,
    )


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user_endpoint(
    payload: UserCreate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> User:
    return create_user(
        db,
        name=payload.name,
        username=payload.username,
        password=payload.password,
        role=payload.role.value,
        active=payload.active,
        delivery_phone=payload.delivery_phone,
        delivery_vehicle=payload.delivery_vehicle,
        delivery_commission_rate=payload.delivery_commission_rate,
        actor_id=current_user.id,
    )


@router.put("/users/{user_id}", response_model=UserOut)
def update_user_endpoint(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> User:
    return update_user(
        db,
        user_id=user_id,
        name=payload.name,
        role=payload.role.value,
        active=payload.active,
        password=payload.password,
        delivery_phone=payload.delivery_phone,
        delivery_vehicle=payload.delivery_vehicle,
        delivery_commission_rate=payload.delivery_commission_rate,
        actor_id=current_user.id,
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_endpoint(
    user_id: int,
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> None:
    try:
        delete_user_permanently(db, user_id=user_id, actor_id=current_user.id)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="تعذر حذف المستخدم لارتباطه بسجلات تشغيلية أخرى.",
        ) from exc


@router.get("/audit/orders", response_model=list[OrderTransitionLogOut])
def order_audit_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_AUDIT_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[OrderTransitionLog]:
    return db.execute(
        select(OrderTransitionLog).order_by(OrderTransitionLog.timestamp.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars().all()


@router.get("/audit/system", response_model=list[SystemAuditLogOut])
def system_audit_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_AUDIT_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[SystemAuditLog]:
    return db.execute(
        select(SystemAuditLog).order_by(SystemAuditLog.timestamp.desc(), SystemAuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars().all()


@router.get("/audit/security", response_model=list[SecurityAuditEventOut])
def security_audit_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_LIST_PAGE_SIZE, ge=1, le=MAX_AUDIT_PAGE_SIZE),
    _: User = Depends(require_roles(UserRole.MANAGER)),
    db: Session = Depends(get_db),
) -> list[SecurityAuditEvent]:
    return db.execute(
        select(SecurityAuditEvent).order_by(SecurityAuditEvent.created_at.desc(), SecurityAuditEvent.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars().all()





