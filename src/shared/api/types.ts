export type UserRole = 'manager' | 'kitchen' | 'delivery';

export type ProductKind = 'sellable' | 'internal';
export type OrderType = 'dine-in' | 'takeaway' | 'delivery';

export type OrderStatus =
  | 'CREATED'
  | 'CONFIRMED'
  | 'SENT_TO_KITCHEN'
  | 'IN_PREPARATION'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'CANCELED';

export interface User {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  active?: boolean;
  permissions_effective?: string[];
}

export interface PermissionCatalogItem {
  code: string;
  label: string;
  description: string;
  roles: UserRole[];
  default_enabled: boolean;
}

export interface UserPermissionsProfile {
  user_id: number;
  username: string;
  role: UserRole;
  default_permissions: string[];
  allow_overrides: string[];
  deny_overrides: string[];
  effective_permissions: string[];
}

export interface AccountSession {
  id: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  is_active: boolean;
}

export interface AccountSessionsRevokeResult {
  revoked_count: number;
}

export interface SystemBackup {
  filename: string;
  size_bytes: number;
  created_at: string;
}

export interface AuthSession {
  user: User;
  token_type: string;
}

export interface Product {
  id: number;
  name: string;
  description?: string | null;
  price: number;
  kind: ProductKind;
  available: boolean;
  category: string;
  category_id?: number | null;
  image_path?: string | null;
  is_archived?: boolean;
}

export interface PublicProduct {
  id: number;
  name: string;
  description?: string | null;
  price: number;
  category: string;
  image_path?: string | null;
}

export interface TableInfo {
  id: number;
  qr_code: string;
  status: 'available' | 'occupied' | 'reserved';
}

export interface ManagerTable extends TableInfo {
  total_orders_count: number;
  has_active_session: boolean;
  active_orders_count: number;
  unsettled_orders_count: number;
  unpaid_total: number;
}

export interface OrderItem {
  id: number;
  product_id: number;
  quantity: number;
  price: number;
  product_name: string;
}

export interface Order {
  id: number;
  type: OrderType;
  status: OrderStatus;
  table_id: number | null;
  phone: string | null;
  address: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  created_at: string;
  notes: string | null;
  payment_status?: 'unpaid' | 'paid' | 'refunded';
  paid_at?: string | null;
  paid_by?: number | null;
  amount_received?: number | null;
  change_amount?: number | null;
  payment_method?: string;
  delivery_team_notified_at?: string | null;
  delivery_team_notified_by?: number | null;
  sent_to_kitchen_at?: string | null;
  items: OrderItem[];
}

export interface TableSession {
  table: TableInfo;
  has_active_session: boolean;
  total_orders: number;
  active_orders_count: number;
  unsettled_orders_count: number;
  unpaid_total: number;
  latest_order_status: OrderStatus | null;
  orders: Order[];
}

export interface TableSessionSettlement {
  table_id: number;
  settled_order_ids: number[];
  settled_total: number;
  amount_received: number;
  change_amount: number;
  table_status: TableInfo['status'];
}

export interface OrdersPage {
  items: Order[];
  total: number;
  page: number;
  page_size: number;
}

export interface KitchenMonitorSummary {
  sent_to_kitchen: number;
  in_preparation: number;
  ready: number;
  oldest_order_wait_seconds: number;
  avg_prep_minutes_today: number;
  warehouse_issued_quantity_today: number;
  warehouse_issue_vouchers_today: number;
  warehouse_issued_items_today: number;
}

export interface KitchenOrdersPage extends OrdersPage {
  summary: KitchenMonitorSummary;
}

export interface KitchenRuntimeSettings {
  order_polling_ms: number;
}

export interface DashboardStats {
  created: number;
  confirmed: number;
  sent_to_kitchen: number;
  in_preparation: number;
  ready: number;
  out_for_delivery?: number;
  delivered: number;
  delivery_failed?: number;
  canceled: number;
  active_orders: number;
  today_sales?: number;
  today_expenses?: number;
  today_net?: number;
}

