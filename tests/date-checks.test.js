import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, utcWeekday } from '../src/checks/dates.js';
import { checkCalendar } from '../src/checks/calendar.js';
import { checkYears } from '../src/checks/years.js';

const row = (date, rowNumber = 2) => ({ rowNumber, documentNumber: `PV-${rowNumber}`, date, amount: -100 });
const rows = dates => dates.map((date, index) => row(date, index + 2));
const serial = (iso, date1904 = false) => {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const day = (Date.parse(`${iso}T00:00:00Z`) - epoch) / 86_400_000;
  return date1904 ? day : day + 1;
};

test('date parser normalizes Thai digits, BE, whitespace and day-first separators', () => {
  for (const date of ['๐๕/๐๑/๒๕๖๙', ' 05-01-2569\u200B ', '2569-01-05']) {
    const parsed = parseDate(date);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.iso, '2026-01-05');
    assert.equal(parsed.rawYear, 2569);
    assert.equal(parsed.system, 'be');
    assert.equal(parsed.converted, '2026-01-05');
  }
  assert.equal(parseDate('05/01/2026').system, 'ce');
  assert.equal(parseDate('2026-1-5').iso, '2026-01-05');
});

test('date parser rejects blank cells, short years, malformed and impossible years', () => {
  for (const date of [null, undefined, '', ' ', '\u200B']) assert.equal(parseDate(date).reason, 'ไม่พบวันที่');
  for (const date of ['05/01/26', '05/01/69', '05/01/๒๖']) {
    assert.equal(parseDate(date).valid, false);
    assert.match(parseDate(date).reason, /ไม่ครบ 4 หลัก/);
  }
  for (const date of ['2026/01/05', '05.01.2026', '1900-01-05', '2900-01-05', '2200-01-05', {}, true]) {
    assert.equal(parseDate(date).valid, false, String(date));
  }
});

test('date parser checks the real calendar, including BE leap years', () => {
  assert.equal(parseDate('29/02/2567').iso, '2024-02-29');
  assert.equal(parseDate('29/02/2569').valid, false);
  assert.equal(parseDate('31/04/2026').valid, false);
  assert.equal(parseDate('00/01/2026').valid, false);
  assert.equal(parseDate('01/13/2026').valid, false);
  assert.equal(parseDate('2000-02-29').valid, true);
  assert.equal(parseDate('2099-12-31').valid, true);
});

test('Excel serial dates support both epochs and fractional time without timezone shifts', () => {
  for (const date1904 of [false, true]) {
    const parsed = parseDate(serial('2026-01-03', date1904) + 0.75, { date1904 });
    assert.equal(parsed.iso, '2026-01-03');
    assert.equal(parsed.system, null);
  }
  for (const date of [-1, NaN, Infinity, 60, 60.9, 0, 1, 59]) assert.equal(parseDate(date).valid, false);
  assert.match(parseDate(60).reason, /สมมติ/);
  assert.equal(parseDate(new Date('2026-01-05T23:00:00Z')).iso, '2026-01-05');
  assert.equal(parseDate(new Date('invalid')).valid, false);
  assert.equal(utcWeekday('2026-01-03'), 6);
});

test('explicit year choices apply to written dates only', () => {
  assert.equal(parseDate('05/01/2569', { yearSystem: 'be' }).iso, '2026-01-05');
  assert.equal(parseDate('05/01/2569', { yearSystem: 'ce' }).valid, false);
  assert.equal(parseDate('05/01/2026', { yearSystem: 'be' }).valid, false);
  assert.equal(parseDate(serial('2026-01-05'), { yearSystem: 'be' }).iso, '2026-01-05');
});

test('calendar check empty input and no verified holiday table', () => {
  assert.equal(checkCalendar([]).count, 0);
  assert.deepEqual(checkCalendar([]).uncoveredYears, []);
  const checked = checkCalendar(rows(['05/01/2569', '2026-01-03', '2026-01-04', '05/01/26', '']));
  assert.equal(checked.count, 2);
  assert.equal(checked.weekendCount, 2);
  assert.equal(checked.holidayCount, 0);
  assert.equal(checked.invalidDateCount, 2);
  assert.deepEqual(checked.uncoveredYears, [2026]);
  assert.deepEqual(checked.flags.map(flag => flag.rowNumber), [3, 4]);
  assert.equal(checked.flags[0].amount, -100);
});

