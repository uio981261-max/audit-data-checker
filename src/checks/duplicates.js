import { cleanText, flagRow, result } from './utils.js';

// Normalize each digit run, so PV-0001 and pv-1 can be reviewed together.
// Blank identifiers are excluded rather than treated as one duplicate group.
export function normalizeDocumentNumber(value) {
  return cleanText(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\d+/g, digits => digits.replace(/^0+(?=\d)/, ''));
}

export function checkDuplicates(rows = []) {
  const buckets = new Map();
  for (const row of rows) {
    const normalized = normalizeDocumentNumber(row.documentNumber);
    if (!normalized) continue;
    if (!buckets.has(normalized)) buckets.set(normalized, []);
    buckets.get(normalized).push(row);
  }

  const groups = [];
  const flags = [];
  for (const [normalized, groupRows] of buckets) {
    if (groupRows.length < 2) continue;
    const rawDiffered = groupRows.some(row => !Object.is(row.documentNumber, groupRows[0].documentNumber));
    const rowNumbers = groupRows.map(row => row.rowNumber);
    const group = { normalized, rows: [...groupRows], rowNumbers, rawDiffered };
    groups.push(group);
    const reason = `หมายเลขเอกสารตรงกันหลังปรับรูปแบบ (${normalized}) พบ ${groupRows.length} รายการ${rawDiffered ? ' และค่าต้นฉบับมีรูปแบบต่างกัน' : ''} ควรสอบทานกับเอกสารต้นทาง`;
    for (const row of groupRows) flags.push(flagRow(row, reason, { normalized, rawDiffered, groupRowNumbers: [...rowNumbers] }));
  }

  return result('duplicates', flags, { groups, groupCount: groups.length });
}
