const ISO_WITHOUT_TZ_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export function parseApiDateMs(value: string | null | undefined): number {
  if (!value) {
    return Number.NaN;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return Number.NaN;
  }

  // Backend timestamps may arrive without timezone suffix; treat them as UTC to avoid client drift.
  if (ISO_WITHOUT_TZ_PATTERN.test(trimmed)) {
    return Date.parse(`${trimmed}Z`);
  }

  return Date.parse(trimmed);
}
