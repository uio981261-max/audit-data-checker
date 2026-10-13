import { cleanText, flagRow, INVISIBLE, parseAmount, result } from './utils.js';

const FIELDS = ['documentNumber', 'date', 'amount', 'description', 'account'];
const LABELS = { documentNumber: 'เลขที่เอกสาร', date: 'วันที่', amount: 'จำนวนเงิน', description: 'คำอธิบาย', account: 'บัญชี' };
// A nonglobal copy avoids the stateful lastIndex behavior of RegExp.test.
const HIDDEN = new RegExp(INVISIBLE.source);

/** Inspect the original cell types and characters without changing the source. */
export function checkHygiene(rows) {
  const flags = [];
  const countsByType = {};
  for (const row of rows) {
    const findings = [];
    const cleanedValues = {};
    const add = (field, type, detail) => {
      findings.push({ field, type, detail });
      countsByType[type] = (countsByType[type] ?? 0) + 1;
    };
    for (const field of FIELDS) {
      const raw = row[field];
      if (typeof raw !== 'string') continue;
      const cleaned = cleanText(raw);
      const amount = field === 'amount' ? parseAmount(raw) : null;
      cleanedValues[field] = field === 'amount' && amount !== null ? amount : cleaned;
      if (/^\p{White_Space}|\p{White_Space}$/u.test(raw)) add(field, 'edgeSpaces', 'มีช่องว่างต้นหรือท้าย');
      if (/\u00A0/.test(raw)) add(field, 'nonBreakingSpace', 'มีช่องว่างชนิด U+00A0');
      if (HIDDEN.test(raw)) add(field, 'zeroWidth', 'มีอักขระความกว้างศูนย์หรืออักขระซ่อน');
      if (/[๐-๙]/.test(raw)) add(field, 'thaiDigits', 'มีเลขไทย');
      if (field === 'amount' && cleaned) {
        if (amount !== null) {
          add(field, 'textNumber', 'ตัวเลขถูกเก็บเป็นข้อความ');
          if (raw.includes(',')) add(field, 'numberCommas', 'มีเครื่องหมายจุลภาคในตัวเลขแบบข้อความ');
        } else {
          add(field, 'invalidAmount', 'รูปแบบจำนวนเงินที่อ่านเป็นตัวเลขไม่ได้');
        }
      }
    }
    if (findings.length) flags.push(flagRow(row,
      findings.map(item => `${LABELS[item.field]}: ${item.detail}`).join('; '),
      { findings, cleanedValues }));
  }
  return result('hygiene', flags, { countsByType });
}
