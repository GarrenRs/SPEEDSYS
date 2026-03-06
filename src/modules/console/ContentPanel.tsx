import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

interface ContentPanelProps {
  title: string;
  onBack: () => void;
  children: ReactNode;
}

export function ContentPanel({ title, onBack, children }: ContentPanelProps) {
  return (
    <section className="console-content-layer flex h-full min-h-0 flex-col rounded-2xl border border-[#ccb89a] bg-[#fbf6ee] shadow-[0_10px_30px_rgba(70,45,25,0.08)]">
      <header className="flex items-center justify-between gap-2 border-b border-[#deccb0] bg-[#f3e8d7] px-4 py-3">
        <h2 className="text-base font-black text-[#4f3828]">{title}</h2>
        <button type="button" onClick={onBack} className="btn-secondary ui-size-sm !h-9 !px-2.5">
          <ArrowRight className="h-4 w-4" />
          <span>رجوع</span>
        </button>
      </header>
      <div className="manager-section-shell flex-1 min-h-0 overflow-auto bg-[#f7efe2]/70 p-4 md:p-5">{children}</div>
    </section>
  );
}
