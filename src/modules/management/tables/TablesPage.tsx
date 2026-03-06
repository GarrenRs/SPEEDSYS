import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type { ManagerTable } from '@/shared/api/types';
import { useDataView } from '@/shared/hooks/useDataView';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';
import { tableStatusLabel } from '@/shared/utils/order';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';

const statusBadgeClass: Record<ManagerTable['status'], string> = {
  available: 'bg-emerald-100 text-emerald-700',
  occupied: 'bg-amber-100 text-amber-700',
  reserved: 'bg-sky-100 text-sky-700',
};

function resolveTablePublicUrl(qrCode: string): string {
  if (/^https?:\/\//i.test(qrCode)) {
    return qrCode;
  }
  const path = qrCode.startsWith('/') ? qrCode : `/${qrCode}`;
  if (typeof window === 'undefined') {
    return path;
  }
  return `${window.location.origin}${path}`;
}

export function TablesPage() {
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [newTableStatus, setNewTableStatus] = useState<ManagerTable['status']>('available');
  const [pendingStatuses, setPendingStatuses] = useState<Record<number, ManagerTable['status']>>({});
  const [copiedTableId, setCopiedTableId] = useState<number | null>(null);
  const [settlementAmounts, setSettlementAmounts] = useState<Record<number, string>>({});

  const refreshTables = () => {
    queryClient.invalidateQueries({ queryKey: ['manager-tables'] });
    queryClient.invalidateQueries({ queryKey: ['public-tables'] });
    queryClient.invalidateQueries({ queryKey: ['manager-orders-paged'] });
    queryClient.invalidateQueries({ queryKey: ['manager-dashboard-operational-heart'] });
    queryClient.invalidateQueries({ queryKey: ['manager-dashboard-smart-orders'] });
    queryClient.invalidateQueries({ queryKey: ['manager-financial'] });
    queryClient.invalidateQueries({ queryKey: ['public-table-session'] });
  };

  const tablesQuery = useQuery({
    queryKey: ['manager-tables'],
    queryFn: () => api.managerTables(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(4000),
  });

  const createTableMutation = useMutation({
    mutationFn: () => api.managerCreateTable(role ?? 'manager', { status: newTableStatus }),
    onSuccess: () => {
      refreshTables();
    },
  });

  const updateTableMutation = useMutation({
    mutationFn: ({ tableId, status }: { tableId: number; status: ManagerTable['status'] }) =>
      api.managerUpdateTable(role ?? 'manager', tableId, { status }),
    onSuccess: () => {
      refreshTables();
    },
  });

  const deleteTableMutation = useMutation({
    mutationFn: (tableId: number) => api.managerDeleteTable(role ?? 'manager', tableId),
    onSuccess: () => {
      refreshTables();
    },
  });

  const settleTableMutation = useMutation({
    mutationFn: ({ tableId, amount }: { tableId: number; amount?: number }) =>
      api.managerSettleTableSession(role ?? 'manager', tableId, amount),
    onSuccess: (result) => {
      refreshTables();
      setSettlementAmounts((prev) => {
        const next = { ...prev };
        delete next[result.table_id];
        return next;
      });
    },
  });

  const view = useDataView({
    rows: tablesQuery.data ?? [],
    search,
    page,
    pageSize: 12,
    sortBy,
    sortDirection,
    searchAccessor: (row) => `${row.id} ${row.status} ${row.qr_code}`,
    sortAccessors: {
      id: (row) => row.id,
      status: (row) => row.status,
      total_orders: (row) => row.total_orders_count,
      active_orders: (row) => row.active_orders_count,
      unpaid_total: (row) => row.unpaid_total,
    },
  });

  const actionError = useMemo(() => {
    if (createTableMutation.isError) {
      return createTableMutation.error instanceof Error ? createTableMutation.error.message : 'تعذر إضافة الطاولة.';
    }
    if (updateTableMutation.isError) {
      return updateTableMutation.error instanceof Error ? updateTableMutation.error.message : 'تعذر تعديل حالة الطاولة.';
    }
    if (deleteTableMutation.isError) {
      return deleteTableMutation.error instanceof Error ? deleteTableMutation.error.message : 'تعذر حذف الطاولة.';
    }
    return '';
  }, [
    createTableMutation.error,
    createTableMutation.isError,
    deleteTableMutation.error,
    deleteTableMutation.isError,
    updateTableMutation.error,
    updateTableMutation.isError,
  ]);

  const settlementError = settleTableMutation.isError
    ? settleTableMutation.error instanceof Error
      ? settleTableMutation.error.message
      : 'تعذر تنفيذ تسوية الجلسة.'
    : '';

  const onCopyLink = async (table: ManagerTable) => {
    const link = resolveTablePublicUrl(table.qr_code);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedTableId(table.id);
      window.setTimeout(() => setCopiedTableId((current) => (current === table.id ? null : current)), 1800);
    } catch {
      setCopiedTableId(null);
    }
  };

  if (tablesQuery.isLoading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل الطاولات...</div>;
  }

  if (tablesQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل بيانات الطاولات.</div>;
  }

  return (
    <div className="admin-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <select value={newTableStatus} onChange={(event) => setNewTableStatus(event.target.value as ManagerTable['status'])} className="form-select sm:w-40">
            <option value="available">متاحة</option>
            <option value="reserved">محجوزة</option>
            <option value="occupied">مشغولة</option>
          </select>
          <button type="button" onClick={() => createTableMutation.mutate()} disabled={createTableMutation.isPending} className="btn-primary sm:w-auto">
            {createTableMutation.isPending ? 'جارٍ الإضافة...' : 'إضافة طاولة'}
          </button>
        </div>
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
        sortOptions={[
          { value: 'id', label: 'ترتيب: رقم الطاولة' },
          { value: 'status', label: 'ترتيب: الحالة' },
          { value: 'active_orders', label: 'ترتيب: الطلبات النشطة' },
          { value: 'unpaid_total', label: 'ترتيب: غير المسدد' },
          { value: 'total_orders', label: 'ترتيب: إجمالي الطلبات' },
        ]}
        searchPlaceholder="بحث برقم أو حالة الطاولة..."
      />

      {actionError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{actionError}</div>
      ) : null}
      {settlementError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{settlementError}</div>
      ) : null}

      <section className="admin-table-shell">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">الطاولة</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
                <th className="px-4 py-3 font-bold">الجلسة</th>
                <th className="px-4 py-3 font-bold">غير المسدد</th>
                <th className="px-4 py-3 font-bold">تسوية الجلسة</th>
                <th className="px-4 py-3 font-bold">رابط الطاولة</th>
                <th className="px-4 py-3 font-bold">التحكم</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((table) => {
                const targetStatus = pendingStatuses[table.id] ?? table.status;
                const canDelete = !table.has_active_session && table.total_orders_count === 0;
                const publicLink = resolveTablePublicUrl(table.qr_code);
                const settlementText = settlementAmounts[table.id] ?? '';
                const parsedSettlement = Number(settlementText);
                const settlementAmount =
                  settlementText.trim().length === 0 || !Number.isFinite(parsedSettlement) ? undefined : parsedSettlement;
                const canSettleSession = table.has_active_session && table.unpaid_total > 0;
                const invalidSettlementAmount = settlementAmount !== undefined && settlementAmount < table.unpaid_total;
                return (
                  <tr key={table.id} className="border-t border-gray-100 align-top">
                    <td data-label="الطاولة" className="px-4 py-3">
                      <p className="font-black text-gray-900">#{table.id}</p>
                      <p className="text-xs text-gray-500">إجمالي الطلبات: {table.total_orders_count}</p>
                    </td>
                    <td data-label="الحالة" className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusBadgeClass[table.status]}`}>
                        {tableStatusLabel(table.status)}
                      </span>
                    </td>
                    <td data-label="الجلسة" className="px-4 py-3 text-xs text-gray-600">
                      <p>نشطة: {table.has_active_session ? 'نعم' : 'لا'}</p>
                      <p>طلبات نشطة: {table.active_orders_count}</p>
                      <p>غير مسددة: {table.unsettled_orders_count}</p>
                    </td>
                    <td data-label="غير المسدد" className="px-4 py-3">
                      <p className="font-black text-brand-700">{table.unpaid_total.toFixed(2)} د.ج</p>
                    </td>
                    <td data-label="تسوية الجلسة" className="px-4 py-3">
                      {canSettleSession ? (
                        <div className="space-y-2">
                          <input
                            type="number"
                            min={table.unpaid_total}
                            step="0.1"
                            value={settlementText}
                            onChange={(event) =>
                              setSettlementAmounts((prev) => ({
                                ...prev,
                                [table.id]: event.target.value,
                              }))
                            }
                            className="form-input min-w-[180px]"
                            placeholder="المبلغ المستلم (اختياري)"
                          />
                          <button
                            type="button"
                            onClick={() => settleTableMutation.mutate({ tableId: table.id, amount: settlementAmount })}
                            disabled={settleTableMutation.isPending || invalidSettlementAmount}
                            className="btn-primary ui-size-sm w-full"
                          >
                            {settleTableMutation.isPending ? 'جارٍ التسوية...' : 'تسوية نهائية'}
                          </button>
                          {invalidSettlementAmount ? (
                            <p className="text-[11px] font-semibold text-rose-700">المبلغ المستلم يجب أن يكون مساويًا للمستحق أو أكبر.</p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs font-semibold text-gray-500">لا توجد تسوية مطلوبة.</p>
                      )}
                    </td>
                    <td data-label="رابط الطاولة" className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={publicLink} target="_blank" rel="noreferrer" className="btn-secondary ui-size-sm">
                          فتح الواجهة
                        </a>
                        <button type="button" onClick={() => onCopyLink(table)} className="btn-secondary ui-size-sm">
                          {copiedTableId === table.id ? 'تم النسخ' : 'نسخ الرابط'}
                        </button>
                      </div>
                    </td>
                    <td data-label="التحكم" className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={targetStatus}
                          onChange={(event) =>
                            setPendingStatuses((prev) => ({
                              ...prev,
                              [table.id]: event.target.value as ManagerTable['status'],
                            }))
                          }
                          className="form-select min-w-[122px]"
                        >
                          <option value="available">متاحة</option>
                          <option value="occupied">مشغولة</option>
                          <option value="reserved">محجوزة</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => updateTableMutation.mutate({ tableId: table.id, status: targetStatus })}
                          disabled={updateTableMutation.isPending || targetStatus === table.status}
                          className="btn-primary ui-size-sm"
                        >
                          حفظ
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTableMutation.mutate(table.id)}
                          disabled={deleteTableMutation.isPending || !canDelete}
                          className="btn-danger ui-size-sm"
                          title={canDelete ? 'حذف الطاولة' : 'لا يمكن حذف طاولة لها جلسة أو سجل طلبات'}
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    لا توجد طاولات مطابقة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <TablePagination page={view.page} totalPages={view.totalPages} totalRows={view.totalRows} onPageChange={setPage} />
      </section>
    </div>
  );
}
