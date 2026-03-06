import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { useAuthStore } from '@/modules/auth/store';

export function KitchenLayout() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMenuOpen || window.innerWidth >= 768) {
      return;
    }
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isMenuOpen]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto min-h-screen w-full max-w-[1920px]">
        <button
          type="button"
          aria-label="إغلاق قائمة المطبخ"
          onClick={() => setIsMenuOpen(false)}
          className={`fixed inset-0 z-30 bg-gray-900/40 transition-opacity md:hidden ${
            isMenuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />

        <aside
          className={`fixed inset-y-0 right-0 z-40 flex w-[82vw] max-w-xs flex-col border-l border-brand-100 bg-white p-4 shadow-2xl transition-transform duration-200 md:hidden ${
            isMenuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-4">
            <p className="text-lg font-black text-brand-700">قائمة المطبخ</p>
            <p className="mt-1 text-xs text-gray-500">{user?.name ?? 'جلسة غير معروفة'}</p>
          </div>
          <div className="mt-3 space-y-2 rounded-2xl border border-brand-100 bg-brand-50/20 p-2">
            <button type="button" onClick={() => setIsMenuOpen(false)} className="btn-secondary w-full">
              متابعة اللوحة
            </button>
            <button type="button" onClick={logout} className="btn-secondary w-full">
              تسجيل الخروج
            </button>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-brand-100 bg-white px-4 md:px-10">
            <div>
              <h1 className="text-xl font-black text-brand-700">شاشة المطبخ</h1>
              <p className="mt-1 text-xs text-gray-500">عرض مباشر لطلبات التحضير</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden text-right md:block">
                <p className="text-xs text-gray-500">المستخدم الحالي</p>
                <p className="text-sm font-bold text-gray-700">{user?.name ?? 'جلسة غير معروفة'}</p>
              </div>

              <button
                type="button"
                onClick={() => setIsMenuOpen((previous) => !previous)}
                aria-expanded={isMenuOpen}
                aria-label={isMenuOpen ? 'إغلاق قائمة المطبخ' : 'فتح قائمة المطبخ'}
                className="btn-secondary w-10 px-0 md:hidden"
              >
                {isMenuOpen ? '×' : '☰'}
              </button>

              <button type="button" onClick={logout} className="btn-secondary hidden md:inline-flex">
                تسجيل الخروج
              </button>
            </div>
          </header>

          <main className="flex-1 p-4 md:p-8 lg:p-10">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
