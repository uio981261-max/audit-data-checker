import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRound } from '../src/checks/round.js';
import { checkHygiene } from '../src/checks/hygiene.js';

const row = (amount, rowNumber = 2, extra = {}) => ({ rowNumber, documentNumber: 'PV-001', date: '2026-01-01', amount, ...extra });

test('round: empty input and blank, zero, malformed values have no flags', () => {
  assert.equal(checkRound([]).count, 0);
  assert.equal(checkRound([row(''), row(null), row(0), row('๐'), row('1,00'), row(NaN)]).count, 0);
});

test('round: exact thresholds overlap without counting a row twice', () => {
  const checked = checkRound([row(1000, 2), row(-10000, 3), row('๒๐,๐๐๐', 4), row(1000.01, 5)]);
  assert.equal(checked.count, 3);
  assert.deepEqual(checked.countsByThreshold, { 1000: 3, 10000: 2 });
  assert.deepEqual(checked.flags[1].matchedThresholds, [1000, 10000]);
  assert.equal(checked.flags[1].cleanedAmount, -10000);
  assert.equal(checked.flags[2].rowNumber, 4);
});

test('round: configurable thresholds are positive, deduplicated, and cent-safe', () => {
  const checked = checkRound([row(0.3, 2), row(-0.6, 3), row(0.3001, 4), row(0.29, 5)], {
    thresholds: [0.1, '0.10', 0, -5, 'bad', 0.3],
  });
  assert.deepEqual(checked.thresholds, [0.1, 0.3]);
  assert.equal(checked.count, 2);
  assert.deepEqual(checked.countsByThreshold, { '0.1': 2, '0.3': 2 });
  assert.equal(checkRound([row(1000)], { thresholds: [] }).count, 0);
  assert.equal(checkRound([row(1000.001)]).count, 0);
  assert.equal(checkRound([row(Number.MIN_VALUE), row(1e-20)]).count, 0);
});

test('round: source rows are retained and not mutated', () => {
  const source = Object.freeze([Object.freeze(row(' 1,000 '))]);
  const checked = checkRound(source);
  assert.equal(checked.flags[0].amount, ' 1,000 ');
  assert.equal(source[0].amount, ' 1,000 ');
});

test('round: near-multiples are never accepted by a floating-point tolerance', () => {
  const checked = checkRound([
    row(10000000000, 2), row(10000000000.000002, 3),
    row('100000000000000000001', 4), row('100000000000000000000', 5),
  ], { thresholds: [1000] });
  assert.deepEqual(checked.flags.map(flag => flag.rowNumber), [2, 5]);
  assert.deepEqual(checked.countsByThreshold, { '1000': 2 });
  assert.deepEqual(checkRound([row(0.3, 6), row(0.30000000000000004, 7)], { thresholds: [0.1] }).flags.map(flag => flag.rowNumber), [6]);
});

test('round: scientific numeric values and sub-cent thresholds retain exact decimal ratios', () => {
  const checked = checkRound([row(3e-8, 2), row(-6e-8, 3), row(3.0000000000000004e-8, 4)], { thresholds: [1e-8, 3e-8] });
  assert.deepEqual(checked.flags.map(flag => flag.rowNumber), [2, 3]);
  assert.equal(checked.countsByThreshold[3e-8], 2);
});

test('hygiene: empty and clean numeric rows are not flagged', () => {
  assert.equal(checkHygiene([]).count, 0);
  assert.equal(checkHygiene([row(null), row(''), row(-123.45), row(0)]).count, 0);
});

test('hygiene: every numeric text amount is flagged, including negatives and Thai digits', () => {
  const checked = checkHygiene([row('123.45', 2), row('-123.45', 3), row('๑๒๓.๔๕', 4), row('(1,234.56)', 5)]);
  assert.equal(checked.count, 4);
  assert.equal(checked.countsByType.textNumber, 4);
  assert.equal(checked.countsByType.thaiDigits, 1);
  assert.equal(checked.countsByType.numberCommas, 1);
  assert.equal(checked.flags[1].cleanedValues.amount, -123.45);
  assert.equal(checked.flags[2].cleanedValues.amount, 123.45);
  assert.equal(checked.flags[3].cleanedValues.amount, -1234.56);
});

test('hygiene: NBSP, zero-width, edge spaces, and mapped text fields are inspected', () => {
  const source = row('\u00a01,๒๓๔.๕๖\u00a0', 7, {
    documentNumber: ' PV-\u200b001 ', description: 'note\uFEFF', account: '\u20601001',
  });
  const checked = checkHygiene([source]);
  assert.equal(checked.count, 1);
  assert.equal(checked.countsByType.edgeSpaces, 2);
  assert.equal(checked.countsByType.nonBreakingSpace, 1);
  assert.equal(checked.countsByType.zeroWidth, 3);
  assert.equal(checked.flags[0].cleanedValues.amount, 1234.56);
  assert.equal(checked.flags[0].cleanedValues.documentNumber, 'PV-001');
  assert.equal(checked.flags[0].cleanedValues.description, 'note');
  assert.equal(checked.flags[0].cleanedValues.account, '1001');
  assert.equal(checked.flags[0].rowNumber, 7);
  assert.equal(source.amount, '\u00a01,๒๓๔.๕๖\u00a0');
});

test('hygiene: malformed amounts are explained and not silently converted', () => {
  const checked = checkHygiene([row('1,00', 2), row('12 34', 3), row('amount', 4), row('  ', 5)]);
  assert.equal(checked.count, 4);
  assert.equal(checked.countsByType.invalidAmount, 3);
  assert.equal(checked.countsByType.textNumber, undefined);
  assert.equal(checked.flags[0].cleanedValues.amount, '1,00');
  assert.equal(checked.flags[3].cleanedValues.amount, '');
});

test('hygiene: format controls cleaned by other checks are also visibly reported', () => {
  const checked = checkHygiene([row('1\u200e0,0\u206300', 2, { documentNumber: 'PV-\u00ad001', date: '2026-01-\u202a05' })]);
  assert.equal(checked.countsByType.zeroWidth, 3);
  assert.equal(checked.flags[0].cleanedValues.amount, 10000);
  assert.equal(checked.flags[0].cleanedValues.documentNumber, 'PV-001');
  assert.equal(checked.flags[0].cleanedValues.date, '2026-01-05');
  assert.equal(checked.countsByType.textNumber, 1);
});
