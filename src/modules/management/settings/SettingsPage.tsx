import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth/store';
import { api } from '@/shared/api/client';
import type { AccountSession, User } from '@/shared/api/types';
import { parseApiDateMs } from '@/shared/utils/date';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';
import { sanitizeMojibakeText } from '@/shared/utils/textSanitizer';

function formatDateTime(value: string): string {
  return new Date(parseApiDateMs(value)).toLocaleString('ar-DZ-u-nu-latn');
}

function sessionStatusMeta(session: AccountSession): { label: string; className: string } {
  if (session.is_active) {
    return { label: 'نشطة', className: 'text-emerald-700' };
  }
  if (session.revoked_at) {
    return { label: 'منهية', className: 'text-rose-700' };
  }
  return { label: 'منتهية', className: 'text-amber-700' };
}

const operationalDescriptionFallbackByKey: Record<string, string> = {
  deployment_mode: 'وضع التشغيل الحالي للنظام (تشغيلي أو صيانة).',
  payment_method: 'طريقة الدفع الافتراضية لتسجيل العمليات النقدية.',
  order_polling_ms: 'فاصل تحديث الطلبات بالميلي ثانية بين كل دورة مزامنة.',
  audit_logs: 'تفعيل أو تعطيل تسجيل الأحداث الحساسة في سجل التدقيق.',
};

function renderOperationalDescription(key: string, description: string): string {
  return sanitizeMojibakeText(description, operationalDescriptionFallbackByKey[key] ?? 'وصف الإعداد التشغيلي.');
}

