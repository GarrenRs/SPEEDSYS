import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, Plus, Minus, CheckCircle2, Clock3, X } from 'lucide-react';

import { api } from '@/shared/api/client';
import type { CreateOrderPayload, Order, OrderType, PublicProduct } from '@/shared/api/types';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { formatOrderTrackingId, tableStatusLabel } from '@/shared/utils/order';
import { parseApiDateMs } from '@/shared/utils/date';
import { adaptiveRefetchInterval } from '@/shared/utils/polling';
import { sanitizeMojibakeText } from '@/shared/utils/textSanitizer';

interface CartRow {
  product: PublicProduct;
  quantity: number;
}

const orderTypeOptions: Array<{ value: OrderType; label: string }> = [
  { value: 'takeaway', label: 'استلام من المطعم' },
  { value: 'delivery', label: 'توصيل للمنزل' },
  { value: 'dine-in', label: 'طلب من الطاولة' },
];
const fallbackDeliveryBlockedReason = 'خدمة التوصيل غير متاحة حاليًا. يرجى اختيار الاستلام أو الطلب من الطاولة.';
const backendOrigin = (import.meta.env.VITE_BACKEND_ORIGIN as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:8122';
const timeFormatter = new Intl.DateTimeFormat('ar-DZ-u-nu-latn', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const orderTypeLabelMap: Record<OrderType, string> = {
  'dine-in': 'طلب من الطاولة',
  takeaway: 'استلام من المطعم',
  delivery: 'توصيل',
};

export function PublicOrderPage() {
  const queryClient = useQueryClient();
  const tableFromPath = Number(new URLSearchParams(window.location.search).get('table') ?? '');
  const tableId = Number.isFinite(tableFromPath) && tableFromPath > 0 ? tableFromPath : undefined;

  const [orderType, setOrderType] = useState<OrderType>(tableId ? 'dine-in' : 'takeaway');
  const [selectedTable, setSelectedTable] = useState<number | undefined>(tableId);
  const [cart, setCart] = useState<Record<number, CartRow>>({});
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [showTableComposer, setShowTableComposer] = useState(!tableId);
  const [lastCreatedOrder, setLastCreatedOrder] = useState<Order | null>(null);
  const [showCreatedOrderCard, setShowCreatedOrderCard] = useState(false);

  const productsQuery = useQuery({
    queryKey: ['public-products'],
    queryFn: api.publicProducts,
  });

  const tablesQuery = useQuery({
    queryKey: ['public-tables'],
    queryFn: api.publicTables,
  });

  const capabilitiesQuery = useQuery({
    queryKey: ['public-operational-capabilities'],
    queryFn: api.publicOperationalCapabilities,
    refetchInterval: adaptiveRefetchInterval(5000),
  });
  const operationalCapabilities = capabilitiesQuery.data;
  const deliveryEnabled = operationalCapabilities?.delivery_enabled ?? false;

  const deliverySettingsQuery = useQuery({
    queryKey: ['public-delivery-settings'],
    queryFn: api.publicDeliverySettings,
    enabled: !tableId && deliveryEnabled,
  });

  const tableSessionQuery = useQuery({
    queryKey: ['public-table-session', tableId],
    queryFn: () => api.publicTableSession(tableId ?? 0),
    enabled: Boolean(tableId),
    refetchInterval: adaptiveRefetchInterval(5000),
  });

  const submitMutation = useMutation({
    mutationFn: (payload: CreateOrderPayload) => api.createPublicOrder(payload),
    onSuccess: (createdOrder) => {
      setLastCreatedOrder(createdOrder);
      setShowCreatedOrderCard(true);
      setCart({});
      setPhone('');
      setAddress('');
      setNotes('');
      setError('');
      if (tableId) {
        setShowTableComposer(false);
        queryClient.invalidateQueries({ queryKey: ['public-table-session', tableId] });
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الطلب');
    },
  });

  const tableSession = tableSessionQuery.data;
  const hasActiveTableSession = tableSession?.has_active_session ?? false;
  const publicOrderTypeOptions = useMemo(
    () => orderTypeOptions.filter((option) => option.value !== 'delivery' || deliveryEnabled),
    [deliveryEnabled]
  );
  const deliveryBlockedReason = sanitizeMojibakeText(
    operationalCapabilities?.delivery_block_reason,
    fallbackDeliveryBlockedReason
  );

  useEffect(() => {
    if (!tableId) {
      return;
    }
    if (!hasActiveTableSession) {
      setShowTableComposer(true);
    }
  }, [hasActiveTableSession, tableId]);

  useEffect(() => {
    if (!tableId && !deliveryEnabled && orderType === 'delivery') {
      setOrderType('takeaway');
      setAddress('');
    }
  }, [deliveryEnabled, orderType, tableId]);

  const categories = useMemo(() => {
    const map = new Map<string, PublicProduct[]>();
    for (const product of productsQuery.data ?? []) {
      const existing = map.get(product.category) ?? [];
      existing.push(product);
      map.set(product.category, existing);
    }
    return map;
  }, [productsQuery.data]);
  const categoryEntries = useMemo(
    () => Array.from(categories.entries()).sort(([first], [second]) => first.localeCompare(second, 'ar')),
    [categories]
  );

  const availablePublicTables = useMemo(
    () => (tablesQuery.data ?? []).filter((table) => table.status !== 'occupied'),
    [tablesQuery.data]
  );

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const subtotal = cartItems.reduce((sum, row) => sum + row.product.price * row.quantity, 0);
  const fixedDeliveryFee = !tableId && orderType === 'delivery' ? (deliverySettingsQuery.data?.delivery_fee ?? 0) : 0;
  const total = subtotal + fixedDeliveryFee;

  const needsTableSelection = !tableId && orderType === 'dine-in';
  const hasTableSelection = Boolean(tableId ?? selectedTable);
  const deliveryMode = !tableId && orderType === 'delivery';
  const deliverySettingsUnavailable = deliveryMode && (deliverySettingsQuery.isLoading || deliverySettingsQuery.isError);
  const submitDisabled =
    submitMutation.isPending ||
    cartItems.length === 0 ||
    (needsTableSelection && !hasTableSelection) ||
    (!tableId && orderType === 'delivery' && !deliveryEnabled) ||
    deliverySettingsUnavailable;

  const productsErrorText = productsQuery.isError
    ? getErrorMessage(productsQuery.error, 'تعذر تحميل قائمة المنتجات')
    : '';
  const tablesErrorText = tablesQuery.isError
    ? getErrorMessage(tablesQuery.error, 'تعذر تحميل قائمة الطاولات')
    : '';
  const deliverySettingsErrorText = deliverySettingsQuery.isError
    ? getErrorMessage(deliverySettingsQuery.error, 'تعذر تحميل رسوم التوصيل')
    : '';
  const capabilitiesErrorText = capabilitiesQuery.isError
    ? getErrorMessage(capabilitiesQuery.error, 'تعذر تحميل حالة التشغيل')
    : '';
  const tableSessionErrorText =
    tableId && tableSessionQuery.isError ? getErrorMessage(tableSessionQuery.error, 'تعذر تحميل حالة الطاولة') : '';
  const createdOrderTypeLabel = lastCreatedOrder ? orderTypeLabelMap[lastCreatedOrder.type] : null;

  const updateQty = (product: PublicProduct, delta: number) => {
    setCart((prev) => {
      const current = prev[product.id]?.quantity ?? 0;
      const nextQty = current + delta;
      if (nextQty <= 0) {
        const clone = { ...prev };
        delete clone[product.id];
        return clone;
      }
      return {
        ...prev,
        [product.id]: {
          product,
          quantity: nextQty,
        },
      };
    });
  };

  const submitOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (cartItems.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل قبل الإرسال');
      return;
    }
    if (!tableId && orderType === 'delivery' && !deliveryEnabled) {
      setError(deliveryBlockedReason);
      return;
    }
    if (!tableId && orderType === 'dine-in' && !selectedTable) {
      setError('يرجى اختيار رقم الطاولة قبل الإرسال');
      return;
    }
    if (!tableId && orderType === 'delivery' && deliverySettingsQuery.isError) {
      setError(deliverySettingsErrorText || 'تعذر تحميل إعدادات التوصيل');
      return;
    }

    const payload: CreateOrderPayload = {
      type: tableId ? 'dine-in' : orderType,
      items: cartItems.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
      })),
      notes: notes || undefined,
    };

    if (tableId || orderType === 'dine-in') {
      payload.table_id = tableId ?? selectedTable;
    }

    if (!tableId && (orderType === 'takeaway' || orderType === 'delivery')) {
      payload.phone = phone;
    }

    if (!tableId && orderType === 'delivery') {
      payload.address = address;
    }

    submitMutation.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <section className="admin-card p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-black text-gray-900 md:text-2xl">طلب جديد</h2>
            <p className="text-sm text-gray-600">اختر الأصناف، راجع الملخص، ثم أرسل الطلب مباشرة.</p>
          </div>
          {tableId ? (
            <span className="rounded-full ui-badge-success px-3 py-1 text-xs font-bold md:text-sm">
              الطاولة رقم {tableId}
              {tableSession ? ` - ${tableStatusLabel(tableSession.table.status)}` : ''}
            </span>
          ) : (
            <label className="w-full max-w-xs">
              <span className="form-label">نوع الطلب</span>
              <select
                className="form-select"
                value={orderType}
                onChange={(event) => setOrderType(event.target.value as OrderType)}
              >
                {publicOrderTypeOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.value === 'dine-in' && availablePublicTables.length === 0}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {capabilitiesQuery.isLoading && (
            <p className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700">
              جارٍ التحقق من حالة التشغيل...
            </p>
          )}
          {capabilitiesErrorText && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              {capabilitiesErrorText}
            </p>
          )}
          {!tableId && tablesErrorText && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              {tablesErrorText}
            </p>
          )}
          {!tableId && orderType === 'delivery' && deliverySettingsErrorText && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              {deliverySettingsErrorText}
            </p>
          )}
          {tableSessionErrorText && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              {tableSessionErrorText}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-6 tablet:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)] desktop:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
        <section className="admin-card p-4 md:p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-lg font-black text-gray-900">قائمة الطعام</h3>
            <span className="rounded-full ui-badge-neutral px-3 py-1 text-xs font-bold">
              الأصناف المتاحة: {productsQuery.data?.length ?? 0}
            </span>
          </div>

          {productsQuery.isLoading ? (
            <div className="rounded-2xl border border-sky-300 bg-sky-50 p-4 text-sm font-semibold text-sky-700">
              جارٍ تحميل المنتجات...
            </div>
          ) : null}

          {productsErrorText ? (
            <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              {productsErrorText}
            </div>
          ) : null}

          {!productsQuery.isLoading && !productsErrorText && categoryEntries.length === 0 ? (
            <div className="rounded-2xl border border-gray-300 bg-gray-50 p-4 text-sm font-semibold text-gray-700">
              لا توجد أصناف متاحة حاليًا.
            </div>
          ) : null}

          <div className="space-y-6">
            {categoryEntries.map(([category, products]) => (
              <div key={category}>
                <h4 className="mb-3 text-sm font-bold text-gray-600">{category}</h4>
                <div className="grid gap-3 md:grid-cols-2">
                  {products.map((product) => {
                    const imageUrl = resolveImageUrl(product.image_path);
                    const quantity = cart[product.id]?.quantity ?? 0;
                    return (
                      <article key={product.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                        {imageUrl && (
                          <img
                            src={imageUrl}
                            alt={product.name}
                            className="mb-3 h-28 w-full rounded-xl border border-gray-200 object-cover"
                            loading="lazy"
                          />
                        )}
                        <h5 className="break-words font-black text-gray-900">{product.name}</h5>
                        {product.description ? <p className="mt-1 text-xs text-gray-600">{product.description}</p> : null}
                        <p className="mt-2 text-sm font-black text-brand-700">{product.price.toFixed(2)} د.ج</p>

                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateQty(product, -1)}
                            className="btn-secondary ui-size-sm h-9 w-9 p-0"
                            aria-label={`تقليل كمية ${product.name}`}
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-10 text-center text-sm font-black">{quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQty(product, 1)}
                            className="btn-primary ui-size-sm h-9 w-9 p-0"
                            aria-label={`زيادة كمية ${product.name}`}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="admin-card h-fit p-4 md:p-6 tablet:sticky tablet:top-6">
          <h3 className="text-lg font-black text-gray-900">ملخص الطلب</h3>

          {submitMutation.isPending && (
            <div className="mt-3 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4" />
                جارٍ إرسال الطلب إلى النظام...
              </span>
            </div>
          )}

          {showCreatedOrderCard && lastCreatedOrder && (
            <article className="mt-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="inline-flex items-center gap-2 text-sm font-black text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    تم إنشاء الطلب بنجاح
                  </p>
                  <p className="text-xs font-semibold text-emerald-800">{formatOrderTrackingId(lastCreatedOrder.id)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreatedOrderCard(false)}
                  className="btn-secondary ui-size-sm h-8 w-8 p-0"
                  aria-label="إخفاء بطاقة التتبع"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1 text-xs text-gray-700">
                <p className="flex items-center justify-between gap-2">
                  <span>الحالة الحالية</span>
                  <StatusBadge status={lastCreatedOrder.status} />
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span>نوع الطلب</span>
                  <span className="font-bold">{createdOrderTypeLabel}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span>وقت الإنشاء</span>
                  <span className="font-bold">{timeFormatter.format(new Date(parseApiDateMs(lastCreatedOrder.created_at)))}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span>الإجمالي</span>
                  <span className="font-black text-emerald-700">{lastCreatedOrder.total.toFixed(2)} د.ج</span>
                </p>
              </div>
            </article>
          )}

          <div className="mt-4 space-y-3">
            {cartItems.length === 0 && (
              <p className="rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                لم يتم اختيار أي صنف بعد.
              </p>
            )}
            {cartItems.map((item) => (
              <div key={item.product.id} className="flex items-center justify-between text-sm">
                <span className="break-words">
                  {item.product.name} x {item.quantity}
                </span>
                <span className="font-bold">{(item.product.price * item.quantity).toFixed(2)} د.ج</span>
              </div>
            ))}
          </div>

          {tableId && tableSessionQuery.isLoading && (
            <p className="mt-4 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">
              جارٍ تحميل حالة الطاولة...
            </p>
          )}

          {tableId && tableSession && hasActiveTableSession && !showTableComposer ? (
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-brand-100 bg-brand-50 p-3">
                <p className="text-sm font-black text-brand-700">جلسة الطاولة نشطة</p>
                <p className="text-xs text-gray-600">طلبات نشطة: {tableSession.active_orders_count}</p>
                <p className="text-xs text-gray-600">طلبات غير مسددة: {tableSession.unsettled_orders_count}</p>
                <p className="text-sm font-bold text-brand-700">الإجمالي غير المسدد: {tableSession.unpaid_total.toFixed(2)} د.ج</p>
              </div>

              <div className="space-y-2">
                {tableSession.orders.map((order) => (
                  <article key={order.id} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-black text-gray-900">{formatOrderTrackingId(order.id)}</p>
                      <StatusBadge status={order.status} />
                    </div>
                    <div className="text-xs text-gray-600">
                      <p>الوقت: {timeFormatter.format(new Date(parseApiDateMs(order.created_at)))}</p>
                      <p>الإجمالي: {order.total.toFixed(2)} د.ج</p>
                    </div>
                  </article>
                ))}
              </div>

              <button type="button" onClick={() => setShowTableComposer(true)} className="btn-secondary w-full">
                طلب جديد لنفس الطاولة
              </button>
            </div>
          ) : (
            <form onSubmit={submitOrder} className="mt-6 space-y-3">
              {tableId && hasActiveTableSession && (
                <button type="button" onClick={() => setShowTableComposer(false)} className="btn-secondary w-full">
                  الرجوع إلى تتبع الجلسة
                </button>
              )}

              {!tableId && (orderType === 'takeaway' || orderType === 'delivery') && (
                <label>
                  <span className="form-label">رقم الهاتف</span>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className="form-input"
                    placeholder="رقم الهاتف"
                    required
                    dir="ltr"
                  />
                </label>
              )}

              {!tableId && orderType === 'delivery' && (
                <label>
                  <span className="form-label">عنوان التوصيل</span>
                  <textarea
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    className="form-textarea"
                    placeholder="عنوان التوصيل"
                    required
                  />
                </label>
              )}

              {!tableId && orderType === 'dine-in' && (
                <label>
                  <span className="form-label">رقم الطاولة</span>
                  <select
                    className="form-select"
                    onChange={(event) => setSelectedTable(Number(event.target.value))}
                    value={selectedTable ?? ''}
                    required
                  >
                    <option value="" disabled>
                      اختر رقم الطاولة
                    </option>
                    {availablePublicTables.map((table) => (
                      <option key={table.id} value={table.id}>
                        طاولة {table.id} ({tableStatusLabel(table.status)})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label>
                <span className="form-label">ملاحظات إضافية (اختياري)</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="form-textarea"
                  placeholder="ملاحظات إضافية"
                />
              </label>

              <div className="space-y-1 rounded-xl bg-brand-50 px-3 py-2 text-sm font-bold text-brand-700">
                <p>قيمة الطلب: {subtotal.toFixed(2)} د.ج</p>
                {!tableId && orderType === 'delivery' && <p>رسوم التوصيل: {fixedDeliveryFee.toFixed(2)} د.ج</p>}
                <p className="text-base">الإجمالي: {total.toFixed(2)} د.ج</p>
              </div>

              {submitMutation.isSuccess && !showCreatedOrderCard && (
                <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                  تم إنشاء الطلب بنجاح.
                </p>
              )}
              {error && (
                <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>
              )}

              <button type="submit" disabled={submitDisabled} className="btn-primary w-full gap-2">
                <ShoppingBag className="h-4 w-4" />
                {submitMutation.isPending ? 'جارٍ الإرسال...' : 'إرسال الطلب'}
              </button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}

function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${backendOrigin}${path.startsWith('/') ? '' : '/'}${path}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

