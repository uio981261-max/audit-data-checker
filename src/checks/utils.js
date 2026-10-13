// Pure helpers. Raw cell values are retained by the loader for review.
// Unicode format controls can be invisible even when they have a nonzero width.
// Use this same set for cleaning identifiers, amounts and dates, and detection.
export const INVISIBLE = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
export function thaiToArabic(value) {
  return String(value ?? '').replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0x0E50));
}
export function cleanText(value) {
  return thaiToArabic(value).replace(INVISIBLE, '').replace(/\u00A0/g, ' ').trim();
}
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = cleanText(value);
  let negative = false;
  if (/^\(.+\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  // Reject malformed grouping instead of silently interpreting ambiguous values.
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const amount = Number(text.replace(/,/g, ''));
  return Number.isFinite(amount) ? (negative ? -Math.abs(amount) : amount) : null;
}
/** Exact decimal representation of an accepted amount; no floating remainder. */
export function decimalParts(value) {
  const amount = parseAmount(value);
  if (amount === null) return null;
  let text = typeof value === 'number' ? String(value) : cleanText(value).replace(/,/g, '');
  let negative = false;
  if (text.startsWith('(')) { negative = true; text = text.slice(1, -1).trim(); }
  if (text.startsWith('-')) { negative = true; text = text.slice(1); }
  else if (text.startsWith('+')) text = text.slice(1);
  const [mantissa, exponentText = '0'] = text.toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  let digits = `${whole}${fraction}`.replace(/^0+/, '') || '0';
  let scale = fraction.length - Number(exponentText);
  // Remove insignificant trailing zeroes before allocating powers of ten.
  while (scale > 0 && digits.endsWith('0') && digits !== '0') {
    digits = digits.slice(0, -1);
    scale -= 1;
  }
  if (digits === '0') return { integer: 0n, scale: 0 };
  const integer = BigInt(digits) * (scale < 0 ? 10n ** BigInt(-scale) : 1n);
  return { integer: negative ? -integer : integer, scale: Math.max(0, scale) };
}
export function flagRow(row, reason, extra = {}) {
  return { rowNumber: row.rowNumber, documentNumber: row.documentNumber ?? '', date: row.date ?? '', amount: row.amount ?? '', description: row.description ?? '', account: row.account ?? '', reason, ...extra };
}
export function result(id, flags, extra = {}) {
  return { id, count: flags.length, flags, ...extra };
}
