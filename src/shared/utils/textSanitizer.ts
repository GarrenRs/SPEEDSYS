const ARABIC_CHAR_REGEX = /[\u0600-\u06FF]/;
const READABLE_CHAR_REGEX = /^[\u0600-\u06FFA-Za-z0-9\s:,.()\-_/]+$/;
const REPLACEMENT_CHAR = '\uFFFD';
const MOJIBAKE_MARKER_REGEX = /(?:Ã.|Ø.|Ù.|ï¿½|Â.)|\uFFFD/;
const EXTENDED_LATIN_REGEX = /[\u00C0-\u00FF]/g;

function decodeUtf8FromLatin1(value: string): string | null {
  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('utf-8').decode(bytes).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

function cleanupToReadableText(value: string): string {
  return value
    .replace(/[^\u0600-\u06FFA-Za-z0-9\s:,.()\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSafeDisplayText(value: string): boolean {
  if (!value || !READABLE_CHAR_REGEX.test(value)) {
    return false;
  }
  return /[\u0600-\u06FFA-Za-z0-9]/.test(value);
}

export function isLikelyCorruptedText(value: string): boolean {
  const raw = value.trim();
  if (!raw) {
    return false;
  }
  if (raw.includes(REPLACEMENT_CHAR)) {
    return true;
  }
  if (MOJIBAKE_MARKER_REGEX.test(raw)) {
    return true;
  }
  const extendedCount = (raw.match(EXTENDED_LATIN_REGEX) ?? []).length;
  if (!ARABIC_CHAR_REGEX.test(raw) && extendedCount >= 2) {
    return true;
  }
  return false;
}

export function sanitizeMojibakeText(value: unknown, fallback = '-'): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const raw = value.trim();
  if (!raw) {
    return fallback;
  }

  if (!isLikelyCorruptedText(raw)) {
    return raw;
  }

  let decoded = decodeUtf8FromLatin1(raw);
  if (decoded && !isLikelyCorruptedText(decoded) && isSafeDisplayText(decoded)) {
    return decoded;
  }

  if (decoded) {
    const decodedTwice = decodeUtf8FromLatin1(decoded);
    if (decodedTwice) {
      decoded = decodedTwice;
    }
    const cleanedDecoded = cleanupToReadableText(decoded);
    if (cleanedDecoded.length >= 3 && !isLikelyCorruptedText(cleanedDecoded) && isSafeDisplayText(cleanedDecoded)) {
      return cleanedDecoded;
    }
  }

  const cleanedRaw = cleanupToReadableText(raw);
  if (cleanedRaw.length >= 3 && !isLikelyCorruptedText(cleanedRaw) && isSafeDisplayText(cleanedRaw)) {
    return cleanedRaw;
  }

  return fallback;
}
