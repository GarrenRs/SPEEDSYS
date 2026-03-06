import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

import { useAuthStore } from '@/modules/auth/store';
import { useManagerAlerts } from '@/app/navigation/ManagerAlertsContext';
import { useManagerNavigation } from '@/app/navigation/ManagerNavigationContext';
import { api } from '@/shared/api/client';
import { parseApiDateMs } from '@/shared/utils/date';
import { formatOrderTrackingId, statusLabel } from '@/shared/utils/order';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';

const SMART_TABLE_PAGE_SIZE = 10;

const SECTION_CARD_THEMES = [
  {
    card: 'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50',
    icon: 'border-slate-700/80 bg-white/95 text-sky-800 shadow-sm',
    kpi: 'border-slate-700/70 bg-white/90',
    cta: 'text-sky-700',
  },
  {
    card: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-lime-50',
    icon: 'border-slate-700/80 bg-white/95 text-emerald-800 shadow-sm',
    kpi: 'border-slate-700/70 bg-white/90',
    cta: 'text-emerald-700',
  },
  {
    card: 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50',
    icon: 'border-slate-700/80 bg-white/95 text-amber-800 shadow-sm',
    kpi: 'border-slate-700/70 bg-white/90',
    cta: 'text-amber-700',
  },
  {
    card: 'border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-pink-50',
    icon: 'border-slate-700/80 bg-white/95 text-fuchsia-800 shadow-sm',
    kpi: 'border-slate-700/70 bg-white/90',
    cta: 'text-fuchsia-700',
  },
  {
    card: 'border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-blue-50',
    icon: 'border-slate-700/80 bg-white/95 text-indigo-800 shadow-sm',
    kpi: 'border-slate-700/70 bg-white/90',
    cta: 'text-indigo-700',
  },
  {
    card: 'border-rose-200 bg-gradient-to-br from-rose-50 via-white to-red-50',
    icon: 'border-slate-700/80 bg-white/95 text-rose-800 shadow-sm',
    kpi: 'border-slate-700/70 bg-white/90',
    cta: 'text-rose-700',
  },
] as const;

function sectionCardTheme(index: number) {
  return SECTION_CARD_THEMES[index % SECTION_CARD_THEMES.length];
}

