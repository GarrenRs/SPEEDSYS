import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '@/shared/api/client';
import type { UserRole } from '@/shared/api/types';
import { useAuthStore } from '../store';

interface LoginPageProps {
  role: UserRole;
}

export function LoginPage({ role }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setSession = useAuthStore((state) => state.setSession);
  const navigate = useNavigate();

  const title = useMemo(
    () =>
      role === 'manager'
        ? 'دخول لوحة المدير'
        : role === 'kitchen'
          ? 'دخول لوحة المطبخ'
          : 'دخول لوحة التوصيل',
    [role]
  );

  const subtitle = useMemo(
    () =>
      role === 'manager'
        ? 'وصول خاص بإدارة النظام'
        : role === 'kitchen'
          ? 'وصول خاص بمستخدمي المطبخ'
          : 'وصول خاص بفريق التوصيل',
    [role]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const session = await api.login({ username, password, role });
      setSession({
        user: session.user,
      });
      navigate(
        role === 'manager' ? '/console' : role === 'kitchen' ? '/kitchen/board' : '/delivery/panel'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-md rounded-3xl border border-brand-100 bg-white p-6 shadow-lg shadow-brand-100/50">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 w-fit rounded-2xl bg-brand-600 px-3 py-1 text-sm font-black text-white">سريع</div>
          <h2 className="text-2xl font-black text-gray-800">{title}</h2>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-bold text-gray-700" htmlFor="username">
              اسم المستخدم
            </label>
            <input
              id="username"
              dir="ltr"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-brand-500"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-gray-700" htmlFor="password">
              كلمة المرور
            </label>
            <input
              id="password"
              type="password"
              dir="ltr"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-brand-500"
              required
            />
          </div>

          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? 'جارٍ التحقق...' : 'تسجيل الدخول'}
          </button>
        </form>
      </div>
    </div>
  );
}
