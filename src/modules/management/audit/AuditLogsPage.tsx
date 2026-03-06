import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import { useDataView } from '@/shared/hooks/useDataView';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';
import { formatOrderTrackingId } from '@/shared/utils/order';
import { parseApiDateMs } from '@/shared/utils/date';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';
import { sanitizeMojibakeText } from '@/shared/utils/textSanitizer';

export function AuditLogsPage() {
  const role = useAuthStore((state) => state.role);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [systemSearch, setSystemSearch] = useState('');
  const [systemSortBy, setSystemSortBy] = useState('timestamp');
  const [systemSortDirection, setSystemSortDirection] = useState<'asc' | 'desc'>('desc');
  const [systemPage, setSystemPage] = useState(1);
  const [securitySearch, setSecuritySearch] = useState('');
  const [securitySortBy, setSecuritySortBy] = useState('created_at');
  const [securitySortDirection, setSecuritySortDirection] = useState<'asc' | 'desc'>('desc');
  const [securityPage, setSecurityPage] = useState(1);

  const renderSystemDescription = (row: {
    module: string;
    action: string;
    entity_type: string;
    entity_id?: number | null;
    description: string;
  }): string => {
    const fallback = `تفاصيل العملية: ${row.module}/${row.action} على ${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ''}`;
    return sanitizeMojibakeText(row.description, fallback);
  };

  const renderSecurityDetail = (row: {
    event_type: string;
    username?: string | null;
    detail?: string | null;
  }): string => {
    const fallback = `حدث أمني: ${row.event_type}${row.username ? ` للمستخدم ${row.username}` : ''}`;
    return sanitizeMojibakeText(row.detail, fallback);
  };

  const logsQuery = useQuery({
    queryKey: ['manager-audit-logs'],
    queryFn: () => api.managerAuditLogs(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const systemLogsQuery = useQuery({
    queryKey: ['manager-audit-system-logs'],
    queryFn: () => api.managerAuditSystemLogs(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const securityLogsQuery = useQuery({
    queryKey: ['manager-audit-security-events'],
    queryFn: () => api.managerAuditSecurityEvents(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const view = useDataView({
    rows: logsQuery.data ?? [],
    search,
    page,
    pageSize: 12,
    sortBy,
    sortDirection,
    searchAccessor: (row) => `${row.order_id} ${formatOrderTrackingId(row.order_id)} ${row.from_status} ${row.to_status} ${row.performed_by}`,
    sortAccessors: {
      timestamp: (row) => parseApiDateMs(row.timestamp),
      order_id: (row) => row.order_id,
      performed_by: (row) => row.performed_by,
    },
  });

  const systemView = useDataView({
    rows: systemLogsQuery.data ?? [],
    search: systemSearch,
    page: systemPage,
    pageSize: 12,
    sortBy: systemSortBy,
    sortDirection: systemSortDirection,
    searchAccessor: (row) =>
      `${row.module} ${row.action} ${row.entity_type} ${row.entity_id ?? ''} ${renderSystemDescription(row)} ${row.performed_by}`,
    sortAccessors: {
      timestamp: (row) => parseApiDateMs(row.timestamp),
      module: (row) => row.module,
      performed_by: (row) => row.performed_by,
    },
  });

  const securityView = useDataView({
    rows: securityLogsQuery.data ?? [],
    search: securitySearch,
    page: securityPage,
    pageSize: 12,
    sortBy: securitySortBy,
    sortDirection: securitySortDirection,
    searchAccessor: (row) =>
      `${row.event_type} ${row.username ?? ''} ${row.role ?? ''} ${row.ip_address ?? ''} ${renderSecurityDetail(row)}`,
    sortAccessors: {
      created_at: (row) => parseApiDateMs(row.created_at),
      event_type: (row) => row.event_type,
      username: (row) => row.username ?? '',
      severity: (row) => row.severity,
    },
  });

  if (logsQuery.isLoading || systemLogsQuery.isLoading || securityLogsQuery.isLoading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل سجل التدقيق...</div>;
  }
  if (logsQuery.isError || systemLogsQuery.isError || securityLogsQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل سجل التدقيق.</div>;
  }

  return (
    <div className="admin-page">
      <div className="space-y-2">
        <h3 className="text-sm font-black text-gray-800">انتقالات حالات الطلبات</h3>
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
            { value: 'timestamp', label: 'ترتيب: الوقت' },
            { value: 'order_id', label: 'ترتيب: الطلب' },
            { value: 'performed_by', label: 'ترتيب: المستخدم' },
          ]}
          searchPlaceholder="بحث في انتقالات الطلبات..."
        />
      </div>

      <section className="admin-table-shell">

        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">الطلب</th>
                <th className="px-4 py-3 font-bold">من</th>
                <th className="px-4 py-3 font-bold">إلى</th>
                <th className="px-4 py-3 font-bold">بواسطة</th>
                <th className="px-4 py-3 font-bold">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td data-label="الطلب" className="px-4 py-3 font-bold">{formatOrderTrackingId(row.order_id)}</td>
                  <td data-label="من" className="px-4 py-3">
                    <StatusBadge status={row.from_status} />
                  </td>
                  <td data-label="إلى" className="px-4 py-3">
                    <StatusBadge status={row.to_status} />
                  </td>
                  <td data-label="بواسطة" className="px-4 py-3">{row.performed_by}</td>
                  <td data-label="الوقت" className="px-4 py-3 text-xs text-gray-500">{new Date(parseApiDateMs(row.timestamp)).toLocaleString('ar-DZ-u-nu-latn')}</td>
                </tr>
              ))}
              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                    لا توجد سجلات انتقال متاحة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <TablePagination page={view.page} totalPages={view.totalPages} totalRows={view.totalRows} onPageChange={setPage} />
      </section>

      <div className="space-y-2">
        <h3 className="text-sm font-black text-gray-800">العمليات الإدارية الحساسة</h3>
        <TableControls
          search={systemSearch}
          onSearchChange={(value) => {
            setSystemSearch(value);
            setSystemPage(1);
          }}
          sortBy={systemSortBy}
          onSortByChange={setSystemSortBy}
          sortDirection={systemSortDirection}
          onSortDirectionChange={setSystemSortDirection}
          sortOptions={[
            { value: 'timestamp', label: 'ترتيب: الوقت' },
            { value: 'module', label: 'ترتيب: الوحدة' },
            { value: 'performed_by', label: 'ترتيب: المستخدم' },
          ]}
          searchPlaceholder="بحث في العمليات الإدارية..."
        />
      </div>

      <section className="admin-table-shell">

        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">الوحدة</th>
                <th className="px-4 py-3 font-bold">الإجراء</th>
                <th className="px-4 py-3 font-bold">الكيان</th>
                <th className="px-4 py-3 font-bold">الوصف</th>
                <th className="px-4 py-3 font-bold">بواسطة</th>
                <th className="px-4 py-3 font-bold">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {systemView.rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td data-label="الوحدة" className="px-4 py-3 font-bold">{row.module}</td>
                  <td data-label="الإجراء" className="px-4 py-3">{row.action}</td>
                  <td data-label="الكيان" className="px-4 py-3 text-xs">{row.entity_type}{row.entity_id ? ` #${row.entity_id}` : ''}</td>
                  <td data-label="الوصف" className="px-4 py-3 text-xs text-gray-700">{renderSystemDescription(row)}</td>
                  <td data-label="بواسطة" className="px-4 py-3">{row.performed_by}</td>
                  <td data-label="الوقت" className="px-4 py-3 text-xs text-gray-500">{new Date(parseApiDateMs(row.timestamp)).toLocaleString('ar-DZ-u-nu-latn')}</td>
                </tr>
              ))}
              {systemView.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    لا توجد عمليات إدارية مسجلة بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={systemView.page}
          totalPages={systemView.totalPages}
          totalRows={systemView.totalRows}
          onPageChange={setSystemPage}
        />
      </section>

      <div className="space-y-2">
        <h3 className="text-sm font-black text-gray-800">أحداث الأمان</h3>
        <TableControls
          search={securitySearch}
          onSearchChange={(value) => {
            setSecuritySearch(value);
            setSecurityPage(1);
          }}
          sortBy={securitySortBy}
          onSortByChange={setSecuritySortBy}
          sortDirection={securitySortDirection}
          onSortDirectionChange={setSecuritySortDirection}
          sortOptions={[
            { value: 'created_at', label: 'ترتيب: الوقت' },
            { value: 'event_type', label: 'ترتيب: الحدث' },
            { value: 'username', label: 'ترتيب: المستخدم' },
            { value: 'severity', label: 'ترتيب: الشدة' },
          ]}
          searchPlaceholder="بحث في أحداث الأمان..."
        />
      </div>

      <section className="admin-table-shell">

        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">الحدث</th>
                <th className="px-4 py-3 font-bold">النتيجة</th>
                <th className="px-4 py-3 font-bold">الشدة</th>
                <th className="px-4 py-3 font-bold">المستخدم</th>
                <th className="px-4 py-3 font-bold">IP</th>
                <th className="px-4 py-3 font-bold">التفاصيل</th>
                <th className="px-4 py-3 font-bold">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {securityView.rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td data-label="الحدث" className="px-4 py-3 font-bold">{row.event_type}</td>
                  <td data-label="النتيجة" className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${row.success ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {row.success ? 'ناجح' : 'فشل'}
                    </span>
                  </td>
                  <td data-label="الشدة" className="px-4 py-3 text-xs">{row.severity}</td>
                  <td data-label="المستخدم" className="px-4 py-3 text-xs">{row.username ?? '-'}</td>
                  <td data-label="IP" className="px-4 py-3 text-xs">{row.ip_address ?? '-'}</td>
                  <td data-label="التفاصيل" className="px-4 py-3 text-xs text-gray-700">{renderSecurityDetail(row)}</td>
                  <td data-label="الوقت" className="px-4 py-3 text-xs text-gray-500">{new Date(parseApiDateMs(row.created_at)).toLocaleString('ar-DZ-u-nu-latn')}</td>
                </tr>
              ))}
              {securityView.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                    لا توجد أحداث أمان مسجلة بعد.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={securityView.page}
          totalPages={securityView.totalPages}
          totalRows={securityView.totalRows}
          onPageChange={setSecurityPage}
        />
      </section>
    </div>
  );
}

