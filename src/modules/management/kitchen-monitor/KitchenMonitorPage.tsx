import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';
import { formatOrderTrackingId, orderTypeLabel } from '@/shared/utils/order';
import { parseApiDateMs } from '@/shared/utils/date';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';

const PAGE_SIZE = 10;

type MonitorSort = 'created_at' | 'total' | 'status' | 'id';

type KitchenSlaTone = 'healthy' | 'warning' | 'critical';

export function KitchenMonitorPage() {
  const role = useAuthStore((state) => state.role);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<MonitorSort>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const fallbackKitchenBlockedReason = 'نظام المطبخ مغلق: لا يوجد مستخدم مطبخ نشط. أضف مستخدم مطبخ من قسم المستخدمين.';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === '1') {
        event.preventDefault();
        navigate('/manager/orders?status=CREATED');
      } else if (key === '2') {
        event.preventDefault();
        navigate('/manager/orders?status=CONFIRMED');
      } else if (key === '3') {
        event.preventDefault();
        navigate('/manager/kitchen-monitor');
      } else if (key === '4') {
        event.preventDefault();
        navigate('/manager/orders?status=READY');
      } else if (key === '5') {
        event.preventDefault();
        navigate('/manager/delivery-team');
      } else if (key === 'n') {
        event.preventDefault();
        navigate('/manager/orders?new=1');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  const ordersQuery = useQuery({
    queryKey: ['manager-kitchen-monitor-paged', page, PAGE_SIZE, search, sortBy, sortDirection],
    queryFn: () =>
      api.managerKitchenOrdersPaged(role ?? 'manager', {
        page,
        pageSize: PAGE_SIZE,
        search,
        sortBy,
        sortDirection,
      }),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const capabilitiesQuery = useQuery({
    queryKey: ['manager-operational-capabilities'],
    queryFn: () => api.managerOperationalCapabilities(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const summary = ordersQuery.data?.summary ?? {
    sent_to_kitchen: 0,
    in_preparation: 0,
    ready: 0,
    oldest_order_wait_seconds: 0,
    avg_prep_minutes_today: 0,
    warehouse_issued_quantity_today: 0,
    warehouse_issue_vouchers_today: 0,
    warehouse_issued_items_today: 0,
  };

  const sla = useMemo(() => {
    const oldestSeconds = summary.oldest_order_wait_seconds;
    const avgPrep = summary.avg_prep_minutes_today;

    if (oldestSeconds >= 20 * 60 || avgPrep >= 22) {
      return {
        tone: 'critical' as KitchenSlaTone,
        title: 'حالة SLA: حرجة',
        text: `أقدم انتظار ${formatElapsed(oldestSeconds)} ومتوسط التحضير ${avgPrep.toFixed(1)} دقيقة`,
        className: 'border-rose-300 bg-rose-50 text-rose-700',
      };
    }

    if (oldestSeconds >= 12 * 60 || avgPrep >= 15) {
      return {
        tone: 'warning' as KitchenSlaTone,
        title: 'حالة SLA: تحذير',
        text: `أقدم انتظار ${formatElapsed(oldestSeconds)} ومتوسط التحضير ${avgPrep.toFixed(1)} دقيقة`,
        className: 'border-amber-300 bg-amber-50 text-amber-700',
      };
    }

    return {
      tone: 'healthy' as KitchenSlaTone,
      title: 'حالة SLA: مستقرة',
      text: `أقدم انتظار ${formatElapsed(oldestSeconds)} ومتوسط التحضير ${avgPrep.toFixed(1)} دقيقة`,
      className: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    };
  }, [summary.avg_prep_minutes_today, summary.oldest_order_wait_seconds]);

  if (ordersQuery.isLoading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل بيانات المطبخ...</div>;
  }

  if (ordersQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل شاشة مراقبة المطبخ.</div>;
  }

  const payload = ordersQuery.data;
  const rows = payload?.items ?? [];
  const totalRows = payload?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const kitchenEnabled = capabilitiesQuery.data?.kitchen_enabled ?? true;
  const kitchenBlockedReason = capabilitiesQuery.data?.kitchen_block_reason ?? fallbackKitchenBlockedReason;

  return (
    <div className="admin-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">اختصارات: Alt+1..5 و Alt+N</div>
      </div>

      <div className={`rounded-2xl border px-4 py-3 ${sla.className}`}>
        <p className="text-sm font-black">{sla.title}</p>
        <p className="text-xs font-semibold">{sla.text}</p>
      </div>
      {!kitchenEnabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
          {kitchenBlockedReason}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/manager/orders?status=CONFIRMED" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
          إرسال المؤكدة للمطبخ
        </Link>
        <Link to="/manager/orders?status=READY" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
          فتح الطلبات الجاهزة
        </Link>
        <Link to="/manager/orders?status=IN_PREPARATION" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
          قيد التحضير الآن
        </Link>
        <Link to="/manager/delivery-team" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
          متابعة فريق التوصيل
        </Link>
      </div>

      <TableControls
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        sortBy={sortBy}
        onSortByChange={(value) => {
          setSortBy(value as MonitorSort);
          setPage(1);
        }}
        sortDirection={sortDirection}
        onSortDirectionChange={(value) => {
          setSortDirection(value);
          setPage(1);
        }}
        sortOptions={[
          { value: 'created_at', label: 'الترتيب حسب الوقت' },
          { value: 'status', label: 'الترتيب حسب الحالة' },
          { value: 'total', label: 'الترتيب حسب المبلغ' },
          { value: 'id', label: 'الترتيب حسب رقم الطلب' },
        ]}
        searchPlaceholder="ابحث برقم الطلب أو النوع أو الحالة..."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-bold text-amber-700">طلبات جديدة للمطبخ</p>
          <p className="mt-1 text-2xl font-black text-amber-900">{summary.sent_to_kitchen}</p>
        </article>
        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-bold text-amber-700">قيد التحضير</p>
          <p className="mt-1 text-2xl font-black text-amber-900">{summary.in_preparation}</p>
        </article>
        <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-bold text-emerald-700">جاهزة</p>
          <p className="mt-1 text-2xl font-black text-emerald-900">{summary.ready}</p>
        </article>
        <article className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-xs font-bold text-brand-700">أقدم طلب داخل المطبخ</p>
          <p className="mt-1 text-2xl font-black text-brand-900">{formatElapsed(summary.oldest_order_wait_seconds)}</p>
        </article>
        <article className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-xs font-bold text-sky-700">متوسط التحضير اليوم</p>
          <p className="mt-1 text-2xl font-black text-sky-900">{summary.avg_prep_minutes_today.toFixed(1)} د</p>
        </article>
        <article className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <p className="text-xs font-bold text-violet-700">وارد للمطبخ من المخزن اليوم</p>
          <p className="mt-1 text-2xl font-black text-violet-900">{summary.warehouse_issued_quantity_today.toFixed(2)}</p>
        </article>
        <article className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <p className="text-xs font-bold text-violet-700">سندات صرف للمطبخ اليوم</p>
          <p className="mt-1 text-2xl font-black text-violet-900">{summary.warehouse_issue_vouchers_today}</p>
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-brand-100 bg-white">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">طلب</th>
                <th className="px-4 py-3 font-bold">النوع</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
                <th className="px-4 py-3 font-bold">وقت دخول المطبخ</th>
                <th className="px-4 py-3 font-bold">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id} className="border-t border-gray-100">
                  <td data-label="طلب" className="px-4 py-3 font-bold">{formatOrderTrackingId(order.id)}</td>
                  <td data-label="النوع" className="px-4 py-3">{orderTypeLabel(order.type)}</td>
                  <td data-label="الحالة" className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td data-label="وقت دخول المطبخ" className="px-4 py-3 text-xs text-gray-500">
                    {new Date(parseApiDateMs(order.sent_to_kitchen_at ?? order.created_at)).toLocaleString('ar-DZ-u-nu-latn')}
                  </td>
                  <td data-label="المبلغ" className="px-4 py-3 font-bold text-brand-700">{order.total.toFixed(2)} د.ج</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                    لا توجد نتائج.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination page={page} totalPages={totalPages} totalRows={totalRows} onPageChange={setPage} />
      </section>
    </div>
  );
}

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return '0د 00ث';
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}س ${minutes.toString().padStart(2, '0')}د`;
  }
  return `${minutes}د ${seconds.toString().padStart(2, '0')}ث`;
}

