import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { checkDuplicates } from '../src/checks/duplicates.js';
import { checkSequence } from '../src/checks/sequence.js';
import { checkCalendar } from '../src/checks/calendar.js';
import { checkRound } from '../src/checks/round.js';
import { checkHygiene } from '../src/checks/hygiene.js';
import { checkYears } from '../src/checks/years.js';
import { checkCompleteness } from '../src/checks/completeness.js';
import { checkBenford } from '../src/checks/benford.js';
import { readFixtureCsv, readFixtureXlsx } from './helpers/read-fixture.js';

const require = createRequire(import.meta.url);
const XLSX = existsSync(new URL('../vendor/xlsx.full.min.js', import.meta.url)) ? require('../vendor/xlsx.cjs') : null;
const documented = readFileSync(new URL('../data/EXPECTED.md', import.meta.url), 'utf8');
const expectedBlock = /```json\s*\r?\n([\s\S]*?)\r?\n```/.exec(documented);
assert.ok(expectedBlock, 'EXPECTED.md must contain the complete canonical JSON expectations');
const expected = JSON.parse(expectedBlock[1]);
const holidays = JSON.parse(readFileSync(new URL('../data/th-holidays.json', import.meta.url), 'utf8'));
const sortedRows = result => result.flags.map(flag => flag.rowNumber).sort((a, b) => a - b);
const fixtureBytes = readFileSync(new URL('../data/sample.xlsx', import.meta.url));
const xlsxValues = readFixtureXlsx(fixtureBytes);
const csvValues = readFixtureCsv(readFileSync(new URL('../data/sample.csv', import.meta.url), 'utf8'));

function recordsFrom(values) {
  assert.equal(values.length, expected.physicalRowsIncludingHeader);
  assert.deepEqual(values[0], ['เลขที่เอกสาร', 'วันที่ลงบัญชี', 'จำนวนเงิน', 'คำอธิบาย', 'บัญชี']);
  return values.slice(1).map((cells, index) => ({
    rowNumber: index + 2,
    documentNumber: cells[0],
    date: cells[1],
    amount: cells[2],
    description: cells[3],
    account: cells[4],
  }));
}

function verifyAllChecks(rows, { csv = false } = {}) {
  assert.equal(rows.length, expected.rowCount);

  const duplicate = checkDuplicates(rows);
  assert.equal(duplicate.count, expected.checks.duplicates.count);
  assert.equal(duplicate.groupCount, expected.checks.duplicates.groupCount);
  assert.equal(duplicate.groups.filter(group => group.rawDiffered).length, expected.checks.duplicates.rawDifferedGroups);
  assert.deepEqual(sortedRows(duplicate), expected.checks.duplicates.rowNumbers);

  const sequence = checkSequence(rows);
  assert.equal(sequence.count, expected.checks.sequence.count);
  assert.equal(sequence.missingCount, expected.checks.sequence.missingCount);
  assert.deepEqual(sequence.flags.map(flag => flag.missingFrom), expected.checks.sequence.missingNumbers);
  assert.ok(sequence.flags.every(flag => flag.missingFrom === flag.missingTo));
  assert.equal(sequence.groups.length, 1);

  const calendar = checkCalendar(rows, { holidays });
  for (const key of ['count', 'weekendCount', 'holidayCount', 'invalidDateCount']) {
    assert.equal(calendar[key], expected.checks.calendar[key], `calendar.${key}`);
  }
  assert.deepEqual(calendar.coveredYears, expected.checks.calendar.coveredYears);
  assert.deepEqual(calendar.uncoveredYears, expected.checks.calendar.uncoveredYears);
  assert.deepEqual(sortedRows(calendar), expected.checks.calendar.rowNumbers);

  const round = checkRound(rows);
  assert.equal(round.count, expected.checks.round.count);
  assert.equal(round.validAmountCount, expected.checks.round.validAmountCount);
  assert.deepEqual(round.countsByThreshold, expected.checks.round.countsByThreshold);
  assert.deepEqual(sortedRows(round), expected.checks.round.rowNumbers);

  const hygiene = checkHygiene(rows);
  if (csv) {
    // CSV has no cell type metadata. Never pretend ordinary CSV amount fields
    // retained the numeric type of their matching XLSX cells.
    assert.equal(hygiene.count, expected.rowCount);
    assert.deepEqual(hygiene.countsByType, { ...expected.checks.hygiene.countsByType, textNumber: expected.rowCount });
    assert.deepEqual(sortedRows(hygiene), rows.map(row => row.rowNumber));
  } else {
    assert.equal(hygiene.count, expected.checks.hygiene.count);
    assert.deepEqual(hygiene.countsByType, expected.checks.hygiene.countsByType);
    assert.deepEqual(sortedRows(hygiene), expected.checks.hygiene.rowNumbers);
  }
  assert.equal(hygiene.flags.find(flag => flag.rowNumber === 158).cleanedValues.amount, -7890.23);

  const years = checkYears(rows);
  for (const key of ['count', 'majoritySystem', 'minoritySystem', 'invalidDateCount', 'mixedYearCount']) {
    assert.equal(years[key], expected.checks.years[key], `years.${key}`);
  }
  assert.deepEqual(years.systemCounts, expected.checks.years.systemCounts);
  assert.deepEqual(sortedRows(years), expected.checks.years.rowNumbers);
  assert.ok(years.flags.every(flag => flag.convertedDate === '2026-02-02'));

  const completeness = checkCompleteness(rows, { expectedRows: expected.rowCount, expectedAmount: expected.totalAmount });
  for (const key of ['count', 'rowCount', 'amountSum', 'validAmountCount', 'invalidAmountCount']) {
    assert.equal(completeness[key], expected.checks.completeness[key], `completeness.${key}`);
  }
  assert.equal(completeness.comparisons.rowCount.difference, expected.checks.completeness.rowDifference);
  assert.equal(completeness.comparisons.amount.difference, expected.checks.completeness.amountDifference);
  assert.equal(Math.round(completeness.amountSum * 100), expected.totalAmountCents);

  const benford = checkBenford(rows);
  for (const key of ['count', 'usableCount', 'excludedCount', 'skipped']) {
    assert.equal(benford[key], expected.checks.benford[key], `benford.${key}`);
  }
  assert.deepEqual(benford.distribution.map(item => item.count), expected.checks.benford.digitCounts);
  assert.equal(benford.distribution.reduce((sum, item) => sum + item.count, 0), expected.rowCount);
}

