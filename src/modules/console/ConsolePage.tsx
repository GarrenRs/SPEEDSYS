import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  Bell,
  Boxes,
  ChefHat,
  ClipboardList,
  Eye,
  EyeOff,
  HardDrive,
  House,
  LogOut,
  ReceiptText,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type { OrderStatus } from '@/shared/api/types';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';
import { ChannelBar, type ConsoleChannel } from './ChannelBar';
import { ChannelCards, type ConsoleSection, type ConsoleSectionCard } from './ChannelCards';
import { ContentPanel } from './ContentPanel';

const OrdersPage = lazy(() => import('@/modules/management/orders/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const KitchenMonitorPage = lazy(() =>
  import('@/modules/management/kitchen-monitor/KitchenMonitorPage').then((m) => ({ default: m.KitchenMonitorPage }))
);
const DeliveryTeamPage = lazy(() =>
  import('@/modules/management/delivery/DeliveryTeamPage').then((m) => ({ default: m.DeliveryTeamPage }))
);
const TablesPage = lazy(() => import('@/modules/management/tables/TablesPage').then((m) => ({ default: m.TablesPage })));
const ProductsPage = lazy(() =>
  import('@/modules/management/products/ProductsPage').then((m) => ({ default: m.ProductsPage }))
);
const WarehousePage = lazy(() =>
  import('@/modules/management/warehouse/WarehousePage').then((m) => ({ default: m.WarehousePage }))
);
const UsersPage = lazy(() => import('@/modules/management/users/UsersPage').then((m) => ({ default: m.UsersPage })));
const ExpensesPage = lazy(() =>
  import('@/modules/management/expenses/ExpensesPage').then((m) => ({ default: m.ExpensesPage }))
);
const FinancialPage = lazy(() =>
  import('@/modules/management/financial/FinancialPage').then((m) => ({ default: m.FinancialPage }))
);
const ReportsPage = lazy(() =>
  import('@/modules/management/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const AuditLogsPage = lazy(() =>
  import('@/modules/management/audit/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage }))
);
const SettingsPage = lazy(() =>
  import('@/modules/management/settings/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);

const SECTION_TO_CHANNEL: Record<ConsoleSection, ConsoleChannel> = {
  orders: 'operations',
  kitchen: 'operations',
  delivery: 'operations',
  tables: 'operations',
  menu: 'restaurant',
  warehouse: 'restaurant',
  staff: 'restaurant',
  expenses: 'restaurant',
  financial: 'business',
  reports: 'business',
  audit: 'business',
  settings: 'system',
  backups: 'system',
};

const SECTION_CAPABILITIES: Partial<Record<ConsoleSection, string>> = {
  orders: 'manager.orders.view',
  kitchen: 'manager.kitchen_monitor.view',
  delivery: 'manager.delivery.view',
  tables: 'manager.tables.view',
  menu: 'manager.products.view',
  warehouse: 'manager.warehouse.view',
  staff: 'manager.users.view',
  expenses: 'manager.expenses.view',
  financial: 'manager.financial.view',
  reports: 'manager.reports.view',
  audit: 'manager.audit.view',
  settings: 'manager.settings.view',
  backups: 'manager.settings.view',
};

const SECTION_CARDS: ConsoleSectionCard[] = [
  { id: 'orders', channel: 'operations', label: 'الطلبات', subtitle: 'متابعة دورة الطلبات لحظيًا', icon: ClipboardList },
  { id: 'kitchen', channel: 'operations', label: 'المطبخ', subtitle: 'مراقبة تدفق وتحضير الطلبات', icon: ChefHat },
  { id: 'delivery', channel: 'operations', label: 'التوصيل', subtitle: 'تشغيل وتتبع فريق التوصيل', icon: Truck },
  { id: 'tables', channel: 'operations', label: 'الطاولات', subtitle: 'إدارة الجلسات والتحصيل الميداني', icon: UtensilsCrossed },
  { id: 'menu', channel: 'restaurant', label: 'قائمة الطعام', subtitle: 'إدارة الأصناف والتصنيفات', icon: BadgeDollarSign },
  { id: 'warehouse', channel: 'restaurant', label: 'المخزن', subtitle: 'حركة المخزون والسندات', icon: Boxes },
  { id: 'staff', channel: 'restaurant', label: 'الطاقم', subtitle: 'إدارة المستخدمين والصلاحيات', icon: Users },
  { id: 'expenses', channel: 'restaurant', label: 'المصروفات', subtitle: 'اعتماد المصروفات ومتابعتها', icon: ReceiptText },
  { id: 'financial', channel: 'business', label: 'المالية', subtitle: 'متابعة المركز المالي اليومي', icon: Wallet },
  { id: 'reports', channel: 'business', label: 'التقارير', subtitle: 'مؤشرات الأداء والتحليلات', icon: BarChart3 },
  { id: 'audit', channel: 'business', label: 'التدقيق', subtitle: 'مراجعة أحداث وسجل النظام', icon: ShieldCheck },
  { id: 'settings', channel: 'system', label: 'الإعدادات', subtitle: 'سياسات وإعدادات التشغيل', icon: Settings },
  { id: 'backups', channel: 'system', label: 'النسخ الاحتياطية', subtitle: 'إنشاء واستعادة النسخ', icon: HardDrive },
];

const LIVE_ACTIVE_STATUSES: OrderStatus[] = [
  'CREATED',
  'CONFIRMED',
  'SENT_TO_KITCHEN',
  'IN_PREPARATION',
  'READY',
  'OUT_FOR_DELIVERY',
];

const HEADER_TILE_CLASS =
  'flex h-12 items-center gap-2 rounded-xl border border-[#ccb89a] bg-[#f7ecdb] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.48)]';
const HEADER_ICON_BUTTON_CLASS =
  'inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[#ccb89a] bg-[#f7ecdb] text-[#5f4733] shadow-[inset_0_1px_0_rgba(255,255,255,0.48)] transition hover:border-[#b98757] hover:bg-[#f0dfc8] hover:text-[#4e3828]';

function parseChannel(value: string | null): ConsoleChannel | null {
  if (value === 'operations' || value === 'restaurant' || value === 'business' || value === 'system') {
    return value;
  }
  return null;
}

function parseSection(value: string | null): ConsoleSection | null {
  if (!value) {
    return null;
  }
  return SECTION_CARDS.some((card) => card.id === value) ? (value as ConsoleSection) : null;
}

function resolveStateFromSearch(
  params: URLSearchParams,
  allowedSections: Set<ConsoleSection>
): { channel: ConsoleChannel | null; section: ConsoleSection | null } {
  const requestedSection = parseSection(params.get('section'));
  if (requestedSection && allowedSections.has(requestedSection)) {
    return {
      channel: SECTION_TO_CHANNEL[requestedSection],
      section: requestedSection,
    };
  }
  return {
    channel: parseChannel(params.get('channel')),
    section: null,
  };
}

function SectionLoading() {
  return (
    <div className="rounded-xl border border-[#ccb89a] bg-[#fff8ec] p-4 text-sm font-semibold text-[#6f5a46]">
      جارٍ تحميل القسم...
    </div>
  );
}

function formatHeaderCounter(value: number): string {
  return value > 99 ? '99+' : String(value);
}

export function ConsolePage() {
  const user = useAuthStore((state) => state.user);
  const role = useAuthStore((state) => state.role);
  const logout = useAuthStore((state) => state.logout);
  const [searchParams, setSearchParams] = useSearchParams();
  const [ordersVisible, setOrdersVisible] = useState(true);

  const availableCards = useMemo(() => {
    if (!Array.isArray(user?.permissions_effective)) {
      return SECTION_CARDS;
    }
    const granted = new Set(user.permissions_effective);
    return SECTION_CARDS.filter((card) => {
      const capability = SECTION_CAPABILITIES[card.id];
      return !capability || granted.has(capability);
    });
  }, [user?.permissions_effective]);

  const allowedSections = useMemo(() => new Set<ConsoleSection>(availableCards.map((card) => card.id)), [availableCards]);

  const [activeChannel, setActiveChannel] = useState<ConsoleChannel | null>(() => {
    const state = resolveStateFromSearch(searchParams, allowedSections);
    return state.channel;
  });
  const [activeSection, setActiveSection] = useState<ConsoleSection | null>(() => {
    const state = resolveStateFromSearch(searchParams, allowedSections);
    return state.section;
  });

  useEffect(() => {
    const state = resolveStateFromSearch(searchParams, allowedSections);
    if (state.channel !== activeChannel) {
      setActiveChannel(state.channel);
    }
    if (state.section !== activeSection) {
      setActiveSection(state.section);
    }
  }, [activeChannel, activeSection, allowedSections, searchParams]);

  const syncSearchState = useCallback(
    (channel: ConsoleChannel | null, section: ConsoleSection | null, extras?: Partial<Record<string, string>>) => {
      const next = new URLSearchParams(searchParams);
      if (channel) {
        next.set('channel', channel);
      } else {
        next.delete('channel');
      }
      if (section) {
        next.set('section', section);
      } else {
        next.delete('section');
      }
      if (section !== 'orders') {
        next.delete('status');
        next.delete('order_type');
        next.delete('new');
      }
      if (extras) {
        for (const [key, value] of Object.entries(extras)) {
          if (!value) {
            next.delete(key);
          } else {
            next.set(key, value);
          }
        }
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const goToConsoleHome = useCallback(() => {
    setActiveChannel(null);
    setActiveSection(null);
    syncSearchState(null, null);
  }, [syncSearchState]);

  const toggleOrdersVisibility = useCallback(() => {
    if (activeChannel !== null || activeSection !== null) {
      setActiveChannel(null);
      setActiveSection(null);
      syncSearchState(null, null);
    }
    setOrdersVisible((current) => !current);
  }, [activeChannel, activeSection, syncSearchState]);

  const operationalHeartQuery = useQuery({
    queryKey: ['console-operational-heart'],
    queryFn: () => api.managerDashboardOperationalHeart(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000, { minimumMs: 5000 }),
  });
  const liveOrdersQuery = useQuery({
    queryKey: ['console-live-orders'],
    queryFn: () => api.managerOrders(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000, { minimumMs: 5000 }),
  });
  const liveKitchenQuery = useQuery({
    queryKey: ['console-live-kitchen'],
    queryFn: () => api.managerKitchenOrders(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000, { minimumMs: 5000 }),
  });
  const liveDeliveryQuery = useQuery({
    queryKey: ['console-live-delivery'],
    queryFn: () => api.managerOrders(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000, { minimumMs: 5000 }),
  });

  const queueCountByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of operationalHeartQuery.data?.queues ?? []) {
      map.set(item.key, item.count);
    }
    return map;
  }, [operationalHeartQuery.data?.queues]);

  const orderNotifications = useMemo(
    () =>
      (queueCountByKey.get('created') ?? 0) +
      (queueCountByKey.get('confirmed') ?? 0) +
      (queueCountByKey.get('kitchen') ?? 0) +
      (queueCountByKey.get('ready') ?? 0) +
      (queueCountByKey.get('out_for_delivery') ?? 0),
    [queueCountByKey]
  );

  const systemStatusLabel = useMemo(() => {
    if (operationalHeartQuery.isLoading && !operationalHeartQuery.data) {
      return 'جارٍ الفحص';
    }
    const capabilities = operationalHeartQuery.data?.capabilities;
    if (!capabilities) {
      return 'غير معروف';
    }
    return capabilities.kitchen_enabled && capabilities.delivery_enabled ? 'مستقر' : 'مقيّد';
  }, [operationalHeartQuery.data, operationalHeartQuery.isLoading]);

  const cardMetrics = useMemo(() => {
    const allOrders = liveOrdersQuery.data ?? [];
    const kitchenOrders = liveKitchenQuery.data ?? [];
    const deliveryOrders = liveDeliveryQuery.data ?? [];
    return {
      orders: allOrders.filter((order) => LIVE_ACTIVE_STATUSES.includes(order.status)).length,
      kitchen: kitchenOrders.filter(
        (order) => order.status === 'SENT_TO_KITCHEN' || order.status === 'IN_PREPARATION' || order.status === 'READY'
      ).length,
      delivery: deliveryOrders.filter(
        (order) => order.type === 'delivery' && LIVE_ACTIVE_STATUSES.includes(order.status)
      ).length,
    };
  }, [liveDeliveryQuery.data, liveKitchenQuery.data, liveOrdersQuery.data]);

  const cardsWithMetrics = useMemo(
    () =>
      availableCards.map((card) => {
        if (card.id === 'orders') {
          return { ...card, metric: cardMetrics.orders };
        }
        if (card.id === 'kitchen') {
          return { ...card, metric: cardMetrics.kitchen };
        }
        if (card.id === 'delivery') {
          return { ...card, metric: cardMetrics.delivery };
        }
        return card;
      }),
    [availableCards, cardMetrics.delivery, cardMetrics.kitchen, cardMetrics.orders]
  );

  const channelCards = useMemo(
    () =>
      activeChannel
        ? cardsWithMetrics.filter(
            (card) => card.channel === activeChannel && !(activeChannel === 'operations' && card.id === 'orders')
          )
        : [],
    [activeChannel, cardsWithMetrics]
  );
  const activeSectionCard = useMemo(
    () => (activeSection ? cardsWithMetrics.find((card) => card.id === activeSection) ?? null : null),
    [activeSection, cardsWithMetrics]
  );

  const selectChannel = useCallback(
    (channel: ConsoleChannel) => {
      if (activeChannel === channel && activeSection === null) {
        setActiveChannel(null);
        setActiveSection(null);
        syncSearchState(null, null);
        return;
      }
      setActiveChannel(channel);
      setActiveSection(null);
      syncSearchState(channel, null);
    },
    [activeChannel, activeSection, syncSearchState]
  );

  const openSection = useCallback(
    (section: ConsoleSection) => {
      const channel = SECTION_TO_CHANNEL[section];
      setActiveChannel(channel);
      setActiveSection(section);
      syncSearchState(channel, section);
    },
    [syncSearchState]
  );

  const closeSectionToCards = useCallback(() => {
    const fallbackChannel = activeSection ? SECTION_TO_CHANNEL[activeSection] : activeChannel;
    setActiveChannel(fallbackChannel ?? null);
    setActiveSection(null);
    syncSearchState(fallbackChannel ?? null, null);
  }, [activeChannel, activeSection, syncSearchState]);

  const renderSection = () => {
    switch (activeSection) {
      case 'orders':
        return <OrdersPage />;
      case 'kitchen':
        return <KitchenMonitorPage />;
      case 'delivery':
        return <DeliveryTeamPage />;
      case 'tables':
        return <TablesPage />;
      case 'menu':
        return <ProductsPage />;
      case 'warehouse':
        return <WarehousePage />;
      case 'staff':
        return <UsersPage />;
      case 'expenses':
        return <ExpensesPage />;
      case 'financial':
        return <FinancialPage />;
      case 'reports':
        return <ReportsPage />;
      case 'audit':
        return <AuditLogsPage />;
      case 'settings':
      case 'backups':
        return <SettingsPage />;
      default:
        return null;
    }
  };

  return (
    <div className="console-theme h-screen overflow-hidden bg-[#e8dece] text-[#4f3828]">
      <div className="flex h-full flex-col">
        <header className="console-header-layer border-b border-[#ccb89a] bg-[#f1e7d8] px-3 py-2 tablet:px-6 tablet:py-3">
          <div className="tablet:hidden">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={logout}
                className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-rose-300 bg-rose-100/85 text-rose-900 transition hover:bg-rose-100"
                aria-label="تسجيل الخروج"
                title="تسجيل الخروج"
              >
                <LogOut className="h-5 w-5" />
              </button>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={goToConsoleHome}
                  className={HEADER_ICON_BUTTON_CLASS}
                  aria-label="العودة إلى الواجهة الرئيسية"
                  title="الواجهة الرئيسية"
                >
                  <House className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={toggleOrdersVisibility}
                  className={HEADER_ICON_BUTTON_CLASS}
                  aria-pressed={!ordersVisible}
                  aria-label={ordersVisible ? 'إخفاء الطلبات' : 'إظهار الطلبات'}
                  title={ordersVisible ? 'إخفاء الطلبات' : 'إظهار الطلبات'}
                >
                  {ordersVisible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>

                <div
                  className={`${HEADER_ICON_BUTTON_CLASS} relative`}
                  role="status"
                  aria-label={`الإشعارات: ${orderNotifications}`}
                  title={`الإشعارات: ${orderNotifications}`}
                >
                  <Bell className="h-5 w-5" />
                  <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full border border-[#a96f3e] bg-[#a96f3e] px-1 text-[10px] font-black leading-4 text-[#fff7eb]">
                    {formatHeaderCounter(orderNotifications)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden tablet:grid tablet:grid-cols-[minmax(200px,1.2fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(180px,1fr)_auto_auto_auto] tablet:items-center tablet:gap-2">
            <div className={`${HEADER_TILE_CLASS} min-w-0`}>
              <Activity className="h-4 w-4 shrink-0 text-brand-700" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-500">الشعار</p>
                <p className="truncate text-sm font-black text-slate-900">منصة التشغيل</p>
              </div>
            </div>

            <div className={`${HEADER_TILE_CLASS} min-w-0`}>
              <Activity className="h-4 w-4 shrink-0 text-slate-600" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-500">حالة النظام</p>
                <p className="truncate text-sm font-black text-slate-900">{systemStatusLabel}</p>
              </div>
            </div>

            <div className={`${HEADER_TILE_CLASS} min-w-0`}>
              <Bell className="h-4 w-4 shrink-0 text-slate-600" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-500">الإشعارات</p>
                <p className="truncate text-sm font-black text-slate-900">{orderNotifications}</p>
              </div>
            </div>

            <div className={`${HEADER_TILE_CLASS} min-w-0`}>
              <span className="text-[10px] font-bold text-slate-500">المستخدم</span>
              <span className="truncate text-sm font-black text-slate-900">{user?.name ?? '-'}</span>
            </div>

            <button
              type="button"
              onClick={toggleOrdersVisibility}
              className="btn-secondary ui-size-sm !h-12 !px-3"
              aria-pressed={!ordersVisible}
            >
              {ordersVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              <span>{ordersVisible ? 'إخفاء الطلبات' : 'إظهار الطلبات'}</span>
            </button>

            <button
              type="button"
              onClick={goToConsoleHome}
              className="btn-secondary ui-size-sm !h-12 !w-12 !px-0"
              aria-label="العودة إلى الواجهة الرئيسية"
              title="الواجهة الرئيسية"
            >
              <House className="h-5 w-5" />
            </button>

            <button type="button" onClick={logout} className="btn-danger ui-size-sm !h-12 !px-3">
              <LogOut className="h-4 w-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </header>

        <ChannelBar activeChannel={activeChannel} onSelectChannel={selectChannel} />

        <main className="console-main-layer flex-1 min-h-0 overflow-hidden p-3 md:p-4">
          {activeSection && activeSectionCard ? (
            <ContentPanel title={activeSectionCard.label} onBack={closeSectionToCards}>
              <Suspense fallback={<SectionLoading />}>{renderSection()}</Suspense>
            </ContentPanel>
          ) : activeChannel ? (
            <ChannelCards channel={activeChannel} cards={channelCards} onOpenSection={openSection} />
          ) : (
            <section className="console-board-layer relative manager-section-shell h-full min-h-0 overflow-auto rounded-2xl border border-[#ccb89a] bg-[#fbf6ee] p-4 shadow-[0_10px_30px_rgba(70,45,25,0.08)] md:p-5">
              <div
                className={`transition-[opacity,transform,filter] duration-300 ${
                  ordersVisible ? 'opacity-100 blur-0 scale-100' : 'pointer-events-none select-none opacity-0 blur-sm scale-[0.985]'
                }`}
              >
                <Suspense fallback={<SectionLoading />}>
                  <OrdersPage />
                </Suspense>
              </div>

              <div
                className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
                  ordersVisible ? 'opacity-0' : 'opacity-100'
                }`}
              >
                <div className="rounded-2xl border border-[#ccb89a] bg-[#fff7ea]/95 px-6 py-4 text-center shadow-[0_8px_26px_rgba(70,45,25,0.16)] backdrop-blur">
                  <p className="text-sm font-black text-[#4f3828]">تم إخفاء جدول الطلبات</p>
                  <p className="mt-1 text-xs font-semibold text-[#755f4a]">يمكنك إظهاره من زر الخصوصية في الهيدر.</p>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
