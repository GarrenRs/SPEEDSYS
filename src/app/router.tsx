import { Suspense, lazy, type ReactElement } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { useAuthStore } from '@/modules/auth/store';
import type { UserRole } from '@/shared/api/types';

const DeliveryLayout = lazy(() => import('./layout/DeliveryLayout').then((m) => ({ default: m.DeliveryLayout })));
const KitchenLayout = lazy(() => import('./layout/KitchenLayout').then((m) => ({ default: m.KitchenLayout })));
const PublicLayout = lazy(() => import('./layout/PublicLayout').then((m) => ({ default: m.PublicLayout })));

const ConsolePage = lazy(() => import('@/modules/console/ConsolePage').then((m) => ({ default: m.ConsolePage })));
const LoginPage = lazy(() => import('@/modules/auth/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const DeliveryPanelPage = lazy(() =>
  import('@/modules/delivery/DeliveryPanelPage').then((m) => ({ default: m.DeliveryPanelPage }))
);
const KitchenBoardPage = lazy(() =>
  import('@/modules/kitchen/KitchenBoardPage').then((m) => ({ default: m.KitchenBoardPage }))
);
const PublicOrderPage = lazy(() =>
  import('@/modules/orders/public/PublicOrderPage').then((m) => ({ default: m.PublicOrderPage }))
);

function RouteLoading() {
  return (
    <div className="p-4 text-center text-sm font-semibold text-gray-600">
      جارٍ تحميل الصفحة...
    </div>
  );
}

function withRouteSuspense(element: ReactElement) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

function RoleGuard({ allowedRole, loginPath }: { allowedRole: UserRole; loginPath: string }) {
  const user = useAuthStore((state) => state.user);
  const role = useAuthStore((state) => state.role);

  if (!role || !user) {
    return <Navigate to={loginPath} replace />;
  }
  if (role !== allowedRole) {
    return (
      <Navigate
        to={
          role === 'manager'
            ? '/console'
            : role === 'kitchen'
              ? '/kitchen/board'
              : '/delivery/panel'
        }
        replace
      />
    );
  }
  return <Outlet />;
}

interface LegacyManagerConsoleState {
  channel: 'operations' | 'restaurant' | 'business' | 'system' | null;
  section:
    | 'orders'
    | 'kitchen'
    | 'delivery'
    | 'tables'
    | 'menu'
    | 'warehouse'
    | 'staff'
    | 'expenses'
    | 'financial'
    | 'reports'
    | 'audit'
    | 'settings'
    | 'backups'
    | null;
}

function resolveLegacyManagerState(pathname: string): LegacyManagerConsoleState {
  if (pathname === '/manager/dashboard' || pathname === '/manager') {
    return { channel: null, section: null };
  }
  if (pathname.startsWith('/manager/orders')) {
    return { channel: 'operations', section: 'orders' };
  }
  if (pathname.startsWith('/manager/kitchen-monitor')) {
    return { channel: 'operations', section: 'kitchen' };
  }
  if (pathname.startsWith('/manager/delivery-team')) {
    return { channel: 'operations', section: 'delivery' };
  }
  if (pathname.startsWith('/manager/tables')) {
    return { channel: 'operations', section: 'tables' };
  }
  if (pathname.startsWith('/manager/products')) {
    return { channel: 'restaurant', section: 'menu' };
  }
  if (pathname.startsWith('/manager/warehouse')) {
    return { channel: 'restaurant', section: 'warehouse' };
  }
  if (pathname.startsWith('/manager/users')) {
    return { channel: 'restaurant', section: 'staff' };
  }
  if (pathname.startsWith('/manager/expenses')) {
    return { channel: 'restaurant', section: 'expenses' };
  }
  if (pathname.startsWith('/manager/financial')) {
    return { channel: 'business', section: 'financial' };
  }
  if (pathname.startsWith('/manager/reports')) {
    return { channel: 'business', section: 'reports' };
  }
  if (pathname.startsWith('/manager/audit-logs')) {
    return { channel: 'business', section: 'audit' };
  }
  if (pathname.startsWith('/manager/settings')) {
    return { channel: 'system', section: 'settings' };
  }
  return { channel: null, section: null };
}

function ManagerLegacyRedirect() {
  const location = useLocation();
  const state = resolveLegacyManagerState(location.pathname);
  const params = new URLSearchParams(location.search);

  if (state.channel) {
    params.set('channel', state.channel);
  } else {
    params.delete('channel');
  }
  if (state.section) {
    params.set('section', state.section);
  } else {
    params.delete('section');
  }

  const target = params.toString().length > 0 ? `/console?${params.toString()}` : '/console';
  return <Navigate to={target} replace />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/order" replace />} />

      <Route path="/manager/login" element={withRouteSuspense(<LoginPage role="manager" />)} />
      <Route path="/kitchen/login" element={withRouteSuspense(<LoginPage role="kitchen" />)} />
      <Route path="/delivery/login" element={withRouteSuspense(<LoginPage role="delivery" />)} />

      <Route element={withRouteSuspense(<PublicLayout />)}>
        <Route path="/order" element={withRouteSuspense(<PublicOrderPage />)} />
        <Route path="/menu" element={withRouteSuspense(<PublicOrderPage />)} />
      </Route>

      <Route element={<RoleGuard allowedRole="manager" loginPath="/manager/login" />}>
        <Route path="/console" element={withRouteSuspense(<ConsolePage />)} />
        <Route path="/manager/*" element={withRouteSuspense(<ManagerLegacyRedirect />)} />
      </Route>

      <Route element={<RoleGuard allowedRole="kitchen" loginPath="/kitchen/login" />}>
        <Route element={withRouteSuspense(<KitchenLayout />)}>
          <Route path="/kitchen/board" element={withRouteSuspense(<KitchenBoardPage />)} />
        </Route>
      </Route>

      <Route element={<RoleGuard allowedRole="delivery" loginPath="/delivery/login" />}>
        <Route element={withRouteSuspense(<DeliveryLayout />)}>
          <Route path="/delivery/panel" element={withRouteSuspense(<DeliveryPanelPage />)} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/order" replace />} />
    </Routes>
  );
}
