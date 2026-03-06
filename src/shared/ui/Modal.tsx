import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Modal({ title, description, open, onClose, footer, children }: ModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl rounded-3xl border border-brand-100 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-black text-gray-900">{title}</h3>
            {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            إغلاق
          </button>
        </div>

        <div className="max-h-[74vh] overflow-y-auto p-6">{children}</div>

        {footer && <div className="border-t border-gray-100 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
