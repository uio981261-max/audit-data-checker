import { decimalParts, flagRow, parseAmount, result } from './utils.js';

function isMultiple(amountParts, thresholdParts) {
  const scale = Math.max(amountParts.scale, thresholdParts.scale);
  const amount = amountParts.integer * 10n ** BigInt(scale - amountParts.scale);
  const threshold = thresholdParts.integer * 10n ** BigInt(scale - thresholdParts.scale);
  return amount !== 0n && amount % threshold === 0n;
}

/** Flag nonzero exact multiples, counting a row once even if thresholds overlap. */
export function checkRound(rows, { thresholds = [1000, 10000] } = {}) {
  const usableThresholds = [...new Set((Array.isArray(thresholds) ? thresholds : [])
    .map(parseAmount).filter(value => value !== null && value > 0))];
  const countsByThreshold = Object.fromEntries(usableThresholds.map(value => [value, 0]));
  const thresholdParts = usableThresholds.map(decimalParts);
  const flags = [];
  let validAmountCount = 0;
  for (const row of rows) {
    const amount = parseAmount(row.amount);
    if (amount === null) continue;
    validAmountCount += 1;
    if (amount === 0) continue;
    const amountParts = decimalParts(row.amount);
    const matchedThresholds = usableThresholds.filter((threshold, index) => isMultiple(amountParts, thresholdParts[index]));
    if (!matchedThresholds.length) continue;
    for (const threshold of matchedThresholds) countsByThreshold[threshold] += 1;
    flags.push(flagRow(row, `จำนวนเงินเป็นจำนวนเท่าของ ${matchedThresholds.map(value => value.toLocaleString('th-TH')).join(' และ ')}`, {
      cleanedAmount: amount,
      matchedThresholds,
    }));
  }
  return result('round', flags, { thresholds: usableThresholds, countsByThreshold, validAmountCount });
}
