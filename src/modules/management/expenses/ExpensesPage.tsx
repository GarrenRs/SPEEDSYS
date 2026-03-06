import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import { useDataView } from '@/shared/hooks/useDataView';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';
import { parseApiDateMs } from '@/shared/utils/date';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';

const emptyForm = { title: '', category: '', cost_center_id: '' as number | '', amount: 0, note: '' };
const emptyCenterForm = { code: '', name: '', active: true };
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;

export function ExpensesPage() {
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const [centerForm, setCenterForm] = useState(emptyCenterForm);
  const [editingCenterId, setEditingCenterId] = useState<number | null>(null);
  const [pageError, setPageError] = useState('');

  const expensesQuery = useQuery({
    queryKey: ['manager-expenses'],
    queryFn: () => api.managerExpenses(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const centersQuery = useQuery({
    queryKey: ['manager-expense-cost-centers'],
    queryFn: () => api.managerExpenseCostCenters(role ?? 'manager', true),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(10000),
  });

  const centers = centersQuery.data ?? [];
  const activeCenters = useMemo(() => centers.filter((item) => item.active), [centers]);

  useEffect(() => {
    if (form.cost_center_id !== '') return;
    if (activeCenters.length === 0) return;
    setForm((prev) => ({ ...prev, cost_center_id: activeCenters[0].id }));
  }, [activeCenters, form.cost_center_id]);

  const refreshExpenses = () => {
    queryClient.invalidateQueries({ queryKey: ['manager-expenses'] });
    queryClient.invalidateQueries({ queryKey: ['manager-financial'] });
    queryClient.invalidateQueries({ queryKey: ['manager-dashboard-operational-heart'] });
  };

  const refreshCenters = () => {
    queryClient.invalidateQueries({ queryKey: ['manager-expense-cost-centers'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.managerCreateExpense(role ?? 'manager', {
        title: form.title,
        category: form.category,
        cost_center_id: Number(form.cost_center_id),
        amount: Number(form.amount),
        note: form.note || null,
      }),
    onSuccess: () => {
      setPageError('');
      setForm((prev) => ({ ...emptyForm, cost_center_id: prev.cost_center_id }));
      refreshExpenses();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر إرسال المصروف للموافقة.'),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      api.managerUpdateExpense(role ?? 'manager', editingId ?? 0, {
        title: form.title,
        category: form.category,
        cost_center_id: Number(form.cost_center_id),
        amount: Number(form.amount),
        note: form.note || null,
      }),
    onSuccess: () => {
      setPageError('');
      setEditingId(null);
      setForm((prev) => ({ ...emptyForm, cost_center_id: prev.cost_center_id }));
      refreshExpenses();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر تحديث المصروف.'),
  });

  const centerSaveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        code: centerForm.code,
        name: centerForm.name,
        active: centerForm.active,
      };
      if (editingCenterId) return api.managerUpdateExpenseCostCenter(role ?? 'manager', editingCenterId, payload);
      return api.managerCreateExpenseCostCenter(role ?? 'manager', payload);
    },
    onSuccess: () => {
      setPageError('');
      setEditingCenterId(null);
      setCenterForm(emptyCenterForm);
      refreshCenters();
      refreshExpenses();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر حفظ مركز التكلفة.'),
  });

  const centerToggleMutation = useMutation({
    mutationFn: (centerId: number) => {
      const center = centers.find((item) => item.id === centerId);
      if (!center) throw new Error('مركز التكلفة غير موجود.');
      return api.managerUpdateExpenseCostCenter(role ?? 'manager', centerId, {
        code: center.code,
        name: center.name,
        active: !center.active,
      });
    },
    onSuccess: () => {
      setPageError('');
      refreshCenters();
      refreshExpenses();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر تحديث حالة مركز التكلفة.'),
  });

  const approveMutation = useMutation({
    mutationFn: (expenseId: number) => api.managerApproveExpense(role ?? 'manager', expenseId, { note: null }),
    onSuccess: () => {
      setPageError('');
      refreshExpenses();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر اعتماد المصروف.'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ expenseId, note }: { expenseId: number; note: string | null }) =>
      api.managerRejectExpense(role ?? 'manager', expenseId, {
        note,
      }),
    onSuccess: () => {
      setPageError('');
      refreshExpenses();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر رفض المصروف.'),
  });

  const uploadAttachmentMutation = useMutation({
    mutationFn: ({
      expenseId,
      fileName,
      mimeType,
      dataBase64,
    }: {
      expenseId: number;
      fileName: string;
      mimeType: string;
      dataBase64: string;
    }) =>
      api.managerCreateExpenseAttachment(role ?? 'manager', expenseId, {
        file_name: fileName,
        mime_type: mimeType,
        data_base64: dataBase64,
      }),
    onSuccess: () => {
      setPageError('');
      refreshExpenses();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر رفع المرفق.'),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: ({ expenseId, attachmentId }: { expenseId: number; attachmentId: number }) =>
      api.managerDeleteExpenseAttachment(role ?? 'manager', expenseId, attachmentId),
    onSuccess: () => {
      setPageError('');
      refreshExpenses();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر حذف المرفق.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (expenseId: number) => api.managerDeleteExpense(role ?? 'manager', expenseId),
    onSuccess: () => {
      setPageError('');
      refreshExpenses();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر حذف المصروف.'),
  });

  const view = useDataView({
    rows: expensesQuery.data ?? [],
    search,
    page,
    pageSize: 10,
    sortBy,
    sortDirection,
    searchAccessor: (row) => {
      const attachmentNames = row.attachments?.map((item) => item.file_name).join(' ') ?? '';
      return `${row.id} ${row.title} ${row.category} ${row.status} ${row.cost_center_name ?? ''} ${row.note ?? ''} ${row.review_note ?? ''} ${attachmentNames}`;
    },
    sortAccessors: {
      created_at: (row) => parseApiDateMs(row.created_at),
      amount: (row) => row.amount,
      title: (row) => row.title,
      status: (row) => row.status,
      id: (row) => row.id,
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.cost_center_id) {
      setPageError('اختر مركز التكلفة قبل إرسال المصروف.');
      return;
    }
    if (editingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const onCenterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    centerSaveMutation.mutate();
  };

  const statusLabel = (status: string) => {
    if (status === 'approved') return 'معتمد';
    if (status === 'rejected') return 'مرفوض';
    return 'بانتظار الموافقة';
  };

  const statusClass = (status: string) => {
    if (status === 'approved') return 'border border-emerald-200 bg-emerald-50 text-emerald-700';
    if (status === 'rejected') return 'border border-rose-200 bg-rose-50 text-rose-700';
    return 'border border-amber-200 bg-amber-50 text-amber-700';
  };

  const handleAttachmentUpload = async (expenseId: number, file: File) => {
    const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.type)) {
      setPageError('نوع المرفق غير مدعوم. الأنواع المتاحة: PDF, JPG, PNG, WEBP.');
      return;
    }
    if (file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE) {
      setPageError('حجم المرفق يجب أن يكون أكبر من صفر وحتى 5 ميغابايت.');
      return;
    }
    const payload = await toBase64Payload(file);
    uploadAttachmentMutation.mutate({
      expenseId,
      fileName: file.name,
      mimeType: payload.mime_type,
      dataBase64: payload.data_base64,
    });
  };

  if (expensesQuery.isLoading || centersQuery.isLoading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل بيانات المصروفات...</div>;
  }
  if (expensesQuery.isError || centersQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل بيانات المصروفات.</div>;
  }

  return (
    <div className="admin-page">
      <section className="admin-card p-4">
        <div className="mb-3">
          <h3 className="text-sm font-black text-gray-800">مراكز التكلفة</h3>
          <p className="text-xs text-gray-600">أنشئ مراكز التكلفة المستخدمة في المصروفات أو حدث حالتها.</p>
        </div>

        <form onSubmit={onCenterSubmit} className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1">
            <span className="form-label">رمز المركز</span>
            <input
              className="form-input"
              placeholder="مثال: KITCHEN"
              value={centerForm.code}
              onChange={(event) => setCenterForm((prev) => ({ ...prev, code: event.target.value }))}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="form-label">اسم المركز</span>
            <input
              className="form-input"
              placeholder="مثال: المطبخ"
              value={centerForm.name}
              onChange={(event) => setCenterForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-gray-700">
            <input
              type="checkbox"
              checked={centerForm.active}
              onChange={(event) => setCenterForm((prev) => ({ ...prev, active: event.target.checked }))}
            />
            مركز نشط
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn-primary" disabled={centerSaveMutation.isPending}>
              {editingCenterId ? 'تحديث المركز' : 'إضافة مركز'}
            </button>
            {editingCenterId ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEditingCenterId(null);
                  setCenterForm(emptyCenterForm);
                }}
              >
                إلغاء
              </button>
            ) : null}
          </div>
        </form>

      </section>

      <section className="admin-table-shell">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-3 py-2 font-bold">الرمز</th>
                <th className="px-3 py-2 font-bold">الاسم</th>
                <th className="px-3 py-2 font-bold">الحالة</th>
                <th className="px-3 py-2 font-bold">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {centers.map((center) => (
                <tr key={center.id}>
                  <td data-label="الرمز" className="px-3 py-2 font-bold">{center.code}</td>
                  <td data-label="الاسم" className="px-3 py-2">{center.name}</td>
                  <td data-label="الحالة" className="px-3 py-2">{center.active ? 'نشط' : 'موقوف'}</td>
                  <td data-label="الإجراء" className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-secondary ui-size-sm"
                        onClick={() => {
                          setEditingCenterId(center.id);
                          setCenterForm({ code: center.code, name: center.name, active: center.active });
                        }}
                      >
                        تعديل
                      </button>
                      <button
                        type="button"
                        className="btn-secondary ui-size-sm"
                        onClick={() => centerToggleMutation.mutate(center.id)}
                        disabled={centerToggleMutation.isPending}
                      >
                        {center.active ? 'إيقاف' : 'تفعيل'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {centers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                    لا توجد مراكز تكلفة بعد.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <form onSubmit={onSubmit} className="grid gap-3 rounded-2xl border border-brand-100 bg-white p-4 md:grid-cols-6">
        <label className="space-y-1">
          <span className="form-label">عنوان المصروف</span>
          <input
            className="form-input"
            placeholder="عنوان المصروف"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            required
          />
        </label>
        <label className="space-y-1">
          <span className="form-label">التصنيف</span>
          <input
            className="form-input"
            placeholder="التصنيف"
            value={form.category}
            onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
            required
          />
        </label>
        <label className="space-y-1">
          <span className="form-label">مركز التكلفة</span>
          <select
            className="form-select"
            value={form.cost_center_id}
            onChange={(event) => setForm((prev) => ({ ...prev, cost_center_id: event.target.value ? Number(event.target.value) : '' }))}
            required
          >
            <option value="">اختر مركز التكلفة</option>
            {activeCenters.map((center) => (
              <option key={center.id} value={center.id}>{`${center.name} (${center.code})`}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="form-label">المبلغ (د.ج)</span>
          <input
            type="number"
            min={0}
            step="0.1"
            className="form-input"
            placeholder="المبلغ"
            value={form.amount}
            onChange={(event) => setForm((prev) => ({ ...prev, amount: Number(event.target.value) }))}
            required
          />
        </label>
        <label className="space-y-1">
          <span className="form-label">ملاحظة (اختياري)</span>
          <input
            className="form-input"
            placeholder="ملاحظة"
            value={form.note}
            onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={createMutation.isPending || updateMutation.isPending || activeCenters.length === 0}
          >
            {editingId ? 'تحديث وإعادة إرسال' : 'إرسال للموافقة'}
          </button>
          {editingId ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditingId(null);
                setForm((prev) => ({ ...emptyForm, cost_center_id: prev.cost_center_id || (activeCenters[0]?.id ?? '') }));
              }}
            >
              إلغاء
            </button>
          ) : null}
        </div>
      </form>

      {activeCenters.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
          أضف مركز تكلفة نشطًا واحدًا على الأقل قبل تسجيل أي مصروف.
        </div>
      ) : null}

      {pageError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{pageError}</div> : null}

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
          { value: 'title', label: 'ترتيب: العنوان' },
          { value: 'status', label: 'ترتيب: الحالة' },
          { value: 'id', label: 'ترتيب: الرقم' },
        ]}
        searchPlaceholder="بحث في المصروفات..."
      />

      <section className="admin-table-shell">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">#</th>
                <th className="px-4 py-3 font-bold">العنوان</th>
                <th className="px-4 py-3 font-bold">التصنيف</th>
                <th className="px-4 py-3 font-bold">مركز التكلفة</th>
                <th className="px-4 py-3 font-bold">المبلغ</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
                <th className="px-4 py-3 font-bold">المرفقات</th>
                <th className="px-4 py-3 font-bold">ملاحظة المراجعة</th>
                <th className="px-4 py-3 font-bold">الوقت</th>
                <th className="px-4 py-3 font-bold">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td data-label="#" className="px-4 py-3 font-bold">{row.id}</td>
                  <td data-label="العنوان" className="px-4 py-3">{row.title}</td>
                  <td data-label="التصنيف" className="px-4 py-3">{row.category}</td>
                  <td data-label="مركز التكلفة" className="px-4 py-3">{row.cost_center_name ?? '-'}</td>
                  <td data-label="المبلغ" className="px-4 py-3 font-bold text-brand-700">{row.amount.toFixed(2)} د.ج</td>
                  <td data-label="الحالة" className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(row.status)}`}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td data-label="المرفقات" className="px-4 py-3">
                    <div className="space-y-1">
                      {row.attachments.length === 0 ? <p className="text-xs text-gray-500">لا يوجد مرفقات</p> : null}
                      {row.attachments.map((attachment) => (
                        <div key={attachment.id} className="flex items-center gap-2 text-xs">
                          <a className="text-brand-700 underline" href={attachment.file_url} target="_blank" rel="noreferrer">
                            {attachment.file_name}
                          </a>
                          <span className="text-gray-500">({Math.max(1, Math.round(attachment.size_bytes / 1024))} ك.ب)</span>
                          {row.status !== 'approved' ? (
                            <button
                              type="button"
                              className="btn-danger ui-size-sm"
                              onClick={() =>
                                deleteAttachmentMutation.mutate({ expenseId: row.id, attachmentId: attachment.id })
                              }
                              disabled={deleteAttachmentMutation.isPending}
                            >
                              حذف
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td data-label="ملاحظة المراجعة" className="px-4 py-3 text-xs text-gray-600">{row.review_note?.trim() ? row.review_note : '-'}</td>
                  <td data-label="الوقت" className="px-4 py-3 text-xs text-gray-500">{new Date(parseApiDateMs(row.created_at)).toLocaleString('ar-DZ-u-nu-latn')}</td>
                  <td data-label="الإجراءات" className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {row.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            className="btn-primary ui-size-sm"
                            onClick={() => approveMutation.mutate(row.id)}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                          >
                            اعتماد
                          </button>
                          <button
                            type="button"
                            className="btn-danger ui-size-sm"
                            onClick={() => {
                              const note = window.prompt('أدخل سبب الرفض (اختياري):', '');
                              if (note === null) return;
                              rejectMutation.mutate({ expenseId: row.id, note: note.trim() || null });
                            }}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                          >
                            رفض
                          </button>
                        </>
                      ) : null}

                      {row.status !== 'approved' ? (
                        <>
                          <button
                            type="button"
                            className="btn-secondary ui-size-sm"
                            onClick={() => {
                              setEditingId(row.id);
                              setForm({
                                title: row.title,
                                category: row.category,
                                cost_center_id: row.cost_center_id,
                                amount: row.amount,
                                note: row.note ?? '',
                              });
                            }}
                          >
                            تعديل
                          </button>
                          <button
                            type="button"
                            className="btn-secondary ui-size-sm"
                            onClick={() => {
                              const input = document.getElementById(`expense-file-${row.id}`) as HTMLInputElement | null;
                              input?.click();
                            }}
                            disabled={uploadAttachmentMutation.isPending}
                          >
                            رفع مرفق
                          </button>
                          <input
                            id={`expense-file-${row.id}`}
                            type="file"
                            className="hidden"
                            accept="application/pdf,image/jpeg,image/png,image/webp"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.currentTarget.value = '';
                              if (!file) return;
                              void handleAttachmentUpload(row.id, file);
                            }}
                          />
                          <button
                            type="button"
                            className="btn-danger ui-size-sm"
                            onClick={() => deleteMutation.mutate(row.id)}
                            disabled={deleteMutation.isPending}
                          >
                            حذف
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination page={view.page} totalPages={view.totalPages} totalRows={view.totalRows} onPageChange={setPage} />
      </section>
    </div>
  );
}

function toBase64Payload(file: File): Promise<{ mime_type: string; data_base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الملف.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const [, base64] = result.split(',', 2);
      if (!base64) {
        reject(new Error('تعذر تحويل الملف.'));
        return;
      }
      resolve({
        mime_type: file.type,
        data_base64: base64,
      });
    };
    reader.readAsDataURL(file);
  });
}

