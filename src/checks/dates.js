import { cleanText } from './utils.js';

const DAY_MS = 86_400_000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

function invalid(reason, details = {}) {
  return { valid: false, iso: null, year: null, rawYear: null, system: null, converted: null, reason, ...details };
}

function validDate(year, month, day, details = {}) {
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return invalid('ปีอยู่นอกช่วงที่รองรับ (ค.ศ. 2000–2099)', { ...details, year });
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return invalid('วันที่ไม่มีอยู่จริงในปฏิทิน', { ...details, year });
  }
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { valid: true, iso, year, rawYear: null, system: null, reason: '', converted: iso, ...details };
}

/**
 * Parse accounting dates without using the host timezone or guessing short years.
 * yearSystem applies only to written years; Excel serials and Date objects already
 * represent Gregorian dates. The supported review window is CE 2000–2099.
 */
export function parseDate(value, { yearSystem = 'auto', date1904 = false } = {}) {
  if (value === null || value === undefined || (typeof value === 'string' && !cleanText(value))) {
    return invalid('ไม่พบวันที่');
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return invalid('วันที่ไม่ถูกต้อง');
    return validDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), { source: 'date' });
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return invalid('เลขวันที่ Excel ไม่ถูกต้อง', { source: 'serial' });
    const days = Math.floor(value);
    // Excel's 1900 date system contains a fictional 29 February 1900.
    if (!date1904 && days === 60) return invalid('เลขวันที่ Excel 60 เป็นวันที่สมมติ 29/02/1900', { source: 'serial' });
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const offset = !date1904 && days > 60 ? days - 1 : days;
    const date = new Date(epoch + offset * DAY_MS);
    if (!Number.isFinite(date.getTime())) return invalid('เลขวันที่ Excel ไม่ถูกต้อง', { source: 'serial' });
    return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), { source: 'serial' });
  }
  if (typeof value !== 'string') return invalid('รูปแบบวันที่ไม่รองรับ');
  const text = cleanText(value);
  let yearText;
  let month;
  let day;
  // Require an unambiguous year-first date, or a day-first date.
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dayMatch = /^(\d{1,2})([/-])(\d{1,2})\2(\d{1,4})$/.exec(text);
  if (isoMatch) {
    yearText = isoMatch[1]; month = Number(isoMatch[2]); day = Number(isoMatch[3]);
  } else if (dayMatch) {
    yearText = dayMatch[4]; month = Number(dayMatch[3]); day = Number(dayMatch[1]);
  } else {
    return invalid('รูปแบบวันที่ไม่รองรับ: ใช้ YYYY-MM-DD หรือ DD/MM/YYYY หรือ DD-MM-YYYY', { source: 'string' });
  }
  const rawYear = Number(yearText);
  const system = rawYear > 2400 ? 'be' : rawYear < 2100 ? 'ce' : null;
  const details = { rawYear, system, source: 'string' };
  if (yearText.length < 4) return invalid('ปีที่มีไม่ครบ 4 หลักไม่ชัดเจน กรุณาตรวจสอบปีเต็มจากต้นทาง', details);
  const chosenSystem = ['be', 'ce'].includes(yearSystem) ? yearSystem : system;
  if (!chosenSystem) return invalid('ปีไม่อยู่ในช่วง พ.ศ. หรือ ค.ศ. ที่รองรับ', details);
  const year = chosenSystem === 'be' ? rawYear - 543 : rawYear;
  return validDate(year, month, day, details);
}

export function utcWeekday(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
