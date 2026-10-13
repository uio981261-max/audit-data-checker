import { CHECK_INFO } from './check-info.js';
import { FIELD_LABELS } from './loader.js';

const SHEETS = { duplicates: 'Duplicate documents', sequence: 'Sequence gaps', calendar: 'Weekend and holidays', round: 'Round amounts', hygiene: 'Text and characters', years: 'Date and year systems', completeness: 'Control totals', benford: 'Benford' };
const printable = value => value instanceof Date ? value.toISOString() : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value;

export function buildReport(results, context, XLSX = globalThis.XLSX) {
  const book = XLSX.utils.book_new();
  const summary = [
    ['Audit Data Checker — รายงานรายการที่ควรสอบทาน'],
    ['ผลตรวจเป็นข้อสังเกตเพื่อสอบทาน ไม่ใช่ข้อสรุปว่ารายการผิดหรือมีการทุจริต'],
    ['ข้อมูลของคุณถูกประมวลผลในเบราว์เซอร์เท่านั้น ไม่ถูกส่งออกไปที่ใด'],
    ['ไฟล์ต้นฉบับ', context.sourceName], ['แผ่นงานต้นฉบับ', context.sheetName],
    ['วันเวลาจัดทำ (UTC)', context.generatedAt || new Date().toISOString()],
    ['จำนวนรายการที่โหลด', context.rowCount], ['แถวหัวคอลัมน์ต้นฉบับ', context.headerRowNumber],
    ['ระบบปีที่เลือก', { auto: 'ตรวจหาอัตโนมัติ', be: 'พ.ศ.', ce: 'ค.ศ.' }[context.options.yearSystem]],
    ['ยอดควบคุมจำนวนแถว', context.options.expectedRows ?? 'ไม่ได้ระบุ'],
    ['ยอดควบคุมจำนวนเงิน', context.options.expectedAmount ?? 'ไม่ได้ระบุ'],
    ['เกณฑ์จำนวนเงินกลม', context.options.thresholds.join(', ')],
    ['หมายเหตุเลขแถว', 'เลขแถวอ้างอิง worksheet/ข้อความต้นฉบับก่อนข้ามแถวว่าง'],
    [], ['การจับคู่คอลัมน์', 'ชื่อคอลัมน์ต้นฉบับ'],
    ...Object.entries(context.mappingHeaders || {}).map(([field, header]) => [FIELD_LABELS[field] || field, header]),
    [], ['การตรวจ', 'จำนวนที่ควรสอบทาน', 'หน่วย / หมายเหตุ'],
    ...results.map(item => [CHECK_INFO[item.id].title, item.count, item.id === 'sequence' ? `ช่วงที่ไม่พบ; รวม ${item.missingCount} เลข` : item.id === 'completeness' ? 'ข้อสังเกตระดับชุดข้อมูล' : item.id === 'benford' ? item.message : 'แถว (หลายประเภทอาจครอบคลุมแถวเดียวกัน)']),
  ];
  const calendar = results.find(item => item.id === 'calendar');
  summary.push([], ['ตารางวันหยุดครอบคลุมปี ค.ศ.', calendar.coveredYears.join(', ') || 'ยังไม่มีปีที่ยืนยันแล้ว'], ['ปีข้อมูลที่ยังไม่ครอบคลุม', calendar.uncoveredYears.join(', ') || 'ไม่มี']);
  for (const item of results) {
    for (const message of [...(item.warnings || []), ...(item.messages || [])]) summary.push([CHECK_INFO[item.id].title, message]);
  }
  const controls = results.find(item => item.id === 'completeness');
  summary.push(['ยอดรวมจำนวนเงินที่อ่านได้', controls.amountSum ?? 'เกินช่วงที่แสดงได้แน่นอน'], ['จำนวนเงินที่อ่านไม่ได้', controls.invalidAmountCount]);
  const append = (rows, name) => {
    // AOA string cells are stored as literal strings, never spreadsheet formulas.
    const sheet = XLSX.utils.aoa_to_sheet(rows.map(row => row.map(printable)));
    sheet['!cols'] = Array.from({ length: rows.reduce((max, row) => Math.max(max, row.length), 0) }, (_, i) => ({ wch: i === 0 ? 24 : 30 }));
    XLSX.utils.book_append_sheet(book, sheet, name);
  };
  append(summary, 'Summary');
  for (const item of results) {
    let rows = [['แถวต้นฉบับ', 'เลขที่เอกสารเดิม', 'วันที่เดิม', 'จำนวนเงินเดิม', 'คำอธิบายเดิม', 'บัญชีเดิม', 'เหตุผล', 'ค่าที่ทำความสะอาด / วันที่แปลง', 'รายละเอียดเพิ่มเติม']];
    if (item.id === 'benford') {
      rows = [[item.message], [item.note], ['เลขหลักแรก', 'จำนวน', 'สัดส่วนที่พบ', 'สัดส่วนตาม Benford'], ...item.distribution.map(d => [d.digit, d.count, d.observed, d.expected])];
    } else {
      if (item.id === 'completeness') rows.push(['ระดับชุดข้อมูล', '', '', controls.amountSum, '', '', `โหลด ${controls.rowCount} แถว; จำนวนเงินอ่านไม่ได้ ${controls.invalidAmountCount} แถว`, '', controls.comparisons]);
      for (const flag of item.flags) {
        const { rowNumber, documentNumber, date, amount, description, account, reason, cleanedValues, convertedDate, cleanedAmount, ...details } = flag;
        rows.push([rowNumber ?? 'ระดับชุดข้อมูล', documentNumber, date, amount, description, account, reason, cleanedValues ?? convertedDate ?? cleanedAmount ?? '', details]);
      }
      if (!item.flags.length) rows.push(['', '', '', '', '', '', item.id === 'completeness' && !controls.hasControls ? 'ยังไม่ได้ระบุยอดควบคุมจากต้นทาง' : 'ไม่พบรายการตามเงื่อนไขที่ตรวจ']);
      if (item.countsByThreshold) rows.push([], ['เกณฑ์', 'จำนวนแถว'], ...Object.entries(item.countsByThreshold));
      for (const warning of item.warnings || []) rows.push(['', '', '', '', '', '', warning]);
    }
    append(rows, SHEETS[item.id]);
  }
  return book;
}

export function downloadReport(results, context, XLSX = globalThis.XLSX) {
  const workbook = buildReport(results, context, XLSX);
  XLSX.writeFile(workbook, `audit-review-${new Date().toISOString().slice(0, 10)}.xlsx`, { bookType: 'xlsx', compression: true });
}
