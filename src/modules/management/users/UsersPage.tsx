import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type {
  DeliveryDriver,
  PermissionCatalogItem,
  User,
  UserPermissionsProfile,
  UserRole,
} from '@/shared/api/types';
import { useDataView } from '@/shared/hooks/useDataView';
import { Modal } from '@/shared/ui/Modal';
import { TableControls } from '@/shared/ui/TableControls';
import { TablePagination } from '@/shared/ui/TablePagination';

interface UserFormState {
  name: string;
  username: string;
  role: UserRole;
  active: boolean;
  password: string;
  delivery_phone: string;
  delivery_vehicle: string;
  delivery_commission_rate: number;
}

const emptyForm: UserFormState = {
  name: '',
  username: '',
  role: 'kitchen',
  active: true,
  password: '',
  delivery_phone: '',
  delivery_vehicle: '',
  delivery_commission_rate: 0,
};

const roleLabel: Record<UserRole, string> = {
  manager: 'مدير النظام',
  kitchen: 'فريق المطبخ',
  delivery: 'فريق التوصيل',
};

export function UsersPage() {
  const currentUser = useAuthStore((state) => state.user);
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyForm);

  const [permissionsModalOpen, setPermissionsModalOpen] = useState(false);
  const [permissionsTargetUser, setPermissionsTargetUser] = useState<User | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<Set<string>>(new Set<string>());

  const usersQuery = useQuery<User[]>({
    queryKey: ['manager-users'],
    queryFn: () => api.managerUsers(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const driversQuery = useQuery<DeliveryDriver[]>({
    queryKey: ['manager-drivers'],
    queryFn: () => api.managerDrivers(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const permissionsCatalogQuery = useQuery<PermissionCatalogItem[]>({
    queryKey: ['manager-users-permissions-catalog', permissionsTargetUser?.role],
    queryFn: () => api.managerPermissionsCatalog(role ?? 'manager', permissionsTargetUser?.role),
    enabled: role === 'manager' && permissionsModalOpen && Boolean(permissionsTargetUser?.role),
  });

  const userPermissionsQuery = useQuery<UserPermissionsProfile>({
    queryKey: ['manager-user-permissions', permissionsTargetUser?.id],
    queryFn: () => api.managerUserPermissions(role ?? 'manager', permissionsTargetUser?.id ?? 0),
    enabled: role === 'manager' && permissionsModalOpen && Boolean(permissionsTargetUser?.id),
  });

  useEffect(() => {
    if (!permissionsModalOpen) return;
    if (!userPermissionsQuery.data) return;
    setPermissionDraft(new Set<string>(userPermissionsQuery.data.effective_permissions));
  }, [permissionsModalOpen, userPermissionsQuery.data]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['manager-users'] });
    queryClient.invalidateQueries({ queryKey: ['manager-drivers'] });
    queryClient.invalidateQueries({ queryKey: ['manager-operational-capabilities'] });
    queryClient.invalidateQueries({ queryKey: ['public-operational-capabilities'] });
    queryClient.invalidateQueries({ queryKey: ['manager-user-permissions'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.managerCreateUser(role ?? 'manager', {
        name: form.name,
        username: form.username,
        password: form.password,
        role: form.role,
        active: form.active,
        delivery_phone: form.role === 'delivery' ? form.delivery_phone : undefined,
        delivery_vehicle: form.role === 'delivery' ? form.delivery_vehicle || null : undefined,
        delivery_commission_rate: form.role === 'delivery' ? form.delivery_commission_rate : undefined,
      }),
    onSuccess: () => {
      setModalOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      refresh();
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      api.managerUpdateUser(role ?? 'manager', editingId ?? 0, {
        name: form.name,
        role: form.role,
        active: form.active,
        password: form.password || undefined,
        delivery_phone: form.role === 'delivery' ? form.delivery_phone : undefined,
        delivery_vehicle: form.role === 'delivery' ? form.delivery_vehicle || null : undefined,
        delivery_commission_rate: form.role === 'delivery' ? form.delivery_commission_rate : undefined,
      }),
    onSuccess: () => {
      setModalOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      refresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: number) => api.managerDeleteUser(role ?? 'manager', userId),
    onSuccess: () => {
      refresh();
    },
  });

  const savePermissionsMutation = useMutation({
    mutationFn: () => {
      const target = permissionsTargetUser;
      const profile = userPermissionsQuery.data;
      if (!target || !profile) {
        throw new Error('لا يمكن حفظ الصلاحيات قبل تحميل البيانات.');
      }
      const defaults = new Set<string>(profile.default_permissions);
      const nextEffective = new Set<string>(permissionDraft);
      const allow = Array.from(nextEffective).filter((code: string) => !defaults.has(code));
      const deny = Array.from(defaults).filter((code) => !nextEffective.has(code));
      return api.managerUpdateUserPermissions(role ?? 'manager', target.id, { allow, deny });
    },
    onSuccess: (updated: UserPermissionsProfile) => {
      setPermissionDraft(new Set<string>(updated.effective_permissions));
      queryClient.invalidateQueries({ queryKey: ['manager-users'] });
      queryClient.invalidateQueries({
        queryKey: ['manager-user-permissions', permissionsTargetUser?.id],
      });
    },
  });

  const actionError = useMemo(() => {
    if (createMutation.isError) {
      return createMutation.error instanceof Error
        ? createMutation.error.message
        : 'تعذر إضافة المستخدم.';
    }
    if (updateMutation.isError) {
      return updateMutation.error instanceof Error
        ? updateMutation.error.message
        : 'تعذر تحديث المستخدم.';
    }
    if (deleteMutation.isError) {
      return deleteMutation.error instanceof Error
        ? deleteMutation.error.message
        : 'تعذر حذف المستخدم.';
    }
    return '';
  }, [
    createMutation.error,
    createMutation.isError,
    deleteMutation.error,
    deleteMutation.isError,
    updateMutation.error,
    updateMutation.isError,
  ]);

  const managedUsers = useMemo(
    () =>
      (usersQuery.data ?? []).filter(
        (row) => row.role !== 'manager' && row.username !== 'manager'
      ),
    [usersQuery.data]
  );

  const view = useDataView<User>({
    rows: managedUsers,
    search,
    page,
    pageSize: 10,
    sortBy,
    sortDirection,
    searchAccessor: (row) => `${row.id} ${row.name} ${row.username} ${row.role}`,
    sortAccessors: {
      id: (row) => row.id,
      name: (row) => row.name,
      username: (row) => row.username,
      role: (row) => row.role,
    },
  });

  const driverByUserId = useMemo(() => {
    const map = new Map<
      number,
      { phone: string; vehicle?: string | null; commission_rate: number }
    >();
    for (const driver of driversQuery.data ?? []) {
      if (driver.user_id) {
        map.set(driver.user_id, {
          phone: driver.phone,
          vehicle: driver.vehicle,
          commission_rate: driver.commission_rate,
        });
      }
    }
    return map;
  }, [driversQuery.data]);

  const permissionsCatalog = permissionsCatalogQuery.data ?? [];
  const permissionsProfile = userPermissionsQuery.data;
  const permissionsActionError = useMemo(() => {
    if (permissionsCatalogQuery.isError) {
      return permissionsCatalogQuery.error instanceof Error
        ? permissionsCatalogQuery.error.message
        : 'تعذر تحميل كتالوج الصلاحيات.';
    }
    if (userPermissionsQuery.isError) {
      return userPermissionsQuery.error instanceof Error
        ? userPermissionsQuery.error.message
        : 'تعذر تحميل صلاحيات المستخدم.';
    }
    if (savePermissionsMutation.isError) {
      return savePermissionsMutation.error instanceof Error
        ? savePermissionsMutation.error.message
        : 'تعذر حفظ الصلاحيات.';
    }
    return '';
  }, [
    permissionsCatalogQuery.error,
    permissionsCatalogQuery.isError,
    savePermissionsMutation.error,
    savePermissionsMutation.isError,
    userPermissionsQuery.error,
    userPermissionsQuery.isError,
  ]);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEditModal = (user: User) => {
    const deliveryInfo = driverByUserId.get(user.id);
    setEditingId(user.id);
    setForm({
      name: user.name,
      username: user.username,
      role: user.role === 'manager' ? 'kitchen' : user.role,
      active: user.active ?? true,
      password: '',
      delivery_phone: deliveryInfo?.phone ?? '',
      delivery_vehicle: deliveryInfo?.vehicle ?? '',
      delivery_commission_rate: deliveryInfo?.commission_rate ?? 0,
    });
    setModalOpen(true);
  };

  const openPermissionsModal = (user: User) => {
    setPermissionsTargetUser(user);
    setPermissionDraft(new Set<string>(user.permissions_effective ?? []));
    setPermissionsModalOpen(true);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.role === 'manager') return;
    if (editingId) {
      updateMutation.mutate();
      return;
    }
    createMutation.mutate();
  };

  if (usersQuery.isLoading) {
    return (
      <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">
        جارٍ تحميل المستخدمين...
      </div>
    );
  }
  if (usersQuery.isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        تعذر تحميل المستخدمين.
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={openCreateModal}
          className="btn-primary w-full sm:w-auto"
        >
          إضافة مستخدم
        </button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
        هذا القسم مخصص لحسابات فريق التشغيل (المطبخ والتوصيل).
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
          { value: 'id', label: 'ترتيب: الرقم' },
          { value: 'name', label: 'ترتيب: الاسم' },
          { value: 'username', label: 'ترتيب: اسم المستخدم' },
          { value: 'role', label: 'ترتيب: الدور' },
        ]}
        searchPlaceholder="بحث في المستخدمين..."
      />

      {actionError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {actionError}
        </div>
      ) : null}

      <section className="admin-table-shell">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">#</th>
                <th className="px-4 py-3 font-bold">الاسم</th>
                <th className="px-4 py-3 font-bold">اسم المستخدم</th>
                <th className="px-4 py-3 font-bold">الدور</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
                <th className="px-4 py-3 font-bold">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((user) => (
                <tr key={user.id} className="border-t border-gray-100">
                  <td data-label="#" className="px-4 py-3 font-bold">
                    #{user.id}
                  </td>
                  <td data-label="الاسم" className="px-4 py-3">
                    {user.name}
                  </td>
                  <td data-label="اسم المستخدم" className="px-4 py-3">
                    {user.username}
                  </td>
                  <td data-label="الدور" className="px-4 py-3">
                    {roleLabel[user.role]}
                  </td>
                  <td data-label="الحالة" className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold ${
                        user.active === false
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {user.active === false ? 'غير نشط' : 'نشط'}
                    </span>
                  </td>
                  <td data-label="الإجراءات" className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary ui-size-sm"
                        onClick={() => openPermissionsModal(user)}
                      >
                        صلاحيات
                      </button>
                      <button
                        type="button"
                        className="btn-secondary ui-size-sm"
                        onClick={() => openEditModal(user)}
                      >
                        تعديل
                      </button>
                      <button
                        type="button"
                        className="btn-danger ui-size-sm"
                        disabled={deleteMutation.isPending || currentUser?.id === user.id}
                        onClick={() => {
                          if (!window.confirm(`تأكيد الحذف النهائي للمستخدم ${user.name}؟`))
                            return;
                          deleteMutation.mutate(user.id);
                        }}
                        title={
                          currentUser?.id === user.id
                            ? 'لا يمكن حذف الحساب الحالي'
                            : 'حذف نهائي للمستخدم'
                        }
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    لا يوجد مستخدمون.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={view.page}
          totalPages={view.totalPages}
          totalRows={view.totalRows}
          onPageChange={setPage}
        />
      </section>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingId(null);
          setForm(emptyForm);
        }}
        title={editingId ? `تعديل المستخدم #${editingId}` : 'إضافة مستخدم جديد'}
        description="أدخل بيانات الحساب الأساسية بدقة. عند اختيار دور التوصيل ستظهر حقول تشغيل السائق المطلوبة."
      >
        <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="form-label">الاسم الكامل</span>
            <input
              className="form-input"
              placeholder="مثال: أحمد محمد علي"
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              required
            />
          </label>

          <label className="space-y-1">
            <span className="form-label">اسم المستخدم</span>
            <input
              className="form-input"
              placeholder="مثال: kitchen_01 (فريد وغير مكرر)"
              value={form.username}
              disabled={editingId !== null}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, username: event.target.value }))
              }
              required
            />
          </label>

          <label className="space-y-1">
            <span className="form-label">الدور التشغيلي</span>
            <select
              className="form-select"
              value={form.role}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, role: event.target.value as UserRole }))
              }
            >
              <option value="kitchen">مطبخ</option>
              <option value="delivery">توصيل</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="form-label">
              كلمة المرور {editingId ? '(اختياري)' : ''}
            </span>
            <input
              type="password"
              className="form-input"
              placeholder={
                editingId
                  ? 'اتركه فارغًا للإبقاء على كلمة المرور الحالية'
                  : '8 أحرف على الأقل وتحتوي أحرفًا وأرقامًا'
              }
              value={form.password}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, password: event.target.value }))
              }
              required={editingId === null}
            />
          </label>

          {form.role === 'delivery' && (
            <>
              <label className="space-y-1">
                <span className="form-label">هاتف السائق</span>
                <input
                  className="form-input"
                  placeholder="مثال: 0550123456"
                  value={form.delivery_phone}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, delivery_phone: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="space-y-1">
                <span className="form-label">المركبة (اختياري)</span>
                <input
                  className="form-input"
                  placeholder="مثال: دراجة نارية / سيارة"
                  value={form.delivery_vehicle}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, delivery_vehicle: event.target.value }))
                  }
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="form-label">نسبة العمولة (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  className="form-input"
                  placeholder="مثال: 12.5"
                  value={form.delivery_commission_rate}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      delivery_commission_rate: Number(event.target.value),
                    }))
                  }
                  required
                />
              </label>
            </>
          )}

          <label className="flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, active: event.target.checked }))
              }
            />
            الحساب نشط
          </label>

          <div className="flex gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="btn-primary"
            >
              {createMutation.isPending || updateMutation.isPending
                ? 'جارٍ الحفظ...'
                : 'حفظ'}
            </button>
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setEditingId(null);
                setForm(emptyForm);
              }}
              className="btn-secondary"
            >
              إلغاء
            </button>
          </div>

          {createMutation.isError || updateMutation.isError ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 md:col-span-2">
              {(createMutation.error as Error)?.message ||
                (updateMutation.error as Error)?.message ||
                'تعذر حفظ المستخدم.'}
            </p>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={permissionsModalOpen}
        onClose={() => {
          setPermissionsModalOpen(false);
          setPermissionsTargetUser(null);
          setPermissionDraft(new Set<string>());
        }}
        title={
          permissionsTargetUser
            ? `صلاحيات المستخدم ${permissionsTargetUser.name}`
            : 'صلاحيات المستخدم'
        }
        description="فعّل أو عطّل الصلاحيات بدقة حسب مهام الحساب. التغييرات تطبق مباشرة بعد الحفظ."
      >
        <div className="space-y-3">
          {permissionsActionError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {permissionsActionError}
            </div>
          ) : null}

          {permissionsProfile ? (
            <div className="rounded-xl border border-brand-100 bg-brand-50/40 px-3 py-2 text-xs text-gray-700">
              <span className="font-bold">الصلاحيات الفعالة الآن:</span>{' '}
              {permissionsProfile.effective_permissions.length}
            </div>
          ) : null}

          {permissionsCatalogQuery.isLoading || userPermissionsQuery.isLoading ? (
            <div className="rounded-xl border border-brand-100 bg-white px-4 py-6 text-center text-sm text-gray-500">
              جارٍ تحميل الصلاحيات...
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-brand-100 bg-white p-3">
              {permissionsCatalog.length === 0 ? (
                <p className="text-sm text-gray-500">
                  لا توجد صلاحيات قابلة للعرض لهذا الدور.
                </p>
              ) : (
                <div className="space-y-2">
                  {permissionsCatalog.map((permission: PermissionCatalogItem) => (
                    <label
                      key={permission.code}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-3 py-2 text-sm transition hover:border-brand-200 hover:bg-brand-50/30"
                    >
                      <input
                        type="checkbox"
                        checked={permissionDraft.has(permission.code)}
                        onChange={(event) => {
                          setPermissionDraft((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(permission.code);
                            else next.delete(permission.code);
                            return next;
                          });
                        }}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-800">
                            {permission.label}
                          </span>
                          {permission.default_enabled ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                              افتراضي
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {permission.description}
                        </p>
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          {permission.code}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={
                savePermissionsMutation.isPending ||
                permissionsCatalogQuery.isLoading ||
                userPermissionsQuery.isLoading
              }
              onClick={() => savePermissionsMutation.mutate()}
            >
              {savePermissionsMutation.isPending
                ? 'جارٍ حفظ الصلاحيات...'
                : 'حفظ الصلاحيات'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPermissionsModalOpen(false);
                setPermissionsTargetUser(null);
                setPermissionDraft(new Set<string>());
              }}
            >
              إغلاق
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
