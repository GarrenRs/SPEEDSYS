import type { LucideIcon } from 'lucide-react';
import { Building2, Cog, Factory, HandPlatter } from 'lucide-react';

export type ConsoleChannel = 'operations' | 'restaurant' | 'business' | 'system';

interface ConsoleChannelDefinition {
  id: ConsoleChannel;
  label: string;
  icon: LucideIcon;
}

const CHANNELS: ConsoleChannelDefinition[] = [
  { id: 'operations', label: 'العمليات', icon: Factory },
  { id: 'restaurant', label: 'المطعم', icon: HandPlatter },
  { id: 'business', label: 'الأعمال', icon: Building2 },
  { id: 'system', label: 'النظام', icon: Cog },
];

interface ChannelBarProps {
  activeChannel: ConsoleChannel | null;
  onSelectChannel: (channel: ConsoleChannel) => void;
}

export function ChannelBar({ activeChannel, onSelectChannel }: ChannelBarProps) {
  return (
    <nav className="console-channel-layer border-b border-[#ccb89a] bg-[#efe4d1]/95 px-3 py-2 backdrop-blur tablet:px-6 tablet:py-3">
      <div className="grid grid-cols-4 gap-2 tablet:hidden">
        {CHANNELS.map((channel) => {
          const Icon = channel.icon;
          const isActive = channel.id === activeChannel;
          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => onSelectChannel(channel.id)}
              className={`inline-flex h-14 items-center justify-center rounded-xl border transition ${
                isActive
                  ? 'border-[#9a5a2a] bg-gradient-to-b from-[#b86b34] to-[#8e4f24] text-[#fff8ef] shadow-[0_6px_16px_rgba(80,48,24,0.22)]'
                  : 'border-[#ccbca0] bg-[#f9f1e5] text-[#5f4733] hover:border-[#b48552] hover:bg-[#f2e4cf] hover:text-[#4e3828]'
              }`}
              aria-label={channel.label}
              title={channel.label}
            >
              <Icon className="h-6 w-6" />
              <span className="sr-only">{channel.label}</span>
            </button>
          );
        })}
      </div>

      <div className="hidden tablet:grid tablet:grid-cols-4 tablet:gap-2">
        {CHANNELS.map((channel) => {
          const Icon = channel.icon;
          const isActive = channel.id === activeChannel;
          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => onSelectChannel(channel.id)}
              className={`inline-flex h-14 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black tracking-wide transition ${
                isActive
                  ? 'border-[#9a5a2a] bg-gradient-to-b from-[#b86b34] to-[#8e4f24] text-[#fff8ef] shadow-sm'
                  : 'border-[#ccbca0] bg-[#f9f1e5] text-[#5f4733] hover:border-[#b48552] hover:bg-[#f2e4cf] hover:text-[#4e3828]'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{channel.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
