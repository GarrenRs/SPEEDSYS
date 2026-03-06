import type { LucideIcon } from 'lucide-react';
import { BellRing } from 'lucide-react';

import type { ConsoleChannel } from './ChannelBar';

export type ConsoleSection =
  | 'orders'
  | 'kitchen'
  | 'delivery'
  | 'tables'
  | 'menu'
  | 'warehouse'
  | 'staff'
  | 'expenses'
  | 'financial'
  | 'reports'
  | 'audit'
  | 'settings'
  | 'backups';

export interface ConsoleSectionCard {
  id: ConsoleSection;
  channel: ConsoleChannel;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  metric?: number;
}

interface ChannelCardsProps {
  channel: ConsoleChannel;
  cards: ConsoleSectionCard[];
  onOpenSection: (section: ConsoleSection) => void;
}

const CHANNEL_TITLES: Record<ConsoleChannel, string> = {
  operations: 'قناة العمليات',
  restaurant: 'قناة المطعم',
  business: 'قناة الأعمال',
  system: 'قناة النظام',
};

function formatMetric(metric: number): string {
  return metric > 99 ? '99+' : String(metric);
}

export function ChannelCards({ channel, cards, onOpenSection }: ChannelCardsProps) {
  return (
    <section className="console-cards-layer flex h-full min-h-0 flex-col rounded-2xl border border-[#ccb89a] bg-gradient-to-b from-[#fbf6ee] to-[#f4eadb] p-4 shadow-[0_10px_30px_rgba(70,45,25,0.08)] md:p-5">
      <header className="mb-4 border-b border-[#decfb8] pb-3">
        <h2 className="text-xl font-black text-[#4f3828]">{CHANNEL_TITLES[channel]}</h2>
      </header>

      <div className="console-scrollbar min-h-0 flex-1 overflow-auto pe-1">
        <div className="grid gap-4 tablet:grid-cols-2">
          {cards.map((card) => {
            const Icon = card.icon;
            const hasNotification = typeof card.metric === 'number' && card.metric > 0;

            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onOpenSection(card.id)}
                className="group min-h-[184px] rounded-2xl border border-[#d3c2a8] bg-[#fffaf2] p-5 text-right transition hover:-translate-y-0.5 hover:border-[#b98757] hover:bg-[#fff3de] hover:shadow-[0_10px_24px_rgba(90,60,35,0.16)]"
              >
                <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                  <div className="min-w-0 space-y-2">
                    <p className="truncate text-lg font-black text-[#4f3828]">{card.label}</p>
                    <p className="text-sm font-semibold leading-7 text-[#7a624d]">{card.subtitle}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {hasNotification ? (
                      <span className="relative inline-flex h-20 w-20 items-center justify-center rounded-2xl border border-[#c89c68] bg-[#fff0d7] text-[#8e5226] transition group-hover:border-[#ad733f] group-hover:text-[#7e471f]">
                        <BellRing className="h-9 w-9" />
                        <span className="absolute -right-2 -top-2 inline-flex min-w-7 items-center justify-center rounded-full border border-[#b26d34] bg-[#b26d34] px-1.5 py-0.5 text-xs font-black text-[#fff7eb]">
                          {formatMetric(card.metric)}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex h-20 w-20 opacity-0" aria-hidden />
                    )}

                    <span className="inline-flex h-20 w-20 items-center justify-center rounded-2xl border border-[#d3c2a8] bg-[#fffef9] text-[#6b5240] transition group-hover:border-[#b98757] group-hover:text-[#8e5226]">
                      <Icon className="h-10 w-10" />
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
