import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import { Modal } from '@/shared/ui/Modal';
import { parseApiDateMs } from '@/shared/utils/date';

const emptySupplierForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  payment_term_days: 0,
  credit_limit: 0,
  quality_rating: 3,
  lead_time_days: 0,
  notes: '',
  active: true,
  supplied_item_ids: [] as number[],
};

export function WarehouseSuppliersSection({ embedded = false }: { embedded?: boolean }) {
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();

  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [pageError, setPageError] = useState('');

  const suppliersQuery = useQuery({
    queryKey: ['manager-warehouse-suppliers'],
    queryFn: () => api.managerWarehouseSuppliers(role ?? 'manager'),
    enabled: role === 'manager',
  });
  const itemsQuery = useQuery({
    queryKey: ['manager-warehouse-items'],
    queryFn: () => api.managerWarehouseItems(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const suppliers = suppliersQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const activeItems = useMemo(() => items.filter((item) => item.active), [items]);
  const itemNameMap = useMemo(() => {
    const map = new Map<number, string>();
    items.forEach((item) => map.set(item.id, item.name));
    return map;
  }, [items]);
  const activeCount = useMemo(() => suppliers.filter((supplier) => supplier.active).length, [suppliers]);
  const inactiveCount = suppliers.length - activeCount;

  const filteredSuppliers = useMemo(() => {
    const normalized = searchText.trim().toLowerCase();
    return suppliers.filter((supplier) => {
      const matchesSearch =
        normalized.length === 0 ||
        supplier.name.toLowerCase().includes(normalized) ||
        (supplier.phone ?? '').toLowerCase().includes(normalized) ||
        (supplier.email ?? '').toLowerCase().includes(normalized) ||
        (supplier.address ?? '').toLowerCase().includes(normalized) ||
        (supplier.notes ?? '').toLowerCase().includes(normalized);
      const matchesStatus =
        statusFilter === 'all' || (statusFilter === 'active' ? supplier.active : !supplier.active);
      return matchesSearch && matchesStatus;
    });
  }, [suppliers, searchText, statusFilter]);

  const closeModal = () => {
    setModalOpen(false);
    setEditingSupplierId(null);
    setSupplierForm(emptySupplierForm);
  };

  const openCreateModal = () => {
    setPageError('');
    setEditingSupplierId(null);
    setSupplierForm(emptySupplierForm);
    setModalOpen(true);
  };

  const openEditModal = (supplier: (typeof suppliers)[number]) => {
    setPageError('');
    setEditingSupplierId(supplier.id);
    setSupplierForm({
      name: supplier.name,
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      payment_term_days: supplier.payment_term_days ?? 0,
      credit_limit: supplier.credit_limit ?? 0,
      quality_rating: supplier.quality_rating ?? 3,
      lead_time_days: supplier.lead_time_days ?? 0,
      notes: supplier.notes ?? '',
      active: supplier.active,
      supplied_item_ids: [...(supplier.supplied_item_ids ?? [])],
    });
    setModalOpen(true);
  };

  const invalidateSuppliers = () => {
    queryClient.invalidateQueries({ queryKey: ['manager-warehouse-suppliers'] });
    queryClient.invalidateQueries({ queryKey: ['manager-warehouse-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['manager-warehouse-inbound'] });
  };

  const saveSupplierMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: supplierForm.name.trim(),
        phone: supplierForm.phone.trim() ? supplierForm.phone.trim() : null,
        email: supplierForm.email.trim() ? supplierForm.email.trim() : null,
        address: supplierForm.address.trim() ? supplierForm.address.trim() : null,
        payment_term_days: Number(supplierForm.payment_term_days),
        credit_limit: supplierForm.credit_limit > 0 ? Number(supplierForm.credit_limit) : null,
        quality_rating: Number(supplierForm.quality_rating),
        lead_time_days: Number(supplierForm.lead_time_days),
        notes: supplierForm.notes.trim() ? supplierForm.notes.trim() : null,
        active: supplierForm.active,
        supplied_item_ids: [...supplierForm.supplied_item_ids],
      };
      if (editingSupplierId) return api.managerUpdateWarehouseSupplier(role ?? 'manager', editingSupplierId, payload);
      return api.managerCreateWarehouseSupplier(role ?? 'manager', payload);
    },
    onSuccess: () => {
      invalidateSuppliers();
      setPageError('');
      closeModal();
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'تعذر حفظ المورد.'),
  });

  const submitSupplier = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (supplierForm.name.trim().length < 2) return setPageError('اسم المورد يجب أن يكون حرفين على الأقل.');
    if (supplierForm.payment_term_days < 0 || supplierForm.lead_time_days < 0) return setPageError('حقول الأيام يجب أن تكون صفراً أو أكبر.');
    if (supplierForm.credit_limit < 0) return setPageError('حد الائتمان لا يمكن أن يكون سالباً.');
    if (supplierForm.quality_rating < 0 || supplierForm.quality_rating > 5) return setPageError('تقييم المورد يجب أن يكون بين 0 و 5.');
    saveSupplierMutation.mutate();
  };

  if (suppliersQuery.isLoading || itemsQuery.isLoading) return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل بيانات الموردين...</div>;
  if (suppliersQuery.isError || itemsQuery.isError) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل قسم إدارة الموردين.</div>;

  return (
    <div id="warehouse-suppliers" className={embedded ? 'space-y-3' : 'admin-page'}>
      {embedded ? (
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-black text-gray-900">إدارة الموردين</h3>
            <p className="text-sm text-gray-600">الموردون جزء من نطاق المخزن، ولا يوجد مسار منفصل لهم.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-sky-300 bg-sky-50 p-4"><p className="text-xs font-bold text-sky-700">إجمالي الموردين</p><p className="mt-1 text-2xl font-black text-sky-900">{suppliers.length}</p></article>
        <article className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-700">الموردون النشطون</p><p className="mt-1 text-2xl font-black text-emerald-900">{activeCount}</p></article>
        <article className="rounded-2xl border border-amber-300 bg-amber-50 p-4"><p className="text-xs font-bold text-amber-700">الموردون الموقوفون</p><p className="mt-1 text-2xl font-black text-amber-900">{inactiveCount}</p></article>
      </div>

      {pageError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{pageError}</div> : null}

      <section className="space-y-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-black text-gray-900">قائمة الموردين</h3>
          <div className="flex flex-wrap gap-2">
            <input className="form-input w-60" placeholder="بحث بالاسم أو الهاتف أو البريد أو الملاحظات" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
            <select className="form-select w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}>
              <option value="all">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="inactive">موقوف</option>
            </select>
            <button type="button" className="btn-primary" onClick={openCreateModal}>إضافة مورد</button>
          </div>
        </div>

        <div className="admin-table-shell">
          <div className="adaptive-table overflow-x-auto">
            <table className="table-unified min-w-full text-sm">
              <thead className="bg-brand-50 text-gray-700">
                <tr>
                  <th className="px-3 py-2 font-bold">المورد</th>
                  <th className="px-3 py-2 font-bold">الهاتف</th>
                  <th className="px-3 py-2 font-bold">البريد</th>
                  <th className="px-3 py-2 font-bold">العنوان</th>
                  <th className="px-3 py-2 font-bold">الدفع (يوم)</th>
                  <th className="px-3 py-2 font-bold">حد الائتمان</th>
                  <th className="px-3 py-2 font-bold">التقييم</th>
                  <th className="px-3 py-2 font-bold">التوريد (يوم)</th>
                  <th className="px-3 py-2 font-bold">أصناف المورد</th>
                  <th className="px-3 py-2 font-bold">الحالة</th>
                  <th className="px-3 py-2 font-bold">آخر تحديث</th>
                  <th className="px-3 py-2 font-bold">الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td data-label="المورد" className="px-3 py-2 font-bold">{supplier.name}</td>
                    <td data-label="الهاتف" className="px-3 py-2">{supplier.phone ?? '-'}</td>
                    <td data-label="البريد" className="px-3 py-2">{supplier.email ?? '-'}</td>
                    <td data-label="العنوان" className="px-3 py-2">{supplier.address ?? '-'}</td>
                    <td data-label="الدفع (يوم)" className="px-3 py-2">{supplier.payment_term_days ?? 0}</td>
                    <td data-label="حد الائتمان" className="px-3 py-2">{(supplier.credit_limit ?? 0).toFixed(2)}</td>
                    <td data-label="التقييم" className="px-3 py-2">{(supplier.quality_rating ?? 0).toFixed(1)}</td>
                    <td data-label="التوريد (يوم)" className="px-3 py-2">{supplier.lead_time_days ?? 0}</td>
                    <td data-label="أصناف المورد" className="px-3 py-2">
                      {supplier.supplied_item_ids.length > 0
                        ? supplier.supplied_item_ids.map((itemId) => itemNameMap.get(itemId) ?? `#${itemId}`).join('، ')
                        : '-'}
                    </td>
                    <td data-label="الحالة" className="px-3 py-2">{supplier.active ? 'نشط' : 'موقوف'}</td>
                    <td data-label="آخر تحديث" className="px-3 py-2 text-xs">{new Date(parseApiDateMs(supplier.updated_at)).toLocaleString('ar-DZ-u-nu-latn')}</td>
                    <td data-label="الإجراء" className="px-3 py-2"><button type="button" className="btn-secondary ui-size-sm" onClick={() => openEditModal(supplier)}>تعديل</button></td>
                  </tr>
                ))}
                {filteredSuppliers.length === 0 ? (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-gray-500">لا يوجد موردون مطابقون لفلتر البحث الحالي.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Modal open={modalOpen} onClose={closeModal} title={editingSupplierId ? `تعديل المورد #${editingSupplierId}` : 'إضافة مورد'} description="عرّف بيانات المورد وشروط التوريد بدقة لضمان صحة حركة المشتريات والمخزون.">
        <form onSubmit={submitSupplier} className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1"><span className="form-label">اسم المورد</span><input className="form-input" placeholder="مثال: مؤسسة النور للمواد الغذائية" value={supplierForm.name} onChange={(e) => setSupplierForm((p) => ({ ...p, name: e.target.value }))} required /></label>
          <label className="space-y-1"><span className="form-label">رقم الهاتف (اختياري)</span><input className="form-input" placeholder="مثال: 0550123456" value={supplierForm.phone} onChange={(e) => setSupplierForm((p) => ({ ...p, phone: e.target.value }))} /></label>
          <label className="space-y-1"><span className="form-label">البريد الإلكتروني (اختياري)</span><input type="email" className="form-input" placeholder="example@supplier.com" value={supplierForm.email} onChange={(e) => setSupplierForm((p) => ({ ...p, email: e.target.value }))} /></label>
          <label className="space-y-1"><span className="form-label">العنوان (اختياري)</span><input className="form-input" placeholder="المدينة، الحي، الشارع" value={supplierForm.address} onChange={(e) => setSupplierForm((p) => ({ ...p, address: e.target.value }))} /></label>
          <label className="space-y-1"><span className="form-label">مدة الدفع (يوم)</span><input type="number" min={0} className="form-input" placeholder="مثال: 30" value={supplierForm.payment_term_days} onChange={(e) => setSupplierForm((p) => ({ ...p, payment_term_days: Number(e.target.value) }))} /></label>
          <label className="space-y-1"><span className="form-label">حد الائتمان</span><input type="number" min={0} step="0.01" className="form-input" placeholder="مثال: 150000" value={supplierForm.credit_limit} onChange={(e) => setSupplierForm((p) => ({ ...p, credit_limit: Number(e.target.value) }))} /></label>
          <label className="space-y-1"><span className="form-label">تقييم المورد (0-5)</span><input type="number" min={0} max={5} step="0.1" className="form-input" placeholder="مثال: 4.5" value={supplierForm.quality_rating} onChange={(e) => setSupplierForm((p) => ({ ...p, quality_rating: Number(e.target.value) }))} /></label>
          <label className="space-y-1"><span className="form-label">مدة التوريد (يوم)</span><input type="number" min={0} className="form-input" placeholder="مثال: 2" value={supplierForm.lead_time_days} onChange={(e) => setSupplierForm((p) => ({ ...p, lead_time_days: Number(e.target.value) }))} /></label>
          <div className="space-y-2 md:col-span-2">
            <span className="form-label">الأصناف التي يوردها هذا المورد</span>
            {activeItems.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">لا يمكن ربط أصناف لأن قائمة أصناف المخزن فارغة حاليًا.</p>
            ) : (
              <div className="grid gap-2 rounded-xl border border-gray-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeItems.map((item) => {
                  const selected = supplierForm.supplied_item_ids.includes(item.id);
                  return (
                    <label key={item.id} className="flex items-center gap-2 text-sm text-gray-800">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) =>
                          setSupplierForm((prev) => ({
                            ...prev,
                            supplied_item_ids: event.target.checked
                              ? [...prev.supplied_item_ids, item.id]
                              : prev.supplied_item_ids.filter((id) => id !== item.id),
                          }))
                        }
                      />
                      <span>{item.name} ({item.unit})</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <label className="space-y-1 md:col-span-2"><span className="form-label">ملاحظات</span><textarea className="form-textarea" placeholder="ملاحظات عن جودة المورد أو شروط خاصة للتعامل" value={supplierForm.notes} onChange={(e) => setSupplierForm((p) => ({ ...p, notes: e.target.value }))} /></label>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 md:col-span-2"><input type="checkbox" checked={supplierForm.active} onChange={(e) => setSupplierForm((p) => ({ ...p, active: e.target.checked }))} />تفعيل المورد لاستخدامه في سندات الإدخال</label>
          <div className="md:col-span-2 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={closeModal}>إلغاء</button><button type="submit" className="btn-primary" disabled={saveSupplierMutation.isPending}>{saveSupplierMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ'}</button></div>
        </form>
      </Modal>
    </div>
  );
}

export function SuppliersPage() {
  return <WarehouseSuppliersSection />;
}

