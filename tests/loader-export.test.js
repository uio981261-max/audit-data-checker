import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { readWorkbook, extractSheet, guessMapping, mapRecords } from '../src/loader.js';
import { buildReport } from '../src/export.js';
import { runChecks } from '../src/run-checks.js';

const require = createRequire(import.meta.url);
const XLSX = existsSync(new URL('../vendor/xlsx.full.min.js', import.meta.url)) ? require('../vendor/xlsx.cjs') : null;
const sheetJsOnly = { skip: XLSX ? false : 'SheetJS browser bundle vendor/xlsx.full.min.js is absent; run node scripts/vendor-libraries.js to verify real SheetJS import/export' };
const headers = ['เลขที่เอกสาร', 'วันที่ลงบัญชี', 'จำนวนเงิน', 'คำอธิบาย', 'บัญชี'];
function workbookFor(values) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(values), 'Input');
  return workbook;
}
function roundTrip(workbook) {
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return readWorkbook(bytes, { XLSX });
}

test('XLSX import preserves physical row numbers, raw numeric/text cells and the 1904 date system', sheetJsOnly, () => {
  const original = workbookFor([
    [], headers,
    ['PV-001', 44593, 1234.56, 'ข้อความสมมติ', '1001'],
    [],
    ['PV-002', '02/02/2569', ' 1,234.56 ', '', '1002'],
  ]);
  original.Workbook = { WBProps: { date1904: true } };
  const sheet = extractSheet(roundTrip(original), 'Input', { XLSX });
  assert.equal(sheet.headerRowNumber, 2);
  assert.deepEqual(sheet.rows.map(row => row.rowNumber), [3, 5]);
  assert.equal(sheet.sourceMeta.physicalRows, 5);
  assert.equal(sheet.sourceMeta.readRows, 2);
  assert.equal(sheet.sourceMeta.date1904, true);
  assert.equal(sheet.rows[0].values[2], 1234.56);
  assert.equal(sheet.rows[1].values[2], ' 1,234.56 ');
  const records = mapRecords(sheet, guessMapping(sheet.headers));
  assert.equal(typeof records[0].amount, 'number');
  assert.equal(typeof records[1].amount, 'string');
  assert.equal(records[1].rowNumber, 5);
});

test('pasted CSV and TSV retain literal strings, Thai digits and blank row positions', sheetJsOnly, () => {
  const source = 'Document No,Posting Date,Amount,Description\n0001,02/02/2569,"1,234.56",=SUM(A1:A2)\n\n0002,02/02/2026,๕๖๗๘.๙๑,สมมติ';
  const workbook = readWorkbook(source, { csv: true, XLSX });
  const sheet = extractSheet(workbook, workbook.SheetNames[0], { XLSX });
  const records = mapRecords(sheet, guessMapping(sheet.headers));
  assert.deepEqual(records.map(row => row.rowNumber), [2, 4]);
  assert.deepEqual(records.map(row => row.documentNumber), ['0001', '0002']);
  assert.deepEqual(records.map(row => row.amount), ['1,234.56', '๕๖๗๘.๙๑']);
  assert.equal(records[0].description, '=SUM(A1:A2)');
  assert.equal(records[0].account, '');
  const tsv = readWorkbook('เลขที่เอกสาร\tวันที่ลงบัญชี\tจำนวนเงิน\n0001\t02/02/2026\t1000', { csv: true, XLSX });
  const pasted = extractSheet(tsv, tsv.SheetNames[0], { XLSX });
  assert.equal(mapRecords(pasted, guessMapping(pasted.headers))[0].amount, '1000');
});

test('header aliases work in Thai/English and never reuse a source column', () => {
  assert.deepEqual(guessMapping(['Document No.', 'Posting_Date', 'TOTAL AMOUNT', 'Memo', 'GL Account']), { documentNumber: 0, date: 1, amount: 2, description: 3, account: 4 });
  assert.deepEqual(guessMapping(headers), { documentNumber: 0, date: 1, amount: 2, description: 3, account: 4 });
  const guessed = guessMapping(['Amount', 'Amount', 'Date']);
  assert.equal(guessed.amount, 0);
  assert.equal(guessed.date, 2);
  assert.equal(guessed.documentNumber, -1);
});

test('mapping permits omitted optional fields and rejects invalid or reused columns', () => {
  const sheet = { headers, rows: [{ rowNumber: 9, values: ['PV-1', '02/02/2026', -1200, '', '1001'] }] };
  const mapping = { documentNumber: 0, date: 1, amount: 2 };
  assert.deepEqual(mapRecords(sheet, mapping), [{ rowNumber: 9, documentNumber: 'PV-1', date: '02/02/2026', amount: -1200, description: '', account: '' }]);
  for (const invalid of [5, 1.5, -2, null, '3']) {
    assert.throws(() => mapRecords(sheet, { ...mapping, description: invalid }));
  }
  assert.throws(() => mapRecords(sheet, { ...mapping, description: 2 }), /ต่างกัน/);
  assert.throws(() => mapRecords(sheet, { ...mapping, amount: -1 }), /ให้ครบ/);
  assert.deepEqual(mapRecords({ headers, rows: [] }, mapping), []);
});