export interface OperationalHeartMeta {
  generated_at: string;
  local_business_date: string;
  refresh_recommended_ms: number;
  contract_version?: string;
}

export interface OperationalHeartCapabilities {
  kitchen_enabled: boolean;
  delivery_enabled: boolean;
  kitchen_active_users: number;
  delivery_active_users: number;
  kitchen_block_reason?: string | null;
  delivery_block_reason?: string | null;
}

export interface OperationalHeartKpis {
  active_orders: number;
  ready_orders: number;
  today_sales: number;
  today_expenses: number;
  today_net: number;
  avg_prep_minutes_today: number;
  oldest_kitchen_wait_seconds: number;
}

export interface OperationalHeartQueue {
  key: string;
  label: string;
  count: number;
  oldest_age_seconds: number;
  aged_over_sla_count: number;
  sla_seconds: number;
  action_route: string;
}

export interface OperationalHeartIncident {
  code: string;
  severity: 'critical' | 'warning' | 'info' | string;
  title: string;
  message: string;
  count: number;
  oldest_age_seconds?: number | null;
  action_route: string;
}

export interface OperationalHeartTimelineItem {
  timestamp: string;
  domain: string;
  title: string;
  description: string;
  action_route?: string | null;
  order_id?: number | null;
  entity_id?: number | null;
}

export interface OperationalHeartFinancialControl {
  severity: 'critical' | 'warning' | 'info' | string;
  action_route: string;
  shift_closed_today: boolean;
  latest_shift_variance: number;
  sales_transactions_today: number;
  expense_transactions_today: number;
  today_net: number;
}

export interface OperationalHeartWarehouseControl {
  severity: 'critical' | 'warning' | 'info' | string;
  action_route: string;
  active_items: number;
  low_stock_items: number;
  pending_stock_counts: number;
  inbound_today: number;
  outbound_today: number;
}

export interface OperationalHeartTablesControl {
  severity: 'critical' | 'warning' | 'info' | string;
  action_route: string;
  active_sessions: number;
  blocked_settlement_tables: number;
  unpaid_orders: number;
  unpaid_total: number;
}

export interface OperationalHeartExpensesControl {
  severity: 'critical' | 'warning' | 'info' | string;
  action_route: string;
  pending_approvals: number;
  pending_amount: number;
  rejected_today: number;
  high_value_pending_amount: number;
}

export interface OperationalHeartReconciliation {
  key: string;
  label: string;
  ok: boolean;
  severity: 'critical' | 'warning' | 'info' | string;
  detail: string;
  action_route: string;
}

export interface OperationalHeartDashboard {
  meta: OperationalHeartMeta;
  capabilities: OperationalHeartCapabilities;
  kpis: OperationalHeartKpis;
  queues: OperationalHeartQueue[];
  incidents: OperationalHeartIncident[];
  timeline: OperationalHeartTimelineItem[];
  financial_control?: OperationalHeartFinancialControl;
  warehouse_control?: OperationalHeartWarehouseControl;
  tables_control?: OperationalHeartTablesControl;
  expenses_control?: OperationalHeartExpensesControl;
  reconciliations?: OperationalHeartReconciliation[];
}

export interface LoginPayload {
  username: string;
  password: string;
  role: UserRole;
}

export interface CreateOrderPayload {
  type: OrderType;
  table_id?: number;
  phone?: string;
  address?: string;
  notes?: string;
  items: Array<{
    product_id: number;
    quantity: number;
  }>;
}

export interface ProductPayload {
  name: string;
  description?: string | null;
  price: number;
  kind: ProductKind;
  category_id: number;
  available: boolean;
  is_archived?: boolean;
}

export interface ProductCategory {
  id: number;
  name: string;
  active: boolean;
  sort_order: number;
}

export interface ProductsPage {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
}

