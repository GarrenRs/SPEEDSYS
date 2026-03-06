import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type { Product, ProductKind, ProductPayload } from '@/shared/api/types';
import { Modal } from '@/shared/ui/Modal';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';

const PAGE_SIZE = 12;
const ARCHIVED_PAGE_SIZE = 100;
const backendOrigin = (import.meta.env.VITE_BACKEND_ORIGIN as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:8122';
const PROTECTED_CATEGORY_NAMES = new Set(['عام']);

type ProductSort = 'id' | 'name' | 'category' | 'price' | 'available';
type ProductAvailabilityState = 'available' | 'unavailable' | 'archived';
type ProductKindFilter = 'all' | ProductKind;

const emptyProductForm = {
  name: '',
  description: '',
  price: 0,
  kind: 'sellable' as ProductKind,
  category_id: 0,
  available: true,
  is_archived: false,
};

export function ProductsPage() {
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<ProductSort>('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [kindFilter, setKindFilter] = useState<ProductKindFilter>('all');
  const [page, setPage] = useState(1);

  const [form, setForm] = useState(emptyProductForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState('');

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySortOrder, setNewCategorySortOrder] = useState(0);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<number, { name: string; sort_order: number }>>({});

  const activeProductsQuery = useQuery({
    queryKey: ['manager-products-paged', 'active', kindFilter, page, PAGE_SIZE, search, sortBy, sortDirection],
    queryFn: () =>
      api.managerProductsPaged(role ?? 'manager', {
        page,
        pageSize: PAGE_SIZE,
        search,
        sortBy,
        sortDirection,
        archiveState: 'active',
        kind: kindFilter,
      }),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(3000),
  });

  const archivedProductsQuery = useQuery({
    queryKey: ['manager-products-paged', 'archived', kindFilter, search, sortBy, sortDirection],
    queryFn: () =>
      api.managerProductsPaged(role ?? 'manager', {
        page: 1,
        pageSize: ARCHIVED_PAGE_SIZE,
        search,
        sortBy,
        sortDirection,
        archiveState: 'archived',
        kind: kindFilter,
      }),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const categoriesQuery = useQuery({
    queryKey: ['manager-categories'],
    queryFn: () => api.managerCategories(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['manager-products-paged'] });
    queryClient.invalidateQueries({ queryKey: ['manager-products'] });
    queryClient.invalidateQueries({ queryKey: ['manager-categories'] });
    queryClient.invalidateQueries({ queryKey: ['public-products'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: ProductPayload) => api.managerCreateProduct(role ?? 'manager', payload),
    onSuccess: refreshAll,
  });

  const updateMutation = useMutation({
    mutationFn: ({ productId, payload }: { productId: number; payload: ProductPayload }) =>
      api.managerUpdateProduct(role ?? 'manager', productId, payload),
    onSuccess: refreshAll,
  });

  const uploadImageMutation = useMutation({
    mutationFn: ({ productId, file }: { productId: number; file: File }) =>
      toBase64Payload(file).then((payload) => api.managerUploadProductImage(role ?? 'manager', productId, payload)),
    onSuccess: refreshAll,
  });

  const archiveMutation = useMutation({
    mutationFn: (productId: number) => api.managerDeleteProduct(role ?? 'manager', productId),
    onSuccess: refreshAll,
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (productId: number) => api.managerDeleteProductPermanently(role ?? 'manager', productId),
    onSuccess: refreshAll,
  });

  const statusMutation = useMutation({
    mutationFn: ({ productId, payload }: { productId: number; payload: ProductPayload }) =>
      api.managerUpdateProduct(role ?? 'manager', productId, payload),
    onSuccess: refreshAll,
  });

  const createCategoryMutation = useMutation({
    mutationFn: (payload: { name: string; active: boolean; sort_order: number }) =>
      api.managerCreateCategory(role ?? 'manager', payload),
    onSuccess: () => {
      refreshAll();
      setNewCategoryName('');
      setNewCategorySortOrder(0);
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({
      categoryId,
      payload,
    }: {
      categoryId: number;
      payload: { name: string; active: boolean; sort_order: number };
    }) => api.managerUpdateCategory(role ?? 'manager', categoryId, payload),
    onSuccess: refreshAll,
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (categoryId: number) => api.managerDeleteCategory(role ?? 'manager', categoryId),
    onSuccess: refreshAll,
  });

  const categories = categoriesQuery.data ?? [];
  const activeCategories = useMemo(() => categories.filter((category) => category.active), [categories]);
  const hasActiveCategories = activeCategories.length > 0;
  const defaultCategoryId = activeCategories[0]?.id ?? 0;

  const resolveCategoryId = (product: Product): number => {
    if (product.category_id && product.category_id > 0) {
      return product.category_id;
    }
    const byName = categories.find((category) => category.name === product.category);
    return byName?.id ?? 0;
  };

  const openCreateModal = () => {
    setEditingId(null);
    setForm({ ...emptyProductForm, category_id: defaultCategoryId });
    setImageFile(null);
    setSubmitError('');
    setIsModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    const resolvedCategoryId = resolveCategoryId(product);
    setEditingId(product.id);
    setForm({
      name: product.name,
      description: product.description ?? '',
      price: product.price,
      kind: product.kind,
      category_id: resolvedCategoryId,
      available: product.available,
      is_archived: Boolean(product.is_archived),
    });
    setImageFile(null);
    setSubmitError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setForm({ ...emptyProductForm, category_id: defaultCategoryId });
    setImageFile(null);
    setSubmitError('');
  };

  const onImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setImageFile(file);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError('');

    if (form.category_id <= 0) {
      setSubmitError('يرجى اختيار تصنيف صالح للمنتج.');
      return;
    }

    const payload: ProductPayload = {
      name: form.name,
      description: form.description || null,
      price: Number(form.price),
      kind: form.kind,
      category_id: form.category_id,
      available: form.available,
    };
    if (editingId) {
      payload.is_archived = form.is_archived;
    }

    try {
      const product = editingId
        ? await updateMutation.mutateAsync({ productId: editingId, payload })
        : await createMutation.mutateAsync(payload);

      if (imageFile) {
        await uploadImageMutation.mutateAsync({ productId: product.id, file: imageFile });
      }

      closeModal();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'تعذر حفظ المنتج');
    }
  };

  const submitNewCategory = () => {
    const normalized = newCategoryName.trim();
    if (normalized.length < 2) {
      return;
    }
    createCategoryMutation.mutate({
      name: normalized,
      active: true,
      sort_order: Math.max(0, Number(newCategorySortOrder) || 0),
    });
  };

  const openCategoryModal = () => {
    setCategoryDrafts(
      Object.fromEntries(
        categories.map((category) => [
          category.id,
          {
            name: category.name,
            sort_order: category.sort_order,
          },
        ])
      )
    );
    setIsCategoryModalOpen(true);
  };

  const isSubmitting =
    createMutation.isPending ||
    updateMutation.isPending ||
    uploadImageMutation.isPending ||
    archiveMutation.isPending ||
    permanentDeleteMutation.isPending ||
    statusMutation.isPending ||
    createCategoryMutation.isPending ||
    updateCategoryMutation.isPending ||
    deleteCategoryMutation.isPending;

  const generalError =
    (archiveMutation.error as Error | null)?.message ??
    (permanentDeleteMutation.error as Error | null)?.message ??
    (statusMutation.error as Error | null)?.message ??
    (createCategoryMutation.error as Error | null)?.message ??
    (updateCategoryMutation.error as Error | null)?.message ??
    (deleteCategoryMutation.error as Error | null)?.message ??
    '';

  const activeRows = activeProductsQuery.data?.items ?? [];
  const archivedRows = archivedProductsQuery.data?.items ?? [];
  const archivedTotalRows = archivedProductsQuery.data?.total ?? 0;
  const totalRows = activeProductsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const buildPayloadFromProduct = (product: Product, nextState: ProductAvailabilityState): ProductPayload | null => {
    const categoryId = resolveCategoryId(product);
    if (categoryId <= 0) {
      return null;
    }

    return {
      name: product.name,
      description: product.description ?? null,
      price: product.price,
      kind: product.kind,
      category_id: categoryId,
      available: nextState === 'available',
      is_archived: nextState === 'archived',
    };
  };

  const formAvailabilityState: ProductAvailabilityState = form.is_archived
    ? 'archived'
    : form.available
      ? 'available'
      : 'unavailable';

  if (activeProductsQuery.isLoading || archivedProductsQuery.isLoading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل المنتجات...</div>;
  }

  if (activeProductsQuery.isError || archivedProductsQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل بيانات المنتجات.</div>;
  }

  return (
    <div className="admin-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button
            type="button"
            onClick={openCategoryModal}
            className="btn-secondary"
          >
            إدارة التصنيفات
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="btn-primary"
          >
            إضافة منتج جديد
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
        onSortByChange={(value) => {
          setSortBy(value as ProductSort);
          setPage(1);
        }}
        sortDirection={sortDirection}
        onSortDirectionChange={(value) => {
          setSortDirection(value);
          setPage(1);
        }}
        sortOptions={[
          { value: 'id', label: 'الترتيب حسب الرقم' },
          { value: 'name', label: 'الترتيب حسب الاسم' },
          { value: 'category', label: 'الترتيب حسب التصنيف' },
          { value: 'price', label: 'الترتيب حسب السعر' },
          { value: 'available', label: 'الترتيب حسب التوفر' },
        ]}
        searchPlaceholder="ابحث بالاسم أو التصنيف أو الرقم..."
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setKindFilter('all');
            setPage(1);
          }}
          className={`rounded-full border px-3 py-1 text-xs font-bold ${
            kindFilter === 'all' ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-300 bg-white text-gray-600'
          }`}
        >
          كل المنتجات
        </button>
        <button
          type="button"
          onClick={() => {
            setKindFilter('sellable');
            setPage(1);
          }}
          className={`rounded-full border px-3 py-1 text-xs font-bold ${
            kindFilter === 'sellable' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 bg-white text-gray-600'
          }`}
        >
          منتجات للبيع
        </button>
        <button
          type="button"
          onClick={() => {
            setKindFilter('internal');
            setPage(1);
          }}
          className={`rounded-full border px-3 py-1 text-xs font-bold ${
            kindFilter === 'internal' ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-gray-300 bg-white text-gray-600'
          }`}
        >
          منتجات داخلية
        </button>
      </div>

      <section className="admin-table-shell shadow-sm">
        {generalError && (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{generalError}</div>
        )}
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 font-bold">رقم</th>
                <th className="px-4 py-3 font-bold">الاسم</th>
                <th className="px-4 py-3 font-bold">النوع التشغيلي</th>
                <th className="px-4 py-3 font-bold">التصنيف</th>
                <th className="px-4 py-3 font-bold">السعر</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
                <th className="px-4 py-3 font-bold">الصورة</th>
                <th className="px-4 py-3 font-bold">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((product) => {
                const imageUrl = resolveImageUrl(product.image_path);
                const activePayload = buildPayloadFromProduct(product, 'available');
                const unavailablePayload = buildPayloadFromProduct(product, 'unavailable');
                const canUpdateQuickState = Boolean(activePayload && unavailablePayload);
                return (
                  <tr key={product.id} className="border-t border-gray-100 align-top">
                    <td data-label="رقم" className="px-4 py-3">#{product.id}</td>
                    <td data-label="الاسم" className="px-4 py-3 font-bold">{product.name}</td>
                    <td data-label="النوع التشغيلي" className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${
                          product.kind === 'sellable'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-sky-100 text-sky-700'
                        }`}
                      >
                        {product.kind === 'sellable' ? 'منتج للبيع' : 'منتج داخلي'}
                      </span>
                    </td>
                    <td data-label="التصنيف" className="px-4 py-3">{product.category}</td>
                    <td data-label="السعر" className="px-4 py-3">{product.price.toFixed(2)} د.ج</td>
                    <td data-label="الحالة" className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-bold ${
                            product.available ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {product.available ? 'متاح' : 'غير متاح'}
                        </span>
                      </div>
                    </td>
                    <td data-label="الصورة" className="px-4 py-3 text-xs text-gray-500">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={product.name}
                          className="h-12 w-12 rounded-lg border border-gray-200 object-cover"
                          loading="lazy"
                        />
                      ) : (
                        'بدون صورة'
                      )}
                    </td>
                    <td data-label="الإجراءات" className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(product)}
                          className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700"
                        >
                          تعديل
                        </button>
                        {product.kind === 'sellable' ? (
                          <button
                            type="button"
                            disabled={!canUpdateQuickState}
                            onClick={() => {
                              const payload = product.available ? unavailablePayload : activePayload;
                              if (!payload) {
                                return;
                              }
                              statusMutation.mutate({
                                productId: product.id,
                                payload,
                              });
                            }}
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold disabled:opacity-50 ${
                              product.available
                                ? 'border border-amber-300 text-amber-700'
                                : 'border border-emerald-300 text-emerald-700'
                            }`}
                          >
                            {product.available ? 'تعطيل' : 'تفعيل'}
                          </button>
                        ) : (
                          <span className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">
                            داخلي (غير قابل للبيع)
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => archiveMutation.mutate(product.id)}
                          className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-bold text-rose-700"
                        >
                          أرشفة
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {activeRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                    لا توجد منتجات متاحة أو غير متاحة ضمن نتائج البحث الحالية.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination page={page} totalPages={totalPages} totalRows={totalRows} onPageChange={setPage} />
      </section>

      <div className="space-y-1">
        <h3 className="text-base font-black text-gray-800">المنتجات المؤرشفة</h3>
        <p className="text-xs text-gray-500">هذه المنتجات خارج القائمة العامة ويمكن استعادتها عند الحاجة.</p>
        {archivedTotalRows > 0 && (
          <p className="text-xs text-gray-500">
            إجمالي المؤرشف: {archivedTotalRows} {archivedTotalRows > ARCHIVED_PAGE_SIZE ? `(يتم عرض أول ${ARCHIVED_PAGE_SIZE})` : ''}
          </p>
        )}
      </div>

      <section className="admin-table-shell border-gray-200 shadow-sm">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 font-bold">رقم</th>
                <th className="px-4 py-3 font-bold">الاسم</th>
                <th className="px-4 py-3 font-bold">النوع التشغيلي</th>
                <th className="px-4 py-3 font-bold">التصنيف</th>
                <th className="px-4 py-3 font-bold">السعر</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
                <th className="px-4 py-3 font-bold">الصورة</th>
                <th className="px-4 py-3 font-bold">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {archivedRows.map((product) => {
                const imageUrl = resolveImageUrl(product.image_path);
                const availablePayload = buildPayloadFromProduct(product, 'available');
                const unavailablePayload = buildPayloadFromProduct(product, 'unavailable');
                const canRestore = Boolean(availablePayload && unavailablePayload);
                const isInternal = product.kind === 'internal';
                return (
                  <tr key={`archived-${product.id}`} className="border-t border-gray-100 align-top">
                    <td data-label="رقم" className="px-4 py-3">#{product.id}</td>
                    <td data-label="الاسم" className="px-4 py-3 font-bold">{product.name}</td>
                    <td data-label="النوع التشغيلي" className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${
                          isInternal ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {isInternal ? 'منتج داخلي' : 'منتج للبيع'}
                      </span>
                    </td>
                    <td data-label="التصنيف" className="px-4 py-3">{product.category}</td>
                    <td data-label="السعر" className="px-4 py-3">{product.price.toFixed(2)} د.ج</td>
                    <td data-label="الحالة" className="px-4 py-3">
                      <span className="rounded-full bg-gray-200 px-2 py-1 text-xs font-bold text-gray-700">مؤرشف</span>
                    </td>
                    <td data-label="الصورة" className="px-4 py-3 text-xs text-gray-500">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={product.name}
                          className="h-12 w-12 rounded-lg border border-gray-200 object-cover"
                          loading="lazy"
                        />
                      ) : (
                        'بدون صورة'
                      )}
                    </td>
                    <td data-label="الإجراءات" className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(product)}
                          className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700"
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          disabled={!canRestore}
                          onClick={() => {
                            if (!unavailablePayload) {
                              return;
                            }
                            statusMutation.mutate({
                              productId: product.id,
                              payload: unavailablePayload,
                            });
                          }}
                          className="rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-bold text-brand-700 disabled:opacity-50"
                        >
                          استعادة كغير متاح
                        </button>
                        {!isInternal && (
                          <button
                            type="button"
                            disabled={!canRestore}
                            onClick={() => {
                              if (!availablePayload) {
                                return;
                              }
                              statusMutation.mutate({
                                productId: product.id,
                                payload: availablePayload,
                              });
                            }}
                            className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-bold text-emerald-700 disabled:opacity-50"
                          >
                            استعادة وتفعيل
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={permanentDeleteMutation.isPending}
                          onClick={() => {
                            const confirmed = window.confirm(
                              `سيتم حذف المنتج رقم ${product.id} نهائيا ولا يمكن التراجع. هل تريد المتابعة؟`
                            );
                            if (!confirmed) {
                              return;
                            }
                            permanentDeleteMutation.mutate(product.id);
                          }}
                          className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-bold text-rose-700 disabled:opacity-50"
                        >
                          حذف نهائي
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {archivedRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    لا توجد منتجات مؤرشفة ضمن نتائج البحث الحالية.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={isModalOpen}
        onClose={closeModal}
        title={editingId ? `تعديل المنتج رقم ${editingId}` : 'إضافة منتج جديد'}
        description="أدخل بيانات المنتج بدقة، ثم حدد نوعه وحالته والتصنيف المناسب قبل الحفظ."
      >
        <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmit}>
          <label className="space-y-1">
            <span className="form-label">اسم المنتج</span>
            <input
              className="form-input"
              placeholder="مثال: بيتزا خضار كبيرة"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>

          <label className="space-y-1">
            <span className="form-label">نوع المنتج</span>
            <select
              className="form-select"
              value={form.kind}
              onChange={(event) => {
                const nextKind = event.target.value as ProductKind;
                setForm((prev) => ({
                  ...prev,
                  kind: nextKind,
                  available: nextKind === 'sellable' ? prev.available : false,
                  is_archived: prev.is_archived,
                }));
              }}
            >
              <option value="sellable">منتج للبيع</option>
              <option value="internal">منتج داخلي (تحضير)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="form-label">التصنيف</span>
            <select
              className="form-select"
              value={form.category_id}
              onChange={(event) => setForm((prev) => ({ ...prev, category_id: Number(event.target.value) }))}
              required
            >
              <option value={0}>اختر تصنيف المنتج</option>
              {categories
                .filter((category) => category.active || category.id === form.category_id)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name} {category.active ? '' : '(غير نشط)'}
                  </option>
                ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="form-label">حالة الإتاحة</span>
            <select
              className="form-select"
              value={formAvailabilityState}
              onChange={(event) => {
                const nextState = event.target.value as ProductAvailabilityState;
                setForm((prev) => {
                  if (nextState === 'available') {
                    if (prev.kind === 'internal') {
                      return { ...prev, available: false, is_archived: false };
                    }
                    return { ...prev, available: true, is_archived: false };
                  }
                  if (nextState === 'archived') {
                    return { ...prev, available: false, is_archived: true };
                  }
                  return { ...prev, available: false, is_archived: false };
                });
              }}
            >
              <option value="available" disabled={form.kind === 'internal'}>
                متاح للطلب
              </option>
              <option value="unavailable">غير متاح للطلب</option>
              <option value="archived">مؤرشف</option>
            </select>
          </label>

          {!hasActiveCategories && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 md:col-span-2">
              لا يوجد تصنيف نشط حاليًا. قم بإضافة أو تفعيل تصنيف من نافذة إدارة التصنيفات.
            </p>
          )}

          <label className="space-y-1 md:col-span-2">
            <span className="form-label">وصف المنتج</span>
            <textarea
              className="form-textarea"
              placeholder="وصف مختصر يساعد فريق التشغيل على التعرف على المنتج"
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </label>

          <label className="space-y-1">
            <span className="form-label">السعر (د.ج)</span>
            <input
              className="form-input"
              placeholder="مثال: 850"
              type="number"
              min={0}
              step="0.1"
              value={form.price}
              onChange={(event) => setForm((prev) => ({ ...prev, price: Number(event.target.value) }))}
              required
            />
          </label>

          {form.kind === 'internal' ? (
            <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 md:col-span-1">
              المنتج الداخلي لا يظهر في واجهات البيع والطلبات، ويُستخدم للتحضير الداخلي فقط.
            </p>
          ) : (
            <div className="md:col-span-1" />
          )}

          <div className="md:col-span-2">
            <label className="form-label">صورة المنتج (اختياري)</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onImageChange}
              className="form-input"
            />
            <p className="mt-1 text-xs text-gray-500">الأنواع المدعومة: PNG / JPG / WEBP.</p>
            {imageFile && <p className="mt-1 text-xs text-gray-500">تم اختيار: {imageFile.name}</p>}
          </div>

          {submitError && <p className="md:col-span-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{submitError}</p>}
          <div className="md:col-span-2 flex items-center justify-end gap-2 border-t border-gray-200 pt-3">
            <button type="button" onClick={closeModal} className="btn-secondary" disabled={isSubmitting}>
              إغلاق
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {editingId ? 'حفظ التعديلات' : 'إضافة المنتج'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        title="إدارة التصنيفات"
        description="أضف التصنيفات ونظّم ترتيبها لتظهر بشكل واضح في إدارة المنتجات."
      >
        <div className="space-y-4">
          <div className="grid gap-2 md:grid-cols-[1.6fr_0.7fr_auto]">
            <label className="space-y-1">
              <span className="form-label">اسم التصنيف الجديد</span>
              <input
                className="form-input"
                placeholder="مثال: مشروبات ساخنة"
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="form-label">ترتيب التصنيف</span>
              <input
                className="form-input"
                type="number"
                min={0}
                value={newCategorySortOrder}
                onChange={(event) => setNewCategorySortOrder(Number(event.target.value))}
                placeholder="مثال: 10"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={submitNewCategory}
                className="btn-primary"
                disabled={createCategoryMutation.isPending || newCategoryName.trim().length < 2}
              >
                إضافة
              </button>
            </div>
          </div>

          {categoriesQuery.isError && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">تعذر تحميل التصنيفات.</p>
          )}

          <div className="adaptive-table max-h-72 overflow-auto rounded-xl border border-gray-200">
            <table className="table-unified min-w-full text-sm">
              <thead className="bg-brand-50 text-gray-700">
                <tr>
                  <th className="px-3 py-2 font-bold">التصنيف</th>
                  <th className="px-3 py-2 font-bold">الترتيب</th>
                  <th className="px-3 py-2 font-bold">الحالة</th>
                  <th className="px-3 py-2 font-bold">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const isProtected = isProtectedCategoryName(category.name);
                  return (
                    <tr key={category.id} className="border-t border-gray-100">
                      <td data-label="التصنيف" className="px-3 py-2">
                        <input
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 font-semibold"
                          value={categoryDrafts[category.id]?.name ?? category.name}
                          disabled={isProtected}
                          onChange={(event) =>
                            setCategoryDrafts((prev) => ({
                              ...prev,
                              [category.id]: {
                                name: event.target.value,
                                sort_order: prev[category.id]?.sort_order ?? category.sort_order,
                              },
                            }))
                          }
                        />
                      </td>
                      <td data-label="الترتيب" className="px-3 py-2">
                        <input
                          className="w-24 rounded-lg border border-gray-300 px-2 py-1.5"
                          type="number"
                          min={0}
                          value={categoryDrafts[category.id]?.sort_order ?? category.sort_order}
                          disabled={isProtected}
                          onChange={(event) =>
                            setCategoryDrafts((prev) => ({
                              ...prev,
                              [category.id]: {
                                name: prev[category.id]?.name ?? category.name,
                                sort_order: Math.max(0, Number(event.target.value) || 0),
                              },
                            }))
                          }
                        />
                      </td>
                      <td data-label="الحالة" className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-bold ${category.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}
                        >
                          {category.active ? 'نشط' : 'غير نشط'}
                        </span>
                        {isProtected && (
                          <span className="mr-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">
                            افتراضي
                          </span>
                        )}
                      </td>
                      <td data-label="الإجراءات" className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isProtected}
                            onClick={() =>
                              updateCategoryMutation.mutate({
                                categoryId: category.id,
                                payload: {
                                  name: (categoryDrafts[category.id]?.name ?? category.name).trim(),
                                  active: category.active,
                                  sort_order: categoryDrafts[category.id]?.sort_order ?? category.sort_order,
                                },
                              })
                            }
                            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            حفظ
                          </button>
                          <button
                            type="button"
                            disabled={isProtected}
                            onClick={() =>
                              updateCategoryMutation.mutate({
                                categoryId: category.id,
                                payload: {
                                  name: (categoryDrafts[category.id]?.name ?? category.name).trim(),
                                  active: !category.active,
                                  sort_order: categoryDrafts[category.id]?.sort_order ?? category.sort_order,
                                },
                              })
                            }
                            className="rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-bold text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {category.active ? 'تعطيل' : 'تفعيل'}
                          </button>
                          <button
                            type="button"
                            disabled={isProtected}
                            onClick={() => deleteCategoryMutation.mutate(category.id)}
                            className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {categories.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                      لا توجد تصنيفات بعد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${backendOrigin}${path.startsWith('/') ? '' : '/'}${path}`;
}

function isProtectedCategoryName(name: string): boolean {
  return PROTECTED_CATEGORY_NAMES.has(name.trim().toLowerCase());
}

function toBase64Payload(file: File): Promise<{ mime_type: string; data_base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('تعذر قراءة ملف الصورة'));
        return;
      }
      const [, base64] = result.split(',', 2);
      if (!base64) {
        reject(new Error('صيغة الصورة غير صالحة'));
        return;
      }
      resolve({
        mime_type: file.type || 'image/jpeg',
        data_base64: base64,
      });
    };
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.readAsDataURL(file);
  });
}
