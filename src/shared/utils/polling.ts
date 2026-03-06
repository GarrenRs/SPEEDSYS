export type AdaptivePollingOptions = {
  minimumMs?: number;
  maximumMs?: number;
  hiddenMultiplier?: number;
  pauseWhenHidden?: boolean;
  pauseWhenOffline?: boolean;
};

function normalizeInterval(value: number, minimumMs: number, maximumMs: number): number {
  const parsed = Number.isFinite(value) ? Math.trunc(value) : minimumMs;
  if (parsed < minimumMs) {
    return minimumMs;
  }
  if (parsed > maximumMs) {
    return maximumMs;
  }
  return parsed;
}

export function adaptiveRefetchInterval(
  baseMs: number,
  options: AdaptivePollingOptions = {}
): () => number | false {
  const minimumMs = Math.max(1000, Math.trunc(options.minimumMs ?? 4000));
  const maximumMs = Math.max(minimumMs, Math.trunc(options.maximumMs ?? 60000));
  const hiddenMultiplier = Math.max(1, options.hiddenMultiplier ?? 3);
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const pauseWhenOffline = options.pauseWhenOffline ?? true;
  const normalizedBase = normalizeInterval(baseMs, minimumMs, maximumMs);

  return () => {
    if (pauseWhenOffline && typeof navigator !== 'undefined' && navigator.onLine === false) {
      return false;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      if (pauseWhenHidden) {
        return false;
      }
      return normalizeInterval(normalizedBase * hiddenMultiplier, minimumMs, maximumMs);
    }
    return normalizedBase;
  };
}