export interface DeliveryDriver {
  id: number;
  user_id: number;
  name: string;
  phone: string;
  status: 'available' | 'busy' | 'inactive';
  vehicle?: string | null;
  commission_rate: number;
  active: boolean;
}

export interface DeliveryAssignment {
  id: number;
  order_id: number;
  driver_id: number;
  assigned_at: string;
  departed_at?: string | null;
  delivered_at?: string | null;
  status: 'notified' | 'assigned' | 'departed' | 'delivered' | 'failed';
}

export interface DeliverySettings {
  delivery_fee: number;
}

export interface DeliveryPolicies {
  min_order_amount: number;
  auto_notify_team: boolean;
}

export interface OperationalCapabilities {
  kitchen_enabled: boolean;
  delivery_enabled: boolean;
  kitchen_active_users: number;
  delivery_active_users: number;
  kitchen_block_reason?: string | null;
  delivery_block_reason?: string | null;
}

export interface OperationalSetting {
  key: string;
  value: string;
  description: string;
  editable: boolean;
}

export interface DeliveryHistoryRow {
  assignment_id: number;
  order_id: number;
  assignment_status: 'assigned' | 'departed' | 'delivered' | 'failed' | 'notified';
  order_status: OrderStatus;
  assigned_at: string;
  departed_at?: string | null;
  delivered_at?: string | null;
  order_subtotal: number;
  delivery_fee: number;
  order_total: number;
  phone?: string | null;
  address?: string | null;
}

export interface FinancialTransaction {
  id: number;
  order_id?: number | null;
  expense_id?: number | null;
  amount: number;
  type: 'sale' | 'refund' | 'expense';
  created_by: number;
  created_at: string;
  note?: string | null;
}

export interface ShiftClosure {
  id: number;
  business_date: string;
  opening_cash: number;
  sales_total: number;
  refunds_total: number;
  expenses_total: number;
  expected_cash: number;
  actual_cash: number;
  variance: number;
  transactions_count: number;
  note?: string | null;
  closed_by: number;
  closed_at: string;
}