export function SettingsPage() {
  const role = useAuthStore((state) => state.role);
  const currentUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  const [deliveryFeeInput, setDeliveryFeeInput] = useState('0');
  const [deliveryMinOrderInput, setDeliveryMinOrderInput] = useState('0');
  const [deliveryAutoNotifyTeam, setDeliveryAutoNotifyTeam] = useState(false);
  const [operationalInputs, setOperationalInputs] = useState<Record<string, string>>({});
  const [restoreFilename, setRestoreFilename] = useState('');
  const [restoreConfirmPhrase, setRestoreConfirmPhrase] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [managerPasswordConfirm, setManagerPasswordConfirm] = useState('');

  const meQuery = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.me(),
    enabled: role === 'manager',
  });

  const deliverySettingsQuery = useQuery({
    queryKey: ['manager-delivery-settings'],
    queryFn: () => api.managerDeliverySettings(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const deliveryPoliciesQuery = useQuery({
    queryKey: ['manager-delivery-policies'],
    queryFn: () => api.managerDeliveryPolicies(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const operationalSettingsQuery = useQuery({
    queryKey: ['manager-operational-settings'],
    queryFn: () => api.managerOperationalSettings(role ?? 'manager'),
    enabled: role === 'manager',
  });

  const backupsQuery = useQuery({
    queryKey: ['manager-system-backups'],
    queryFn: () => api.managerSystemBackups(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(20000),
  });

  const sessionsQuery = useQuery({
    queryKey: ['manager-account-sessions'],
    queryFn: () => api.managerAccountSessions(role ?? 'manager'),
    enabled: role === 'manager',
    refetchInterval: adaptiveRefetchInterval(15000),
  });

  const managerProfile = useMemo<User | null>(() => meQuery.data ?? currentUser ?? null, [currentUser, meQuery.data]);

  const updateDeliverySettingsMutation = useMutation({
    mutationFn: (deliveryFee: number) => api.managerUpdateDeliverySettings(role ?? 'manager', { delivery_fee: deliveryFee }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-delivery-settings'] });
      queryClient.invalidateQueries({ queryKey: ['public-delivery-settings'] });
    },
  });

  const updateDeliveryPoliciesMutation = useMutation({
    mutationFn: (payload: { min_order_amount: number; auto_notify_team: boolean }) =>
      api.managerUpdateDeliveryPolicies(role ?? 'manager', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-delivery-policies'] });
      queryClient.invalidateQueries({ queryKey: ['manager-audit-system-logs'] });
    },
  });

  const updateOperationalSettingMutation = useMutation({
    mutationFn: (payload: { key: string; value: string }) =>
      api.managerUpdateOperationalSetting(role ?? 'manager', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-operational-settings'] });
      queryClient.invalidateQueries({ queryKey: ['manager-audit-system-logs'] });
    },
  });

  const createBackupMutation = useMutation({
    mutationFn: () => api.managerCreateSystemBackup(role ?? 'manager'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-system-backups'] });
      queryClient.invalidateQueries({ queryKey: ['manager-audit-system-logs'] });
    },
  });

  const restoreBackupMutation = useMutation({
    mutationFn: () =>
      api.managerRestoreSystemBackup(role ?? 'manager', {
        filename: restoreFilename,
        confirm_phrase: restoreConfirmPhrase,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-system-backups'] });
      queryClient.invalidateQueries({ queryKey: ['manager-audit-system-logs'] });
      setRestoreConfirmPhrase('');
    },
  });

  const updateManagerAccountMutation = useMutation({
    mutationFn: async () => {
      if (!managerProfile) {
        throw new Error('تعذر تحميل بيانات حساب المدير.');
      }
      const nextName = managerName.trim();
      if (nextName.length < 2) {
        throw new Error('الاسم يجب أن يكون حرفين على الأقل.');
      }

      const nextPassword = managerPassword.trim();
      if (nextPassword.length > 0 && nextPassword.length < 8) {
        throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
      }
      if (nextPassword.length > 0) {
        const hasLetter = /[A-Za-z\u0600-\u06FF]/.test(nextPassword);
        const hasNumber = /\d/.test(nextPassword);
        if (!hasLetter || !hasNumber) {
          throw new Error('كلمة المرور يجب أن تحتوي على أحرف وأرقام على الأقل.');
        }
        if (/\s/.test(nextPassword)) {
          throw new Error('كلمة المرور يجب ألا تحتوي على مسافات.');
        }
      }

      return api.managerUpdateAccountProfile(role ?? 'manager', {
        name: nextName,
        password: nextPassword.length > 0 ? nextPassword : undefined,
      });
    },
    onSuccess: () => {
      setManagerPassword('');
      setManagerPasswordConfirm('');
      queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      queryClient.invalidateQueries({ queryKey: ['manager-users'] });
      queryClient.invalidateQueries({ queryKey: ['manager-audit-system-logs'] });
    },
  });

  const revokeSessionsMutation = useMutation({
    mutationFn: () => api.managerRevokeAllAccountSessions(role ?? 'manager'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-account-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['manager-audit-system-logs'] });
    },
  });

  useEffect(() => {
    if (deliverySettingsQuery.data) {
      setDeliveryFeeInput(String(deliverySettingsQuery.data.delivery_fee));
    }
  }, [deliverySettingsQuery.data]);

  useEffect(() => {
    if (managerProfile?.name) {
      setManagerName(managerProfile.name);
    }
  }, [managerProfile?.name]);

  useEffect(() => {
    if (deliveryPoliciesQuery.data) {
      setDeliveryMinOrderInput(String(deliveryPoliciesQuery.data.min_order_amount));
      setDeliveryAutoNotifyTeam(deliveryPoliciesQuery.data.auto_notify_team);
    }
  }, [deliveryPoliciesQuery.data]);

  useEffect(() => {
    if (operationalSettingsQuery.data) {
      const nextInputs: Record<string, string> = {};
      for (const row of operationalSettingsQuery.data) {
        nextInputs[row.key] = row.value;
      }
      setOperationalInputs(nextInputs);
    }
  }, [operationalSettingsQuery.data]);

  useEffect(() => {
    if (!restoreFilename && (backupsQuery.data?.length ?? 0) > 0) {
      setRestoreFilename(backupsQuery.data?.[0].filename ?? '');
    }
  }, [backupsQuery.data, restoreFilename]);

  const sessions = sessionsQuery.data ?? [];
  const activeSessionsCount = sessions.filter((session) => session.is_active).length;
  const operationalRows = operationalSettingsQuery.data ?? [];
  const backups = backupsQuery.data ?? [];

  const deliverySettingsError = updateDeliverySettingsMutation.isError
    ? updateDeliverySettingsMutation.error instanceof Error
      ? updateDeliverySettingsMutation.error.message
      : 'تعذر حفظ رسوم التوصيل.'
    : '';

  const deliveryPoliciesError = updateDeliveryPoliciesMutation.isError
    ? updateDeliveryPoliciesMutation.error instanceof Error
      ? updateDeliveryPoliciesMutation.error.message
      : 'تعذر حفظ سياسات التوصيل.'
    : '';

  const operationalSettingError = updateOperationalSettingMutation.isError
    ? updateOperationalSettingMutation.error instanceof Error
      ? updateOperationalSettingMutation.error.message
      : 'تعذر حفظ الإعداد التشغيلي.'
    : '';

  const backupError = createBackupMutation.isError || restoreBackupMutation.isError
    ? createBackupMutation.error instanceof Error
      ? createBackupMutation.error.message
      : restoreBackupMutation.error instanceof Error
        ? restoreBackupMutation.error.message
        : 'تعذر تنفيذ عملية النسخ الاحتياطي.'
    : '';

  const managerPasswordMismatch =
    managerPassword.length > 0 && managerPasswordConfirm.length > 0 && managerPassword !== managerPasswordConfirm;
  const managerPasswordPolicyError = useMemo(() => {
    const value = managerPassword.trim();
    if (value.length === 0) return '';
    if (value.length < 8) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
    if (!/[A-Za-z\u0600-\u06FF]/.test(value) || !/\d/.test(value)) {
      return 'كلمة المرور يجب أن تحتوي على أحرف وأرقام على الأقل.';
    }
    if (/\s/.test(value)) return 'كلمة المرور يجب ألا تحتوي على مسافات.';
    return '';
  }, [managerPassword]);

  const normalizeManagerAccountError = (value: string): string => {
    const raw = value.trim();
    if (!raw) return '';
    const hasArabic = /[\u0600-\u06FF]/.test(raw);
    const looksCorrupted =
      /-3\s*\(/i.test(raw) ||
      /manager\s*S\d/i.test(raw) ||
      /S1\s*f/i.test(raw) ||
      /A\s*,\d/i.test(raw);
    if (!hasArabic && looksCorrupted) {
      return 'لا يمكن تعديل حساب المدير من هذا المسار.';
    }
    return raw;
  };

  const managerAccountError = updateManagerAccountMutation.isError
    ? updateManagerAccountMutation.error instanceof Error
      ? normalizeManagerAccountError(updateManagerAccountMutation.error.message)
      : 'تعذر تحديث بيانات الحساب.'
    : '';

  const sessionsError = revokeSessionsMutation.isError
    ? revokeSessionsMutation.error instanceof Error
      ? revokeSessionsMutation.error.message
      : 'تعذر إنهاء الجلسات.'
    : '';

  const trimmedName = managerName.trim();
  const hasNameChange = !!managerProfile && trimmedName.length >= 2 && trimmedName !== managerProfile.name;
  const hasPasswordInput = managerPassword.trim().length > 0;
  const canSubmitAccount =
    !updateManagerAccountMutation.isPending &&
    !!managerProfile &&
    trimmedName.length >= 2 &&
    !managerPasswordMismatch &&
    !managerPasswordPolicyError &&
    (hasNameChange || hasPasswordInput);

  if (role !== 'manager') {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-700">هذه الصفحة مخصصة لحساب المدير فقط.</div>;
  }

  if (meQuery.isLoading || deliverySettingsQuery.isLoading || deliveryPoliciesQuery.isLoading || operationalSettingsQuery.isLoading || sessionsQuery.isLoading || backupsQuery.isLoading) {
    return <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-gray-500">جارٍ تحميل الإعدادات...</div>;
  }

  if (meQuery.isError || deliverySettingsQuery.isError || deliveryPoliciesQuery.isError || operationalSettingsQuery.isError || sessionsQuery.isError || backupsQuery.isError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">تعذر تحميل إعدادات النظام.</div>;
  }

  return (
    <div className="admin-page">
      <section className="admin-card p-4">
        <h3 className="text-sm font-black text-gray-800">الحساب الشخصي</h3>
        <p className="mt-1 text-xs text-gray-600">حدّث الاسم وكلمة المرور لحساب المدير. عند تغيير كلمة المرور تُنهى جميع الجلسات النشطة تلقائيًا.</p>

        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-[11px] text-gray-500">اسم المستخدم</p>
            <p className="font-bold text-gray-800">{managerProfile?.username ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-[11px] text-gray-500">الدور</p>
            <p className="font-bold text-gray-800">{managerProfile?.role === 'manager' ? 'مدير النظام' : '-'}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-[11px] text-gray-500">الجلسات النشطة</p>
            <p className="font-bold text-brand-700">{activeSessionsCount}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="form-label">الاسم</span>
            <input
              className="form-input"
              value={managerName}
              onChange={(event) => setManagerName(event.target.value)}
              placeholder="اسم المدير"
            />
          </label>
          <label className="space-y-1">
            <span className="form-label">كلمة المرور الجديدة (اختياري)</span>
            <input
              type="password"
              className="form-input"
              placeholder="8 أحرف على الأقل وتحتوي أحرفًا وأرقامًا"
              value={managerPassword}
              onChange={(event) => setManagerPassword(event.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="form-label">تأكيد كلمة المرور</span>
            <input
              type="password"
              className="form-input"
              placeholder="أعد إدخال كلمة المرور"
              value={managerPasswordConfirm}
              onChange={(event) => setManagerPasswordConfirm(event.target.value)}
            />
          </label>
        </div>

        {managerPasswordMismatch ? <p className="mt-2 text-xs font-semibold text-amber-700">تأكيد كلمة المرور غير مطابق.</p> : null}
        {managerPasswordPolicyError ? <p className="mt-2 text-xs font-semibold text-amber-700">{managerPasswordPolicyError}</p> : null}
        {managerAccountError ? <p className="mt-2 text-xs font-semibold text-rose-700">{managerAccountError}</p> : null}
        {updateManagerAccountMutation.isSuccess ? <p className="mt-2 text-xs font-semibold text-emerald-700">تم حفظ بيانات الحساب بنجاح.</p> : null}

        <button
          type="button"
          className="btn-primary mt-3"
          disabled={!canSubmitAccount}
          onClick={() => updateManagerAccountMutation.mutate()}
        >
          {updateManagerAccountMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ بيانات الحساب'}
        </button>
      </section>

      <section className="admin-card p-4">
        <h3 className="text-sm font-black text-gray-800">إعدادات التوصيل العامة</h3>
        <p className="mt-1 text-xs text-gray-600">تحكم في الرسوم والسياسات التشغيلية الخاصة بخدمة التوصيل.</p>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="form-label">رسوم التوصيل الثابتة (د.ج)</span>
            <input
              type="number"
              min={0}
              step="0.1"
              value={deliveryFeeInput}
              onChange={(event) => setDeliveryFeeInput(event.target.value)}
              className="form-input"
            />
          </label>

          <label className="space-y-1">
            <span className="form-label">الحد الأدنى لطلب التوصيل (د.ج)</span>
            <input
              type="number"
              min={0}
              step="0.1"
              value={deliveryMinOrderInput}
              onChange={(event) => setDeliveryMinOrderInput(event.target.value)}
              className="form-input"
            />
          </label>

          <label className="flex items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={deliveryAutoNotifyTeam}
              onChange={(event) => setDeliveryAutoNotifyTeam(event.target.checked)}
            />
            <span className="text-sm font-semibold text-gray-700">تبليغ فريق التوصيل تلقائيًا عند بدء التحضير</span>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const parsedFee = Number(deliveryFeeInput);
              if (!Number.isFinite(parsedFee) || parsedFee < 0) {
                return;
              }
              updateDeliverySettingsMutation.mutate(parsedFee);
            }}
            disabled={updateDeliverySettingsMutation.isPending}
            className="btn-primary"
          >
            {updateDeliverySettingsMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ رسوم التوصيل'}
          </button>

          <button
            type="button"
            onClick={() => {
              const parsedMin = Number(deliveryMinOrderInput);
              if (!Number.isFinite(parsedMin) || parsedMin < 0) {
                return;
              }
              updateDeliveryPoliciesMutation.mutate({
                min_order_amount: parsedMin,
                auto_notify_team: deliveryAutoNotifyTeam,
              });
            }}
            disabled={updateDeliveryPoliciesMutation.isPending}
            className="btn-secondary"
          >
            {updateDeliveryPoliciesMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ سياسات التوصيل'}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-brand-700">
          <span>الرسم الحالي: {(deliverySettingsQuery.data?.delivery_fee ?? 0).toFixed(2)} د.ج</span>
          <span>الحد الأدنى الحالي: {(deliveryPoliciesQuery.data?.min_order_amount ?? 0).toFixed(2)} د.ج</span>
          <span>التبليغ التلقائي: {deliveryPoliciesQuery.data?.auto_notify_team ? 'مفعل' : 'غير مفعل'}</span>
        </div>

        {deliverySettingsError ? <p className="mt-2 text-xs font-semibold text-rose-700">{deliverySettingsError}</p> : null}
        {deliveryPoliciesError ? <p className="mt-2 text-xs font-semibold text-rose-700">{deliveryPoliciesError}</p> : null}
        {updateDeliverySettingsMutation.isSuccess ? <p className="mt-2 text-xs font-semibold text-emerald-700">تم حفظ رسوم التوصيل بنجاح.</p> : null}
        {updateDeliveryPoliciesMutation.isSuccess ? <p className="mt-2 text-xs font-semibold text-emerald-700">تم حفظ سياسات التوصيل بنجاح.</p> : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-gray-800">الجلسات</h3>
          <p className="text-xs text-gray-600">يمكنك إنهاء جميع جلسات الحساب الحالية عند الحاجة. الحد الأقصى للجلسات النشطة هو 3 جلسات.</p>
        </div>
        <button
          type="button"
          className="btn-danger ui-size-sm"
          disabled={revokeSessionsMutation.isPending || sessions.length === 0}
          onClick={() => revokeSessionsMutation.mutate()}
        >
          {revokeSessionsMutation.isPending ? 'جارٍ الإنهاء...' : 'إنهاء جميع الجلسات'}
        </button>
      </div>
      {sessionsError ? <p className="text-xs font-semibold text-rose-700">{sessionsError}</p> : null}
      {revokeSessionsMutation.isSuccess ? (
        <p className="text-xs font-semibold text-emerald-700">تم إنهاء {revokeSessionsMutation.data?.revoked_count ?? 0} جلسة.</p>
      ) : null}

      <section className="admin-table-shell">

        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">#</th>
                <th className="px-4 py-3 font-bold">بداية الجلسة</th>
                <th className="px-4 py-3 font-bold">انتهاء الصلاحية</th>
                <th className="px-4 py-3 font-bold">حالة الجلسة</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const meta = sessionStatusMeta(session);
                return (
                  <tr key={session.id} className="border-t border-gray-100">
                    <td data-label="#" className="px-4 py-3 font-bold">{session.id}</td>
                    <td data-label="بداية الجلسة" className="px-4 py-3 text-xs text-gray-600">{formatDateTime(session.created_at)}</td>
                    <td data-label="انتهاء الصلاحية" className="px-4 py-3 text-xs text-gray-600">{formatDateTime(session.expires_at)}</td>
                    <td data-label="حالة الجلسة" className={`px-4 py-3 text-xs font-bold ${meta.className}`}>{meta.label}</td>
                  </tr>
                );
              })}
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                    لا توجد جلسات مسجلة.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <h3 className="text-sm font-black text-gray-700">إعدادات تشغيل عامة</h3>
      {operationalSettingError ? <p className="text-xs font-semibold text-rose-700">{operationalSettingError}</p> : null}
      {updateOperationalSettingMutation.isSuccess ? (
        <p className="text-xs font-semibold text-emerald-700">تم حفظ الإعداد التشغيلي بنجاح.</p>
      ) : null}

      <section className="admin-table-shell">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">المفتاح</th>
                <th className="px-4 py-3 font-bold">القيمة</th>
                <th className="px-4 py-3 font-bold">الوصف</th>
                <th className="px-4 py-3 font-bold">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {operationalRows.map((row) => (
                <tr key={row.key} className="border-t border-gray-100">
                  <td data-label="المفتاح" className="px-4 py-3 font-bold">{row.key}</td>
                  <td data-label="القيمة" className="px-4 py-3">
                    {row.editable ? (
                      <input
                        className="form-input ui-size-sm w-44"
                        value={operationalInputs[row.key] ?? row.value}
                        onChange={(event) =>
                          setOperationalInputs((prev) => ({
                            ...prev,
                            [row.key]: event.target.value,
                          }))
                        }
                      />
                    ) : (
                      <span>{row.value}</span>
                    )}
                  </td>
                  <td data-label="الوصف" className="px-4 py-3 text-xs text-gray-500">
                    {renderOperationalDescription(row.key, row.description)}
                  </td>
                  <td data-label="الإجراء" className="px-4 py-3">
                    {row.editable ? (
                      <button
                        type="button"
                        className="btn-secondary ui-size-sm"
                        disabled={updateOperationalSettingMutation.isPending}
                        onClick={() =>
                          updateOperationalSettingMutation.mutate({
                            key: row.key,
                            value: (operationalInputs[row.key] ?? row.value).trim(),
                          })
                        }
                      >
                        {updateOperationalSettingMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ'}
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-gray-500">قراءة فقط</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-gray-800">النسخ الاحتياطي والاستعادة</h3>
          <p className="text-xs text-gray-600">أنشئ نسخة احتياطية من قاعدة البيانات أو استرجع نسخة سابقة عند الحاجة.</p>
        </div>
        <button
          type="button"
          className="btn-primary ui-size-sm"
          disabled={createBackupMutation.isPending}
          onClick={() => createBackupMutation.mutate()}
        >
          {createBackupMutation.isPending ? 'جارٍ الإنشاء...' : 'إنشاء نسخة احتياطية'}
        </button>
      </div>
      {backupError ? <p className="text-xs font-semibold text-rose-700">{backupError}</p> : null}
      {createBackupMutation.isSuccess ? <p className="text-xs font-semibold text-emerald-700">تم إنشاء النسخة الاحتياطية بنجاح.</p> : null}
      {restoreBackupMutation.isSuccess ? <p className="text-xs font-semibold text-emerald-700">تمت استعادة النسخة الاحتياطية بنجاح.</p> : null}

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="space-y-1">
            <span className="form-label">ملف الاستعادة</span>
            <select
              className="form-select"
              value={restoreFilename}
              onChange={(event) => setRestoreFilename(event.target.value)}
            >
              <option value="">اختر ملف النسخة الاحتياطية</option>
              {backups.map((item) => (
                <option key={item.filename} value={item.filename}>
                  {item.filename}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="form-label">عبارة التأكيد</span>
            <input
              className="form-input"
              value={restoreConfirmPhrase}
              onChange={(event) => setRestoreConfirmPhrase(event.target.value)}
              placeholder="اكتب RESTORE"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              className="btn-danger w-full md:w-auto"
              disabled={restoreBackupMutation.isPending || !restoreFilename || restoreConfirmPhrase !== 'RESTORE'}
              onClick={() => restoreBackupMutation.mutate()}
            >
              {restoreBackupMutation.isPending ? 'جارٍ الاستعادة...' : 'استعادة النسخة'}
            </button>
          </div>
      </div>

      <section className="admin-table-shell">
        <div className="adaptive-table overflow-x-auto">
          <table className="table-unified min-w-full text-sm">
            <thead className="bg-brand-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-bold">اسم الملف</th>
                <th className="px-4 py-3 font-bold">الحجم</th>
                <th className="px-4 py-3 font-bold">تاريخ الإنشاء</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((item) => (
                <tr key={item.filename} className="border-t border-gray-100">
                  <td data-label="اسم الملف" className="px-4 py-3 font-bold">{item.filename}</td>
                  <td data-label="الحجم" className="px-4 py-3 text-xs text-gray-600">{(item.size_bytes / 1024 / 1024).toFixed(2)} MB</td>
                  <td data-label="تاريخ الإنشاء" className="px-4 py-3 text-xs text-gray-600">{formatDateTime(item.created_at)}</td>
                </tr>
              ))}
              {backups.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                    لا توجد نسخ احتياطية متاحة بعد.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

