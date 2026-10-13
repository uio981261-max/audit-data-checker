import { cleanText, flagRow, result } from './utils.js';
import { normalizeDocumentNumber } from './duplicates.js';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const serializableInteger = value => value <= MAX_SAFE ? Number(value) : value.toString();

// BigInt retains exact document suffixes even when the input exceeds 2^53.
// Negative / fractional standalone numbers do not define voucher sequences.
export function parseDocumentSequence(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  const text = cleanText(value).replace(/\s+/g, ' ').trim();
  if (!text || /^-\d+(?:[.,]\d+)?$/.test(text) || /^[+-]?\d+[.,]\d+$/.test(text)) return null;
  const match = /^(.*?)(\d+)$/.exec(text);
  if (!match) return null;
  // A leading plus sign on an otherwise numeric identifier is harmless.
  const prefix = match[1] === '+' ? '' : normalizeDocumentNumber(match[1]);
  return { prefix, number: BigInt(match[2]) };
}

export function checkSequence(rows = []) {
  const buckets = new Map();
  let skippedCount = 0;
  let unsafeNumericCount = 0;
  for (const row of rows) {
    const parsed = parseDocumentSequence(row.documentNumber);
    if (!parsed) {
      if (cleanText(row.documentNumber)) skippedCount += 1;
      if (typeof row.documentNumber === 'number' && Number.isInteger(row.documentNumber) && !Number.isSafeInteger(row.documentNumber)) unsafeNumericCount += 1;
      continue;
    }
    if (!buckets.has(parsed.prefix)) buckets.set(parsed.prefix, new Map());
    const numbers = buckets.get(parsed.prefix);
    const key = parsed.number.toString();
    // A duplicate document does not introduce a second sequence boundary.
    if (!numbers.has(key)) numbers.set(key, { number: parsed.number, row });
  }

  const flags = [];
  const groups = [];
  let totalMissing = 0n;
  for (const [prefix, numbers] of buckets) {
    const sorted = [...numbers.values()].sort((a, b) => a.number < b.number ? -1 : a.number > b.number ? 1 : 0);
    const missingRanges = [];
    let groupMissing = 0n;
    for (let index = 1; index < sorted.length; index += 1) {
      const before = sorted[index - 1];
      const after = sorted[index];
      if (after.number - before.number <= 1n) continue;
      const first = before.number + 1n;
      const last = after.number - 1n;
      const missing = last - first + 1n;
      const range = {
        prefix,
        missingFrom: first.toString(),
        missingTo: last.toString(),
        missingCount: serializableInteger(missing),
        beforeRow: before.row.rowNumber,
        afterRow: after.row.rowNumber,
        rowNumbers: [before.row.rowNumber, after.row.rowNumber],
      };
      missingRanges.push(range);
      groupMissing += missing;
      const displayRange = first === last ? first.toString() : `${first}–${last}`;
      const reason = `ไม่พบลำดับ ${prefix || '(ไม่มีคำนำหน้า)'} ${displayRange} ในข้อมูลที่โหลด ระหว่างแถว ${before.row.rowNumber} และ ${after.row.rowNumber} ควรสอบทานขอบเขตข้อมูลและทะเบียนเอกสาร`;
      flags.push(flagRow(before.row, reason, { ...range, beforeDocumentNumber: before.row.documentNumber, afterDocumentNumber: after.row.documentNumber }));
    }
    totalMissing += groupMissing;
    groups.push({ prefix, firstNumber: sorted[0].number.toString(), lastNumber: sorted[sorted.length - 1].number.toString(), uniqueCount: sorted.length, missingRanges, missingCount: serializableInteger(groupMissing) });
  }

  const messages = [];
  if (skippedCount) messages.push(`ข้าม ${skippedCount} รายการที่หมายเลขเอกสารไม่มีลำดับจำนวนเต็มที่ใช้ตรวจได้`);
  if (unsafeNumericCount) messages.push(`มี ${unsafeNumericCount} หมายเลขที่เก็บเป็นตัวเลขเกินช่วงที่ JavaScript แทนค่าได้แน่นอน ควรนำเข้าหมายเลขเอกสารเป็นข้อความ`);
  return result('sequence', flags, { groups, missingCount: serializableInteger(totalMissing), skippedCount, unsafeNumericCount, messages });
}
