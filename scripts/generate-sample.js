import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { writeFixtureWorkbook } from './fixture-xlsx.js';

// All names, values, and vouchers in this fixture are fictional.
// Keep the seed and planting plan fixed so regression tests stay reproducible.
const require = createRequire(import.meta.url);
const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const seed = 0xA0D17;
let randomState = seed;
function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

const headers = ['เลขที่เอกสาร', 'วันที่ลงบัญชี', 'จำนวนเงิน', 'คำอธิบาย', 'บัญชี'];
const missingNumbers = [100, 300, 500, 700, 900, 1100, 1300];
const weekdays = [];
for (let day = new Date(Date.UTC(2026, 0, 1)); day.getUTCFullYear() === 2026; day.setUTCDate(day.getUTCDate() + 1)) {
  if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) weekdays.push(day.toISOString().slice(0, 10));
}

const records = [];
for (let document = 1; document <= 1995; document += 1) {
  if (missingNumbers.includes(document)) continue;
  const baht = 1000 + Math.floor(random() * 99000);
  const cents = 1 + Math.floor(random() * 99);
  const sign = document % 19 === 0 ? -1 : 1;
  records.push({
    documentNumber: `PV-2569-${String(document).padStart(4, '0')}`,
    date: weekdays[Math.floor(random() * weekdays.length)],
    amount: sign * (baht * 100 + cents) / 100,
    amountCents: sign * (baht * 100 + cents),
    description: `รายการสังเคราะห์ ${String(document).padStart(4, '0')}`,
    account: `บัญชีสมมติ-${String(1 + document % 8).padStart(2, '0')}`,
  });
}

// Fifteen dates are weekends; the remaining dates are verified weekdays.
for (let index = 40; index < 55; index += 1) records[index].date = index % 2 === 0 ? '2026-02-07' : '2026-02-08';
// Six minority-system dates convert to Monday, 2026-02-02.
for (let index = 70; index < 76; index += 1) records[index].date = '2569-02-02';
// Exactly twenty rows match 1,000; exactly ten of those also match 10,000.
for (let offset = 0; offset < 10; offset += 1) {
  records[100 + offset].amount = (1 + offset % 9) * 1000;
  records[100 + offset].amountCents = records[100 + offset].amount * 100;
  records[110 + offset].amount = (offset + 1) * 10000;
  records[110 + offset].amountCents = records[110 + offset].amount * 100;
}

const textAmounts = [
  [' 1,234.56 ', 123456],
  ['2,345.67', 234567],
  ['\u00a03,456.78\u00a0', 345678],
  ['4\u200b567.89', 456789],
  ['๕๖๗๘.๙๑', 567891],
  ['6789.12', 678912],
  ['(7,890.23)', -789023],
  ['8,901.34\uFEFF', 890134],
  ['+9012.45', 901245],
];
textAmounts.forEach(([amount, amountCents], offset) => {
  records[150 + offset].amount = amount;
  records[150 + offset].amountCents = amountCents;
});

const duplicateVariants = [
  'pv-2569-0001',
  ' PV-2569-0002 ',
  'PV-2569-0003\u00a0',
  'PV-2569-\u200b0004',
];
// Twelve originals plus twelve copies make twelve groups and 24 flagged rows.
for (let offset = 0; offset < 12; offset += 1) {
  records.push({ ...records[offset], documentNumber: duplicateVariants[offset] ?? records[offset].documentNumber });
}

const rows = [headers, ...records.map(row => [row.documentNumber, row.date, row.amount, row.description, row.account])];
const totalAmountCents = records.reduce((sum, row) => sum + row.amountCents, 0);
const firstDigitCounts = Array(9).fill(0);
for (const row of records) {
  const firstDigit = String(Math.abs(row.amountCents)).replace(/^0+/, '')[0];
  firstDigitCounts[Number(firstDigit) - 1] += 1;
}
// These frozen expectations come from the plant plan, never from the checks.
const expected = JSON.parse(readFileSync(`${dataDirectory}/EXPECTED.json`, 'utf8'));
assert.equal(records.length, expected.rowCount);
assert.equal(totalAmountCents, expected.totalAmountCents);
assert.deepEqual(firstDigitCounts, expected.checks.benford.digitCounts);

mkdirSync(dataDirectory, { recursive: true });
// RFC 4180 quoting preserves spaces and invisible characters exactly. CSV has no
// numeric/text cell types; sample.xlsx is canonical for the nine text amounts.
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
writeFileSync(`${dataDirectory}/sample.csv`, `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8');

let workbookBuffer;
let xlsxWriter;
try {
  const XLSX = require('../vendor/xlsx.cjs');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 24 }, { wch: 19 }, { wch: 17 }, { wch: 30 }, { wch: 22 }];
  // Keep amounts as numeric or text cells intentionally; dates are ISO text.
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ข้อมูลสังเคราะห์');
  workbook.Props = { CreatedDate: new Date('1980-01-01T00:00:00.000Z'), ModifiedDate: new Date('1980-01-01T00:00:00.000Z') };
  workbookBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  xlsxWriter = `SheetJS ${XLSX.version}`;
} catch (error) {
  if (error.code !== 'ENOENT' || !String(error.path).replace(/\\/g, '/').endsWith('/vendor/xlsx.full.min.js')) throw error;
  workbookBuffer = writeFixtureWorkbook(rows);
  xlsxWriter = 'development-only OOXML fixture writer (Node built-ins)';
  console.warn('SheetJS bundle is absent; generating sample.xlsx with the development-only fixture writer. Browser import/export still requires the vendored SheetJS bundle.');
}
writeFileSync(`${dataDirectory}/sample.xlsx`, workbookBuffer);

console.log(JSON.stringify({ rows: records.length, totalAmountCents, firstDigitCounts, xlsxWriter }, null, 2));
