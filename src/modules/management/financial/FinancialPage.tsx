import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import { useDataView } from '@/shared/hooks/useDataView';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';
import { formatOrderTrackingId } from '@/shared/utils/order';
import { parseApiDateMs } from '@/shared/utils/date';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';
import { sanitizeMojibakeText } from '@/shared/utils/textSanitizer';

const transactionTypeLabel: Record<'sale' | 'refund' | 'expense', string> = {
  sale: 'مبيعات',
  refund: 'مرتجعات',
  expense: 'مصروف',
};

const transactionNoteFallback: Record<'sale' | 'refund' | 'expense', string> = {
  sale: 'تحصيل نقدي عند التسليم',
  refund: 'إرجاع مالي للطلب',
  expense: 'قيد مصروف تشغيلي',
};

function renderFinancialNote(note: string | null | undefined, type: 'sale' | 'refund' | 'expense'): string {
  return sanitizeMojibakeText(note, transactionNoteFallback[type]);
}

function asMoney(value: number): string {
  return `${value.toFixed(2)} د.ج`;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function FinancialPage() {
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [closureSearch, setClosureSearch] = useState('');
  const [closureSortBy, setClosureSortBy] = useState('closed_at');
  const [closureSortDirection, setClosureSortDirection] = useState<'asc' | 'desc'>('desc');
  const [closurePage, setClosurePage] = useState(1);

  const [openingCash, setOpeningCash] = useState('0');
  const [actualCash, setActualCash] = useState('0');
  const [closureNote, setClosureNote] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const transactionsQuery = useQuery({
    queryKey: ['manager-financial'],
    queryFn: () => api.managerFinancialTransactions(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const closuresQuery = useQuery({
    queryKey: ['manager-shift-closures'],
    queryFn: () => api.managerShiftClosures(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const createClosureMutation = useMutation({
    mutationFn: () =>
      api.managerCreateShiftClosure(role ?? 'manager', {
        opening_cash: Number(openingCash),
        actual_cash: Number(actualCash),
        note: closureNote.trim() || null,
      }),
    onSuccess: () => {
      setClosureNote('');
      queryClient.invalidateQueries({ queryKey: ['manager-shift-closures'] });
      queryClient.invalidateQueries({ queryKey: ['manager-dashboard-operational-heart'] });
      queryClient.invalidateQueries({ queryKey: ['manager-dashboard-smart-orders'] });
      queryClient.invalidateQueries({ queryKey: ['manager-audit-system-logs'] });
    },
  });

  const view = useDataView({
    rows: transactionsQuery.data ?? [],
    search,
    page,
    pageSize: 12,
    sortBy,
    sortDirection,
    searchAccessor: (row) =>
      `${row.id} ${row.type} ${renderFinancialNote(row.note, row.type)} ${row.order_id ?? ''} ${row.order_id ? formatOrderTrackingId(row.order_id) : ''}`,
    sortAccessors: {
      created_at: (row) => parseApiDateMs(row.created_at),
      amount: (row) => row.amount,
      id: (row) => row.id,
      type: (row) => row.type,
    },
  });

  const closuresView = useDataView({
    rows: closuresQuery.data ?? [],
    search: closureSearch,
    page: closurePage,
    pageSize: 10,
    sortBy: closureSortBy,
    sortDirection: closureSortDirection,
    searchAccessor: (row) => `${row.business_date} ${row.note ?? ''} ${row.closed_by} ${row.transactions_count}`,
    sortAccessors: {
      closed_at: (row) => parseApiDateMs(row.closed_at),
      expected_cash: (row) => row.expected_cash,
      actual_cash: (row) => row.actual_cash,
      variance: (row) => row.variance,
    },
  });

  const todayDateKey = useMemo(() => localDateKey(new Date(nowMs)), [nowMs]);

  const todaySummary = useMemo(() => {
    const rows = (transactionsQuery.data ?? []).filter(
      (row) => localDateKey(new Date(parseApiDateMs(row.created_at))) === todayDateKey
    );

    const sales = rows.filter((row) => row.type === 'sale').reduce((sum, row) => sum + row.amount, 0);
    const refunds = rows.filter((row) => row.type === 'refund').reduce((sum, row) => sum + row.amount, 0);
    const expenses = rows.filter((row) => row.type === 'expense').reduce((sum, row) => sum + row.amount, 0);

    return {
      sales,
      refunds,
      expenses,
      transactionsCount: rows.length,
    };
  }, [todayDateKey, transactionsQuery.data]);

  const openingCashValue = Number(openingCash);
  const actualCashValue = Number(actualCash);
  const expectedCashPreview = (Number.isFinite(openingCashValue) ? openingCashValue : 0)
    + todaySummary.sales
    - todaySummary.refunds
    - todaySummary.expenses;
  const variancePreview = (Number.isFinite(actualCashValue) ? actualCashValue : 0) - expectedCashPreview;

  const todayClosure = useMemo(
    () => (closuresQuery.data ?? []).find((row) => row.business_date === todayDateKey),
    [closuresQuery.data, todayDateKey]
  );

  const closureError = createClosureMutation.isError
    ? createClosureMutation.error instanceof Error
      ? createClosureMutation.error.message
      : 'تعذر تنفيذ إغلاق الوردية.'
    : '';

  if (transactionsQuery.isLoading || closuresQuery.isLoading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل البيانات المالية...</div>;
  }
  if (transactionsQuery.isError || closuresQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل البيانات المالية.</div>;
  }

  return (
    <div className="admin-page">
      <section className="admin-card p-4">
        <div className="mb-3">
          <h3 className="text-sm font-black text-gray-800">إغلاق وردية اليوم</h3>
          <p className="text-xs text-gray-600">أدخل رصيد البداية والنقد الفعلي في الصندوق لإتمام المطابقة.</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <p className="text-xs text-gray-500">مبيعات اليوم</p>
            <p className="font-black text-emerald-700">{asMoney(todaySummary.sales)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <p className="text-xs text-gray-500">مرتجعات اليوم</p>
            <p className="font-black text-amber-700">{asMoney(todaySummary.refunds)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <p className="text-xs text-gray-500">مصروفات اليوم</p>
            <p className="font-black text-rose-700">{asMoney(todaySummary.expenses)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <p className="text-xs text-gray-500">عدد الحركات</p>
            <p className="font-black text-brand-700">{todaySummary.transactionsCount}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="form-label">رصيد بداية الوردية (د.ج)</span>
            <input
              type="number"
              min={0}
              step="0.1"
              className="form-input"
              value={openingCash}
              onChange={(event) => setOpeningCash(event.target.value)}
            />
          </label>

          <label className="space-y-1">
            <span className="form-label">النقد الفعلي في الصندوق (د.ج)</span>
            <input
              type="number"
              min={0}
              step="0.1"
              className="form-input"
              value={actualCash}
              onChange={(event) => setActualCash(event.target.value)}
            />
          </label>

          <label className="space-y-1">
            <span className="form-label">ملاحظة الإغلاق (اختياري)</span>
            <input
              className="form-input"
              value={closureNote}
              onChange={(event) => setClosureNote(event.target.value)}
              placeholder="ملاحظة إضافية"
            />
          </label>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2">
            <p className="text-xs text-gray-600">الرصيد المتوقع للصندوق</p>
            <p className="text-sm font-black text-brand-700">{asMoney(expectedCashPreview)}</p>
          </div>
          <div className={`rounded-xl border px-3 py-2 ${Math.abs(variancePreview) < 0.009 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className="text-xs text-gray-600">فرق المطابقة</p>
            <p className={`text-sm font-black ${Math.abs(variancePreview) < 0.009 ? 'text-emerald-700' : 'text-amber-700'}`}>
              {asMoney(variancePreview)}
            </p>
          </div>
        </div>

        {todayClosure ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            تم إغلاق وردية اليوم. يمكنك مراجعة تفاصيل الإغلاق في جدول سجل الإغلاقات أدناه.
          </div>
        ) : null}

        {closureError ? <p className="mt-3 text-sm font-semibold text-rose-700">{closureError}</p> : null}

        {createClosureMutation.isSuccess ? (
          <p className="mt-3 text-sm font-semibold text-emerald-700">تم تنفيذ إغلاق الوردية وتسجيل المطابقة بنجاح.</p>
        ) : null}

        <button
          type="button"
          className="btn-primary mt-3"
          disabled={
            createClosureMutation.isPending ||
            !!todayClosure ||
            !Number.isFinite(Number(openingCash)) ||
            Number(openingCash) < 0 ||
            !Number.isFinite(Number(actualCash)) ||
            Number(actualCash) < 0
          }
          onClick={() => createClosureMutation.mutate()}
        >
          {createClosureMutation.isPending ? 'جارٍ تنفيذ الإغلاق...' : 'إغلاق وردية اليوم'}
        </button>
      </section>

      <div className="space-y-2">
        <h3 className="text-sm font-black text-gray-800">الحركات المالية</h3>
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
            { value: 'amount', label: 'ترتيب: المبلغ' },
            { value: 'type', label: 'ترتيب: النوع' },
            { value: 'id', label: 'ترتيب: رقم المعاملة' },
          ]}
          searchPlaceholder="بحث في السجلات المالية..."
        />
      </div>

      <section className="admin-table-shell">

        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">#</th>
                <th className="px-4 py-3 font-bold">النوع</th>
                <th className="px-4 py-3 font-bold">الطلب</th>
                <th className="px-4 py-3 font-bold">المبلغ</th>
                <th className="px-4 py-3 font-bold">الملاحظة</th>
                <th className="px-4 py-3 font-bold">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td data-label="#" className="px-4 py-3 font-bold">{row.id}</td>
                  <td data-label="النوع" className="px-4 py-3">{transactionTypeLabel[row.type]}</td>
                  <td data-label="الطلب" className="px-4 py-3">{row.order_id ? formatOrderTrackingId(row.order_id) : '-'}</td>
                  <td data-label="المبلغ" className="px-4 py-3 font-bold text-brand-700">{row.amount.toFixed(2)} د.ج</td>
                  <td data-label="الملاحظة" className="px-4 py-3 text-xs text-gray-500">{renderFinancialNote(row.note, row.type)}</td>
                  <td data-label="الوقت" className="px-4 py-3 text-xs text-gray-500">{new Date(parseApiDateMs(row.created_at)).toLocaleString('ar-DZ-u-nu-latn')}</td>
                </tr>
              ))}
              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    لا توجد حركات مالية.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination page={view.page} totalPages={view.totalPages} totalRows={view.totalRows} onPageChange={setPage} />
      </section>

      <div className="space-y-2">
        <h3 className="text-sm font-black text-gray-800">سجل إغلاق الورديات</h3>
        <TableControls
          search={closureSearch}
          onSearchChange={(value) => {
            setClosureSearch(value);
            setClosurePage(1);
          }}
          sortBy={closureSortBy}
          onSortByChange={setClosureSortBy}
          sortDirection={closureSortDirection}
          onSortDirectionChange={setClosureSortDirection}
          sortOptions={[
            { value: 'closed_at', label: 'ترتيب: وقت الإغلاق' },
            { value: 'expected_cash', label: 'ترتيب: الرصيد المتوقع' },
            { value: 'actual_cash', label: 'ترتيب: الرصيد الفعلي' },
            { value: 'variance', label: 'ترتيب: فرق المطابقة' },
          ]}
          searchPlaceholder="بحث في سجل الإغلاقات..."
        />
      </div>

      <section className="admin-table-shell">

        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">التاريخ</th>
                <th className="px-4 py-3 font-bold">بداية الوردية</th>
                <th className="px-4 py-3 font-bold">المبيعات</th>
                <th className="px-4 py-3 font-bold">المرتجعات</th>
                <th className="px-4 py-3 font-bold">المصروفات</th>
                <th className="px-4 py-3 font-bold">المتوقع</th>
                <th className="px-4 py-3 font-bold">الفعلي</th>
                <th className="px-4 py-3 font-bold">الفرق</th>
                <th className="px-4 py-3 font-bold">حركات</th>
                <th className="px-4 py-3 font-bold">بواسطة</th>
                <th className="px-4 py-3 font-bold">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {closuresView.rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td data-label="التاريخ" className="px-4 py-3 font-bold">{row.business_date}</td>
                  <td data-label="بداية الوردية" className="px-4 py-3">{asMoney(row.opening_cash)}</td>
                  <td data-label="المبيعات" className="px-4 py-3 text-emerald-700">{asMoney(row.sales_total)}</td>
                  <td data-label="المرتجعات" className="px-4 py-3 text-amber-700">{asMoney(row.refunds_total)}</td>
                  <td data-label="المصروفات" className="px-4 py-3 text-rose-700">{asMoney(row.expenses_total)}</td>
                  <td data-label="المتوقع" className="px-4 py-3 font-bold text-brand-700">{asMoney(row.expected_cash)}</td>
                  <td data-label="الفعلي" className="px-4 py-3 font-bold text-gray-900">{asMoney(row.actual_cash)}</td>
                  <td data-label="الفرق" className={`px-4 py-3 font-bold ${Math.abs(row.variance) < 0.009 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {asMoney(row.variance)}
                  </td>
                  <td data-label="حركات" className="px-4 py-3">{row.transactions_count}</td>
                  <td data-label="بواسطة" className="px-4 py-3">{row.closed_by}</td>
                  <td data-label="الوقت" className="px-4 py-3 text-xs text-gray-500">{new Date(parseApiDateMs(row.closed_at)).toLocaleString('ar-DZ-u-nu-latn')}</td>
                </tr>
              ))}
              {closuresView.rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-500">
                    لا توجد إغلاقات وردية مسجلة بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={closuresView.page}
          totalPages={closuresView.totalPages}
          totalRows={closuresView.totalRows}
          onPageChange={setClosurePage}
        />
      </section>
    </div>
  );
}