test('loader records cached, uncached and error formula cells and truncation metadata', sheetJsOnly, () => {
  const workbook = workbookFor([headers, ['PV-1', '02/02/2026', 100], [], ['PV-2', '02/02/2026']]);
  const source = workbook.Sheets.Input;
  source.C2 = { t: 'n', v: 100, f: '50+50' };
  source.C4 = { t: 'n', f: 'SUM(C2)' };
  source.A5 = { t: 'n', f: '1+1' };
  source.D4 = { t: 'e', v: 7, w: '#DIV/0!' };
  source['!ref'] = 'A1:E5';
  source['!fullref'] = 'A1:E1048576';
  const sheet = extractSheet(workbook, 'Input', { XLSX });
  assert.deepEqual(sheet.rows.map(row => row.rowNumber), [2, 4, 5]);
  assert.equal(sheet.sourceMeta.formulaCount, 3);
  assert.equal(sheet.sourceMeta.errorCellCount, 1);
  assert.equal(sheet.sourceMeta.looksTruncated, true);
  assert.equal(sheet.sourceMeta.physicalRows, 1048576);
  assert.equal(sheet.rows[1].values[2], '');
  assert.equal(sheet.rows[1].values[3], '#DIV/0!');
  assert.throws(() => extractSheet(workbook, 'Absent', { XLSX }), /ไม่มีข้อมูล/);
  assert.throws(() => readWorkbook('anything', { XLSX: null }), /ไลบรารี/);
});

test('report round-trip contains Summary plus eight checks, traceable rows and literal strings', sheetJsOnly, () => {
  const rows = [
    { rowNumber: 3, documentNumber: '=1+1', date: '02/02/2026', amount: '1,000', description: '=SUM(A1:A2)', account: '@ACCOUNT' },
    { rowNumber: 8, documentNumber: '=1+1', date: '02/02/2569', amount: 1000, description: '+value', account: '-text' },
  ];
  const options = { yearSystem: 'auto', thresholds: [1000, 10000], holidays: { coverageYears: [], holidays: [] }, expectedRows: 2, expectedAmount: 2000 };
  const results = runChecks(rows, options);
  const context = { sourceName: '=HYPERLINK("https://example.invalid")', sheetName: 'Input', rowCount: 2, headerRowNumber: 1, options, mappingHeaders: { documentNumber: 'Document No', amount: 'Amount' }, generatedAt: '2026-10-12T00:00:00.000Z' };
  const report = roundTrip(buildReport(results, context, XLSX));
  assert.deepEqual(report.SheetNames, ['Summary', 'Duplicate documents', 'Sequence gaps', 'Weekend and holidays', 'Round amounts', 'Text and characters', 'Date and year systems', 'Control totals', 'Benford']);
  const duplicate = report.Sheets['Duplicate documents'];
  assert.equal(duplicate.A2.v, 3);
  assert.equal(duplicate.A3.v, 8);
  assert.equal(duplicate.B2.v, '=1+1');
  assert.equal(duplicate.E2.v, '=SUM(A1:A2)');
  assert.equal(duplicate.B2.t, 's');
  assert.equal(report.Sheets.Summary.B4.v, context.sourceName);
  for (const sheet of Object.values(report.Sheets)) {
    for (const [address, cell] of Object.entries(sheet)) {
      if (!address.startsWith('!')) assert.equal(cell.f, undefined, `formula appeared at ${address}`);
    }
  }
  assert.equal(report.Sheets.Benford.A1.v, results.at(-1).message);
});

test('sample follows the browser loader, auto mapping, all-check runner and nine-sheet export flow', sheetJsOnly, () => {
  const expected = JSON.parse(readFileSync(new URL('../data/EXPECTED.json', import.meta.url), 'utf8'));
  const holidays = JSON.parse(readFileSync(new URL('../data/th-holidays.json', import.meta.url), 'utf8'));
  const workbook = readWorkbook(readFileSync(new URL('../data/sample.xlsx', import.meta.url)), { XLSX });
  const sheet = extractSheet(workbook, workbook.SheetNames[0], { XLSX });
  const mapping = guessMapping(sheet.headers);
  const records = mapRecords(sheet, mapping);
  const options = { yearSystem: 'auto', thresholds: [1000, 10000], holidays, expectedRows: expected.rowCount, expectedAmount: expected.totalAmount, sourceMeta: sheet.sourceMeta, date1904: sheet.sourceMeta.date1904 };
  const results = runChecks(records, options);
  assert.equal(records.length, expected.rowCount);
  for (const item of results) assert.equal(item.count, expected.checks[item.id].count, `${item.id} count`);
  assert.deepEqual(results.find(item => item.id === 'round').countsByThreshold, expected.checks.round.countsByThreshold);
  assert.equal(results.find(item => item.id === 'completeness').amountSum, expected.totalAmount);
  const report = buildReport(results, { sourceName: 'sample.xlsx', sheetName: workbook.SheetNames[0], rowCount: records.length, headerRowNumber: sheet.headerRowNumber, options }, XLSX);
  assert.equal(report.SheetNames.length, 9);
  assert.equal(report.Sheets['Duplicate documents'].A2.v, expected.checks.duplicates.rowNumbers[0]);
});
