import { cleanText } from './checks/utils.js';

export const FIELD_LABELS = {
  documentNumber: 'เลขที่เอกสาร', date: 'วันที่ลงบัญชี', amount: 'จำนวนเงิน',
  description: 'คำอธิบาย (ไม่บังคับ)', account: 'บัญชี (ไม่บังคับ)',
};
const ALIASES = {
  documentNumber: ['เลขที่เอกสาร', 'หมายเลขเอกสาร', 'เลขที่ใบสำคัญ', 'เลขที่ใบแจ้งหนี้', 'เลขที่', 'documentnumber', 'documentno', 'docno', 'voucherno', 'voucher', 'invoiceno', 'invoicenumber'],
  date: ['วันที่ลงบัญชี', 'วันที่บันทึก', 'วันที่', 'postingdate', 'documentdate', 'date', 'invoicedate'],
  amount: ['จำนวนเงิน', 'ยอดเงิน', 'ยอดรวม', 'amount', 'totalamount', 'netamount', 'total', 'value'],
  description: ['คำอธิบาย', 'รายละเอียด', 'รายการ', 'description', 'narration', 'memo', 'details'],
  account: ['บัญชี', 'รหัสบัญชี', 'เลขที่บัญชี', 'account', 'accountcode', 'accountnumber', 'glaccount'],
};
const headerKey = value => cleanText(value).toLowerCase().replace(/[\s_\-.\/()]/g, '');
export function guessMapping(headers) {
  const used = new Set();
  return Object.fromEntries(Object.entries(ALIASES).map(([field, aliases]) => {
    const index = headers.findIndex((header, position) => !used.has(position) && aliases.includes(headerKey(header)));
    if (index >= 0) used.add(index);
    return [field, index];
  }));
}

export function readWorkbook(data, { csv = false, XLSX = globalThis.XLSX } = {}) {
  if (!XLSX) throw new Error('ไม่พบไลบรารีอ่านไฟล์ กรุณาตรวจไฟล์ใน vendor/');
  // raw:true retains CSV values as text rather than guessing source cell types.
  return XLSX.read(data, { type: typeof data === 'string' ? 'string' : 'array', raw: csv, cellDates: false, cellFormula: true, cellHTML: false });
}

export function extractSheet(workbook, sheetName, { XLSX = globalThis.XLSX } = {}) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) throw new Error('แผ่นงานนี้ไม่มีข้อมูล กรุณาเลือกแผ่นงานอื่น');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  // Iterate actual cells, not the formatted range (which can span a million rows).
  const populated = new Map();
  let maxColumn = range.s.c;
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!') || !cell || (!cell.f && (cell.v === undefined || cell.v === null || cell.v === ''))) continue;
    const position = XLSX.utils.decode_cell(address);
    if (!populated.has(position.r)) populated.set(position.r, new Map());
    populated.get(position.r).set(position.c, cell);
    maxColumn = Math.max(maxColumn, position.c);
  }
  if (!populated.size) throw new Error('ไม่พบเซลล์ที่มีข้อมูล');
  // Header is the first used row. Original row numbers are never renumbered.
  const indices = [...populated.keys()].sort((a, b) => a - b);
  const headerIndex = indices[0];
  const firstColumn = range.s.c;
  const columnCount = maxColumn - firstColumn + 1;
  if (columnCount > 500) throw new Error('พบมากกว่า 500 คอลัมน์ กรุณาส่งออกเฉพาะคอลัมน์ที่ต้องใช้');
  const headers = Array.from({ length: columnCount }, (_, i) => String(populated.get(headerIndex).get(i + firstColumn)?.v ?? `คอลัมน์ ${XLSX.utils.encode_col(i + firstColumn)}`));
  let formulaCount = 0;
  let errorCellCount = 0;
  const rows = indices.filter(index => index > headerIndex).map(index => {
    const values = Array.from({ length: columnCount }, (_, i) => {
      const cell = populated.get(index).get(i + firstColumn);
      if (cell?.f) formulaCount += 1;
      if (cell?.t === 'e') {
        errorCellCount += 1;
        const message = String(cell.w ?? 'CELL_ERROR');
        return message.startsWith('#') ? message : `#${message}`;
      }
      return cell?.v ?? '';
    });
    return { rowNumber: index + 1, values };
  });
  const fullRange = sheet['!fullref'] ? XLSX.utils.decode_range(sheet['!fullref']) : range;
  return {
    headers, rows, headerRowNumber: headerIndex + 1,
    sourceMeta: { readRows: rows.length, physicalRows: fullRange.e.r + 1, looksTruncated: fullRange.e.r > range.e.r, formulaCount, errorCellCount, date1904: Boolean(workbook.Workbook?.WBProps?.date1904) },
  };
}

export function mapRecords(sheet, mapping) {
  const required = ['documentNumber', 'date', 'amount'];
  if (required.some(field => !Number.isInteger(mapping[field]) || mapping[field] < 0 || mapping[field] >= sheet.headers.length)) throw new Error('กรุณาจับคู่เลขที่เอกสาร วันที่ และจำนวนเงินให้ครบ');
  const fields = Object.keys(FIELD_LABELS);
  if (fields.some(field => mapping[field] !== undefined && (!Number.isInteger(mapping[field]) || mapping[field] < -1 || mapping[field] >= sheet.headers.length))) throw new Error('กรุณาเลือกคอลัมน์ที่มีอยู่ในข้อมูลสำหรับแต่ละรายการ');
  const selected = fields.map(field => mapping[field]).filter(index => index >= 0);
  if (new Set(selected).size !== selected.length) throw new Error('กรุณาเลือกคอลัมน์ต่างกันสำหรับแต่ละรายการ');
  return sheet.rows.map(row => ({ rowNumber: row.rowNumber, ...Object.fromEntries(fields.map(field => [field, mapping[field] >= 0 ? row.values[mapping[field]] : ''])) }));
}
