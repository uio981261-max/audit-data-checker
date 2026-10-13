import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDuplicates, normalizeDocumentNumber } from '../src/checks/duplicates.js';
import { checkSequence, parseDocumentSequence } from '../src/checks/sequence.js';

const rows = documents => documents.map((documentNumber, index) => ({ rowNumber: index + 2, documentNumber, date: '', amount: -100, description: '', account: '' }));

test('document checks accept empty input', () => {
  assert.equal(checkDuplicates([]).count, 0);
  assert.equal(checkSequence([]).count, 0);
  assert.equal(checkSequence([]).missingCount, 0);
});

test('duplicates normalize case, digit runs, whitespace, Thai digits and invisible characters', () => {
  const input = rows([' PV-๒๕๖๙-๐๐๐๑\u200B ', 'pv-2569-1', 'PV-2569-0001', 'X  0002', ' x\u00A02 ', 'different']);
  const snapshot = structuredClone(input);
  const found = checkDuplicates(input);
  assert.equal(found.count, 5);
  assert.equal(found.groupCount, 2);
  assert.deepEqual(found.groups[0].rowNumbers, [2, 3, 4]);
  assert.equal(found.groups[0].normalized, 'pv-2569-1');
  assert.equal(found.groups[0].rawDiffered, true);
  assert.equal(found.flags[0].amount, -100);
  assert.deepEqual(input, snapshot);
});

test('all duplicate rows are flagged while blank identifiers are excluded', () => {
  const found = checkDuplicates(rows(['A', 'A', 'A', '', ' ', null, undefined]));
  assert.equal(found.count, 3);
  assert.equal(found.groups[0].rawDiffered, false);
  assert.equal(found.flags.length, 3);
});

test('zero and negative document values normalize without discarding sign', () => {
  assert.equal(normalizeDocumentNumber('000'), '0');
  assert.equal(normalizeDocumentNumber('-0001'), '-1');
  assert.equal(normalizeDocumentNumber('\uFEFF A\u200E-0001 \u2060'), 'a-1');
  assert.equal(normalizeDocumentNumber('\u200E A-0001 \u200E'), 'a-1');
  const found = checkDuplicates(rows([0, '๐๐๐', '-0001', '-1', '1']));
  assert.equal(found.count, 4);
  assert.equal(found.groupCount, 2);
  assert.equal(found.groups[0].rawDiffered, true);
});

test('sequence finds compact gaps per prefix and retains source row numbers', () => {
  const input = rows(['PV-2569-0004', 'pv-2569-0001', 'PV-2569-0001', 'RV-01', 'RV-03', 'PV-2570-0001', 'PV-2570-0002']);
  const snapshot = structuredClone(input);
  const found = checkSequence(input);
  assert.equal(found.count, 2);
  assert.equal(found.missingCount, 3);
  assert.deepEqual(found.flags[0].rowNumbers, [3, 2]);
  assert.equal(found.flags[0].missingFrom, '2');
  assert.equal(found.flags[0].missingTo, '3');
  assert.equal(found.flags[0].beforeRow, 3);
  assert.equal(found.flags[0].afterRow, 2);
  assert.deepEqual(input, snapshot);
});

test('sequence accepts Thai suffixes and plain integer documents', () => {
  const found = checkSequence(rows(['๐๐๑', '๐๐๓', 'ใบ-๐๐๑', 'ใบ-๐๐๔']));
  assert.equal(found.count, 2);
  assert.equal(found.missingCount, 3);
  assert.equal(found.flags[1].prefix, 'ใบ-');
  assert.deepEqual(parseDocumentSequence('ABC0009'), { prefix: 'abc', number: 9n });
});

test('sequence skips blanks, negative and fractional numeric documents', () => {
  const found = checkSequence(rows(['', null, undefined, -1, '-0003', '1.5', 'ABC', '+0001', '+0002', 1.5]));
  assert.equal(found.count, 0);
  assert.equal(found.skippedCount, 5);
  assert.equal(found.unsafeNumericCount, 0);
  assert.equal(found.groups[0].uniqueCount, 2);
  assert.equal(parseDocumentSequence(-2), null);
});

test('duplicate-only sequence does not create gaps or boundary missing numbers', () => {
  const found = checkSequence(rows(['D-8', 'd-0008', 'D-8']));
  assert.equal(found.count, 0);
  assert.equal(found.missingCount, 0);
  assert.equal(found.groups[0].uniqueCount, 1);
});

test('giant gaps are one exact serializable range without expanding missing numbers', () => {
  const found = checkSequence(rows(['1', '100000000000000000000']));
  assert.equal(found.count, 1);
  assert.equal(found.missingCount, '99999999999999999998');
  assert.equal(found.flags[0].missingFrom, '2');
  assert.equal(found.flags[0].missingTo, '99999999999999999999');
  assert.doesNotThrow(() => JSON.stringify(found));
});

test('string suffixes above the safe integer limit are exact; unsafe numeric cells are skipped', () => {
  const found = checkSequence(rows(['L-9007199254740993', 'L-9007199254740995', 9007199254740992]));
  assert.equal(found.count, 1);
  assert.equal(found.missingCount, 1);
  assert.equal(found.flags[0].missingFrom, '9007199254740994');
  assert.equal(found.unsafeNumericCount, 1);
  assert.equal(found.messages.length, 2);
});
