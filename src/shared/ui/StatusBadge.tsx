import type { OrderStatus } from '../api/types';
import { statusClasses, statusLabel } from '../utils/order';

interface StatusBadgeProps {
  status: OrderStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[status]}`}>
      {statusLabel[status]}
    </span>
  );
}
