import { decimalParts, parseAmount, result } from './utils.js';

const EXCEL_ROW_LIMIT = 1048576;
const isProvided = value => value !== null && value !== undefined && value !== '';
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const validCount = value => Number.isSafeInteger(value) && value >= 0;

// Round the aggregate once, at currency precision, with halves away from zero.
function toCents({ integer, scale }) {
  if (scale <= 2) return integer * 10n ** BigInt(2 - scale);
  const divisor = 10n ** BigInt(scale - 2);
  const absolute = integer < 0n ? -integer : integer;
  const rounded = absolute / divisor + (absolute % divisor * 2n >= divisor ? 1n : 0n);
  return integer < 0n ? -rounded : rounded;
}
const isSafeCents = value => value >= -MAX_SAFE_CENTS && value <= MAX_SAFE_CENTS;

/** Compare browser-loaded data with independent source controls. */
export function checkCompleteness(rows, { expectedRows = null, expectedAmount = null, sourceMeta = {} } = {}) {
  const flags = [];
  const warnings = [];
  const comparisons = {};
  let sum = { integer: 0n, scale: 0 };
  let validAmountCount = 0;
  let invalidAmountCount = 0;
  for (const row of rows) {
    const amount = decimalParts(row.amount);
    if (amount === null) {
      invalidAmountCount += 1;
      continue;
    }
    const scale = Math.max(sum.scale, amount.scale);
    sum = {
      integer: sum.integer * 10n ** BigInt(scale - sum.scale) + amount.integer * 10n ** BigInt(scale - amount.scale),
      scale,
    };
    validAmountCount += 1;
  }
  const totalCents = toCents(sum);
  const amountSum = isSafeCents(totalCents) ? Number(totalCents) / 100 : null;
  const warn = (code, message, extra = {}) => {
    warnings.push(message);
    flags.push({ reason: message, code, ...extra });
  };
  if (amountSum === null) warn('amountSumOutOfRange', 'ยอดรวมเกินช่วงที่แสดงจำนวนเงินระดับสตางค์ได้แน่นอน กรุณาแยกชุดข้อมูลหรือยืนยันยอดด้วยระบบต้นทาง');
  if (isProvided(expectedRows)) {
    const expected = parseAmount(expectedRows);
    if (!validCount(expected)) warn('invalidRowControl', 'ยอดควบคุมจำนวนแถวต้องเป็นจำนวนเต็มที่ไม่ติดลบ');
    else {
      const difference = rows.length - expected;
      comparisons.rowCount = { actual: rows.length, expected, difference, matches: difference === 0 };
      if (difference !== 0) flags.push({ code: 'rowDifference', reason: `จำนวนแถวต่างจากยอดควบคุม ${difference} แถว`, ...comparisons.rowCount });
    }
  }
  if (isProvided(expectedAmount)) {
    const expected = parseAmount(expectedAmount);
    const expectedParts = decimalParts(expectedAmount);
    if (expectedParts === null) warn('invalidAmountControl', 'ยอดควบคุมจำนวนเงินต้องอ่านเป็นตัวเลขได้');
    else {
      const expectedCents = toCents(expectedParts);
      const differenceCents = totalCents - expectedCents;
      const available = amountSum !== null && isSafeCents(expectedCents) && isSafeCents(differenceCents);
      if (!available) {
        comparisons.amount = { actual: amountSum, expected, difference: null, matches: false, available: false };
        warn('amountComparisonOutOfRange', 'ไม่สามารถเทียบยอดควบคุมในช่วงจำนวนเงินระดับสตางค์ได้แน่นอน กรุณายืนยันยอดด้วยระบบต้นทาง');
      } else {
        const difference = Number(differenceCents) / 100;
        comparisons.amount = { actual: amountSum, expected, difference, matches: difference === 0, available: true };
        if (difference !== 0) flags.push({ code: 'amountDifference', reason: `ยอดรวมต่างจากยอดควบคุม ${difference.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, ...comparisons.amount });
      }
    }
  }
  if (invalidAmountCount) warn('invalidAmounts', `มี ${invalidAmountCount} แถวที่จำนวนเงินว่างหรืออ่านไม่ได้ จึงไม่ได้รวมในยอดรวม`, { invalidAmountCount });
  const counts = [rows.length, sourceMeta.declaredRows, sourceMeta.readRows, sourceMeta.physicalRows];
  if (counts.includes(EXCEL_ROW_LIMIT)) warn('excelLimit', 'จำนวนแถวแตะขีดจำกัด Excel 1,048,576 แถว ควรยืนยันว่าข้อมูลต้นทางส่งออกครบ');
  const readRows = validCount(sourceMeta.readRows) ? sourceMeta.readRows : rows.length;
  // physicalRows is the absolute worksheet extent, including headers/blanks.
  // Only declaredRows and readRows use comparable nonempty data-record counts.
  const metadataSuggestsTruncation = validCount(sourceMeta.declaredRows) && sourceMeta.declaredRows > readRows;
  if (sourceMeta.looksTruncated === true || metadataSuggestsTruncation) {
    warn('possibleTruncation', 'ข้อมูลอาจถูกตัดทอน ควรเทียบจำนวนแถวกับระบบต้นทางและส่งออกใหม่หากจำเป็น');
  }
  return result('completeness', flags, {
    rowCount: rows.length, amountSum, validAmountCount, invalidAmountCount, comparisons, warnings,
    hasControls: isProvided(expectedRows) || isProvided(expectedAmount),
  });
}
