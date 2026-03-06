import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type { OrderStatus } from '@/shared/api/types';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';
import { parseApiDateMs } from '@/shared/utils/date';
import { formatOrderTrackingId, orderTypeLabel } from '@/shared/utils/order';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';

const DEFAULT_KITCHEN_POLLING_MS = 5000;
const KITCHEN_PAGE_SIZE = 24;

type KitchenSort = 'created_at' | 'total' | 'status' | 'id';

const kitchenColumns: Array<{ title: string; status: OrderStatus }> = [
  { title: 'طلبات جديدة للمطبخ', status: 'SENT_TO_KITCHEN' },
  { title: 'قيد التحضير', status: 'IN_PREPARATION' },
  { title: 'جاهزة', status: 'READY' },
];

function normalizePollingMs(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_KITCHEN_POLLING_MS;
  }
  const parsed = Math.trunc(Number(value));
  if (parsed < 3000 || parsed > 60000) {
    return DEFAULT_KITCHEN_POLLING_MS;
  }
  return parsed;
}

export function KitchenBoardPage() {
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<KitchenSort>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const runtimeSettingsQuery = useQuery({
    queryKey: ['kitchen-runtime-settings'],
    queryFn: () => api.kitchenRuntimeSettings(role ?? 'kitchen'),
    enabled: role === 'kitchen',
    refetchInterval: adaptiveRefetchInterval(60_000, { minimumMs: 30_000 }),
  });

  const pollingMs = normalizePollingMs(runtimeSettingsQuery.data?.order_polling_ms);

  const ordersQuery = useQuery({
    queryKey: ['kitchen-orders-paged', page, KITCHEN_PAGE_SIZE, search, sortBy, sortDirection],
    queryFn: () =>
      api.kitchenOrdersPaged(role ?? 'kitchen', {
        page,
        pageSize: KITCHEN_PAGE_SIZE,
        search,
        sortBy,
        sortDirection,
      }),
    enabled: role === 'kitchen',
    refetchInterval: adaptiveRefetchInterval(pollingMs, { minimumMs: 3000 }),
  });

  const invalidateKitchenAndManagerViews = () => {
    const keys = [
      'kitchen-orders-paged',
      'manager-orders-paged',
      'manager-kitchen-monitor-paged',
      'manager-dashboard-operational-heart',
      'manager-dashboard-smart-orders',
    ];
    for (const key of keys) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const startMutation = useMutation({
    mutationFn: (orderId: number) => api.kitchenStartOrder(role ?? 'kitchen', orderId),
    onSuccess: invalidateKitchenAndManagerViews,
  });

  const readyMutation = useMutation({
    mutationFn: (orderId: number) => api.kitchenReadyOrder(role ?? 'kitchen', orderId),
    onSuccess: invalidateKitchenAndManagerViews,
  });

  const grouped = useMemo(() => {
    const orders = ordersQuery.data?.items ?? [];
    return kitchenColumns.map((column) => ({
      ...column,
      orders: orders.filter((order) => order.status === column.status),
    }));
  }, [ordersQuery.data]);

  const totalRows = ordersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / KITCHEN_PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  if (ordersQuery.isLoading && !ordersQuery.data) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-6 text-sm text-gray-500">جارٍ تحميل الطلبات...</div>;
  }

  if (ordersQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">تعذر تحميل بيانات المطبخ.</div>;
  }

  const actionError =
    (startMutation.error as Error | null)?.message ?? (readyMutation.error as Error | null)?.message ?? null;

  return (
    <div className="admin-page">
      <div className="admin-card flex flex-wrap items-start justify-between gap-3 p-4 md:p-5">
        <div className="admin-header">
          <h2 className="admin-title">لوحة المطبخ (Kanban)</h2>
          <p className="admin-subtitle">تحديث تلقائي كل {(pollingMs / 1000).toFixed(0)} ثانية مع تتبع زمني مباشر للطلبات.</p>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">إجمالي طلبات المطبخ: {totalRows}</span>
      </div>

      {actionError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{actionError}</div>
      )}

      <TableControls
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        sortBy={sortBy}
        onSortByChange={(value) => {
          setSortBy(value as KitchenSort);
          setPage(1);
        }}
        sortDirection={sortDirection}
        onSortDirectionChange={(value) => {
          setSortDirection(value);
          setPage(1);
        }}
        sortOptions={[
          { value: 'created_at', label: 'الترتيب حسب وقت الإنشاء' },
          { value: 'status', label: 'الترتيب حسب الحالة' },
          { value: 'total', label: 'الترتيب حسب المبلغ' },
          { value: 'id', label: 'الترتيب حسب رقم الطلب' },
        ]}
        searchPlaceholder="ابحث برقم الطلب أو الحالة أو رقم الهاتف..."
      />

      {runtimeSettingsQuery.isError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-700">
          تعذر تحميل إعداد التحديث المركزي، تم استخدام القيمة الافتراضية.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {grouped.map((column) => (
          <section key={column.status} className="admin-card">
            <header className="flex items-center justify-between border-b border-brand-100 px-4 py-3">
              <h3 className="text-sm font-black text-gray-800">{column.title}</h3>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">{column.orders.length}</span>
            </header>

            <div className="space-y-3 p-3">
              {column.orders.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
                  لا توجد طلبات في هذا العمود
                </div>
              )}

              {column.orders.map((order) => {
                const inRowStartPending = startMutation.isPending && startMutation.variables === order.id;
                const inRowReadyPending = readyMutation.isPending && readyMutation.variables === order.id;

                return (
                  <article key={order.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-base font-black text-gray-900">طلب {formatOrderTrackingId(order.id)}</p>
                      <StatusBadge status={order.status} />
                    </div>

                    <p className="text-xs font-semibold text-gray-600">{orderTypeLabel(order.type)}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {order.table_id
                        ? `طاولة ${order.table_id}`
                        : order.type === 'delivery'
                          ? order.address
                            ? `توصيل: ${order.address}`
                            : 'توصيل'
                          : 'طلب خارجي'}
                    </p>

                    <div className="mt-2 rounded-lg bg-white px-2 py-1 text-xs text-gray-600">
                      {order.items.map((item) => `${item.product_name} x ${item.quantity}`).join('، ')}
                    </div>

                    <p className="mt-2 text-xs font-bold text-brand-700">
                      الوقت المنقضي: {elapsed(now, order.sent_to_kitchen_at ?? order.created_at)}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {order.status === 'SENT_TO_KITCHEN' && (
                        <button
                          type="button"
                          onClick={() => startMutation.mutate(order.id)}
                          disabled={inRowStartPending}
                          className="btn-primary ui-size-sm"
                        >
                          {inRowStartPending ? 'جارٍ البدء...' : 'ابدأ التحضير'}
                        </button>
                      )}

                      {order.status === 'IN_PREPARATION' && (
                        <button
                          type="button"
                          onClick={() => readyMutation.mutate(order.id)}
                          disabled={inRowReadyPending}
                          className="btn-secondary ui-size-sm"
                        >
                          {inRowReadyPending ? 'جارٍ الحفظ...' : 'تم التجهيز'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <section className="admin-card">
        <TablePagination page={page} totalPages={totalPages} totalRows={totalRows} onPageChange={setPage} />
      </section>
    </div>
  );
}

function elapsed(now: number, anchorTime: string): string {
  const anchorMs = parseApiDateMs(anchorTime);
  if (!Number.isFinite(anchorMs)) {
    return '0د 00ث';
  }
  const diff = Math.max(0, Math.floor((now - anchorMs) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}د ${s.toString().padStart(2, '0')}ث`;
}
