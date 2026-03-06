import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type { CreateOrderPayload, Order, OrderStatus, OrderType, Product, TableInfo } from '@/shared/api/types';
import { Modal } from '@/shared/ui/Modal';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { TablePagination } from '@/shared/ui/TablePagination';
import { formatOrderTrackingId, orderDateKey, managerActions, orderTypeClasses, orderTypeLabel, tableStatusLabel } from '@/shared/utils/order';
import { parseApiDateMs } from '@/shared/utils/date';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';
import { sanitizeMojibakeText } from '@/shared/utils/textSanitizer';

const timeOnlyFormatter = new Intl.DateTimeFormat('ar-DZ-u-nu-latn', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function actionButtonClasses(targetStatus: OrderStatus): string {
  if (targetStatus === 'CONFIRMED') {
    return 'border-emerald-300 bg-emerald-100/80 text-emerald-900 hover:bg-emerald-100';
  }
  if (targetStatus === 'SENT_TO_KITCHEN') {
    return 'border-amber-300 bg-amber-100/80 text-amber-900 hover:bg-amber-100';
  }
  if (targetStatus === 'CANCELED') {
    return 'border-rose-300 bg-rose-100/80 text-rose-900 hover:bg-rose-100';
  }
  if (targetStatus === 'DELIVERED') {
    return 'border-cyan-300 bg-cyan-100/80 text-cyan-900 hover:bg-cyan-100';
  }
  return 'border-stone-300 bg-stone-100/80 text-stone-800 hover:bg-stone-100';
}

const rowCellBase = 'px-4 py-3 border-b border-[#e3d2b7] bg-[#fffdf9]/85';
const PAGE_SIZE = 12;
const LIVE_ORDERS_REFETCH_MS = 2000;
const orderStatuses: OrderStatus[] = [
  'CREATED',
  'CONFIRMED',
  'SENT_TO_KITCHEN',
  'IN_PREPARATION',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'CANCELED',
];
const orderTypes: OrderType[] = ['dine-in', 'takeaway', 'delivery'];
const fallbackKitchenBlockedReason = 'نظام المطبخ مغلق حاليًا. أضف مستخدم مطبخ نشط من قسم المستخدمين.';
const fallbackDeliveryBlockedReason = 'نظام التوصيل مغلق حاليًا. أضف مستخدم توصيل نشط من قسم المستخدمين.';
const cancellationReasonOptions = [
  { value: 'customer_request', label: 'طلب العميل' },
  { value: 'duplicate_order', label: 'طلب مكرر' },
  { value: 'item_unavailable', label: 'نفاد صنف' },
  { value: 'payment_issue', label: 'تعذر الدفع' },
  { value: 'operational_issue', label: 'ظرف تشغيلي' },
];
const emergencyFailReasonOptions = [
  { value: 'delivery_service_disabled', label: 'تعذر تشغيل خدمة التوصيل' },
  { value: 'no_driver_available', label: 'عدم توفر سائق توصيل' },
  { value: 'address_issue', label: 'تعذر الوصول إلى العنوان' },
  { value: 'customer_unreachable', label: 'تعذر التواصل مع العميل' },
  { value: 'operational_emergency', label: 'طارئ تشغيلي' },
];

function normalizeStatus(value: string | null): OrderStatus | 'all' {
  return value && orderStatuses.includes(value as OrderStatus) ? (value as OrderStatus) : 'all';
}

function normalizeType(value: string | null): OrderType | 'all' {
  return value && orderTypes.includes(value as OrderType) ? (value as OrderType) : 'all';
}

interface ManualOrderItemRow {
  product_id: number;
  quantity: number;
}

interface ReasonDialogState {
  mode: 'cancel' | 'emergency_fail';
  order: Order;
}

export function OrdersPage() {
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>(() => normalizeStatus(searchParams.get('status')));
  const [typeFilter, setTypeFilter] = useState<OrderType | 'all'>(() => normalizeType(searchParams.get('order_type')));
  const [page, setPage] = useState(1);
  const [amountReceived, setAmountReceived] = useState<Record<number, number>>({});
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualType, setManualType] = useState<OrderType>('takeaway');
  const [manualTableId, setManualTableId] = useState<number | ''>('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualItems, setManualItems] = useState<ManualOrderItemRow[]>([{ product_id: 0, quantity: 1 }]);
  const [manualError, setManualError] = useState('');
  const [reasonDialog, setReasonDialog] = useState<ReasonDialogState | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');

  const invalidateOperationalQueries = () => {
    const keys: string[] = [
      'manager-orders-paged',
      'manager-tables',
      'manager-dashboard-operational-heart',
      'manager-dashboard-smart-orders',
      'manager-kitchen-monitor-paged',
      'manager-financial',
      'manager-orders-delivery',
      'delivery-orders',
      'delivery-assignments',
      'manager-operational-capabilities',
      'public-operational-capabilities',
      'public-tables',
    ];
    for (const key of keys) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    queryClient.invalidateQueries({ queryKey: ['public-table-session'] });
  };

  const resetReasonDialog = () => {
    setReasonDialog(null);
    setReasonCode('');
    setReasonNote('');
  };

  const openReasonDialog = (mode: ReasonDialogState['mode'], order: Order) => {
    const defaults = mode === 'cancel' ? cancellationReasonOptions : emergencyFailReasonOptions;
    setReasonDialog({ mode, order });
    setReasonCode(defaults[0]?.value ?? '');
    setReasonNote('');
  };

  const ordersQuery = useQuery({
    queryKey: ['manager-orders-paged', page, search, sortBy, sortDirection, statusFilter, typeFilter],
    queryFn: () =>
      api.managerOrdersPaged(role ?? 'manager', {
        page,
        pageSize: PAGE_SIZE,
        search,
        sortBy: sortBy as 'created_at' | 'total' | 'status' | 'id',
        sortDirection,
        status: statusFilter === 'all' ? undefined : statusFilter,
        orderType: typeFilter === 'all' ? undefined : typeFilter,
      }),
    enabled: role === 'manager',
    // Orders board must keep refreshing continuously in operational console mode.
    refetchInterval: LIVE_ORDERS_REFETCH_MS,
    refetchIntervalInBackground: true,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });

  const assignmentsQuery = useQuery({
    queryKey: ['delivery-assignments'],
    queryFn: () => api.deliveryAssignments(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const capabilitiesQuery = useQuery({
    queryKey: ['manager-operational-capabilities'],
    queryFn: () => api.managerOperationalCapabilities(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const productsQuery = useQuery({
    queryKey: ['manager-products', 'sellable'],
    queryFn: () => api.managerProducts(role ?? 'manager', 'sellable'),
    enabled: role === 'manager',
  });

  const tablesQuery = useQuery({
    queryKey: ['public-tables'],
    queryFn: () => api.publicTables(),
    enabled: role === 'manager',
  });

  const transitionMutation = useMutation({
    mutationFn: ({
      orderId,
      targetStatus,
      amount,
      collectPayment,
      reasonCode,
      reasonNote,
    }: {
      orderId: number;
      targetStatus: OrderStatus;
      amount?: number;
      collectPayment?: boolean;
      reasonCode?: string;
      reasonNote?: string;
    }) => api.managerTransitionOrder(role ?? 'manager', orderId, targetStatus, amount, collectPayment, reasonCode, reasonNote),
    onSuccess: () => {
      invalidateOperationalQueries();
      resetReasonDialog();
    },
  });

  const notifyTeamMutation = useMutation({
    mutationFn: (orderId: number) => api.managerNotifyDeliveryTeam(role ?? 'manager', orderId),
    onSuccess: invalidateOperationalQueries,
  });

  const emergencyDeliveryFailMutation = useMutation({
    mutationFn: ({
      orderId,
      reasonCode,
      reasonNote,
    }: {
      orderId: number;
      reasonCode: string;
      reasonNote?: string;
    }) => api.managerEmergencyDeliveryFail(role ?? 'manager', orderId, reasonCode, reasonNote),
    onSuccess: () => {
      invalidateOperationalQueries();
      resetReasonDialog();
    },
  });

  const collectPaymentMutation = useMutation({
    mutationFn: ({ orderId, amount }: { orderId: number; amount?: number }) =>
      api.managerCollectOrderPayment(role ?? 'manager', orderId, amount),
    onSuccess: invalidateOperationalQueries,
  });

  const resetManualForm = () => {
    setManualType('takeaway');
    setManualTableId('');
    setManualPhone('');
    setManualAddress('');
    setManualNotes('');
    setManualItems([{ product_id: 0, quantity: 1 }]);
    setManualError('');
  };

  const operationalCapabilities = capabilitiesQuery.data;
  const kitchenEnabled = operationalCapabilities?.kitchen_enabled ?? true;
  const deliveryEnabled = operationalCapabilities?.delivery_enabled ?? true;
  const kitchenBlockedReason = sanitizeMojibakeText(
    operationalCapabilities?.kitchen_block_reason,
    fallbackKitchenBlockedReason
  );
  const deliveryBlockedReason = sanitizeMojibakeText(
    operationalCapabilities?.delivery_block_reason,
    fallbackDeliveryBlockedReason
  );

  const openManualModal = () => {
    resetManualForm();
    setIsManualModalOpen(true);
  };

  const closeManualModal = () => {
    setIsManualModalOpen(false);
    resetManualForm();
  };

  useEffect(() => {
    const nextStatus = normalizeStatus(searchParams.get('status'));
    if (nextStatus !== statusFilter) {
      setStatusFilter(nextStatus);
      setPage(1);
    }

    const nextType = normalizeType(searchParams.get('order_type'));
    if (nextType !== typeFilter) {
      setTypeFilter(nextType);
      setPage(1);
    }

    if (searchParams.get('new') === '1') {
      resetManualForm();
      setIsManualModalOpen(true);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('new');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams, statusFilter, typeFilter]);

  useEffect(() => {
    if (!deliveryEnabled && manualType === 'delivery') {
      setManualType('takeaway');
      setManualAddress('');
    }
  }, [deliveryEnabled, manualType]);

  const manualCreateMutation = useMutation({
    mutationFn: (payload: CreateOrderPayload) => api.managerCreateManualOrder(role ?? 'manager', payload),
    onSuccess: () => {
      invalidateOperationalQueries();
      closeManualModal();
    },
    onError: (error) => {
      setManualError(error instanceof Error ? error.message : 'تعذر إنشاء الطلب يدويًا.');
    },
  });

  const activeAssignedOrders = useMemo(() => {
    const ids = new Set<number>();
    for (const assignment of assignmentsQuery.data ?? []) {
      if (assignment.status === 'assigned' || assignment.status === 'departed') {
        ids.add(assignment.order_id);
      }
    }
    return ids;
  }, [assignmentsQuery.data]);

  const availableManualProducts = useMemo<Product[]>(
    () => (productsQuery.data ?? []).filter((product) => product.kind === 'sellable' && product.available && !product.is_archived),
    [productsQuery.data]
  );

  const tableOptions = useMemo<TableInfo[]>(() => {
    const rows = tablesQuery.data ?? [];
    return rows.filter((table) => table.status !== 'occupied' || table.id === manualTableId);
  }, [manualTableId, tablesQuery.data]);

  const manualTotal = useMemo(() => {
    const map = new Map<number, Product>();
    for (const product of availableManualProducts) {
      map.set(product.id, product);
    }
    return manualItems.reduce((sum, item) => {
      const product = map.get(item.product_id);
      if (!product || item.quantity <= 0) {
        return sum;
      }
      return sum + product.price * item.quantity;
    }, 0);
  }, [availableManualProducts, manualItems]);

  const rows = ordersQuery.data?.items ?? [];
  const totalRows = ordersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const syncFilterParam = (key: 'status' | 'order_type', value: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (!value || value === 'all') {
      nextParams.delete(key);
    } else {
      nextParams.set(key, value);
    }
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const submitManualOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setManualError('');
    if (manualType === 'delivery' && !deliveryEnabled) {
      setManualError(deliveryBlockedReason);
      return;
    }

    const validItems = manualItems
      .filter((item) => item.product_id > 0 && item.quantity > 0)
      .map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
      }));

    if (validItems.length === 0) {
      setManualError('يجب اختيار عنصر واحد على الأقل مع كمية صحيحة.');
      return;
    }

    const payload: CreateOrderPayload = {
      type: manualType,
      items: validItems,
      notes: manualNotes.trim() || undefined,
    };

    if (manualType === 'dine-in') {
      if (!manualTableId) {
        setManualError('رقم الطاولة مطلوب لطلب الطاولة.');
        return;
      }
      payload.table_id = Number(manualTableId);
    } else {
      const phone = manualPhone.trim();
      if (manualType === 'delivery' && !phone) {
        setManualError('رقم الهاتف مطلوب لطلبات التوصيل.');
        return;
      }
      if (phone) {
        payload.phone = phone;
      }
    }

    if (manualType === 'delivery') {
      const address = manualAddress.trim();
      if (!address) {
        setManualError('عنوان التوصيل مطلوب.');
        return;
      }
      payload.address = address;
    }

    manualCreateMutation.mutate(payload);
  };

  const activeReasonOptions = reasonDialog?.mode === 'emergency_fail' ? emergencyFailReasonOptions : cancellationReasonOptions;

  const submitReasonAction = () => {
    if (!reasonDialog || !reasonCode) {
      return;
    }
    const normalizedNote = reasonNote.trim() || undefined;
    if (reasonDialog.mode === 'cancel') {
      transitionMutation.mutate({
        orderId: reasonDialog.order.id,
        targetStatus: 'CANCELED',
        reasonCode,
        reasonNote: normalizedNote,
      });
      return;
    }
    emergencyDeliveryFailMutation.mutate({
      orderId: reasonDialog.order.id,
      reasonCode,
      reasonNote: normalizedNote,
    });
  };

  const renderOrderActions = (order: Order) => (
    <>
      {managerActions(order.status, order.type)
        .filter((action) => !(action.target === 'SENT_TO_KITCHEN' && !kitchenEnabled))
        .map((action) => (
        <button
          key={action.target}
          type="button"
          disabled={transitionMutation.isPending}
          onClick={() => {
            if (action.target === 'CANCELED') {
              openReasonDialog('cancel', order);
              return;
            }
            transitionMutation.mutate({
              orderId: order.id,
              targetStatus: action.target,
              amount: action.target === 'DELIVERED' && order.type === 'takeaway' ? amountReceived[order.id] ?? order.total : undefined,
            });
          }}
          className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${actionButtonClasses(action.target)}`}
        >
          {action.label}
        </button>
      ))}

      {order.type === 'delivery' &&
        order.status === 'IN_PREPARATION' &&
        !order.delivery_team_notified_at &&
        deliveryEnabled &&
        !activeAssignedOrders.has(order.id) && (
          <button
            type="button"
            disabled={notifyTeamMutation.isPending}
            onClick={() => notifyTeamMutation.mutate(order.id)}
            className="rounded-lg border border-cyan-300 bg-cyan-100/80 px-2.5 py-1 text-xs font-bold text-cyan-900 hover:bg-cyan-100 disabled:opacity-60"
          >
            {notifyTeamMutation.isPending ? 'جارٍ التبليغ...' : 'تبليغ فريق التوصيل'}
          </button>
        )}

      {order.type === 'delivery' &&
        !deliveryEnabled &&
        (order.status === 'IN_PREPARATION' || order.status === 'READY' || order.status === 'OUT_FOR_DELIVERY') && (
          <button
            type="button"
            disabled={emergencyDeliveryFailMutation.isPending}
            onClick={() => openReasonDialog('emergency_fail', order)}
            className="rounded-lg border border-rose-300 bg-rose-100/80 px-2.5 py-1 text-xs font-bold text-rose-900 hover:bg-rose-100 disabled:opacity-60"
          >
            {emergencyDeliveryFailMutation.isPending ? 'جارٍ الإغلاق...' : 'إغلاق طارئ (فشل توصيل)'}
          </button>
        )}

      {order.type === 'delivery' && order.status === 'IN_PREPARATION' && !deliveryEnabled && (
        <span className="rounded-lg border border-rose-300 bg-rose-100/80 px-2.5 py-1 text-xs font-bold text-rose-900">
          نظام التوصيل مغلق
        </span>
      )}

      {order.status === 'CONFIRMED' && !kitchenEnabled && (
        <span className="rounded-lg border border-rose-300 bg-rose-100/80 px-2.5 py-1 text-xs font-bold text-rose-900">
          نظام المطبخ مغلق
        </span>
      )}

      {order.type === 'delivery' && order.status === 'IN_PREPARATION' && activeAssignedOrders.has(order.id) && (
        <span className="rounded-lg border border-emerald-300 bg-emerald-100/80 px-2.5 py-1 text-xs font-bold text-emerald-900">
          تم التقاط الطلب
        </span>
      )}

      {order.type === 'delivery' && order.status === 'IN_PREPARATION' && order.delivery_team_notified_at && (
        <span className="rounded-lg border border-cyan-300 bg-cyan-100/80 px-2.5 py-1 text-xs font-bold text-cyan-900">
          تم تبليغ الفريق
        </span>
      )}

      {order.status === 'READY' && order.type === 'takeaway' && (
        <label className="flex items-center gap-1">
          <span className="text-[11px] font-bold text-[#6f5a46]">المبلغ المستلم</span>
          <input
            type="number"
            min={order.total}
            step="0.1"
            value={amountReceived[order.id] ?? order.total}
            onChange={(event) => setAmountReceived((prev) => ({ ...prev, [order.id]: Number(event.target.value) }))}
            className="form-input ui-size-sm w-28"
          />
        </label>
      )}

      {order.status === 'READY' && order.type === 'takeaway' && (
        <button
          type="button"
          disabled={transitionMutation.isPending}
          onClick={() =>
            transitionMutation.mutate({
              orderId: order.id,
              targetStatus: 'DELIVERED',
              collectPayment: false,
            })
          }
          className="rounded-lg border border-stone-300 bg-stone-100/80 px-2.5 py-1 text-xs font-bold text-stone-800 hover:bg-stone-100 disabled:opacity-60"
        >
          تسليم بدون تحصيل
        </button>
      )}

      {order.status === 'DELIVERED' && order.type !== 'dine-in' && order.payment_status !== 'paid' && (
        <>
          <label className="flex items-center gap-1">
            <span className="text-[11px] font-bold text-[#6f5a46]">تحصيل لاحق</span>
            <input
              type="number"
              min={order.total}
              step="0.1"
              value={amountReceived[order.id] ?? order.total}
              onChange={(event) => setAmountReceived((prev) => ({ ...prev, [order.id]: Number(event.target.value) }))}
              className="form-input ui-size-sm w-28"
            />
          </label>
          <button
            type="button"
            disabled={collectPaymentMutation.isPending}
            onClick={() =>
              collectPaymentMutation.mutate({
                orderId: order.id,
                amount: amountReceived[order.id] ?? order.total,
              })
            }
            className="rounded-lg border border-emerald-300 bg-emerald-100/80 px-2.5 py-1 text-xs font-bold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
          >
            {collectPaymentMutation.isPending ? 'جارٍ التحصيل...' : 'تحصيل الآن'}
          </button>
        </>
      )}
    </>
  );

  if (ordersQuery.isLoading) {
    return <div className="rounded-2xl border border-[#d3c0a2] bg-[#fff8ec] p-5 text-sm text-[#6f5a46]">جارٍ تحميل الطلبات...</div>;
  }

  if (ordersQuery.isError) {
    return <div className="rounded-2xl border border-rose-300 bg-rose-100/80 p-5 text-sm text-rose-900">تعذر تحميل الطلبات.</div>;
  }

  return (
    <div className="admin-page orders-modern-surface">
      {!kitchenEnabled && (
        <div className="rounded-2xl border border-rose-300 bg-rose-100/80 px-4 py-3 text-sm font-semibold text-rose-900">
          {kitchenBlockedReason}
        </div>
      )}
      {!deliveryEnabled && (
        <div className="rounded-2xl border border-amber-300 bg-amber-100/80 px-4 py-3 text-sm font-semibold text-amber-900">
          {deliveryBlockedReason}
        </div>
      )}

      <div className="rounded-2xl border border-[#d5c3a6] bg-[#f8efdf] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
        <div className="grid gap-2 xl:grid-cols-[minmax(240px,1.4fr)_minmax(170px,0.85fr)_minmax(130px,0.65fr)_minmax(170px,0.9fr)_minmax(170px,0.9fr)_minmax(140px,0.75fr)_minmax(150px,0.75fr)]">
          <label>
            <span className="form-label">حقل البحث</span>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="بحث في الطلبات..."
              className="form-input"
            />
          </label>

          <label>
            <span className="form-label">الترتيب حسب</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="form-select"
            >
              <option value="created_at">ترتيب: الوقت</option>
              <option value="status">ترتيب: الحالة</option>
              <option value="total">ترتيب: المبلغ</option>
              <option value="id">ترتيب: الرقم</option>
            </select>
          </label>

          <div>
            <span className="form-label">اتجاه الترتيب</span>
            <button
              type="button"
              onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
              className="btn-secondary w-full"
            >
              {sortDirection === 'asc' ? 'تصاعدي' : 'تنازلي'}
            </button>
          </div>

          <label>
            <span className="form-label">تصفية حسب الحالة</span>
            <select
              value={statusFilter}
              onChange={(event) => syncFilterParam('status', event.target.value)}
              className="form-select"
            >
              <option value="all">كل الحالات</option>
              <option value="CREATED">تم الإنشاء</option>
              <option value="CONFIRMED">تم التأكيد</option>
              <option value="SENT_TO_KITCHEN">أُرسل للمطبخ</option>
              <option value="IN_PREPARATION">قيد التحضير</option>
              <option value="READY">جاهز</option>
              <option value="OUT_FOR_DELIVERY">خرج للتوصيل</option>
              <option value="DELIVERED">تم التسليم</option>
              <option value="DELIVERY_FAILED">فشل التوصيل</option>
              <option value="CANCELED">ملغى</option>
            </select>
          </label>

          <label>
            <span className="form-label">تصفية حسب النوع</span>
            <select
              value={typeFilter}
              onChange={(event) => syncFilterParam('order_type', event.target.value)}
              className="form-select"
            >
              <option value="all">كل الأنواع</option>
              <option value="dine-in">داخل المطعم</option>
              <option value="takeaway">استلام</option>
              <option value="delivery">توصيل</option>
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.delete('status');
                nextParams.delete('order_type');
                setSearchParams(nextParams, { replace: true });
              }}
            >
              مسح الفلاتر
            </button>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={openManualModal}
              className="btn-primary w-full"
            >
              إنشاء طلب جديد
            </button>
          </div>
        </div>
      </div>

      <section className="admin-table-shell orders-table-modern shadow-[0_12px_32px_rgba(66,45,24,0.10)]">
        {transitionMutation.isError ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {transitionMutation.error instanceof Error
              ? transitionMutation.error.message
              : 'تعذر تنفيذ الإجراء على الطلب. تحقق من حالة الطلب ثم أعد المحاولة.'}
          </div>
        ) : null}
        {notifyTeamMutation.isError ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
            {notifyTeamMutation.error instanceof Error ? notifyTeamMutation.error.message : 'تعذر تبليغ فريق التوصيل.'}
          </div>
        ) : null}
        {emergencyDeliveryFailMutation.isError ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {emergencyDeliveryFailMutation.error instanceof Error
              ? emergencyDeliveryFailMutation.error.message
              : 'تعذر تنفيذ الإغلاق الطارئ لطلب التوصيل.'}
          </div>
        ) : null}
        {collectPaymentMutation.isError ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {collectPaymentMutation.error instanceof Error ? collectPaymentMutation.error.message : 'تعذر تسجيل التحصيل.'}
          </div>
        ) : null}

        <div className="space-y-3 p-3 md:hidden">
          {rows.map((order) => {
            const dayKey = orderDateKey(order.created_at);
            return (
              <article key={order.id} className="rounded-2xl border border-[#dac7ab] bg-[#fffaf2] p-3 shadow-[0_8px_22px_rgba(66,45,24,0.08)]">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-gray-900">{formatOrderTrackingId(order.id)}</p>
                    <p className="text-[11px] font-medium text-gray-500">
                      {dayKey} - {timeOnlyFormatter.format(new Date(parseApiDateMs(order.created_at)))}
                    </p>
                  </div>
                  <StatusBadge status={order.status} />
                </div>

                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${orderTypeClasses(order.type)}`}>
                    {orderTypeLabel(order.type)}
                  </span>
                  <span className="text-sm font-black text-[#8f5126]">{order.total.toFixed(2)} د.ج</span>
                </div>

                <div className="space-y-1 text-xs text-gray-600">
                  <p className="font-bold text-gray-700">تفاصيل الطلب</p>
                  {order.items.map((item) => (
                    <p key={item.id} className="font-semibold text-gray-700">
                      {item.product_name} x {item.quantity}
                    </p>
                  ))}
                  {order.notes ? <p>ملاحظة: {order.notes}</p> : null}
                  <p>البيانات: {order.table_id ? `طاولة ${order.table_id}` : order.phone ?? '-'}</p>
                  {order.type === 'delivery' ? <p>العنوان: {order.address ?? '-'}</p> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">{renderOrderActions(order)}</div>
              </article>
            );
          })}
          {rows.length === 0 && <div className="rounded-xl border border-[#d6c2a5] bg-[#fffaf2] px-4 py-10 text-center text-[#7a6450]">لا توجد نتائج.</div>}
        </div>

        <div className="adaptive-table orders-table-scroll hidden overflow-x-auto md:block">
          <table className="table-unified orders-table-modern-grid min-w-full border-collapse text-sm">
            <thead className="bg-[#efe2cd] text-[#654b36]">
              <tr>
                <th className="px-4 py-3 font-bold">رقم الطلب</th>
                <th className="px-4 py-3 font-bold">النوع</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
                <th className="px-4 py-3 font-bold">المبلغ</th>
                <th className="px-4 py-3 font-bold">تفاصيل الطلب</th>
                <th className="px-4 py-3 font-bold">البيانات</th>
                <th className="px-4 py-3 font-bold">العنوان</th>
                <th className="px-4 py-3 font-bold">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => {
                const dayKey = orderDateKey(order.created_at);
                return (
                  <tr key={order.id} className="align-top transition-colors hover:bg-[#fff5e5]">
                    <td data-label="رقم الطلب" className={`${rowCellBase} font-bold`}>
                      <p className="text-[#3f2f24]">{formatOrderTrackingId(order.id)}</p>
                      <p className="text-xs font-medium text-[#7b6551]">{dayKey}</p>
                      <p className="text-xs font-medium text-[#7b6551]">{timeOnlyFormatter.format(new Date(parseApiDateMs(order.created_at)))}</p>
                    </td>
                    <td data-label="النوع" className={rowCellBase}>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${orderTypeClasses(order.type)}`}>
                        {orderTypeLabel(order.type)}
                      </span>
                    </td>
                    <td data-label="الحالة" className={rowCellBase}>
                      <StatusBadge status={order.status} />
                    </td>
                    <td data-label="المبلغ" className={`${rowCellBase} font-bold text-[#8f5126]`}>{order.total.toFixed(2)} د.ج</td>
                    <td data-label="تفاصيل الطلب" className={rowCellBase}>
                      <div className="min-w-[230px] space-y-1">
                        {order.items.map((item) => (
                          <p key={item.id} className="text-xs font-semibold text-[#5d4737]">
                            {item.product_name} x {item.quantity}
                          </p>
                        ))}
                        {order.notes ? <p className="text-xs text-[#7b6551]">ملاحظة: {order.notes}</p> : null}
                      </div>
                    </td>
                    <td data-label="البيانات" className={`${rowCellBase} text-xs text-[#7b6551]`}>
                      {order.table_id ? `طاولة ${order.table_id}` : order.phone ?? '-'}
                    </td>
                    <td data-label="العنوان" className={`${rowCellBase} text-xs text-[#7b6551]`}>
                      {order.type === 'delivery' ? order.address ?? '-' : '-'}
                    </td>
                    <td data-label="الإجراءات" className={rowCellBase}>
                      <div className="flex flex-wrap items-center gap-2">{renderOrderActions(order)}</div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[#7a6450]">
                    لا توجد نتائج.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination page={page} totalPages={totalPages} totalRows={totalRows} onPageChange={setPage} />
      </section>

      <Modal
        open={isManualModalOpen}
        onClose={closeManualModal}
        title="إنشاء طلب جديد"
        description="أدخل بيانات الطلب الجديد حسب نوع الطلب مع تطبيق قواعد التشغيل المعتمدة."
      >
        <form className="space-y-4" onSubmit={submitManualOrder}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="form-label">نوع الطلب</span>
              <select
                value={manualType}
                onChange={(event) => {
                  const nextType = event.target.value as OrderType;
                  setManualType(nextType);
                  if (nextType !== 'dine-in') {
                    setManualTableId('');
                  }
                  if (nextType !== 'delivery') {
                    setManualAddress('');
                  }
                }}
                className="form-select"
              >
                <option value="takeaway">استلام</option>
                <option value="delivery" disabled={!deliveryEnabled}>
                  توصيل
                </option>
                <option value="dine-in">طلب طاولة</option>
              </select>
              {!deliveryEnabled ? <p className="text-xs font-semibold text-amber-700">{deliveryBlockedReason}</p> : null}
            </label>

            {manualType === 'dine-in' ? (
              <label className="space-y-1">
                <span className="form-label">رقم الطاولة</span>
                <select
                  value={manualTableId}
                  onChange={(event) => setManualTableId(event.target.value ? Number(event.target.value) : '')}
                  className="form-select"
                  required
                >
                  <option value="">اختر الطاولة</option>
                  {tableOptions.map((table) => (
                    <option key={table.id} value={table.id}>
                      طاولة {table.id} ({tableStatusLabel(table.status)})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="space-y-1">
                <span className="form-label">رقم الهاتف</span>
                <input
                  value={manualPhone}
                  onChange={(event) => setManualPhone(event.target.value)}
                  className="form-input"
                  placeholder={manualType === 'takeaway' ? 'اختياري لطلبات الاستلام (مثال: 0550123456)' : 'مطلوب لطلبات التوصيل (مثال: 0550123456)'}
                  required={manualType === 'delivery'}
                />
              </label>
            )}

            {manualType === 'delivery' && (
              <label className="space-y-1 md:col-span-2">
                <span className="form-label">عنوان التوصيل</span>
                <input
                  value={manualAddress}
                  onChange={(event) => setManualAddress(event.target.value)}
                  className="form-input"
                  placeholder="الحي، الشارع، أقرب نقطة دالة"
                  required
                />
              </label>
            )}

            <label className="space-y-1 md:col-span-2">
              <span className="form-label">ملاحظات الطلب (اختياري)</span>
              <textarea
                value={manualNotes}
                onChange={(event) => setManualNotes(event.target.value)}
                className="form-textarea min-h-[80px]"
                placeholder="أي تعليمات تشغيلية إضافية تخص هذا الطلب"
              />
            </label>
          </div>

          <div className="rounded-2xl border border-brand-100 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-black text-gray-800">عناصر الطلب</p>
              <button
                type="button"
                onClick={() => setManualItems((prev) => [...prev, { product_id: 0, quantity: 1 }])}
                className="btn-secondary ui-size-sm"
              >
                إضافة عنصر
              </button>
            </div>

            <div className="mb-1 hidden gap-2 text-xs font-bold text-gray-500 md:grid md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_88px]">
              <span className="text-right">المنتج</span>
              <span className="text-right">الكمية</span>
              <span className="text-right">الإجراءات</span>
            </div>

            <div className="space-y-2">
              {manualItems.map((item, index) => (
                <div
                  key={`${index}-${item.product_id}-${item.quantity}`}
                  className="grid gap-2 md:items-end md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_88px]"
                >
                  <label className="space-y-1">
                    <span className="form-label md:hidden">المنتج</span>
                    <select
                      aria-label="اختيار المنتج"
                      value={item.product_id}
                      onChange={(event) => {
                        const nextProductId = Number(event.target.value);
                        setManualItems((prev) =>
                          prev.map((current, i) => (i === index ? { ...current, product_id: nextProductId } : current))
                        );
                      }}
                      className="form-select"
                    >
                      <option value={0}>اختر المنتج من القائمة</option>
                      {availableManualProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} - {product.price.toFixed(2)} د.ج
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="form-label md:hidden">الكمية</span>
                    <input
                      type="number"
                      aria-label="كمية العنصر"
                      min={1}
                      step={1}
                      value={item.quantity}
                      onChange={(event) => {
                        const nextQuantity = Number(event.target.value);
                        setManualItems((prev) =>
                          prev.map((current, i) => (i === index ? { ...current, quantity: Number.isFinite(nextQuantity) ? nextQuantity : 1 } : current))
                        );
                      }}
                      className="form-input"
                      placeholder="مثال: 2"
                    />
                  </label>

                  <div className="space-y-1 text-right">
                    <span className="form-label md:hidden">الإجراءات</span>
                    <button
                      type="button"
                      onClick={() =>
                        setManualItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
                      }
                      className="btn-danger ui-size-sm w-full"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-black text-brand-700">
            إجمالي الطلب: {manualTotal.toFixed(2)} د.ج
          </div>

          {manualError ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{manualError}</p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={manualCreateMutation.isPending}
              className="btn-primary"
            >
              {manualCreateMutation.isPending ? 'جارٍ إنشاء الطلب...' : 'إنشاء الطلب'}
            </button>
            <button
              type="button"
              onClick={closeManualModal}
              className="btn-secondary"
            >
              إلغاء
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!reasonDialog}
        onClose={resetReasonDialog}
        title={reasonDialog?.mode === 'cancel' ? 'تأكيد إلغاء الطلب' : 'إغلاق طارئ لطلب التوصيل'}
        description={
          reasonDialog?.mode === 'cancel'
            ? 'حدد سببًا معياريًا واضحًا لأن هذا الإجراء يوثق في سجل التدقيق.'
            : 'حدد سببًا معياريًا واضحًا لأن الإغلاق الطارئ يسجل في سجل التدقيق.'
        }
        footer={(
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={resetReasonDialog}>
              إلغاء
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={transitionMutation.isPending || emergencyDeliveryFailMutation.isPending || !reasonCode}
              onClick={submitReasonAction}
            >
              {transitionMutation.isPending || emergencyDeliveryFailMutation.isPending ? 'جارٍ التنفيذ...' : 'تأكيد التنفيذ'}
            </button>
          </div>
        )}
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700">
            الطلب: {reasonDialog ? formatOrderTrackingId(reasonDialog.order.id) : '-'}
          </div>

          <label className="space-y-1">
            <span className="form-label">السبب المعياري</span>
            <select
              className="form-select"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
            >
              {activeReasonOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="form-label">ملاحظة إضافية (اختياري)</span>
            <textarea
              className="form-textarea min-h-[84px]"
              value={reasonNote}
              onChange={(event) => setReasonNote(event.target.value)}
              placeholder="معلومة إضافية قصيرة تدعم سبب الإجراء"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}