test('calendar check uses only verified real holiday dates and reports full-year coverage separately', () => {
  const holidays = {
    coverageYears: [{ year: 2026, verified: true, source: 'https://example.test/official-announcement' }, { year: 2025, verified: false, source: 'draft' }],
    holidays: [
      { date: '2026-01-05', name: 'Test verified fixture', source: 'https://example.test/official-announcement', verified: true },
      { date: '2026-01-03', name: 'Weekend fixture', source: 'https://example.test/official-announcement', verified: true },
      { date: '2026-01-06', name: 'Unverified', source: 'draft', verified: false },
      { date: '2026-01-07', name: 'Placeholder', source: 'draft', verified: true, placeholder: true },
      { date: '2026-01-08', name: 'No source', verified: true },
      { date: '2026-02-30', name: 'Impossible', source: 'draft', verified: true },
      { date: null, name: 'Placeholder', source: 'draft', verified: false }
    ]
  };
  const checked = checkCalendar(rows(['2026-01-03', '2569-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2027-01-04']), { holidays });
  assert.equal(checked.count, 2);
  assert.equal(checked.weekendCount, 1);
  assert.equal(checked.holidayCount, 2);
  assert.deepEqual(checked.coveredYears, [2026]);
  assert.deepEqual(checked.uncoveredYears, [2027]);
  assert.equal(checked.flags[0].holiday, true);
  assert.equal(checked.flags[0].weekend, true);
  assert.equal(checked.flags[1].normalizedDate, '2026-01-05');
  assert.deepEqual(checked.flags[1].holidaySources, ['https://example.test/official-announcement']);
  assert.deepEqual(checkCalendar([], { holidays: { coverageYears: [2026] } }).coveredYears, []);
  assert.deepEqual(checkCalendar([], { holidays: { coverageYears: [2026], coverageVerified: true } }).coveredYears, [2026]);
  assert.deepEqual(checkCalendar(rows(['2026-01-05']), { holidays: { holidays: holidays.holidays } }).uncoveredYears, [2026]);
  assert.equal(checkCalendar([], { holidays: null }).count, 0);
  assert.equal(checkCalendar([], { holidays: { holidays: [null], coverageYears: 'invalid' } }).count, 0);
});

test('calendar respects 1904 dates and shows source coverage when explicit selection is incompatible', () => {
  const checked = checkCalendar(rows([serial('2026-01-03', true)]), { date1904: true });
  assert.equal(checked.count, 1);
  assert.equal(checked.flags[0].normalizedDate, '2026-01-03');
  const incompatible = checkCalendar(rows(['2569-01-03']), { yearSystem: 'ce' });
  assert.equal(incompatible.count, 0);
  assert.equal(incompatible.invalidDateCount, 1);
  assert.deepEqual(incompatible.uncoveredYears, [2026]);
});

test('calendar does not treat empty or nontext source fields as verified holiday evidence', () => {
  const holidays = {
    coverageYears: [{ year: 2026, verified: true, source: '  ' }],
    holidays: [{ date: '2026-01-05', name: 'fixture', verified: true, source: '  ' }, { date: '2026-01-06', name: 'fixture', verified: true, source: 123 }],
  };
  const checked = checkCalendar(rows(['2026-01-05', '2026-01-06']), { holidays });
  assert.equal(checked.holidayCount, 0);
  assert.deepEqual(checked.coveredYears, []);
  assert.deepEqual(checked.uncoveredYears, [2026]);
});

test('year check empty, uniform and native dates do not invent mixtures', () => {
  assert.equal(checkYears([]).count, 0);
  const checked = checkYears(rows(['2569-01-05', '2569-01-06', serial('2026-01-07'), new Date('2026-01-08T00:00:00Z')]));
  assert.equal(checked.count, 0);
  assert.equal(checked.majoritySystem, 'be');
  assert.deepEqual(checked.systemCounts, { be: 2, ce: 0 });
  assert.equal(checkYears(rows(['2026-01-05', '2026-01-06'])).count, 0);
});

test('year check flags minority written years and preserves converted dates even for explicit selection', () => {
  for (const yearSystem of ['auto', 'be', 'ce']) {
    const checked = checkYears(rows(['2569-01-05', '2569-01-06', '๒๐๒๖-๐๑-๐๗']), { yearSystem });
    assert.equal(checked.count, 1);
    assert.equal(checked.mixedYearCount, 1);
    assert.equal(checked.flags[0].rowNumber, 4);
    assert.equal(checked.flags[0].dateSystem, 'ce');
    assert.equal(checked.flags[0].convertedDate, '2026-01-07');
    assert.equal(checked.minoritySystem, 'ce');
  }
  const reverse = checkYears(rows(['2026-01-05', '2026-01-06', '2569-01-07']));
  assert.equal(reverse.count, 1);
  assert.equal(reverse.minoritySystem, 'be');
});

test('year check ties flag both written systems; malformed dates are reported once', () => {
  const checked = checkYears(rows(['2569-01-05', '2026-01-06', '', '05/01/26', '1900-01-05', '2900-01-05', '2026-02-30']));
  assert.equal(checked.count, 7);
  assert.equal(checked.mixedYearCount, 2);
  assert.equal(checked.invalidDateCount, 5);
  assert.equal(checked.tied, true);
  assert.equal(checked.majoritySystem, null);
  assert.equal(new Set(checked.flags.map(flag => flag.rowNumber)).size, 7);
});