const KPI_CARD_TONES = [
  { shell: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white', value: 'text-emerald-800' },
  { shell: 'border-sky-200 bg-gradient-to-br from-sky-50 to-white', value: 'text-sky-800' },
  { shell: 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-white', value: 'text-indigo-800' },
  { shell: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white', value: 'text-amber-800' },
  { shell: 'border-rose-200 bg-gradient-to-br from-rose-50 to-white', value: 'text-rose-800' },
] as const;

function asMoney(value: number | undefined): string {
  return `${Number(value ?? 0).toFixed(2)} د.ج`;
}

function resolveSectionKpi(
  route: string,
  snapshot: ReturnType<typeof useManagerAlerts>['operationalHeart'],
  unresolvedCount: number,
  auditBadge: number
): { value: string; label: string } {
  if (!snapshot) {
    return { value: '-', label: 'جارٍ التحميل' };
  }
  switch (route) {
    case '/manager/orders':
      return {
        value: String(snapshot.kpis.active_orders),
        label: 'طلبات نشطة',
      };
    case '/manager/tables':
      return {
        value: String(snapshot.tables_control?.active_sessions ?? 0),
        label: 'جلسات نشطة',
      };
    case '/manager/kitchen-monitor':
      return {
        value: `${snapshot.kpis.avg_prep_minutes_today.toFixed(1)} د`,
        label: 'متوسط التحضير',
      };
    case '/manager/delivery-team':
      return {
        value: String(snapshot.queues.find((row) => row.key === 'out_for_delivery')?.count ?? 0),
        label: 'خارج للتوصيل',
      };
    case '/manager/products':
      return {
        value: String(snapshot.kpis.ready_orders),
        label: 'جاهز للإغلاق',
      };
    case '/manager/warehouse':
      return {
        value: String(snapshot.warehouse_control?.low_stock_items ?? 0),
        label: 'مخزون منخفض',
      };
    case '/manager/financial':
      return {
        value: asMoney(snapshot.kpis.today_net),
        label: 'صافي النقد',
      };
    case '/manager/expenses':
      return {
        value: String(snapshot.expenses_control?.pending_approvals ?? 0),
        label: 'موافقات معلقة',
      };
    case '/manager/reports':
      return {
        value: String((snapshot.reconciliations ?? []).filter((item) => !item.ok).length),
        label: 'فجوات مطابقة',
      };
    case '/manager/users':
      return {
        value: String(snapshot.capabilities.kitchen_active_users + snapshot.capabilities.delivery_active_users),
        label: 'عناصر تشغيل نشطة',
      };
    case '/manager/settings':
      return {
        value: String(
          Number(Boolean(snapshot.capabilities.kitchen_block_reason)) +
            Number(Boolean(snapshot.capabilities.delivery_block_reason))
        ),
        label: 'قيود تشغيل',
      };
    case '/manager/audit-logs':
      return {
        value: String(auditBadge),
        label: 'تنبيهات تدقيق',
      };
    default:
      return {
        value: String(unresolvedCount),
        label: 'تنبيهات مفتوحة',
      };
  }
}

export function DashboardPage() {
  const role = useAuthStore((state) => state.role);
  const { sections, navigateToSection } = useManagerNavigation();
  const { operationalHeart, unresolvedCount, notifications, isLoading, isError } = useManagerAlerts();
  const [showSmartOrders, setShowSmartOrders] = useState(false);

  const smartOrdersQuery = useQuery({
    queryKey: ['manager-dashboard-smart-orders', SMART_TABLE_PAGE_SIZE],
    queryFn: () =>
      api.managerOrdersPaged(role ?? 'manager', {
        page: 1,
        pageSize: SMART_TABLE_PAGE_SIZE,
        sortBy: 'created_at',
        sortDirection: 'desc',
      }),
    enabled: role === 'manager' && showSmartOrders,
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const auditDomainBadge = notifications.find((row) => row.key === 'audit')?.badge ?? 0;

  const sectionCards = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        kpi: resolveSectionKpi(section.to, operationalHeart, unresolvedCount, auditDomainBadge),
      })),
    [auditDomainBadge, operationalHeart, sections, unresolvedCount]
  );

  const coreKpis = useMemo(
    () => [
      { key: 'sales', label: 'إجمالي المبيعات', value: asMoney(operationalHeart?.kpis.today_sales) },
      { key: 'active', label: 'الطلبات النشطة', value: String(operationalHeart?.kpis.active_orders ?? 0) },
      { key: 'net', label: 'صافي النقد', value: asMoney(operationalHeart?.kpis.today_net) },
      { key: 'stock', label: 'مخزون منخفض', value: String(operationalHeart?.warehouse_control?.low_stock_items ?? 0) },
      { key: 'alerts', label: 'تنبيهات غير معالجة', value: String(unresolvedCount) },
    ],
    [operationalHeart?.kpis.active_orders, operationalHeart?.kpis.today_net, operationalHeart?.kpis.today_sales, operationalHeart?.warehouse_control?.low_stock_items, unresolvedCount]
  );

  const smartOrders = smartOrdersQuery.data?.items ?? [];

  return (
    <div className="admin-page space-y-4">
      <section className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 shadow-sm md:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-black text-slate-50 sm:text-lg">الأقسام التشغيلية</h3>
          <span className="text-xs font-semibold text-slate-300">نفس ترتيب النظام التشغيلي المعتمد</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sectionCards.map((section, index) => {
            const theme = sectionCardTheme(index);
            const Icon = section.icon;
            return (
              <button
                key={section.to}
                type="button"
                onClick={() => navigateToSection(section.to)}
                className={`group rounded-2xl border p-4 text-right ring-1 ring-black/5 transition hover:shadow-md ${theme.card}`}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-3">
                  <div className="min-w-0 flex min-h-[6.5rem] flex-col">
                    <p className="text-sm font-black text-gray-900">{section.label}</p>
                    <p className="mt-1 text-xs text-gray-500">{section.description}</p>
                    <div className={`mt-auto flex items-center justify-between rounded-xl border px-3 py-2 ${theme.kpi}`}>
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold text-gray-500">{section.kpi.label}</p>
                        <p className="truncate text-sm font-black text-gray-900">{section.kpi.value}</p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-black ${theme.cta}`}>
                        فتح القسم
                        <ExternalLink className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </div>
                  <span className={`inline-flex h-full min-h-[6.5rem] w-20 items-center justify-center rounded-2xl border sm:w-24 ${theme.icon}`}>
                    <Icon className="h-10 w-10 sm:h-12 sm:w-12" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 md:p-5">
        <h3 className="text-base font-black text-gray-900 sm:text-lg">KPI Core Strip</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {coreKpis.map((kpi, index) => {
            const tone = KPI_CARD_TONES[index % KPI_CARD_TONES.length];
            return (
            <article key={kpi.key} className={`rounded-xl border px-3 py-3 ${tone.shell}`}>
              <p className="text-xs font-bold text-gray-600">{kpi.label}</p>
              <p className={`mt-1 text-2xl font-black ${tone.value}`}>{kpi.value}</p>
            </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-black text-gray-900 sm:text-lg">Smart Orders Table</h3>
          <button
            type="button"
            onClick={() => setShowSmartOrders((current) => !current)}
            className="btn-secondary ui-size-sm !h-11 !px-3"
            aria-expanded={showSmartOrders}
          >
            {showSmartOrders ? (
              <>
                <ChevronUp className="h-4 w-4" />
                <span>إخفاء الجدول</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                <span>إظهار أحدث الطلبات</span>
              </>
            )}
          </button>
        </div>

        {showSmartOrders ? (
          <div className="adaptive-table mt-3 overflow-hidden rounded-2xl border border-brand-100">
            <div className="max-h-[380px] overflow-auto">
              <table className="table-unified min-w-full text-sm">
                <thead className="bg-brand-50 text-gray-700">
                  <tr>
                    <th className="px-4 py-3 font-bold">الطلب</th>
                    <th className="px-4 py-3 font-bold">النوع</th>
                    <th className="px-4 py-3 font-bold">الحالة</th>
                    <th className="px-4 py-3 font-bold">الإجمالي</th>
                    <th className="px-4 py-3 font-bold">الوقت</th>
                    <th className="px-4 py-3 font-bold">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {smartOrdersQuery.isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                        جارٍ تحميل أحدث الطلبات...
                      </td>
                    </tr>
                  ) : smartOrdersQuery.isError ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-rose-700">
                        تعذر تحميل بيانات جدول الطلبات الذكي.
                      </td>
                    </tr>
                  ) : smartOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                        لا توجد طلبات ضمن النطاق الحالي.
                      </td>
                    </tr>
                  ) : (
                    smartOrders.map((order) => (
                      <tr key={order.id}>
                        <td data-label="الطلب" className="px-4 py-3 font-black text-gray-900">
                          {formatOrderTrackingId(order.id)}
                        </td>
                        <td data-label="النوع" className="px-4 py-3">
                          {order.type}
                        </td>
                        <td data-label="الحالة" className="px-4 py-3">
                          {statusLabel[order.status]}
                        </td>
                        <td data-label="الإجمالي" className="px-4 py-3">
                          {asMoney(order.total)}
                        </td>
                        <td data-label="الوقت" className="px-4 py-3 text-xs text-gray-600">
                          {new Date(parseApiDateMs(order.created_at)).toLocaleString('ar-DZ-u-nu-latn')}
                        </td>
                        <td data-label="إجراء" className="px-4 py-3">
                          <Link to={`/manager/orders?status=${order.status}`} className="btn-secondary ui-size-sm w-full sm:w-auto">
                            فتح المسار
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {isError ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          تعذر تحميل البيانات الحية للوحة التشغيل. يمكنك متابعة الأقسام يدويًا عبر بطاقات التنقل أعلاه.
        </section>
      ) : null}

      {isLoading ? (
        <section className="rounded-2xl border border-brand-100 bg-white px-4 py-3 text-sm font-semibold text-gray-600">
          جارٍ مزامنة مؤشرات النظام الحية...
        </section>
      ) : null}
    </div>
  );
}
