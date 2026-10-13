import { flagRow, result } from './utils.js';
import { parseDate } from './dates.js';

/** Detect written-year mixtures even when the user explicitly selects a calendar system. */
export function checkYears(rows, { yearSystem = 'auto', date1904 = false } = {}) {
  const parsedRows = rows.map(row => ({ row, parsed: parseDate(row.date, { yearSystem: 'auto', date1904 }) }));
  const systemCounts = { be: 0, ce: 0 };
  for (const { parsed } of parsedRows) {
    if (parsed.valid && parsed.system) systemCounts[parsed.system] += 1;
  }
  const mixed = systemCounts.be > 0 && systemCounts.ce > 0;
  const tied = mixed && systemCounts.be === systemCounts.ce;
  const majoritySystem = tied || (!systemCounts.be && !systemCounts.ce) ? null : systemCounts.be > systemCounts.ce ? 'be' : 'ce';
  const minoritySystem = mixed && !tied ? (majoritySystem === 'be' ? 'ce' : 'be') : null;
  const flags = [];
  let invalidDateCount = 0;
  let mixedYearCount = 0;
  for (const { row, parsed } of parsedRows) {
    let reason = '';
    if (!parsed.valid) {
      invalidDateCount += 1;
      reason = parsed.reason;
    } else if (mixed && (tied || parsed.system === minoritySystem)) {
      mixedYearCount += 1;
      reason = tied
        ? 'พบปี พ.ศ. และ ค.ศ. ในจำนวนเท่ากัน กรุณาตรวจสอบระบบปีของคอลัมน์'
        : `ปีใช้ระบบ ${parsed.system === 'be' ? 'พ.ศ.' : 'ค.ศ.'} ซึ่งเป็นส่วนน้อยในคอลัมน์ที่ใช้ ${majoritySystem === 'be' ? 'พ.ศ.' : 'ค.ศ.'} เป็นส่วนใหญ่`;
    }
    if (reason) flags.push(flagRow(row, reason, {
      rawYear: parsed.rawYear,
      dateSystem: parsed.system,
      normalizedDate: parsed.iso,
      convertedDate: parsed.converted,
      validDate: parsed.valid
    }));
  }
  return result('years', flags, { systemCounts, majoritySystem, minoritySystem, mixed, tied, invalidDateCount, mixedYearCount, yearSystem });
}
