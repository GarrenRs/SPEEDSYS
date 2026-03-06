import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import { useDataView } from '@/shared/hooks/useDataView';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';
import { downloadCsvReport, downloadXlsxReport, openPdfPrintView } from '@/shared/utils/reportExport';
import { orderTypeLabel } from '@/shared/utils/order';
import { isLikelyCorruptedText, sanitizeMojibakeText } from '@/shared/utils/textSanitizer';

type ReportTab = 'daily' | 'monthly' | 'type' | 'profitability' | 'comparison' | 'peak';
type ProfitabilityScope = 'products' | 'categories';

type ReportViewRow = {
  id: string;
  primary: string;
  secondary: string;
  sales: number;
  expenses: number;
  net: number;
  count: number;
  quantity: number;
  marginPercent: number;
  estimatedUnitCost: number;
};

const comparisonMetricLabelByKey: Record<string, string> = {
  sales: 'المبيعات',
  expenses: 'المصروفات',
  net: 'الصافي',
  delivered_orders_count: 'عدد الطلبات المسلّمة',
  avg_order_value: 'متوسط قيمة الطلب',
};

const comparisonMetricFallbackByIndex = [
  'المبيعات',
  'المصروفات',
  'الصافي',
  'عدد الطلبات المسلّمة',
  'متوسط قيمة الطلب',
];

