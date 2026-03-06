import { Outlet } from 'react-router-dom';

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-brand-100 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-brand-600 px-2.5 py-1.5 text-sm font-black text-white">سريع</div>
            <div>
              <p className="text-xs text-gray-500">واجهة عامة للطلبات</p>
              <h1 className="text-base font-bold text-gray-800">نظام الطلب الذاتي</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
