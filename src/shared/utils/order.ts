import type { OrderStatus, OrderType } from '../api/types';
import { parseApiDateMs } from './date';

export const statusLabel: Record<OrderStatus, string> = {
  CREATED: 'تم الإنشاء',
  CONFIRMED: 'تم التأكيد',
  SENT_TO_KITCHEN: 'أُرسل للمطبخ',
  IN_PREPARATION: 'قيد التحضير',
  READY: 'جاهز',
  OUT_FOR_DELIVERY: 'خرج للتوصيل',
  DELIVERED: 'تم التسليم',
  DELIVERY_FAILED: 'فشل التوصيل',
  CANCELED: 'ملغى',
};

export const statusClasses: Record<OrderStatus, string> = {
  CREATED: 'ui-badge-neutral',
  CONFIRMED: 'ui-badge-info',
  SENT_TO_KITCHEN: 'ui-badge-warning',
  IN_PREPARATION: 'ui-badge-primary',
  READY: 'ui-badge-success',
  OUT_FOR_DELIVERY: 'ui-badge-info',
  DELIVERED: 'ui-badge-success',
  DELIVERY_FAILED: 'ui-badge-danger',
  CANCELED: 'ui-badge-danger',
};

const orderTypeText: Record<OrderType, string> = {
  'dine-in': 'داخل المطعم',
  takeaway: 'استلام',
  delivery: 'توصيل',
};

const orderTypeStyle: Record<OrderType, string> = {
  'dine-in': 'ui-pill-primary',
  takeaway: 'ui-pill-info',
  delivery: 'ui-pill-success',
};

const tableStatusText: Record<'available' | 'occupied' | 'reserved', string> = {
  available: 'متاحة',
  occupied: 'مشغولة',
  reserved: 'محجوزة',
};

const managerActionMap: Record<OrderStatus, Array<{ label: string; target: OrderStatus }>> = {
  CREATED: [
    { label: 'تأكيد', target: 'CONFIRMED' },
    { label: 'إلغاء', target: 'CANCELED' },
  ],
  CONFIRMED: [
    { label: 'إرسال للمطبخ', target: 'SENT_TO_KITCHEN' },
    { label: 'إلغاء', target: 'CANCELED' },
  ],
  SENT_TO_KITCHEN: [],
  IN_PREPARATION: [],
  READY: [{ label: 'تسليم', target: 'DELIVERED' }],
  OUT_FOR_DELIVERY: [],
  DELIVERED: [],
  DELIVERY_FAILED: [],
  CANCELED: [],
};

export function orderTypeLabel(type: OrderType): string {
  return orderTypeText[type];
}

export function orderTypeClasses(type: OrderType): string {
  return orderTypeStyle[type];
}

export function formatOrderTrackingId(orderId: number): string {
  const normalized = Number.isFinite(orderId) ? Math.max(0, Math.trunc(orderId)) : 0;
  return `#${String(normalized).padStart(6, '0')}`;
}

export function orderDateKey(value: string): string {
  const parsedMs = parseApiDateMs(value);
  if (Number.isNaN(parsedMs)) {
    return '';
  }
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(parsedMs));
}

export function tableStatusLabel(status: 'available' | 'occupied' | 'reserved'): string {
  return tableStatusText[status];
}

export function managerActions(status: OrderStatus, type: OrderType): Array<{ label: string; target: OrderStatus }> {
  if (status === 'READY' && type === 'delivery') {
    return [];
  }
  return managerActionMap[status];
}