function resolveComparisonMetricLabel(metric: string, index: number): string {
  const normalizedMetric = metric.trim().toLowerCase();
  if (comparisonMetricLabelByKey[normalizedMetric]) {
    return comparisonMetricLabelByKey[normalizedMetric];
  }

  const cleaned = sanitizeMojibakeText(metric, '');
  if (cleaned && !isLikelyCorruptedText(cleaned)) {
    return cleaned;
  }

  return comparisonMetricFallbackByIndex[index] ?? `مؤشر ${index + 1}`;
}

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ReportsPage() {
  const role = useAuthStore((state) => state.role);
  const [tab, setTab] = useState<ReportTab>('daily');
  const [profitabilityScope, setProfitabilityScope] = useState<ProfitabilityScope>('products');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [comparisonStartDate, setComparisonStartDate] = useState(isoDateDaysAgo(6));
  const [comparisonEndDate, setComparisonEndDate] = useState(todayIsoDate());
  const [peakStartDate, setPeakStartDate] = useState(isoDateDaysAgo(13));
  const [peakEndDate, setPeakEndDate] = useState(todayIsoDate());

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('time');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const isDateRangeValid = !startDate || !endDate || startDate <= endDate;
  const isComparisonDateRangeValid =
    !comparisonStartDate || !comparisonEndDate || comparisonStartDate <= comparisonEndDate;
  const isPeakDateRangeValid = !peakStartDate || !peakEndDate || peakStartDate <= peakEndDate;

  const dailyQuery = useQuery({
    queryKey: ['manager-report-daily'],
    queryFn: () => api.managerReportsDaily(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const monthlyQuery = useQuery({
    queryKey: ['manager-report-monthly'],
    queryFn: () => api.managerReportsMonthly(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const typeQuery = useQuery({
    queryKey: ['manager-report-type'],
    queryFn: () => api.managerReportsByType(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const perfQuery = useQuery({
    queryKey: ['manager-report-perf'],
    queryFn: () => api.managerReportsPerformance(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const profitabilityQuery = useQuery({
    queryKey: ['manager-report-profitability', startDate, endDate],
    queryFn: () =>
      api.managerReportsProfitability(role ?? 'manager', {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
    enabled: role === 'manager' && tab === 'profitability' && isDateRangeValid,
  });

  const comparisonQuery = useQuery({
    queryKey: ['manager-report-period-comparison', comparisonStartDate, comparisonEndDate],
    queryFn: () =>
      api.managerReportsPeriodComparison(role ?? 'manager', {
        startDate: comparisonStartDate || undefined,
        endDate: comparisonEndDate || undefined,
      }),
    enabled: role === 'manager' && tab === 'comparison' && isComparisonDateRangeValid,
  });

  const peakQuery = useQuery({
    queryKey: ['manager-report-peak-hours-performance', peakStartDate, peakEndDate],
    queryFn: () =>
      api.managerReportsPeakHoursPerformance(role ?? 'manager', {
        startDate: peakStartDate || undefined,
        endDate: peakEndDate || undefined,
      }),
    enabled: role === 'manager' && tab === 'peak' && isPeakDateRangeValid,
  });

  useEffect(() => {
    setPage(1);
    setSearch('');
    if (tab === 'profitability') {
      setSortBy('net');
      setSortDirection('desc');
      return;
    }
    if (tab === 'comparison') {
      setSortBy('net');
      setSortDirection('desc');
      return;
    }
    if (tab === 'peak') {
      setSortBy('count');
      setSortDirection('desc');
      return;
    }
    setSortBy('time');
    setSortDirection('desc');
  }, [tab]);

  const rows = useMemo<ReportViewRow[]>(() => {
    if (tab === 'daily') {
      return (dailyQuery.data ?? []).map((row) => ({
        id: `day-${row.day}`,
        primary: row.day,
        secondary: '-',
        sales: row.sales,
        expenses: row.expenses,
        net: row.net,
        count: 0,
        quantity: 0,
        marginPercent: 0,
        estimatedUnitCost: 0,
      }));
    }

    if (tab === 'monthly') {
      return (monthlyQuery.data ?? []).map((row) => ({
        id: `month-${row.month}`,
        primary: row.month,
        secondary: '-',
        sales: row.sales,
        expenses: row.expenses,
        net: row.net,
        count: 0,
        quantity: 0,
        marginPercent: 0,
        estimatedUnitCost: 0,
      }));
    }

    if (tab === 'type') {
      return (typeQuery.data ?? []).map((row) => ({
        id: `type-${row.order_type}`,
        primary: orderTypeLabel(row.order_type),
        secondary: row.order_type,
        sales: row.sales,
        expenses: 0,
        net: row.sales,
        count: row.orders_count,
        quantity: row.orders_count,
        marginPercent: 0,
        estimatedUnitCost: 0,
      }));
    }

    if (tab === 'comparison') {
      return (comparisonQuery.data?.deltas ?? []).map((row, index) => ({
        id: `delta-${index}-${row.metric}`,
        primary: resolveComparisonMetricLabel(row.metric, index),
        secondary: row.change_percent == null ? '-' : `${row.change_percent.toFixed(2)}%`,
        sales: row.current_value,
        expenses: row.previous_value,
        net: row.absolute_change,
        count: 0,
        quantity: 0,
        marginPercent: row.change_percent ?? 0,
        estimatedUnitCost: 0,
      }));
    }

    if (tab === 'peak') {
      return (peakQuery.data?.by_hours ?? []).map((row) => ({
        id: `peak-${row.hour_label}`,
        primary: row.hour_label,
        secondary: `${row.avg_prep_minutes.toFixed(2)} دقيقة`,
        sales: row.sales,
        expenses: 0,
        net: row.avg_order_value,
        count: row.orders_count,
        quantity: row.orders_count,
        marginPercent: row.avg_prep_minutes,
        estimatedUnitCost: 0,
      }));
    }

    if (profitabilityScope === 'categories') {
      return (profitabilityQuery.data?.by_categories ?? []).map((row) => ({
        id: `category-${row.category_name}`,
        primary: row.category_name,
        secondary: '-',
        sales: row.revenue,
        expenses: row.estimated_cost,
        net: row.gross_profit,
        count: 0,
        quantity: row.quantity_sold,
        marginPercent: row.margin_percent,
        estimatedUnitCost: 0,
      }));
    }

    return (profitabilityQuery.data?.by_products ?? []).map((row) => ({
      id: `product-${row.product_id}`,
      primary: row.product_name,
      secondary: row.category_name,
      sales: row.revenue,
      expenses: row.estimated_cost,
      net: row.gross_profit,
      count: 0,
      quantity: row.quantity_sold,
      marginPercent: row.margin_percent,
      estimatedUnitCost: row.estimated_unit_cost,
    }));
  }, [
    tab,
    dailyQuery.data,
    monthlyQuery.data,
    typeQuery.data,
    comparisonQuery.data,
    peakQuery.data,
    profitabilityQuery.data,
    profitabilityScope,
  ]);

  const sortAccessors = useMemo(
    () => ({
      time: (row: ReportViewRow) => row.primary,
      primary: (row: ReportViewRow) => row.primary,
      sales: (row: ReportViewRow) => row.sales,
      expenses: (row: ReportViewRow) => row.expenses,
      net: (row: ReportViewRow) => row.net,
      quantity: (row: ReportViewRow) => row.quantity,
      count: (row: ReportViewRow) => row.count,
      marginPercent: (row: ReportViewRow) => row.marginPercent,
      estimatedUnitCost: (row: ReportViewRow) => row.estimatedUnitCost,
    }),
    []
  );

  const exportRowsSource = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query ? rows.filter((row) => `${row.primary} ${row.secondary}`.toLowerCase().includes(query)) : rows;
    const sorter = sortAccessors[sortBy as keyof typeof sortAccessors];
    return [...filtered].sort((a, b) => {
      const va = sorter?.(a);
      const vb = sorter?.(b);
      if (va === vb) return 0;
      if (va === undefined || va === null) return 1;
      if (vb === undefined || vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDirection === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortDirection === 'asc' ? sa.localeCompare(sb, 'ar') : sb.localeCompare(sa, 'ar');
    });
  }, [rows, search, sortBy, sortDirection, sortAccessors]);

  const view = useDataView<ReportViewRow>({
    rows,
    search,
    page,
    pageSize: 10,
    sortBy,
    sortDirection,
    searchAccessor: (row) => `${row.primary} ${row.secondary}`,
    sortAccessors,
  });

  const loading =
    dailyQuery.isLoading ||
    monthlyQuery.isLoading ||
    typeQuery.isLoading ||
    perfQuery.isLoading ||
    (tab === 'comparison' && comparisonQuery.isLoading) ||
    (tab === 'peak' && peakQuery.isLoading) ||
    (tab === 'profitability' && profitabilityQuery.isLoading);

  const error =
    dailyQuery.isError ||
    monthlyQuery.isError ||
    typeQuery.isError ||
    perfQuery.isError ||
    (tab === 'comparison' && comparisonQuery.isError) ||
    (tab === 'peak' && peakQuery.isError) ||
    (tab === 'profitability' && profitabilityQuery.isError);

  const sortOptions =
    tab === 'comparison'
      ? [
          { value: 'primary', label: 'ترتيب: المؤشر' },
          { value: 'sales', label: 'ترتيب: القيمة الحالية' },
          { value: 'expenses', label: 'ترتيب: القيمة السابقة' },
          { value: 'net', label: 'ترتيب: فرق القيمة' },
          { value: 'marginPercent', label: 'ترتيب: فرق %' },
        ]
      : tab === 'peak'
      ? [
          { value: 'primary', label: 'ترتيب: الساعة' },
          { value: 'count', label: 'ترتيب: عدد الطلبات' },
          { value: 'sales', label: 'ترتيب: المبيعات' },
          { value: 'net', label: 'ترتيب: متوسط قيمة الطلب' },
          { value: 'marginPercent', label: 'ترتيب: متوسط التحضير (دقيقة)' },
        ]
      : tab === 'profitability'
      ? [
          { value: 'primary', label: profitabilityScope === 'products' ? 'ترتيب: الصنف' : 'ترتيب: الفئة' },
          { value: 'quantity', label: 'ترتيب: الكمية' },
          { value: 'sales', label: 'ترتيب: الإيراد' },
          { value: 'expenses', label: 'ترتيب: التكلفة' },
          { value: 'net', label: 'ترتيب: الربح' },
          { value: 'marginPercent', label: 'ترتيب: هامش الربح %' },
          ...(profitabilityScope === 'products' ? [{ value: 'estimatedUnitCost', label: 'ترتيب: تكلفة الوحدة' }] : []),
        ]
      : [
          { value: 'time', label: 'ترتيب: الفترة' },
          { value: 'sales', label: 'ترتيب: المبيعات' },
          { value: 'expenses', label: 'ترتيب: المصروفات' },
          { value: 'net', label: 'ترتيب: الصافي' },
          ...(tab === 'type' ? [{ value: 'count', label: 'ترتيب: عدد الطلبات' }] : []),
        ];

  const exportMeta = useMemo(() => {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    if (tab === 'comparison') {
      return {
        title: 'مقارنة الفترات',
        fileBase: `period_comparison_${stamp}`,
        headers: ['المؤشر', 'القيمة الحالية', 'القيمة السابقة', 'فرق القيمة', 'فرق %'],
        rows: exportRowsSource.map((row) => [
          row.primary,
          Number(row.sales.toFixed(2)),
          Number(row.expenses.toFixed(2)),
          Number(row.net.toFixed(2)),
          row.secondary,
        ]),
      };
    }
    if (tab === 'peak') {
      return {
        title: 'تقرير ساعة الذروة والأداء',
        fileBase: `peak_hours_performance_${stamp}`,
        headers: ['الساعة', 'عدد الطلبات المسلّمة', 'المبيعات', 'متوسط قيمة الطلب', 'متوسط التحضير (دقيقة)'],
        rows: exportRowsSource.map((row) => [
          row.primary,
          row.count,
          Number(row.sales.toFixed(2)),
          Number(row.net.toFixed(2)),
          Number(row.marginPercent.toFixed(2)),
        ]),
      };
    }
    if (tab === 'profitability') {
      if (profitabilityScope === 'products') {
        return {
          title: 'ربحية الأصناف',
          fileBase: `profitability_products_${stamp}`,
          headers: ['الصنف', 'الفئة', 'الكمية المباعة', 'الإيراد', 'التكلفة التقديرية', 'الربح الإجمالي', 'هامش الربح %', 'تكلفة الوحدة'],
          rows: exportRowsSource.map((row) => [
            row.primary,
            row.secondary,
            row.quantity,
            Number(row.sales.toFixed(2)),
            Number(row.expenses.toFixed(2)),
            Number(row.net.toFixed(2)),
            Number(row.marginPercent.toFixed(2)),
            Number(row.estimatedUnitCost.toFixed(4)),
          ]),
        };
      }
      return {
        title: 'ربحية الفئات',
        fileBase: `profitability_categories_${stamp}`,
        headers: ['الفئة', 'الكمية المباعة', 'الإيراد', 'التكلفة التقديرية', 'الربح الإجمالي', 'هامش الربح %'],
        rows: exportRowsSource.map((row) => [
          row.primary,
          row.quantity,
          Number(row.sales.toFixed(2)),
          Number(row.expenses.toFixed(2)),
          Number(row.net.toFixed(2)),
          Number(row.marginPercent.toFixed(2)),
        ]),
      };
    }
    if (tab === 'type') {
      return {
        title: 'التقرير حسب نوع الطلب',
        fileBase: `report_by_order_type_${stamp}`,
        headers: ['نوع الطلب', 'عدد الطلبات', 'المبيعات', 'المصروفات', 'الصافي'],
        rows: exportRowsSource.map((row) => [
          row.primary,
          row.count,
          Number(row.sales.toFixed(2)),
          Number(row.expenses.toFixed(2)),
          Number(row.net.toFixed(2)),
        ]),
      };
    }
    if (tab === 'monthly') {
      return {
        title: 'التقرير الشهري',
        fileBase: `monthly_report_${stamp}`,
        headers: ['الشهر', 'المبيعات', 'المصروفات', 'الصافي'],
        rows: exportRowsSource.map((row) => [
          row.primary,
          Number(row.sales.toFixed(2)),
          Number(row.expenses.toFixed(2)),
          Number(row.net.toFixed(2)),
        ]),
      };
    }
    return {
      title: 'التقرير اليومي',
      fileBase: `daily_report_${stamp}`,
      headers: ['اليوم', 'المبيعات', 'المصروفات', 'الصافي'],
      rows: exportRowsSource.map((row) => [
        row.primary,
        Number(row.sales.toFixed(2)),
        Number(row.expenses.toFixed(2)),
        Number(row.net.toFixed(2)),
      ]),
    };
  }, [tab, profitabilityScope, exportRowsSource]);

  if (loading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل التقارير...</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل بيانات التقارير.</div>;
  }

  return (
    <div className="admin-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="rounded-xl bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700">
          متوسط التحضير: {perfQuery.data?.avg_prep_minutes.toFixed(1) ?? '0.0'} دقيقة
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab('daily')}
          className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === 'daily' ? 'bg-brand-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
        >
          يومي
        </button>
        <button
          type="button"
          onClick={() => setTab('monthly')}
          className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === 'monthly' ? 'bg-brand-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
        >
          شهري
        </button>
        <button
          type="button"
          onClick={() => setTab('type')}
          className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === 'type' ? 'bg-brand-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
        >
          حسب النوع
        </button>
        <button
          type="button"
          onClick={() => setTab('profitability')}
          className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === 'profitability' ? 'bg-brand-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
        >
          ربحية الأصناف والفئات
        </button>
        <button
          type="button"
          onClick={() => setTab('comparison')}
          className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === 'comparison' ? 'bg-brand-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
        >
          مقارنة الفترات
        </button>
        <button
          type="button"
          onClick={() => setTab('peak')}
          className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === 'peak' ? 'bg-brand-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
        >
          ساعة الذروة والأداء
        </button>
      </div>

      {tab === 'comparison' ? (
        <section className="admin-card grid gap-3 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="form-label">من تاريخ</span>
              <input
                type="date"
                className="form-input"
                value={comparisonStartDate}
                onChange={(event) => {
                  setComparisonStartDate(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="space-y-1">
              <span className="form-label">إلى تاريخ</span>
              <input
                type="date"
                className="form-input"
                value={comparisonEndDate}
                onChange={(event) => {
                  setComparisonEndDate(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <div className="flex items-end justify-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setComparisonStartDate(isoDateDaysAgo(6));
                  setComparisonEndDate(todayIsoDate());
                  setPage(1);
                }}
              >
                آخر 7 أيام
              </button>
            </div>
          </div>

          {!isComparisonDateRangeValid ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              تاريخ البداية يجب أن يكون قبل أو مساويًا لتاريخ النهاية.
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
              <p className="text-xs font-semibold text-brand-700">الفترة الحالية</p>
              <p className="text-xs text-brand-700">
                {comparisonQuery.data?.current_period.start_date ?? '-'} إلى {comparisonQuery.data?.current_period.end_date ?? '-'}
              </p>
              <div className="mt-2 grid gap-1 text-sm text-brand-900">
                <p>المبيعات: {(comparisonQuery.data?.current_period.sales ?? 0).toFixed(2)} د.ج</p>
                <p>المصروفات: {(comparisonQuery.data?.current_period.expenses ?? 0).toFixed(2)} د.ج</p>
                <p>الصافي: {(comparisonQuery.data?.current_period.net ?? 0).toFixed(2)} د.ج</p>
                <p>عدد الطلبات المسلّمة: {comparisonQuery.data?.current_period.delivered_orders_count ?? 0}</p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold text-gray-700">الفترة السابقة</p>
              <p className="text-xs text-gray-600">
                {comparisonQuery.data?.previous_period.start_date ?? '-'} إلى {comparisonQuery.data?.previous_period.end_date ?? '-'}
              </p>
              <div className="mt-2 grid gap-1 text-sm text-gray-800">
                <p>المبيعات: {(comparisonQuery.data?.previous_period.sales ?? 0).toFixed(2)} د.ج</p>
                <p>المصروفات: {(comparisonQuery.data?.previous_period.expenses ?? 0).toFixed(2)} د.ج</p>
                <p>الصافي: {(comparisonQuery.data?.previous_period.net ?? 0).toFixed(2)} د.ج</p>
                <p>عدد الطلبات المسلّمة: {comparisonQuery.data?.previous_period.delivered_orders_count ?? 0}</p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'peak' ? (
        <section className="admin-card grid gap-3 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="form-label">من تاريخ</span>
              <input
                type="date"
                className="form-input"
                value={peakStartDate}
                onChange={(event) => {
                  setPeakStartDate(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="space-y-1">
              <span className="form-label">إلى تاريخ</span>
              <input
                type="date"
                className="form-input"
                value={peakEndDate}
                onChange={(event) => {
                  setPeakEndDate(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <div className="flex items-end justify-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setPeakStartDate(isoDateDaysAgo(13));
                  setPeakEndDate(todayIsoDate());
                  setPage(1);
                }}
              >
                آخر 14 يوم
              </button>
            </div>
          </div>

          {!isPeakDateRangeValid ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              تاريخ البداية يجب أن يكون قبل أو مساويًا لتاريخ النهاية.
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs font-semibold text-gray-500">ساعة الذروة</p>
              <p className="text-lg font-black text-gray-900">{peakQuery.data?.peak_hour ?? '-'}</p>
            </div>
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-xs font-semibold text-brand-700">طلبات ساعة الذروة</p>
              <p className="text-lg font-black text-brand-800">{peakQuery.data?.peak_orders_count ?? 0}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-xs font-semibold text-emerald-700">مبيعات ساعة الذروة</p>
              <p className="text-lg font-black text-emerald-800">{(peakQuery.data?.peak_sales ?? 0).toFixed(2)} د.ج</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold text-amber-700">متوسط التحضير العام</p>
              <p className="text-lg font-black text-amber-800">{(peakQuery.data?.overall_avg_prep_minutes ?? 0).toFixed(2)} دقيقة</p>
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'profitability' ? (
        <section className="admin-card grid gap-3 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1">
              <span className="form-label">من تاريخ (اختياري)</span>
              <input
                type="date"
                className="form-input"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="space-y-1">
              <span className="form-label">إلى تاريخ</span>
              <input
                type="date"
                className="form-input"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-sm font-bold ${profitabilityScope === 'products' ? 'bg-brand-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
                onClick={() => {
                  setProfitabilityScope('products');
                  setPage(1);
                }}
              >
                ربحية الأصناف
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-sm font-bold ${profitabilityScope === 'categories' ? 'bg-brand-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
                onClick={() => {
                  setProfitabilityScope('categories');
                  setPage(1);
                }}
              >
                ربحية الفئات
              </button>
            </div>
            <div className="flex items-end justify-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setStartDate('');
                  setEndDate(todayIsoDate());
                  setPage(1);
                }}
              >
                إعادة ضبط المدة
              </button>
            </div>
          </div>
          {!isDateRangeValid ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              تاريخ البداية يجب أن يكون قبل أو مساويًا لتاريخ النهاية.
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs font-semibold text-gray-500">الكمية المباعة</p>
              <p className="text-lg font-black text-gray-900">{profitabilityQuery.data?.total_quantity_sold ?? 0}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-xs font-semibold text-emerald-700">إجمالي الإيراد</p>
              <p className="text-lg font-black text-emerald-800">{(profitabilityQuery.data?.total_revenue ?? 0).toFixed(2)} د.ج</p>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
              <p className="text-xs font-semibold text-rose-700">إجمالي التكلفة التقديرية</p>
              <p className="text-lg font-black text-rose-800">{(profitabilityQuery.data?.total_estimated_cost ?? 0).toFixed(2)} د.ج</p>
            </div>
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-xs font-semibold text-brand-700">الربح الإجمالي / الهامش</p>
              <p className="text-lg font-black text-brand-800">
                {(profitabilityQuery.data?.total_gross_profit ?? 0).toFixed(2)} د.ج
                <span className="mr-2 text-sm font-semibold">({(profitabilityQuery.data?.total_margin_percent ?? 0).toFixed(2)}%)</span>
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => downloadCsvReport(exportMeta.fileBase, exportMeta.headers, exportMeta.rows)}
          disabled={exportMeta.rows.length === 0}
        >
          تصدير CSV
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => downloadXlsxReport(exportMeta.fileBase, exportMeta.title, exportMeta.headers, exportMeta.rows)}
          disabled={exportMeta.rows.length === 0}
        >
          تصدير XLSX
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => openPdfPrintView(exportMeta.title, exportMeta.headers, exportMeta.rows)}
          disabled={exportMeta.rows.length === 0}
        >
          تصدير PDF
        </button>
      </div>

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
        sortOptions={sortOptions}
        searchPlaceholder={
          tab === 'comparison'
            ? 'بحث في مؤشرات المقارنة...'
            : tab === 'peak'
            ? 'بحث في ساعات الذروة...'
            : tab === 'profitability'
            ? profitabilityScope === 'products'
              ? 'بحث في ربحية الأصناف...'
              : 'بحث في ربحية الفئات...'
            : 'بحث في التقارير...'
        }
      />

      <section className="admin-table-shell">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              {tab === 'comparison' ? (
                <tr>
                  <th className="px-4 py-3 font-bold">المؤشر</th>
                  <th className="px-4 py-3 font-bold">القيمة الحالية</th>
                  <th className="px-4 py-3 font-bold">القيمة السابقة</th>
                  <th className="px-4 py-3 font-bold">فرق القيمة</th>
                  <th className="px-4 py-3 font-bold">فرق %</th>
                </tr>
              ) : tab === 'peak' ? (
                <tr>
                  <th className="px-4 py-3 font-bold">الساعة</th>
                  <th className="px-4 py-3 font-bold">عدد الطلبات المسلّمة</th>
                  <th className="px-4 py-3 font-bold">المبيعات</th>
                  <th className="px-4 py-3 font-bold">متوسط قيمة الطلب</th>
                  <th className="px-4 py-3 font-bold">متوسط التحضير (دقيقة)</th>
                </tr>
              ) : tab === 'profitability' ? (
                profitabilityScope === 'products' ? (
                  <tr>
                    <th className="px-4 py-3 font-bold">الصنف</th>
                    <th className="px-4 py-3 font-bold">الفئة</th>
                    <th className="px-4 py-3 font-bold">الكمية المباعة</th>
                    <th className="px-4 py-3 font-bold">الإيراد</th>
                    <th className="px-4 py-3 font-bold">التكلفة التقديرية</th>
                    <th className="px-4 py-3 font-bold">الربح الإجمالي</th>
                    <th className="px-4 py-3 font-bold">هامش الربح %</th>
                    <th className="px-4 py-3 font-bold">تكلفة الوحدة</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-4 py-3 font-bold">الفئة</th>
                    <th className="px-4 py-3 font-bold">الكمية المباعة</th>
                    <th className="px-4 py-3 font-bold">الإيراد</th>
                    <th className="px-4 py-3 font-bold">التكلفة التقديرية</th>
                    <th className="px-4 py-3 font-bold">الربح الإجمالي</th>
                    <th className="px-4 py-3 font-bold">هامش الربح %</th>
                  </tr>
                )
              ) : (
                <tr>
                  <th className="px-4 py-3 font-bold">{tab === 'monthly' ? 'الشهر' : tab === 'daily' ? 'اليوم' : 'نوع الطلب'}</th>
                  {tab === 'type' ? <th className="px-4 py-3 font-bold">عدد الطلبات</th> : null}
                  <th className="px-4 py-3 font-bold">المبيعات</th>
                  <th className="px-4 py-3 font-bold">المصروفات</th>
                  <th className="px-4 py-3 font-bold">الصافي</th>
                </tr>
              )}
            </thead>
            <tbody>
              {view.rows.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-8 text-center text-sm text-gray-500"
                    colSpan={
                      tab === 'comparison'
                        ? 5
                        : tab === 'peak'
                        ? 5
                        : tab === 'profitability'
                        ? profitabilityScope === 'products'
                          ? 8
                          : 6
                        : tab === 'type'
                        ? 5
                        : 4
                    }
                  >
                    لا توجد بيانات للعرض.
                  </td>
                </tr>
              ) : (
                view.rows.map((row) =>
                  tab === 'comparison' ? (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td data-label="المؤشر" className="px-4 py-3 font-semibold">{row.primary}</td>
                      <td data-label="القيمة الحالية" className="px-4 py-3 font-bold text-brand-700">{row.sales.toFixed(2)}</td>
                      <td data-label="القيمة السابقة" className="px-4 py-3 font-bold text-gray-700">{row.expenses.toFixed(2)}</td>
                      <td data-label="فرق القيمة" className={`px-4 py-3 font-black ${row.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {row.net.toFixed(2)}
                      </td>
                      <td data-label="فرق %" className={`px-4 py-3 font-semibold ${row.marginPercent >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {row.secondary}
                      </td>
                    </tr>
                  ) : tab === 'peak' ? (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td data-label="الساعة" className="px-4 py-3 font-semibold">{row.primary}</td>
                      <td data-label="عدد الطلبات المسلّمة" className="px-4 py-3">{row.count}</td>
                      <td data-label="المبيعات" className="px-4 py-3 font-bold text-emerald-700">{row.sales.toFixed(2)}</td>
                      <td data-label="متوسط قيمة الطلب" className="px-4 py-3 font-bold text-brand-700">{row.net.toFixed(2)}</td>
                      <td data-label="متوسط التحضير (دقيقة)" className="px-4 py-3">{row.marginPercent.toFixed(2)}</td>
                    </tr>
                  ) : tab === 'profitability' ? (
                    profitabilityScope === 'products' ? (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td data-label="الصنف" className="px-4 py-3 font-semibold">{row.primary}</td>
                        <td data-label="الفئة" className="px-4 py-3">{row.secondary}</td>
                        <td data-label="الكمية المباعة" className="px-4 py-3">{row.quantity}</td>
                        <td data-label="الإيراد" className="px-4 py-3 font-bold text-emerald-700">{row.sales.toFixed(2)}</td>
                        <td data-label="التكلفة التقديرية" className="px-4 py-3 font-bold text-rose-700">{row.expenses.toFixed(2)}</td>
                        <td data-label="الربح الإجمالي" className="px-4 py-3 font-black text-brand-700">{row.net.toFixed(2)}</td>
                        <td data-label="هامش الربح %" className="px-4 py-3">{row.marginPercent.toFixed(2)}%</td>
                        <td data-label="تكلفة الوحدة" className="px-4 py-3">{row.estimatedUnitCost.toFixed(4)}</td>
                      </tr>
                    ) : (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td data-label="الفئة" className="px-4 py-3 font-semibold">{row.primary}</td>
                        <td data-label="الكمية المباعة" className="px-4 py-3">{row.quantity}</td>
                        <td data-label="الإيراد" className="px-4 py-3 font-bold text-emerald-700">{row.sales.toFixed(2)}</td>
                        <td data-label="التكلفة التقديرية" className="px-4 py-3 font-bold text-rose-700">{row.expenses.toFixed(2)}</td>
                        <td data-label="الربح الإجمالي" className="px-4 py-3 font-black text-brand-700">{row.net.toFixed(2)}</td>
                        <td data-label="هامش الربح %" className="px-4 py-3">{row.marginPercent.toFixed(2)}%</td>
                      </tr>
                    )
                  ) : (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td data-label={tab === 'monthly' ? 'الشهر' : tab === 'daily' ? 'اليوم' : 'نوع الطلب'} className="px-4 py-3 font-semibold">{row.primary}</td>
                      {tab === 'type' ? <td data-label="عدد الطلبات" className="px-4 py-3">{row.count}</td> : null}
                      <td data-label="المبيعات" className="px-4 py-3 font-bold text-emerald-700">{row.sales.toFixed(2)}</td>
                      <td data-label="المصروفات" className="px-4 py-3 font-bold text-rose-700">{row.expenses.toFixed(2)}</td>
                      <td data-label="الصافي" className="px-4 py-3 font-black text-brand-700">{row.net.toFixed(2)}</td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
        <TablePagination page={view.page} totalPages={view.totalPages} totalRows={view.totalRows} onPageChange={setPage} />
      </section>
    </div>
  );
}
