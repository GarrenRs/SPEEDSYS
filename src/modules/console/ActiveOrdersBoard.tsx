import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type { Order, OrderStatus } from '@/shared/api/types';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { parseApiDateMs } from '@/shared/utils/date';
import { formatOrderTrackingId } from '@/shared/utils/order';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';

type ActiveFilter = 'ALL' | 'NEW' | 'CONFIRMED' | 'IN_KITCHEN' | 'READY' | 'OUT_FOR_DELIVERY';

const FILTERS: ActiveFilter[] = ['ALL', 'NEW', 'CONFIRMED', 'IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY'];
const FILTER_LABELS: Record<ActiveFilter, string> = {
  ALL: 'الكل',
  NEW: 'جديد',
  CONFIRMED: 'مؤكد',
  IN_KITCHEN: 'داخل المطبخ',
  READY: 'جاهز',
  OUT_FOR_DELIVERY: 'قيد التوصيل',
};
const ACTIVE_STATUSES: OrderStatus[] = ['CREATED', 'CONFIRMED', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY'];

const FILTER_TO_STATUSES: Record<Exclude<ActiveFilter, 'ALL'>, OrderStatus[]> = {
  NEW: ['CREATED'],
  CONFIRMED: ['CONFIRMED'],
  IN_KITCHEN: ['SENT_TO_KITCHEN', 'IN_PREPARATION'],
  READY: ['READY'],
  OUT_FOR_DELIVERY: ['OUT_FOR_DELIVERY'],
};

function matchesFilter(order: Order, filter: ActiveFilter): boolean {
  if (filter === 'ALL') {
    return ACTIVE_STATUSES.includes(order.status);
  }
  return FILTER_TO_STATUSES[filter].includes(order.status);
}

function resolveDestination(order: Order): string {
  if (order.table_id) {
    return `طاولة ${order.table_id}`;
  }
  if (order.type === 'delivery') {
    if (order.address && order.phone) {
      return `${order.address} (${order.phone})`;
    }
    return order.address ?? order.phone ?? 'توصيل';
  }
  return 'سفري';
}

function summarizeItems(order: Order): string {
  if (order.items.length === 0) {
    return '-';
  }
  return order.items
    .slice(0, 3)
    .map((item) => `${item.product_name} x${item.quantity}`)
    .join('، ');
}

interface ActiveOrdersBoardProps {
  onOpenOrderSection: (status?: OrderStatus) => void;
}

export function ActiveOrdersBoard({ onOpenOrderSection }: ActiveOrdersBoardProps) {
  const role = useAuthStore((state) => state.role);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('ALL');

  const ordersQuery = useQuery({
    queryKey: ['console-active-orders'],
    queryFn: () => api.managerOrders(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000, { minimumMs: 5000 }),
  });

  const rows = useMemo(
    () =>
      (ordersQuery.data ?? [])
        .filter((order) => matchesFilter(order, activeFilter))
        .sort((a, b) => parseApiDateMs(b.created_at) - parseApiDateMs(a.created_at)),
    [activeFilter, ordersQuery.data]
  );

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-300 bg-white shadow-sm">
      <header className="border-b border-slate-300 px-4 py-3">
        <h2 className="text-base font-black text-slate-900">الطلبات النشطة</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setActiveFilter(filter)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-black transition ${
                filter === activeFilter
                  ? 'border-brand-500 bg-brand-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-brand-300 hover:text-brand-700'
              }`}
            >
              {FILTER_LABELS[filter]}
            </button>
          ))}
        </div>
      </header>

      <div className="adaptive-table flex-1 min-h-0 overflow-auto">
        <table className="table-unified min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-4 py-3 font-black">رقم الطلب</th>
              <th className="px-4 py-3 font-black">الطاولة / التوصيل</th>
              <th className="px-4 py-3 font-black">العناصر</th>
              <th className="px-4 py-3 font-black">الحالة</th>
              <th className="px-4 py-3 font-black">الوقت</th>
              <th className="px-4 py-3 font-black">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {ordersQuery.isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                  جارٍ تحميل الطلبات النشطة...
                </td>
              </tr>
            ) : ordersQuery.isError ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-rose-700">
                  تعذر تحميل الطلبات النشطة.
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                  لا توجد طلبات ضمن هذا الفلتر.
                </td>
              </tr>
            ) : (
              rows.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3 font-black text-slate-900">{formatOrderTrackingId(order.id)}</td>
                  <td className="px-4 py-3 text-xs text-slate-700">{resolveDestination(order)}</td>
                  <td className="px-4 py-3 text-xs text-slate-700">{summarizeItems(order)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {new Date(parseApiDateMs(order.created_at)).toLocaleTimeString('ar-DZ-u-nu-latn', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="btn-secondary ui-size-sm w-full sm:w-auto"
                      onClick={() => onOpenOrderSection(order.status)}
                    >
                      فتح
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
