import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArrowRight,
  Boxes,
  ClipboardList,
  Clock3,
  LogOut,
  Settings,
  ShieldCheck,
  Truck,
  Wallet,
  X,
} from 'lucide-react';

import { useAuthStore } from '@/modules/auth/store';
import { parseApiDateMs } from '@/shared/utils/date';
import { ManagerAlertsProvider, useManagerAlerts, type AlertDomainKey, type AlertSeverity } from '@/app/navigation/ManagerAlertsContext';
import { ManagerNavigationProvider, useManagerNavigation } from '@/app/navigation/ManagerNavigationContext';

const DOMAIN_ICONS: Record<AlertDomainKey, LucideIcon> = {
  orders: ClipboardList,
  inventory: Boxes,
  financial: Wallet,
  delivery: Truck,
  system: Settings,
  audit: ShieldCheck,
};

function severityBadgeClass(severity: AlertSeverity): string {
  if (severity === 'critical') {
    return 'border-rose-300 bg-rose-50 text-rose-700';
  }
  if (severity === 'warning') {
    return 'border-amber-300 bg-amber-50 text-amber-700';
  }
  return 'border-sky-300 bg-sky-50 text-sky-700';
}

function severityDotClass(severity: AlertSeverity): string {
  if (severity === 'critical') {
    return 'bg-rose-500';
  }
  if (severity === 'warning') {
    return 'bg-amber-500';
  }
  return 'bg-sky-500';
}