test('documented EXPECTED.md is canonical and its complete JSON equals EXPECTED.json', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../data/EXPECTED.json', import.meta.url), 'utf8')), expected);
  assert.equal(expected.checks.duplicates.groupCount, 12);
  assert.equal(expected.checks.sequence.missingCount, 7);
  assert.equal(expected.checks.calendar.weekendCount, 15);
  assert.equal(expected.checks.round.count, 20);
  assert.equal(expected.checks.hygiene.countsByType.textNumber, 9);
  assert.equal(expected.checks.years.mixedYearCount, 6);
});

test('all eight checks on the actual sample XLSX match EXPECTED.md exactly without external dependencies', () => {
  if (XLSX) {
    const workbook = XLSX.read(fixtureBytes, { type: 'buffer', cellDates: false });
    const sheetValues = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: '' });
    assert.deepEqual(sheetValues, xlsxValues, 'independent fixture reader and real SheetJS must agree');
    verifyAllChecks(recordsFrom(sheetValues));
  } else {
    verifyAllChecks(recordsFrom(xlsxValues));
  }
});

test('all eight checks on actual sample CSV retain business results and honestly flag all 2000 text amounts', () => {
  verifyAllChecks(recordsFrom(csvValues), { csv: true });
});

test('actual fixtures preserve numeric/text types, planted raw characters and all 2001 source rows', () => {
  const rows = recordsFrom(xlsxValues);
  assert.equal(rows.filter(row => typeof row.amount === 'string').length, 9);
  assert.equal(rows.filter(row => typeof row.amount === 'number').length, 1991);
  assert.ok(rows.some(row => typeof row.amount === 'number' && row.amount < 0));
  assert.deepEqual(rows.slice(150, 159).map(row => row.amount), [
    ' 1,234.56 ', '2,345.67', '\u00a03,456.78\u00a0', '4\u200b567.89',
    '๕๖๗๘.๙๑', '6789.12', '(7,890.23)', '8,901.34\uFEFF', '+9012.45',
  ]);
  assert.deepEqual(rows.slice(1988, 1992).map(row => row.documentNumber), [
    'pv-2569-0001', ' PV-2569-0002 ', 'PV-2569-0003\u00a0', 'PV-2569-\u200b0004',
  ]);
  const csvRows = recordsFrom(csvValues);
  assert.ok(csvRows.every(row => typeof row.amount === 'string'));
  assert.deepEqual(csvRows.map(row => row.amount), rows.map(row => String(row.amount)));
  assert.deepEqual(csvRows.map(row => row.rowNumber), rows.map(row => row.rowNumber));
  assert.deepEqual(csvRows.map(({ amount, ...rest }) => rest), rows.map(({ amount, ...rest }) => rest));
});

test('test-only CSV reader handles BOM, quotes, commas, multiline fields and blank rows without type guessing', () => {
  const values = readFixtureCsv('\uFEFFDocument,Amount,Description\r\n0001,"1,234.56","say ""hello"""\r\n\r\n0002,-12.34,"line 1\nline 2"\r\n');
  assert.deepEqual(values, [
    ['Document', 'Amount', 'Description'], ['0001', '1,234.56', 'say "hello"'], [], ['0002', '-12.34', 'line 1\nline 2'],
  ]);
  assert.deepEqual(readFixtureCsv(''), []);
  assert.deepEqual(readFixtureCsv('\uFEFF'), []);
  assert.deepEqual(readFixtureCsv('a,b,\n'), [['a', 'b', '']]);
  assert.throws(() => readFixtureCsv('a,"unfinished'), /unterminated/);
  assert.throws(() => readFixtureCsv('a,"closed"garbage'), /malformed/);
});

test('test-only XLSX reader rejects a truncated archive instead of returning partial fixture rows', () => {
  assert.throws(() => readFixtureXlsx(fixtureBytes.subarray(0, fixtureBytes.length - 30)), /ZIP/);
  assert.throws(() => readFixtureXlsx(Buffer.from('not an xlsx file')), /ZIP/);
});
