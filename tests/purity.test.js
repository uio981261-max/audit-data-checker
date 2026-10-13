import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../src/run-checks.js';

test('all eight checks retain frozen source records and options and return JSON-serializable review results', () => {
  const rows = Object.freeze([
    Object.freeze({ rowNumber: 2, documentNumber: ' PV-๐๐๑ ', date: '๒๕๖๙-๐๒-๐๗', amount: ' (1,000.00) ', description: 'fictional', account: '1001' }),
    Object.freeze({ rowNumber: 8, documentNumber: 'pv-1', date: '2026-02-02', amount: 2000, description: '', account: '' }),
    Object.freeze({ rowNumber: 9, documentNumber: 'PV-9007199254741000', date: '', amount: '', description: '', account: '' }),
  ]);
  const options = Object.freeze({ thresholds: Object.freeze([1000, 10000]), expectedRows: 3, expectedAmount: 1000, yearSystem: 'auto', sourceMeta: Object.freeze({ readRows: 3, physicalRows: 9 }), holidays: Object.freeze({ coverageYears: Object.freeze([]), holidays: Object.freeze([]) }) });
  const before = JSON.stringify({ rows, options });
  const first = runChecks(rows, options);
  assert.equal(first.length, 8);
  assert.equal(JSON.stringify({ rows, options }), before);
  assert.equal(JSON.stringify(first), JSON.stringify(runChecks(rows, options)));
  assert.equal(first.find(item => item.id === 'duplicates').groupCount, 1);
  assert.equal(first.find(item => item.id === 'sequence').missingCount, '9007199254740998');
  assert.equal(first.find(item => item.id === 'completeness').amountSum, 1000);
  assert.equal(runChecks([]).every(item => item.count === 0), true);
});