function ManagerShell() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const { pageTitle, currentSection, isDashboard, navigateToDashboard } = useManagerNavigation();
  const { notifications, unresolvedCount, operationalHeart, isLoading } = useManagerAlerts();

  const [activeDomain, setActiveDomain] = useState<AlertDomainKey | null>(null);
  const activeDomainSummary = useMemo(
    () => notifications.find((domain) => domain.key === activeDomain) ?? null,
    [activeDomain, notifications]
  );

  useEffect(() => {
    setActiveDomain(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!activeDomain) {
      return;
    }
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [activeDomain]);

  const generatedAtLabel = operationalHeart
    ? new Date(parseApiDateMs(operationalHeart.meta.generated_at)).toLocaleTimeString('ar-DZ-u-nu-latn', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--';
  const businessDateLabel = operationalHeart?.meta.local_business_date ?? '--';

  const shiftClosed = operationalHeart?.financial_control?.shift_closed_today ?? false;
  const systemStatus = operationalHeart
    ? operationalHeart.capabilities.kitchen_enabled && operationalHeart.capabilities.delivery_enabled
      ? 'تشغيل مستقر'
      : 'تشغيل مقيّد'
    : 'جارٍ الفحص';
  const SectionIcon = currentSection?.icon ?? Activity;
  const sectionDescription = currentSection?.description ?? 'مركز متابعة وتشغيل موحّد لكامل النظام.';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-brand-100 bg-white/95 shadow-sm backdrop-blur">
          <div className="w-full px-4 py-3 md:px-6 lg:px-8">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch">
              <div className="grid w-full gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div className="inline-flex h-11 min-w-0 items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3">
                  <Activity className="h-4 w-4 text-brand-700" />
                  <div>
                    <p className="text-[10px] font-bold text-brand-700">System Status</p>
                    <p className="text-sm font-black text-brand-900">{systemStatus}</p>
                  </div>
                </div>
                <div className="inline-flex h-11 min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${shiftClosed ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <div>
                    <p className="text-[10px] font-bold text-gray-500">الوردية</p>
                    <p className={`text-sm font-black ${shiftClosed ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {shiftClosed ? 'مغلقة' : 'مفتوحة'}
                    </p>
                  </div>
                </div>
                <div className="inline-flex h-11 min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3">
                  <Clock3 className="h-4 w-4 text-gray-500" />
                  <div>
                    <p className="text-[10px] font-bold text-gray-500">تاريخ العمل</p>
                    <p className="text-sm font-black text-gray-800">{businessDateLabel}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch sm:justify-end lg:items-end">
                <div className="flex min-w-0 items-stretch gap-1.5 overflow-x-auto rounded-xl border border-gray-200 bg-slate-100/80 p-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:justify-end lg:border-transparent lg:bg-transparent lg:p-0">
                  {notifications.map((domain) => {
                    const Icon = DOMAIN_ICONS[domain.key];
                    const isActive = activeDomain === domain.key;
                    return (
                      <button
                        key={domain.key}
                        type="button"
                        onClick={() => setActiveDomain((current) => (current === domain.key ? null : domain.key))}
                        className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition ${
                          isActive
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-brand-300 hover:text-brand-700'
                        }`}
                        aria-label={`تنبيهات ${domain.label}`}
                      >
                        <Icon className="h-4 w-4" />
                        <span
                          className={`absolute -left-1 -top-1 min-w-5 rounded-full px-1 text-[10px] font-black leading-5 ${severityBadgeClass(domain.severity)}`}
                        >
                          {domain.badge}
                        </span>
                      </button>
                    );
                  })}
                  <div className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3">
                    <div>
                      <p className="text-[10px] font-bold text-gray-500">إجمالي التنبيهات</p>
                      <p className="text-sm font-black text-gray-900">{unresolvedCount}</p>
                    </div>
                  </div>
                  <div className="hidden h-11 shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 sm:inline-flex">
                    <Clock3 className="h-4 w-4 text-gray-500" />
                    <span className="text-xs font-semibold text-gray-600">آخر تحديث: {isLoading ? '...' : generatedAtLabel}</span>
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-stretch justify-end gap-2 sm:w-auto sm:flex-nowrap">
                  <div className="hidden h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 sm:flex">
                    <Activity className="h-4 w-4 text-gray-500" />
                    <div className="max-w-40 truncate text-sm font-bold text-gray-700">{user?.name ?? 'جلسة غير معروفة'}</div>
                  </div>
                  <button type="button" onClick={logout} className="btn-danger ui-size-sm !h-11 !px-3 max-sm:w-full sm:w-auto">
                    <LogOut className="h-4 w-4" />
                    <span>خروج</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden">
          <div className="w-full px-4 py-4 md:px-6 lg:px-8">
            <section className="rounded-2xl border border-brand-100 bg-white px-4 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {!isDashboard ? (
                    <button type="button" onClick={navigateToDashboard} className="btn-secondary ui-size-sm !h-11 !px-3">
                      <ArrowRight className="h-4 w-4" />
                      <span>العودة إلى لوحة المتابعة</span>
                    </button>
                  ) : (
                    <span className="inline-flex h-11 items-center rounded-full border border-brand-200 bg-brand-50 px-3 text-xs font-bold text-brand-700">
                      القسم الرئيسي
                    </span>
                  )}
                  <div className="hidden max-w-40 truncate text-sm font-bold text-gray-700 sm:block">{user?.name ?? 'جلسة غير معروفة'}</div>
                </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
                      <SectionIcon className="h-5 w-5" />
                    </span>
                    <div>
                      <h1 className="text-base font-black text-gray-900 sm:text-lg">{pageTitle}</h1>
                      <p className="text-xs text-gray-500">{sectionDescription}</p>
                    </div>
                  </div>
                <div className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold ${shiftClosed ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${shiftClosed ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span>{shiftClosed ? 'حالة الوردية: مغلقة' : 'حالة الوردية: مفتوحة'}</span>
                </div>
              </div>
            </section>

            <section className="manager-section-shell mt-4">
              <Outlet />
            </section>
          </div>
        </main>
      </div>

      <button
        type="button"
        aria-label="إغلاق طبقة التنبيهات"
        onClick={() => setActiveDomain(null)}
        className={`fixed inset-0 z-40 bg-gray-900/40 transition-opacity ${
          activeDomain ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        className={`fixed inset-y-0 right-0 z-50 w-[92vw] max-w-md border-l border-brand-100 bg-white shadow-2xl transition-transform duration-200 ${
          activeDomain ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between border-b border-brand-100 p-4">
            <div>
              <p className="text-xs font-bold text-gray-500">تنبيهات المجال</p>
              <h2 className="text-lg font-black text-gray-900">{activeDomainSummary?.label ?? 'التنبيهات'}</h2>
            </div>
            <button type="button" className="btn-secondary ui-size-sm !px-2.5" onClick={() => setActiveDomain(null)} aria-label="إغلاق">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeDomainSummary ? (
              <div className="space-y-2">
                <div className={`rounded-xl border px-3 py-2 text-sm font-bold ${severityBadgeClass(activeDomainSummary.severity)}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span>إجمالي التنبيهات</span>
                    <span>{activeDomainSummary.badge}</span>
                  </div>
                </div>

                {activeDomainSummary.actions.length === 0 ? (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                    لا توجد تنبيهات مفتوحة ضمن هذا المجال الآن.
                  </div>
                ) : (
                  activeDomainSummary.actions.map((action) => (
                    <Link key={action.id} to={action.actionRoute} className={`block rounded-xl border p-3 ${severityBadgeClass(action.severity)}`} onClick={() => setActiveDomain(null)}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-black">{action.title}</p>
                        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${severityDotClass(action.severity)}`} />
                      </div>
                      <p className="mt-2 text-xs font-semibold">{action.detail}</p>
                      <p className="mt-2 text-[11px] font-black">فتح الإجراء</p>
                    </Link>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="border-t border-brand-100 p-4">
            <button type="button" className="btn-secondary w-full justify-center" onClick={() => setActiveDomain(null)}>
              إغلاق
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function ManagerLayout() {
  return (
    <ManagerNavigationProvider>
      <ManagerAlertsProvider>
        <ManagerShell />
      </ManagerAlertsProvider>
    </ManagerNavigationProvider>
  );
}
