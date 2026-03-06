import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { formatOrderTrackingId, orderTypeLabel } from '@/shared/utils/order';
import { parseApiDateMs } from '@/shared/utils/date';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';

const assignmentStatusLabel: Record<string, string> = {
  assigned: 'تم الالتقاط',
  departed: 'خرج للتوصيل',
  delivered: 'تم التسليم',
  failed: 'فشل التسليم',
};

export function DeliveryPanelPage() {
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();

  const ordersQuery = useQuery({
    queryKey: ['delivery-orders'],
    queryFn: () => api.deliveryOrders(role ?? 'delivery'),
    enabled: role === 'delivery',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const assignmentsQuery = useQuery({
    queryKey: ['delivery-assignments'],
    queryFn: () => api.deliveryAssignments(role ?? 'delivery'),
    enabled: role === 'delivery',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const historyQuery = useQuery({
    queryKey: ['delivery-history'],
    queryFn: () => api.deliveryHistory(role ?? 'delivery'),
    enabled: role === 'delivery',
    refetchInterval: adaptiveRefetchInterval(4000),
  });

  const invalidateDeliveryViews = (options?: { includeHistory?: boolean; includeDashboard?: boolean; includeFinancial?: boolean }) => {
    const keys = ['delivery-orders', 'delivery-assignments', 'manager-orders-paged', 'manager-orders-delivery'];
    for (const key of keys) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    if (options?.includeHistory) {
      queryClient.invalidateQueries({ queryKey: ['delivery-history'] });
    }
    if (options?.includeDashboard) {
      queryClient.invalidateQueries({ queryKey: ['manager-dashboard-operational-heart'] });
      queryClient.invalidateQueries({ queryKey: ['manager-dashboard-smart-orders'] });
    }
    if (options?.includeFinancial) {
      queryClient.invalidateQueries({ queryKey: ['manager-financial'] });
    }
  };

  const claimMutation = useMutation({
    mutationFn: (orderId: number) => api.deliveryClaim(role ?? 'delivery', orderId),
    onSuccess: () => invalidateDeliveryViews(),
  });

  const departMutation = useMutation({
    mutationFn: (orderId: number) => api.deliveryDepart(role ?? 'delivery', orderId),
    onSuccess: () => invalidateDeliveryViews({ includeDashboard: true }),
  });

  const deliveredMutation = useMutation({
    mutationFn: (orderId: number) => api.deliveryDelivered(role ?? 'delivery', orderId),
    onSuccess: () => invalidateDeliveryViews({ includeHistory: true, includeDashboard: true, includeFinancial: true }),
  });

  const failedMutation = useMutation({
    mutationFn: (orderId: number) => api.deliveryFailed(role ?? 'delivery', orderId),
    onSuccess: () => invalidateDeliveryViews({ includeHistory: true, includeDashboard: true }),
  });

  const myAssignmentByOrder = useMemo(() => {
    const map = new Map<number, { status: string; assigned_at: string }>();
    for (const assignment of assignmentsQuery.data ?? []) {
      const prev = map.get(assignment.order_id);
      if (!prev || parseApiDateMs(assignment.assigned_at) > parseApiDateMs(prev.assigned_at)) {
        map.set(assignment.order_id, {
          status: assignment.status,
          assigned_at: assignment.assigned_at,
        });
      }
    }
    return map;
  }, [assignmentsQuery.data]);

  if (ordersQuery.isLoading || assignmentsQuery.isLoading || historyQuery.isLoading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل طلبات التوصيل...</div>;
  }
  if (ordersQuery.isError || assignmentsQuery.isError || historyQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل بيانات التوصيل.</div>;
  }

  const orders = ordersQuery.data ?? [];
  const historyRows = historyQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-gray-900">لوحة عنصر التوصيل</h2>
        <p className="text-sm text-gray-500">رسوم التوصيل تُدار مركزيًا من لوحة المدير وتظهر هنا للعرض فقط.</p>
      </div>

      {(claimMutation.isError || departMutation.isError || deliveredMutation.isError || failedMutation.isError) && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {(claimMutation.error as Error)?.message ||
            (departMutation.error as Error)?.message ||
            (deliveredMutation.error as Error)?.message ||
            (failedMutation.error as Error)?.message ||
            'تعذر تنفيذ الإجراء.'}
        </div>
      )}

      <section className="grid gap-3">
        {orders.map((order) => {
          const myAssignment = myAssignmentByOrder.get(order.id);
          const canClaim = order.status === 'IN_PREPARATION' && !myAssignment;
          const claimedByMeInPrep = order.status === 'IN_PREPARATION' && myAssignment?.status === 'assigned';
          const canDepart = order.status === 'READY' && myAssignment?.status === 'assigned';
          const canComplete = order.status === 'OUT_FOR_DELIVERY' && myAssignment?.status === 'departed';

          return (
            <article key={order.id} className="rounded-2xl border border-brand-100 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-lg font-black text-gray-900">طلب {formatOrderTrackingId(order.id)}</p>
                <StatusBadge status={order.status} />
              </div>
              <p className="mt-1 text-sm text-gray-600">{orderTypeLabel(order.type)}</p>
              <p className="text-sm text-gray-600">الهاتف: {order.phone ?? '-'}</p>
              <p className="text-sm text-gray-600">العنوان: {order.address ?? '-'}</p>

              <div className="mt-2 grid gap-1 rounded-xl bg-brand-50 p-3 text-sm">
                <p className="font-semibold text-gray-700">قيمة الطلب: {order.subtotal.toFixed(2)} د.ج</p>
                <p className="font-semibold text-gray-700">رسوم التوصيل: {order.delivery_fee.toFixed(2)} د.ج</p>
                <p className="font-black text-brand-700">الإجمالي: {order.total.toFixed(2)} د.ج</p>
              </div>

              {canClaim && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => claimMutation.mutate(order.id)}
                    disabled={claimMutation.isPending}
                    className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                  >
                    {claimMutation.isPending ? 'جارٍ التأكيد...' : 'تأكيد جاهزيتي'}
                  </button>
                </div>
              )}

              {claimedByMeInPrep && (
                <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">
                  تم تأكيد جاهزيتك لهذا الطلب. بانتظار انتقاله إلى حالة الجاهزية.
                </p>
              )}

              {canDepart && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => departMutation.mutate(order.id)}
                    disabled={departMutation.isPending}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
                  >
                    {departMutation.isPending ? 'جارٍ البدء...' : 'بدء التوصيل'}
                  </button>
                </div>
              )}

              {canComplete && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => deliveredMutation.mutate(order.id)}
                    disabled={deliveredMutation.isPending}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {deliveredMutation.isPending ? 'جارٍ الحفظ...' : 'تم التوصيل'}
                  </button>
                  <button
                    type="button"
                    onClick={() => failedMutation.mutate(order.id)}
                    disabled={failedMutation.isPending}
                    className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    {failedMutation.isPending ? 'جارٍ الحفظ...' : 'فشل'}
                  </button>
                </div>
              )}
            </article>
          );
        })}

        {orders.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            لا توجد طلبات توصيل متاحة حاليًا.
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-brand-100 bg-white">
        <div className="border-b border-brand-100 px-4 py-3">
          <h3 className="text-base font-black text-gray-800">سجل عملياتي</h3>
          <p className="text-xs text-gray-500">كل الطلبات التي قمت بإنهائها (تسليم/فشل).</p>
        </div>
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">الطلب</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
                <th className="px-4 py-3 font-bold">قيمة الطلب</th>
                <th className="px-4 py-3 font-bold">رسوم التوصيل</th>
                <th className="px-4 py-3 font-bold">الإجمالي</th>
                <th className="px-4 py-3 font-bold">العنوان</th>
                <th className="px-4 py-3 font-bold">وقت الإنهاء</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => (
                <tr key={row.assignment_id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-bold">{formatOrderTrackingId(row.order_id)}</td>
                  <td className="px-4 py-3 text-xs">
                    {assignmentStatusLabel[row.assignment_status] ?? row.assignment_status}
                  </td>
                  <td className="px-4 py-3 font-semibold">{row.order_subtotal.toFixed(2)} د.ج</td>
                  <td className="px-4 py-3 font-semibold">{row.delivery_fee.toFixed(2)} د.ج</td>
                  <td className="px-4 py-3 font-black text-brand-700">{row.order_total.toFixed(2)} د.ج</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{row.address ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{row.delivered_at ? new Date(parseApiDateMs(row.delivered_at)).toLocaleString('ar-DZ-u-nu-latn') : '-'}</td>
                </tr>
              ))}
              {historyRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    لا يوجد سجل عمليات حتى الآن.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}


