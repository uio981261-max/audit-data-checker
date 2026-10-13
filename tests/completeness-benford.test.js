import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCompleteness } from '../src/checks/completeness.js';
import { checkBenford } from '../src/checks/benford.js';

const row = (amount, rowNumber = 2) => ({ rowNumber, amount });
const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) < tolerance);

test('completeness: empty input with absent or zero controls is complete', () => {
  const absent = checkCompleteness([]);
  assert.equal(absent.count, 0);
  assert.equal(absent.hasControls, false);
  assert.equal(absent.rowCount, 0);
  assert.equal(absent.amountSum, 0);
  const controlled = checkCompleteness([], { expectedRows: 0, expectedAmount: 0 });
  assert.equal(controlled.count, 0);
  assert.equal(controlled.hasControls, true);
  assert.equal(controlled.comparisons.rowCount.matches, true);
  assert.equal(controlled.comparisons.amount.matches, true);
});

test('completeness: sums signed and cleaned Thai/text amounts at currency precision', () => {
  const checked = checkCompleteness([row(0.1), row(0.2), row(-100), row('๑,๒๓๔.๕๖')], {
    expectedRows: '๔', expectedAmount: '1,134.86',
  });
  assert.equal(checked.count, 0);
  assert.equal(checked.amountSum, 1134.86);
  assert.equal(checked.validAmountCount, 4);
  assert.equal(checked.invalidAmountCount, 0);
});

test('completeness: zero controls remain meaningful and mismatch flags are aggregate', () => {
  const checked = checkCompleteness([row(-1.25)], { expectedRows: 0, expectedAmount: 0 });
  assert.equal(checked.count, 2);
  assert.deepEqual(checked.comparisons.rowCount, { actual: 1, expected: 0, difference: 1, matches: false });
  assert.equal(checked.comparisons.amount.difference, -1.25);
  assert.ok(checked.flags.every(flag => !('rowNumber' in flag)));
});

test('completeness: blank and invalid amounts are excluded and explicitly warned', () => {
  const checked = checkCompleteness([row(null), row(''), row('1,00'), row(-5), row(0)], { expectedRows: 5, expectedAmount: -5 });
  assert.equal(checked.count, 1);
  assert.equal(checked.amountSum, -5);
  assert.equal(checked.invalidAmountCount, 3);
  assert.equal(checked.flags[0].code, 'invalidAmounts');
  assert.equal(checked.comparisons.amount.matches, true);
});

test('completeness: malformed controls cannot appear to match', () => {
  const checked = checkCompleteness([], { expectedRows: '2.5', expectedAmount: 'not an amount' });
  assert.deepEqual(checked.flags.map(flag => flag.code), ['invalidRowControl', 'invalidAmountControl']);
  assert.deepEqual(checked.comparisons, {});
});

test('completeness: Excel row cap and evidence of truncation are warned', () => {
  const checked = checkCompleteness([row(100)], { sourceMeta: { declaredRows: 1048576, readRows: 1 } });
  assert.deepEqual(checked.flags.map(flag => flag.code), ['excelLimit', 'possibleTruncation']);
  // Worksheet extent includes headers/blanks, unlike the loaded data row count.
  assert.equal(checkCompleteness([row(100)], { sourceMeta: { physicalRows: 3, readRows: 1 } }).count, 0);
  assert.equal(checkCompleteness([row(100)], { sourceMeta: { looksTruncated: true } }).flags[0].code, 'possibleTruncation');
  assert.equal(checkCompleteness([row(100)], { sourceMeta: { physicalRows: 1, readRows: 1, declaredRows: 1 } }).count, 0);
});

test('completeness: exact decimals round the final aggregate once with symmetric signed halves', () => {
  for (const [amount, expected] of [['10000.005', 10000.01], ['-10000.005', -10000.01], ['1.005', 1.01], ['-1.005', -1.01]]) {
    const checked = checkCompleteness([row(amount)], { expectedAmount: expected });
    assert.equal(checked.amountSum, expected);
    assert.equal(checked.comparisons.amount.matches, true);
  }
  assert.equal(checkCompleteness([row('0.004'), row('0.004')]).amountSum, 0.01);
  assert.equal(checkCompleteness([row('0.004'), row('-0.004')]).amountSum, 0);
});

test('completeness: unsafe monetary aggregates cannot appear to match control totals', () => {
  const checked = checkCompleteness([row(1e308), row(1e308)], { expectedAmount: 0 });
  assert.equal(checked.amountSum, null);
  assert.equal(checked.comparisons.amount.difference, null);
  assert.equal(checked.comparisons.amount.matches, false);
  assert.equal(checked.comparisons.amount.available, false);
  assert.deepEqual(checked.flags.map(flag => flag.code), ['amountSumOutOfRange', 'amountComparisonOutOfRange']);
  assert.doesNotThrow(() => JSON.stringify(checked));
  // Exact decimal cancellation remains available even when intermediate float sums overflow.
  assert.equal(checkCompleteness([row(1e308), row(1e308), row(-1e308), row(-1e308)]).amountSum, 0);
  assert.equal(checkCompleteness([], { expectedAmount: '1e999' }).flags[0].code, 'invalidAmountControl');
  assert.equal(checkCompleteness([], { expectedRows: Number.MAX_SAFE_INTEGER + 1 }).flags[0].code, 'invalidRowControl');
});

test('benford: empty, blanks, zeros, and invalid amounts are skipped', () => {
  assert.equal(checkBenford([]).skipped, true);
  const checked = checkBenford([row(null), row(''), row(0), row('๐'), row(NaN), row('1,00')]);
  assert.equal(checked.usableCount, 0);
  assert.equal(checked.excludedCount, 6);
  assert.equal(checked.skipped, true);
  assert.equal(checked.count, 0);
  assert.equal(checked.distribution.length, 9);
  assert.ok(checked.distribution.every(item => item.observed === 0));
  near(checked.distribution.reduce((sum, item) => sum + item.expected, 0), 1);
});

test('benford: first significant digit handles negatives, decimals, Thai text, and scientific numbers', () => {
  const checked = checkBenford([row(-123), row(0.00234), row('๓,๔๕๖.๗๘'), row(4e21), row(5e-324), row('0.0067'), row(-7e-8), row(800), row(9.1)]);
  assert.equal(checked.usableCount, 9);
  assert.ok(checked.distribution.every(item => item.count === 1));
  assert.equal(checked.skipped, true);
  assert.equal(checked.count, 0);
});

test('benford: exactly 300 usable amounts shows a distribution without row conclusions', () => {
  const rows = Array.from({ length: 300 }, (_, index) => row(index % 2 ? -100 : '๑๐๐', index + 2));
  const checked = checkBenford(rows);
  assert.equal(checked.usableCount, 300);
  assert.equal(checked.skipped, false);
  assert.equal(checked.distribution[0].count, 300);
  assert.equal(checked.distribution[0].observed, 1);
  near(checked.distribution[0].expected, Math.log10(2));
  assert.deepEqual(checked.flags, []);
  assert.match(checked.note, /สอบถามเพิ่มเติม/);
  assert.equal(checkBenford(rows.slice(1)).skipped, true);
});

test('benford: accepted large decimal text retains its original significant digit', () => {
  const checked = checkBenford([row('99999999999999999999'), row('-0.00000000000000000009999999999999999999')]);
  assert.equal(checked.usableCount, 2);
  assert.equal(checked.distribution[8].count, 2);
  assert.equal(checked.distribution[0].count, 0);
});
