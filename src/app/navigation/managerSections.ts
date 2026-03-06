import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Boxes,
  ChefHat,
  ClipboardList,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingBasket,
  Table2,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';

export const MANAGER_DASHBOARD_ROUTE = '/manager/dashboard';

export interface ManagerSectionDefinition {
  to: string;
  label: string;
  capability: string;
  description: string;
  icon: LucideIcon;
}

export const MANAGER_SECTIONS: ManagerSectionDefinition[] = [
  {
    to: '/manager/orders',
    label: 'إدارة الطلبات',
    capability: 'manager.orders.view',
    description: 'متابعة دورة الطلبات وتنفيذ الإجراءات الحرجة بسرعة.',
    icon: ClipboardList,
  },
  {
    to: '/manager/tables',
    label: 'إدارة الطاولات',
    capability: 'manager.tables.view',
    description: 'إدارة جلسات الطاولات والتحصيل الميداني بدقة.',
    icon: Table2,
  },
  {
    to: '/manager/kitchen-monitor',
    label: 'مراقبة المطبخ',
    capability: 'manager.kitchen_monitor.view',
    description: 'متابعة طوابير التحضير وزمن التجهيز لحظيًا.',
    icon: ChefHat,
  },
  {
    to: '/manager/delivery-team',
    label: 'فريق التوصيل',
    capability: 'manager.delivery.view',
    description: 'إدارة مهام المندوبين وحالات التسليم الميدانية.',
    icon: Truck,
  },
  {
    to: '/manager/products',
    label: 'إدارة المنتجات',
    capability: 'manager.products.view',
    description: 'تنظيم المنتجات والتصنيفات وسياسات العرض.',
    icon: ShoppingBasket,
  },
  {
    to: '/manager/warehouse',
    label: 'إدارة المخزن',
    capability: 'manager.warehouse.view',
    description: 'حركة المخزون، السندات، والجرد التشغيلي.',
    icon: Boxes,
  },
  {
    to: '/manager/financial',
    label: 'العمليات المالية',
    capability: 'manager.financial.view',
    description: 'المبيعات، الإغلاقات، وتسوية النقد اليومية.',
    icon: Wallet,
  },
  {
    to: '/manager/expenses',
    label: 'المصروفات',
    capability: 'manager.expenses.view',
    description: 'اعتماد المصروفات ومتابعة دورة الموافقات.',
    icon: ReceiptText,
  },
  {
    to: '/manager/reports',
    label: 'التقارير',
    capability: 'manager.reports.view',
    description: 'مؤشرات الأداء والتحليل التشغيلي والمالي.',
    icon: BarChart3,
  },
  {
    to: '/manager/users',
    label: 'المستخدمون',
    capability: 'manager.users.view',
    description: 'إدارة الحسابات والأدوار والصلاحيات.',
    icon: Users,
  },
  {
    to: '/manager/settings',
    label: 'الإعدادات',
    capability: 'manager.settings.view',
    description: 'سياسات التشغيل والإعدادات العامة للنظام.',
    icon: Settings,
  },
  {
    to: '/manager/audit-logs',
    label: 'سجل التدقيق',
    capability: 'manager.audit.view',
    description: 'مراجعة أحداث النظام والتدقيق الأمني.',
    icon: ShieldCheck,
  },
];

export function resolveManagerSectionFromPath(pathname: string): ManagerSectionDefinition | null {
  if (pathname === MANAGER_DASHBOARD_ROUTE) {
    return null;
  }
  for (const section of MANAGER_SECTIONS) {
    if (pathname === section.to || pathname.startsWith(`${section.to}/`)) {
      return section;
    }
  }
  return null;
}
