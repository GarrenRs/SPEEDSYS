import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type { Order } from '@/shared/api/types';
import { useDataView } from '@/shared/hooks/useDataView';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';
import { formatOrderTrackingId } from '@/shared/utils/order';
import { parseApiDateMs } from '@/shared/utils/date';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';
import { sanitizeMojibakeText } from '@/shared/utils/textSanitizer';

export function DeliveryTeamPage() {
  const role = useAuthStore((state) => state.role);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const fallbackDeliveryBlockedReason = 'نظام التوصيل مغلق: لا يوجد عنصر توصيل نشط. أضف مستخدم توصيل من قسم المستخدمين.';

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

  const driversQuery = useQuery({
    queryKey: ['manager-drivers'],
    queryFn: () => api.managerDrivers(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const ordersQuery = useQuery({
    queryKey: ['manager-orders-delivery'],
    queryFn: () => api.managerOrders(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const assignmentsQuery = useQuery({
    queryKey: ['delivery-assignments'],
    queryFn: () => api.deliveryAssignments(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const deliverySettingsQuery = useQuery({
    queryKey: ['manager-delivery-settings'],
    queryFn: () => api.managerDeliverySettings(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const capabilitiesQuery = useQuery({
    queryKey: ['manager-operational-capabilities'],
    queryFn: () => api.managerOperationalCapabilities(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(3000),
  });


  const latestAssignmentByOrder = useMemo(() => {
    const map = new Map<number, { driver_id: number; status: string; assigned_at: string }>();
    for (const item of assignmentsQuery.data ?? []) {
      const prev = map.get(item.order_id);
      if (!prev || parseApiDateMs(item.assigned_at) > parseApiDateMs(prev.assigned_at)) {
        map.set(item.order_id, {
          driver_id: item.driver_id,
          status: item.status,
          assigned_at: item.assigned_at,
        });
      }
    }
    return map;
  }, [assignmentsQuery.data]);

  const driverNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const driver of driversQuery.data ?? []) {
      map.set(driver.id, driver.name);
    }
    return map;
  }, [driversQuery.data]);

  const deliveryOrders = useMemo<Order[]>(
    () => (ordersQuery.data ?? []).filter((order) => order.type === 'delivery'),
    [ordersQuery.data]
  );

  const deliveryOpsSummary = useMemo(() => {
    const waitingTeamPickup = deliveryOrders.filter(
      (order) => order.status === 'IN_PREPARATION' && !!order.delivery_team_notified_at && !latestAssignmentByOrder.has(order.id)
    ).length;
    const readyAssigned = deliveryOrders.filter((order) => order.status === 'READY' && latestAssignmentByOrder.get(order.id)?.status === 'assigned').length;
    const outForDelivery = deliveryOrders.filter((order) => order.status === 'OUT_FOR_DELIVERY').length;
    const failedDelivery = deliveryOrders.filter((order) => order.status === 'DELIVERY_FAILED').length;

    if (failedDelivery >= 2 || waitingTeamPickup >= 3) {
      return {
        toneClass: 'border-rose-300 bg-rose-50 text-rose-700',
        title: 'حالة التوصيل: حرجة',
        text: `بانتظار الالتقاط ${waitingTeamPickup} | فشل ${failedDelivery}`,
        waitingTeamPickup,
        readyAssigned,
        outForDelivery,
        failedDelivery,
      };
    }

    if (failedDelivery > 0 || waitingTeamPickup > 0 || readyAssigned > 0) {
      return {
        toneClass: 'border-amber-300 bg-amber-50 text-amber-700',
        title: 'حالة التوصيل: تحتاج متابعة',
        text: `بانتظار الالتقاط ${waitingTeamPickup} | جاهز مع عنصر ${readyAssigned} | خارج للتوصيل ${outForDelivery}`,
        waitingTeamPickup,
        readyAssigned,
        outForDelivery,
        failedDelivery,
      };
    }

    return {
      toneClass: 'border-emerald-300 bg-emerald-50 text-emerald-700',
      title: 'حالة التوصيل: مستقرة',
      text: `خارج للتوصيل ${outForDelivery} | لا توجد اختناقات`,
      waitingTeamPickup,
      readyAssigned,
      outForDelivery,
      failedDelivery,
    };
  }, [deliveryOrders, latestAssignmentByOrder]);

  const view = useDataView<Order>({
    rows: deliveryOrders,
    search,
    page,
    pageSize: 10,
    sortBy,
    sortDirection,
    searchAccessor: (order) => {
      const assignment = latestAssignmentByOrder.get(order.id);
      const driverName = assignment ? driverNameById.get(assignment.driver_id) ?? '' : '';
      return `${order.id} ${formatOrderTrackingId(order.id)} ${order.status} ${order.phone ?? ''} ${order.address ?? ''} ${driverName}`;
    },
    sortAccessors: {
      created_at: (order) => parseApiDateMs(order.created_at),
      id: (order) => order.id,
      status: (order) => order.status,
      total: (order) => order.total,
    },
  });

  if (ordersQuery.isLoading || driversQuery.isLoading || assignmentsQuery.isLoading || deliverySettingsQuery.isLoading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل بيانات التوصيل...</div>;
  }
  if (ordersQuery.isError || driversQuery.isError || assignmentsQuery.isError || deliverySettingsQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل بيانات فريق التوصيل.</div>;
  }

  const deliveryEnabled = capabilitiesQuery.data?.delivery_enabled ?? true;
  const deliveryBlockedReason = sanitizeMojibakeText(
    capabilitiesQuery.data?.delivery_block_reason,
    fallbackDeliveryBlockedReason
  );

  return (
    <div className="admin-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">اختصارات: Alt+1..5 و Alt+N</div>
      </div>

      <div className={`rounded-2xl border px-4 py-3 ${deliveryOpsSummary.toneClass}`}>
        <p className="text-sm font-black">{deliveryOpsSummary.title}</p>
        <p className="text-xs font-semibold">{deliveryOpsSummary.text}</p>
      </div>
      {!deliveryEnabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
          {deliveryBlockedReason}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/manager/orders?status=IN_PREPARATION&order_type=delivery" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
          بانتظار التقاط الفريق
        </Link>
        <Link to="/manager/orders?status=READY&order_type=delivery" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
          جاهز للتوصيل
        </Link>
        <Link to="/manager/orders?status=OUT_FOR_DELIVERY&order_type=delivery" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
          خارج للتوصيل
        </Link>
        <Link to="/manager/orders?status=DELIVERY_FAILED&order_type=delivery" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
          مراجعة فشل التوصيل
        </Link>
      </div>

      <section className="admin-card p-4">
        <div className="mb-4 rounded-xl border border-brand-100 bg-brand-50 p-3">
          <h3 className="text-sm font-black text-gray-700">رسوم التوصيل الثابتة</h3>
          <p className="mt-1 text-xs text-gray-600">قيمة رسوم التوصيل المطبقة على جميع طلبات التوصيل.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-brand-700">الرسم الحالي: {(deliverySettingsQuery.data?.delivery_fee ?? 0).toFixed(2)} د.ج</span>
            <Link to="/manager/settings" className="btn-secondary ui-size-sm">
              تعديل الرسوم
            </Link>
          </div>
        </div>

        <h3 className="mb-3 text-sm font-black text-gray-700">عناصر التوصيل المسجلون</h3>
        <div className="grid gap-2 md:grid-cols-3">
          {(driversQuery.data ?? []).map((driver) => (
            <div key={driver.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <p className="font-bold text-gray-800">{driver.name}</p>
              <p className="text-xs text-gray-600">{driver.phone}</p>
              <p className="text-xs text-gray-600">{driver.vehicle || 'بدون مركبة محددة'}</p>
              <p className="text-xs font-bold text-brand-700">
                الحالة: {driver.status === 'available' ? 'متاح' : driver.status === 'busy' ? 'مشغول' : 'غير نشط'}
              </p>
            </div>
          ))}
          {(driversQuery.data ?? []).length === 0 && (
            <p className="text-sm text-gray-500">لا يوجد عناصر توصيل. أضف مستخدمًا بدور التوصيل من قسم المستخدمين.</p>
          )}
        </div>
      </section>

      <TableControls
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        sortDirection={sortDirection}
        onSortDirectionChange={setSortDirection}
        sortOptions={[
          { value: 'created_at', label: 'ترتيب: الوقت' },
          { value: 'id', label: 'ترتيب: رقم الطلب' },
          { value: 'status', label: 'ترتيب: حالة الطلب' },
          { value: 'total', label: 'ترتيب: المبلغ' },
        ]}
        searchPlaceholder="بحث في سجل التوصيل..."
      />

      <section className="admin-table-shell">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">الطلب</th>
                <th className="px-4 py-3 font-bold">حالة الطلب</th>
                <th className="px-4 py-3 font-bold">العميل</th>
                <th className="px-4 py-3 font-bold">العنوان</th>
                <th className="px-4 py-3 font-bold">المبلغ</th>
                <th className="px-4 py-3 font-bold">العنصر المكلّف</th>
                <th className="px-4 py-3 font-bold">حالة التشغيل</th>
                <th className="px-4 py-3 font-bold">وقت الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((order) => {
                const assignment = latestAssignmentByOrder.get(order.id);
                const driverName = assignment ? driverNameById.get(assignment.driver_id) ?? `#${assignment.driver_id}` : '-';

                const operationStatus = assignment
                  ? assignment.status === 'assigned'
                    ? 'تم الالتقاط'
                    : assignment.status === 'departed'
                    ? 'خرج للتوصيل'
                    : assignment.status === 'delivered'
                    ? 'تم التسليم'
                    : assignment.status === 'failed'
                    ? 'فشل'
                    : '-'
                  : order.status === 'IN_PREPARATION' && order.delivery_team_notified_at
                  ? 'تم تبليغ الفريق (بانتظار الالتقاط)'
                  : '-';

                const operationTime = assignment?.assigned_at ?? order.delivery_team_notified_at ?? null;

                return (
                  <tr key={order.id} className="border-t border-gray-100">
                    <td data-label="الطلب" className="px-4 py-3 font-bold">{formatOrderTrackingId(order.id)}</td>
                    <td data-label="حالة الطلب" className="px-4 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                    <td data-label="العميل" className="px-4 py-3 text-xs">{order.phone ?? '-'}</td>
                    <td data-label="العنوان" className="px-4 py-3 text-xs">{order.address ?? '-'}</td>
                    <td data-label="المبلغ" className="px-4 py-3 font-bold">{order.total.toFixed(2)} د.ج</td>
                    <td data-label="العنصر المكلّف" className="px-4 py-3 text-xs">{driverName}</td>
                    <td data-label="حالة التشغيل" className="px-4 py-3 text-xs">{operationStatus}</td>
                    <td data-label="وقت الإجراء" className="px-4 py-3 text-xs">{operationTime ? new Date(parseApiDateMs(operationTime)).toLocaleString('ar-DZ-u-nu-latn') : '-'}</td>
                  </tr>
                );
              })}
              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                    لا يوجد سجل توصيل.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination page={view.page} totalPages={view.totalPages} totalRows={view.totalRows} onPageChange={setPage} />
      </section>
    </div>
  );
}



