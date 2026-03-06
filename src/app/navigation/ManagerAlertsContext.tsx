import { createContext, type PropsWithChildren, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type { OperationalHeartDashboard } from '@/shared/api/types';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';

export type AlertDomainKey = 'orders' | 'inventory' | 'financial' | 'delivery' | 'system' | 'audit';
export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface DomainAlertAction {
  id: string;
  title: string;
  detail: string;
  actionRoute: string;
  severity: AlertSeverity;
}

export interface DomainAlertSummary {
  key: AlertDomainKey;
  label: string;
  badge: number;
  severity: AlertSeverity;
  actions: DomainAlertAction[];
}

interface ManagerAlertsContextValue {
  operationalHeart: OperationalHeartDashboard | null;
  notifications: DomainAlertSummary[];
  unresolvedCount: number;
  isLoading: boolean;
  isError: boolean;
}

const ManagerAlertsContext = createContext<ManagerAlertsContextValue | null>(null);

function normalizeSeverity(value?: string | null): AlertSeverity {
  if (value === 'critical') {
    return 'critical';
  }
  if (value === 'warning') {
    return 'warning';
  }
  return 'info';
}

function maxSeverity(current: AlertSeverity, next: AlertSeverity): AlertSeverity {
  const rank: Record<AlertSeverity, number> = { info: 1, warning: 2, critical: 3 };
  return rank[next] > rank[current] ? next : current;
}

function resolveDomainFromRoute(route: string | null | undefined): AlertDomainKey {
  const normalized = String(route ?? '').toLowerCase();
  if (normalized.includes('/manager/audit')) {
    return 'audit';
  }
  if (normalized.includes('/manager/warehouse')) {
    return 'inventory';
  }
  if (normalized.includes('/manager/financial') || normalized.includes('/manager/expenses')) {
    return 'financial';
  }
  if (normalized.includes('/manager/delivery')) {
    return 'delivery';
  }
  if (
    normalized.includes('/manager/orders') ||
    normalized.includes('/manager/kitchen') ||
    normalized.includes('/manager/tables') ||
    normalized.includes('/manager/products')
  ) {
    return 'orders';
  }
  return 'system';
}

function buildDomainNotifications(snapshot: OperationalHeartDashboard | null): DomainAlertSummary[] {
  const domainMap: Record<AlertDomainKey, DomainAlertSummary> = {
    orders: { key: 'orders', label: 'الطلبات', badge: 0, severity: 'info', actions: [] },
    inventory: { key: 'inventory', label: 'المخزون', badge: 0, severity: 'info', actions: [] },
    financial: { key: 'financial', label: 'العمليات المالية', badge: 0, severity: 'info', actions: [] },
    delivery: { key: 'delivery', label: 'التوصيل', badge: 0, severity: 'info', actions: [] },
    system: { key: 'system', label: 'النظام', badge: 0, severity: 'info', actions: [] },
    audit: { key: 'audit', label: 'سجل التدقيق', badge: 0, severity: 'info', actions: [] },
  };

  if (!snapshot) {
    return Object.values(domainMap);
  }

  const queueMap = Object.fromEntries(snapshot.queues.map((queue) => [queue.key, queue]));

  const ordersBadge =
    (queueMap.created?.count ?? 0) +
    (queueMap.confirmed?.count ?? 0) +
    (queueMap.kitchen?.count ?? 0) +
    (queueMap.ready?.count ?? 0);
  const deliveryBadge = (queueMap.out_for_delivery?.count ?? 0) + (queueMap.delivery_failed?.count ?? 0);
  const inventoryBadge =
    (snapshot.warehouse_control?.low_stock_items ?? 0) + (snapshot.warehouse_control?.pending_stock_counts ?? 0);
  const financialBadge =
    (snapshot.financial_control?.shift_closed_today ? 0 : 1) +
    ((snapshot.expenses_control?.pending_approvals ?? 0) > 0 ? 1 : 0) +
    (Math.abs(snapshot.financial_control?.latest_shift_variance ?? 0) > 0 ? 1 : 0);
  const systemBadge =
    (snapshot.capabilities.kitchen_block_reason ? 1 : 0) + (snapshot.capabilities.delivery_block_reason ? 1 : 0);
  const auditBadge = (snapshot.reconciliations ?? []).filter((item) => !item.ok).length;

  domainMap.orders.badge = ordersBadge;
  domainMap.delivery.badge = deliveryBadge;
  domainMap.inventory.badge = inventoryBadge;
  domainMap.financial.badge = financialBadge;
  domainMap.system.badge = systemBadge;
  domainMap.audit.badge = auditBadge;

  domainMap.orders.severity = ordersBadge >= 6 ? 'critical' : ordersBadge > 0 ? 'warning' : 'info';
  domainMap.delivery.severity = deliveryBadge >= 4 ? 'critical' : deliveryBadge > 0 ? 'warning' : 'info';
  domainMap.inventory.severity = normalizeSeverity(snapshot.warehouse_control?.severity);
  domainMap.financial.severity = normalizeSeverity(snapshot.financial_control?.severity);
  domainMap.system.severity = systemBadge > 0 ? 'warning' : 'info';
  domainMap.audit.severity = auditBadge > 0 ? 'warning' : 'info';

  for (const incident of snapshot.incidents) {
    const domain = resolveDomainFromRoute(incident.action_route);
    const severity = normalizeSeverity(incident.severity);
    domainMap[domain].actions.push({
      id: `incident-${incident.code}`,
      title: incident.title,
      detail: incident.message,
      actionRoute: incident.action_route,
      severity,
    });
    domainMap[domain].severity = maxSeverity(domainMap[domain].severity, severity);
  }

  if (snapshot.capabilities.kitchen_block_reason) {
    domainMap.system.actions.push({
      id: 'system-kitchen-block',
      title: 'المطبخ مقيد تشغيليًا',
      detail: snapshot.capabilities.kitchen_block_reason,
      actionRoute: '/manager/settings',
      severity: 'warning',
    });
  }

  if (snapshot.capabilities.delivery_block_reason) {
    domainMap.system.actions.push({
      id: 'system-delivery-block',
      title: 'التوصيل مقيد تشغيليًا',
      detail: snapshot.capabilities.delivery_block_reason,
      actionRoute: '/manager/settings',
      severity: 'warning',
    });
  }

  for (const item of snapshot.reconciliations ?? []) {
    if (item.ok) {
      continue;
    }
    const severity = normalizeSeverity(item.severity);
    domainMap.audit.actions.push({
      id: `recon-${item.key}`,
      title: item.label,
      detail: item.detail,
      actionRoute: item.action_route,
      severity,
    });
    domainMap.audit.severity = maxSeverity(domainMap.audit.severity, severity);
  }

  if ((snapshot.warehouse_control?.low_stock_items ?? 0) > 0) {
    domainMap.inventory.actions.push({
      id: 'warehouse-low-stock',
      title: 'أصناف منخفضة في المخزون',
      detail: `عدد الأصناف المنخفضة: ${snapshot.warehouse_control?.low_stock_items ?? 0}`,
      actionRoute: snapshot.warehouse_control?.action_route ?? '/manager/warehouse',
      severity: 'warning',
    });
  }

  if ((snapshot.expenses_control?.pending_approvals ?? 0) > 0) {
    domainMap.financial.actions.push({
      id: 'expenses-pending-approvals',
      title: 'موافقات مصروفات معلقة',
      detail: `بانتظار الاعتماد: ${snapshot.expenses_control?.pending_approvals ?? 0}`,
      actionRoute: snapshot.expenses_control?.action_route ?? '/manager/expenses',
      severity: 'warning',
    });
  }

  return Object.values(domainMap).map((domain) => ({
    ...domain,
    actions: domain.actions.slice(0, 12),
  }));
}

export function ManagerAlertsProvider({ children }: PropsWithChildren) {
  const role = useAuthStore((state) => state.role);

  const operationalHeartQuery = useQuery({
    queryKey: ['manager-dashboard-operational-heart'],
    queryFn: () => api.managerDashboardOperationalHeart(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const notifications = useMemo(
    () => buildDomainNotifications(operationalHeartQuery.data ?? null),
    [operationalHeartQuery.data]
  );

  const unresolvedCount = useMemo(
    () => notifications.reduce((sum, row) => sum + row.badge, 0),
    [notifications]
  );

  const value = useMemo<ManagerAlertsContextValue>(
    () => ({
      operationalHeart: operationalHeartQuery.data ?? null,
      notifications,
      unresolvedCount,
      isLoading: operationalHeartQuery.isLoading,
      isError: operationalHeartQuery.isError,
    }),
    [
      notifications,
      operationalHeartQuery.data,
      operationalHeartQuery.isError,
      operationalHeartQuery.isLoading,
      unresolvedCount,
    ]
  );

  return <ManagerAlertsContext.Provider value={value}>{children}</ManagerAlertsContext.Provider>;
}

export function useManagerAlerts(): ManagerAlertsContextValue {
  const context = useContext(ManagerAlertsContext);
  if (!context) {
    throw new Error('useManagerAlerts must be used within ManagerAlertsProvider');
  }
  return context;
}

