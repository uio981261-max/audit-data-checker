import { flagRow, result } from './utils.js';
import { parseDate, utcWeekday } from './dates.js';

const hasSource = entry => typeof entry?.source === 'string' && entry.source.trim().length > 0;

function verifiedCoverage(table) {
  const entries = Array.isArray(table?.coverageYears) ? table.coverageYears : [];
  const years = entries.flatMap(entry => {
    if (typeof entry === 'number' && table.coverageVerified === true) return [entry];
    if (entry && typeof entry === 'object' && entry.verified === true && hasSource(entry)) return [entry.year];
    return [];
  });
  return [...new Set(years.filter(year => Number.isInteger(year) && year >= 2000 && year <= 2099))].sort((a, b) => a - b);
}

/** Only explicitly verified holidays are checked; coverage means a verified full-year list. */
export function checkCalendar(rows, { holidays = {}, yearSystem = 'auto', date1904 = false } = {}) {
  const holidayMap = new Map();
  const entries = Array.isArray(holidays?.holidays) ? holidays.holidays : [];
  for (const holiday of entries) {
    if (!holiday || holiday.verified !== true || holiday.placeholder === true || !hasSource(holiday) || typeof holiday.date !== 'string') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday.date)) continue;
    const parsed = parseDate(holiday.date, { yearSystem: 'ce' });
    if (!parsed.valid) continue;
    const values = holidayMap.get(parsed.iso) ?? [];
    values.push(holiday);
    holidayMap.set(parsed.iso, values);
  }
  const flags = [];
  const dataYearSet = new Set();
  let invalidDateCount = 0;
  let weekendCount = 0;
  let holidayCount = 0;
  for (const row of rows) {
    // Coverage describes source years even when an explicit selector conflicts.
    const automatic = parseDate(row.date, { yearSystem: 'auto', date1904 });
    if (automatic.valid) dataYearSet.add(automatic.year);
    const parsed = parseDate(row.date, { yearSystem, date1904 });
    if (!parsed.valid) { invalidDateCount += 1; continue; }
    dataYearSet.add(parsed.year);
    const weekday = utcWeekday(parsed.iso);
    const weekend = weekday === 0 || weekday === 6;
    const matches = holidayMap.get(parsed.iso) ?? [];
    if (!weekend && !matches.length) continue;
    const reasons = [];
    if (weekend) { weekendCount += 1; reasons.push(weekday === 6 ? 'ลงรายการวันเสาร์' : 'ลงรายการวันอาทิตย์'); }
    if (matches.length) { holidayCount += 1; reasons.push(`ลงรายการวันหยุดตามตารางที่ยืนยันแล้ว: ${matches.map(item => item.name).join(', ')}`); }
    flags.push(flagRow(row, reasons.join(' / '), {
      normalizedDate: parsed.iso,
      convertedDate: parsed.iso,
      weekend,
      holiday: matches.length > 0,
      holidayNames: matches.map(item => item.name),
      holidaySources: matches.map(item => item.source)
    }));
  }
  const coveredYears = verifiedCoverage(holidays);
  const dataYears = [...dataYearSet].sort((a, b) => a - b);
  const uncoveredYears = dataYears.filter(year => !coveredYears.includes(year));
  const warnings = [];
  if (uncoveredYears.length) warnings.push(`ตารางวันหยุดยังไม่ครอบคลุมปี ค.ศ. ${uncoveredYears.join(', ')} ที่ยืนยันแล้ว ผลตรวจวันหยุดอาจไม่ครบถ้วน`);
  if (!coveredYears.length) warnings.push('ยังไม่มีตารางวันหยุดครบปีที่ยืนยันจากประกาศทางการ ขณะนี้ตรวจวันเสาร์/อาทิตย์ได้');
  if (invalidDateCount) warnings.push(`มี ${invalidDateCount} รายการที่อ่านวันที่ไม่ได้ตามระบบปีที่เลือก กรุณาดูผลตรวจระบบปี/วันที่`);
  return result('calendar', flags, { coveredYears, uncoveredYears, dataYears, invalidDateCount, weekendCount, holidayCount, warnings });
}
