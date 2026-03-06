import { createContext, type PropsWithChildren, useCallback, useContext, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/modules/auth/store';
import {
  MANAGER_DASHBOARD_ROUTE,
  MANAGER_SECTIONS,
  type ManagerSectionDefinition,
  resolveManagerSectionFromPath,
} from './managerSections';

interface ManagerNavigationContextValue {
  sections: ManagerSectionDefinition[];
  currentSection: ManagerSectionDefinition | null;
  isDashboard: boolean;
  pageTitle: string;
  navigateToSection: (to: string) => void;
  navigateToDashboard: () => void;
}

const ManagerNavigationContext = createContext<ManagerNavigationContextValue | null>(null);

export function ManagerNavigationProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);

  const sections = useMemo(() => {
    if (!Array.isArray(user?.permissions_effective)) {
      return MANAGER_SECTIONS;
    }
    const granted = new Set(user.permissions_effective);
    return MANAGER_SECTIONS.filter((section) => granted.has(section.capability));
  }, [user?.permissions_effective]);

  const currentSection = useMemo(() => {
    const resolved = resolveManagerSectionFromPath(location.pathname);
    if (resolved) {
      return resolved;
    }
    return sections.find((section) => location.pathname.startsWith(section.to)) ?? null;
  }, [location.pathname, sections]);

  const isDashboard = location.pathname === MANAGER_DASHBOARD_ROUTE;

  const pageTitle = useMemo(() => {
    if (isDashboard) {
      return 'لوحة المتابعة التشغيلية';
    }
    return currentSection?.label ?? 'الإدارة';
  }, [currentSection?.label, isDashboard]);

  const navigateToSection = useCallback(
    (to: string) => {
      navigate(to);
    },
    [navigate]
  );

  const navigateToDashboard = useCallback(() => {
    navigate(MANAGER_DASHBOARD_ROUTE);
  }, [navigate]);

  const value = useMemo<ManagerNavigationContextValue>(
    () => ({
      sections,
      currentSection,
      isDashboard,
      pageTitle,
      navigateToSection,
      navigateToDashboard,
    }),
    [sections, currentSection, isDashboard, pageTitle, navigateToSection, navigateToDashboard]
  );

  return <ManagerNavigationContext.Provider value={value}>{children}</ManagerNavigationContext.Provider>;
}

export function useManagerNavigation(): ManagerNavigationContextValue {
  const context = useContext(ManagerNavigationContext);
  if (!context) {
    throw new Error('useManagerNavigation must be used within ManagerNavigationProvider');
  }
  return context;
}
