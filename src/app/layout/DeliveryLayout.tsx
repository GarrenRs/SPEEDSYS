import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { useAuthStore } from '@/modules/auth/store';

export function DeliveryLayout() {
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
      <div className="mx-auto min-h-screen w-full max-w-[1280px]">
        <button
          type="button"
          aria-label="إغلاق قائمة التوصيل"
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
            <p className="text-lg font-black text-brand-700">قائمة التوصيل</p>
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

        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-brand-100 bg-white px-4 md:px-6">
          <div>
            <h1 className="text-lg font-black text-brand-700">لوحة التوصيل</h1>
            <p className="text-xs text-gray-500 md:hidden">لوحة السائق</p>
          </div>

          <div className="flex items-center gap-2">
            <p className="hidden text-xs font-semibold text-gray-600 md:block">{user?.name ?? 'جلسة غير معروفة'}</p>

            <button
              type="button"
              onClick={() => setIsMenuOpen((previous) => !previous)}
              aria-expanded={isMenuOpen}
              aria-label={isMenuOpen ? 'إغلاق قائمة التوصيل' : 'فتح قائمة التوصيل'}
              className="btn-secondary w-10 px-0 md:hidden"
            >
              {isMenuOpen ? '×' : '☰'}
            </button>

            <button type="button" onClick={logout} className="btn-secondary hidden md:inline-flex">
              تسجيل الخروج
            </button>
          </div>
        </header>

        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