export interface Expense {
  id: number;
  title: string;
  category: string;
  cost_center_id: number;
  cost_center_name?: string | null;
  amount: number;
  note?: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  attachments: ExpenseAttachment[];
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCostCenter {
  id: number;
  code: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExpenseAttachment {
  id: number;
  expense_id: number;
  file_name: string;
  file_url: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: number;
  created_at: string;
}

export interface ReportDailyRow {
  day: string;
  sales: number;
  expenses: number;
  net: number;
}

export interface ReportMonthlyRow {
  month: string;
  sales: number;
  expenses: number;
  net: number;
}

export interface ReportByTypeRow {
  order_type: OrderType;
  orders_count: number;
  sales: number;
}

export interface ReportPerformance {
  avg_prep_minutes: number;
}

export interface ReportProfitabilityProductRow {
  product_id: number;
  product_name: string;
  category_name: string;
  quantity_sold: number;
  revenue: number;
  estimated_unit_cost: number;
  estimated_cost: number;
  gross_profit: number;
  margin_percent: number;
}

export interface ReportProfitabilityCategoryRow {
  category_name: string;
  quantity_sold: number;
  revenue: number;
  estimated_cost: number;
  gross_profit: number;
  margin_percent: number;
}

export interface ReportProfitability {
  start_date?: string | null;
  end_date?: string | null;
  total_quantity_sold: number;
  total_revenue: number;
  total_estimated_cost: number;
  total_gross_profit: number;
  total_margin_percent: number;
  by_products: ReportProfitabilityProductRow[];
  by_categories: ReportProfitabilityCategoryRow[];
}

export interface ReportPeriodMetrics {
  label: string;
  start_date: string;
  end_date: string;
  days_count: number;
  sales: number;
  expenses: number;
  net: number;
  delivered_orders_count: number;
  avg_order_value: number;
}

export interface ReportPeriodDeltaRow {
  metric: string;
  current_value: number;
  previous_value: number;
  absolute_change: number;
  change_percent?: number | null;
}

export interface ReportPeriodComparison {
  current_period: ReportPeriodMetrics;
  previous_period: ReportPeriodMetrics;
  deltas: ReportPeriodDeltaRow[];
}

export interface ReportPeakHourRow {
  hour_label: string;
  orders_count: number;
  sales: number;
  avg_order_value: number;
  avg_prep_minutes: number;
}

export interface ReportPeakHoursPerformance {
  start_date: string;
  end_date: string;
  days_count: number;
  peak_hour?: string | null;
  peak_orders_count: number;
  peak_sales: number;
  overall_avg_prep_minutes: number;
  by_hours: ReportPeakHourRow[];
}

export interface OrderTransitionLog {
  id: number;
  order_id: number;
  from_status: OrderStatus;
  to_status: OrderStatus;
  performed_by: number;
  timestamp: string;
}

export interface SystemAuditLog {
  id: number;
  module: string;
  action: string;
  entity_type: string;
  entity_id?: number | null;
  description: string;
  performed_by: number;
  timestamp: string;
}

export interface SecurityAuditEvent {
  id: number;
  event_type: string;
  success: boolean;
  severity: string;
  username?: string | null;
  role?: UserRole | null;
  user_id?: number | null;
  ip_address?: string | null;
  user_agent?: string | null;
  detail?: string | null;
  created_at: string;
}

export interface WarehouseSupplier {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  payment_term_days: number;
  credit_limit?: number | null;
  quality_rating: number;
  lead_time_days: number;
  notes?: string | null;
  active: boolean;
  supplied_item_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface WarehouseItem {
  id: number;
  name: string;
  unit: string;
  alert_threshold: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WarehouseStockBalance {
  item_id: number;
  item_name: string;
  unit: string;
  alert_threshold: number;
  active: boolean;
  quantity: number;
  is_low: boolean;
}

export interface WarehouseInboundVoucherItem {
  item_id: number;
  item_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

export interface WarehouseOutboundVoucherItem {
  item_id: number;
  item_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

export interface WarehouseInboundVoucher {
  id: number;
  voucher_no: string;
  supplier_id: number;
  supplier_name: string;
  reference_no?: string | null;
  note?: string | null;
  posted_at: string;
  received_by: number;
  total_quantity: number;
  total_cost: number;
  items: WarehouseInboundVoucherItem[];
}

export interface WarehouseOutboundVoucher {
  id: number;
  voucher_no: string;
  reason_code: string;
  reason: string;
  note?: string | null;
  posted_at: string;
  issued_by: number;
  total_quantity: number;
  total_cost: number;
  items: WarehouseOutboundVoucherItem[];
}

export interface WarehouseLedgerRow {
  id: number;
  item_id: number;
  item_name: string;
  movement_kind: 'inbound' | 'outbound' | string;
  source_type: string;
  source_id: number;
  quantity: number;
  unit_cost: number;
  line_value: number;
  running_avg_cost: number;
  balance_before: number;
  balance_after: number;
  note?: string | null;
  created_by: number;
  created_at: string;
}

export interface WarehouseOutboundReason {
  code: string;
  label: string;
}

export interface WarehouseStockCountItem {
  item_id: number;
  item_name: string;
  unit: string;
  system_quantity: number;
  counted_quantity: number;
  variance_quantity: number;
  unit_cost: number;
  variance_value: number;
}

export interface WarehouseStockCount {
  id: number;
  count_no: string;
  note?: string | null;
  status: 'pending' | 'settled' | string;
  counted_by: number;
  counted_at: string;
  settled_by?: number | null;
  settled_at?: string | null;
  total_variance_quantity: number;
  total_variance_value: number;
  items: WarehouseStockCountItem[];
}

export interface WarehouseDashboard {
  active_items: number;
  active_suppliers: number;
  low_stock_items: number;
  inbound_today: number;
  outbound_today: number;
}

