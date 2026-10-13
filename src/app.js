import { FIELD_LABELS, readWorkbook, extractSheet, guessMapping, mapRecords } from './loader.js';
import { parseAmount } from './checks/utils.js';
import { checkCalendar } from './checks/calendar.js';
import { runChecks } from './run-checks.js';
import { CHECK_INFO } from './check-info.js';
import { downloadReport } from './export.js';

const $ = id => document.getElementById(id);
const number = value => value == null ? 'ไม่สามารถแสดงได้แน่นอน' : Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const rawText = value => value instanceof Date ? value.toISOString() : String(value ?? '');
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const state = { workbook: null, sheet: null, mapping: {}, results: null, context: null, chart: null, holidays: { coverageYears: [], holidays: [] }, holidayError: false, csv: false, looksTruncated: false };
const holidayReady = fetch(new URL('../data/th-holidays.json', import.meta.url)).then(response => {
  if (!response.ok) throw new Error('Holiday table unavailable');
  return response.json();
}).then(data => { state.holidays = data; }).catch(() => { state.holidayError = true; });

function error(message) {
  $('app-error').textContent = message;
  $('app-error').hidden = !message;
}
function stage(name) {
  for (const part of ['import', 'mapping', 'results']) {
    $(part + '-panel').hidden = part !== name;
    const step = $('step-' + part);
    step.classList.toggle('is-current', part === name);
    step.classList.toggle('is-complete', ['import', 'mapping', 'results'].indexOf(part) < ['import', 'mapping', 'results'].indexOf(name));
    if (part === name) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  }
}
function table(headers, values, caption) {
  const node = element('table');
  node.append(element('caption', caption, 'visually-hidden'));
  const head = element('thead'); const tr = element('tr');
  for (const label of headers) { const th = element('th', label); th.scope = 'col'; tr.append(th); }
  head.append(tr); node.append(head);
  const body = element('tbody');
  for (const row of values) {
    const line = element('tr');
    for (const cell of row) line.append(element('td', rawText(cell)));
    body.append(line);
  }
  node.append(body); return node;
}
function scrollableTable(headers, values, caption) {
  const wrapper = element('div', undefined, 'table-wrap');
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', caption);
  wrapper.append(table(headers, values, caption));
  return wrapper;
}
function focusHeading(id) { const node = $(id); node.tabIndex = -1; node.focus(); }
function csvHasUnclosedQuote(text) {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    if (quoted && text[i + 1] === '"') { i++; continue; }
    quoted = !quoted;
  }
  return quoted;
}
async function loadSource(data, sourceName, csv = false) {
  error(''); $('loading-status').textContent = 'กำลังอ่านข้อมูลภายในเบราว์เซอร์…';
  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const workbook = readWorkbook(data, { csv });
    if (!workbook.SheetNames.length) throw new Error('ไม่พบแผ่นงานในไฟล์');
    state.workbook = workbook; state.sourceName = sourceName; state.csv = csv;
    state.looksTruncated = csv && typeof data === 'string' && csvHasUnclosedQuote(data);
    state.results = null; state.context = null;
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    $('expected-rows').value = ''; $('expected-amount').value = ''; $('year-system').value = 'auto';
    $('sheet-select').replaceChildren(...workbook.SheetNames.map(name => { const option = element('option', name); option.value = name; return option; }));
    $('source-name').textContent = sourceName;
    renderSheet(); stage('mapping'); focusHeading('mapping-title');
    $('loading-status').textContent = `โหลด ${number(state.sheet.rows.length)} รายการแล้ว ข้อมูลยังไม่ถูกแก้ไข`;
  } catch (cause) { error(`อ่านข้อมูลไม่สำเร็จ: ${cause.message}`); }
  finally { $('sample-button').disabled = false; $('paste-button').disabled = false; }
}
function renderSheet() {
  state.sheet = extractSheet(state.workbook, $('sheet-select').value);
  state.sheet.sourceMeta.looksTruncated ||= state.looksTruncated;
  state.mapping = guessMapping(state.sheet.headers);
  $('mapping-fields').replaceChildren();
  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    const wrapper = element('div', undefined, 'mapping-field field');
    const title = element('label', label); title.htmlFor = 'map-' + field;
    const select = element('select'); select.id = 'map-' + field;
    const empty = element('option', '— เลือกคอลัมน์ —'); empty.value = '-1'; select.append(empty);
    state.sheet.headers.forEach((header, index) => { const option = element('option', `${index + 1}. ${header}`); option.value = index; select.append(option); });
    select.value = state.mapping[field];
    select.addEventListener('change', () => { state.mapping[field] = Number(select.value); });
    wrapper.append(title, select); $('mapping-fields').append(wrapper);
  }
  $('preview-container').replaceChildren(table(['แถวต้นฉบับ', ...state.sheet.headers], state.sheet.rows.slice(0, 20).map(row => [row.rowNumber, ...row.values]), 'ตัวอย่างข้อมูลต้นฉบับ 20 แถวแรก'));
  $('mapping-error').textContent = state.sheet.sourceMeta.formulaCount ? `พบเซลล์สูตร ${number(state.sheet.sourceMeta.formulaCount)} เซลล์ ใช้ค่าที่บันทึกไว้ในไฟล์ โดยไม่คำนวณสูตรใหม่` : '';
  $('mapping-error').hidden = !state.sheet.sourceMeta.formulaCount;
  updateCoverage();
}
async function updateCoverage() {
  await holidayReady;
  const calendar = checkCalendar([], { holidays: state.holidays });
  $('holiday-coverage').textContent = state.holidayError ? 'อ่านตารางวันหยุดไม่สำเร็จ จะตรวจเฉพาะวันเสาร์/อาทิตย์ กรุณาตรวจไฟล์ data/th-holidays.json' : calendar.coveredYears.length ? `ตารางวันหยุดที่ยืนยันแล้วครอบคลุมปี ค.ศ. ${calendar.coveredYears.join(', ')} ตรวจความครอบคลุมกับปีข้อมูลอีกครั้งในผลตรวจ` : 'ตารางวันหยุดยังไม่มีปีที่ยืนยันแล้ว: ตรวจวันเสาร์/อาทิตย์ได้ แต่ผลวันหยุดราชการยังไม่ครบ กรุณาเติมและยืนยัน data/th-holidays.json จากประกาศทางการ';
}
function infoPopover(id) {
  const info = CHECK_INFO[id];
  const detail = element('details', undefined, 'info-popover');
  const summary = element('summary', 'คำแนะนำการสอบทาน'); detail.append(summary);
  for (const [label, value] of [['อาการ', info.symptom], ['สาเหตุที่พบบ่อย', info.cause], ['วิธีตรวจ/แก้ไข', info.remedy]]) { const p = element('p'); p.append(element('strong', label + ' → '), document.createTextNode(value)); detail.append(p); }
  return detail;
}
function resultDetails(item, container) {
  if (item.id === 'duplicates') container.append(element('p', `${number(item.groupCount)} กลุ่ม; ${number(item.groups.filter(g => g.rawDiffered).length)} กลุ่มมีรูปแบบค่าต้นฉบับต่างกัน`));
  if (item.id === 'sequence') container.append(element('p', `ไม่พบ ${item.missingCount} เลขใน ${item.count} ช่วง ตรวจเฉพาะระหว่างเลขต่ำสุดและสูงสุดที่พบในคำนำหน้าเดียวกัน`));
  if (item.id === 'calendar') container.append(element('p', `วันเสาร์/อาทิตย์ ${number(item.weekendCount)} แถว · วันหยุดตามตาราง ${number(item.holidayCount)} แถว · ปีที่ครอบคลุม: ${item.coveredYears.join(', ') || 'ยังไม่มีปีที่ยืนยันแล้ว'}`));
  if (item.id === 'round') container.append(element('p', Object.entries(item.countsByThreshold).map(([threshold, count]) => `เกณฑ์ ${number(threshold)}: ${number(count)} แถว`).join(' · ')));
  if (item.id === 'hygiene' && state.csv) container.append(element('p', 'CSV/ข้อมูลที่วางไม่มีชนิดเซลล์ จึงอ่านจำนวนเงินเป็นข้อความ ไม่อาจยืนยันชนิดเซลล์ในระบบต้นทางได้', 'notice'));
  if (item.id === 'years') container.append(element('p', `ปีข้อความ พ.ศ. ${number(item.systemCounts.be)} แถว · ค.ศ. ${number(item.systemCounts.ce)} แถว · วันที่ว่างหรืออ่านไม่ได้ ${number(item.invalidDateCount)} แถว`));
  if (item.id === 'completeness') {
    container.append(element('p', `โหลด ${number(item.rowCount)} แถว · ยอดรวมที่อ่านได้ ${number(item.amountSum)} บาท · จำนวนเงินที่อ่านไม่ได้ ${number(item.invalidAmountCount)} แถว`));
    if (!item.hasControls) container.append(element('p', 'ยังไม่ได้ระบุยอดควบคุม จึงยังไม่ยืนยันความครบถ้วนกับระบบต้นทาง', 'notice'));
    const comparisons = Object.entries(item.comparisons).map(([name, value]) => [name === 'rowCount' ? 'จำนวนแถว' : 'ยอดรวม (บาท)', number(value.expected), number(value.actual), number(value.difference), value.matches ? 'ตรงกับยอดควบคุม' : 'ควรสอบทาน']);
    if (comparisons.length) container.append(scrollableTable(['รายการ', 'ยอดควบคุม', 'ที่โหลดได้', 'ผลต่าง', 'ข้อสังเกต'], comparisons, 'เปรียบเทียบยอดควบคุม'));
  }
  for (const message of [...(item.warnings || []), ...(item.messages || [])]) container.append(element('p', message, 'notice warning'));
  if (item.id === 'benford') {
    container.append(element('p', item.message), element('p', item.note, 'notice'));
    if (item.skipped) return;
    const chart = element('div', undefined, 'chart-container'); const canvas = element('canvas'); canvas.id = 'benford-chart'; canvas.setAttribute('aria-label', 'กราฟสัดส่วนเลขหลักแรกที่พบเทียบกับ Benford'); canvas.setAttribute('role', 'img'); chart.append(canvas); container.append(chart);
    container.append(scrollableTable(['เลขหลักแรก', 'จำนวน', 'ที่พบ (%)', 'Benford (%)'], item.distribution.map(d => [d.digit, d.count, (d.observed * 100).toFixed(2), (d.expected * 100).toFixed(2)]), 'ข้อมูลกราฟ Benford สำหรับการอ่านด้วยโปรแกรมอ่านหน้าจอ'));
    return;
  }
  if (!item.flags.length) { container.append(element('p', 'ไม่พบรายการตามเงื่อนไขที่ตรวจ ผลนี้ไม่ใช่การรับรองความถูกต้องของข้อมูลทั้งหมด', 'empty-state')); return; }
  const wrapper = element('div', undefined, 'table-wrap'); wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', CHECK_INFO[item.id].title + ' ตารางรายการที่ควรสอบทาน');
  const labels = ['แถวต้นฉบับ', 'เลขที่เอกสารเดิม', 'วันที่เดิม', 'จำนวนเงินเดิม', 'คำอธิบายเดิม', 'บัญชีเดิม', 'เหตุผล', 'ค่าที่ทำความสะอาด / วันที่แปลง'];
  const display = flag => [flag.rowNumber ?? 'ระดับชุดข้อมูล', flag.documentNumber, flag.date, flag.amount, flag.description, flag.account, flag.reason, flag.cleanedValues ? Object.entries(flag.cleanedValues).map(([key, value]) => `${FIELD_LABELS[key]}: ${rawText(value)}`).join(' / ') : flag.convertedDate ?? flag.cleanedAmount ?? ''];
  let shown = Math.min(100, item.flags.length);
  const rowsTable = table(labels, item.flags.slice(0, shown).map(display), CHECK_INFO[item.id].title + ' รายการที่ควรสอบทาน'); wrapper.append(rowsTable); container.append(wrapper);
  if (shown < item.flags.length) {
    const more = element('button', `แสดงเพิ่ม (แสดง ${shown} จาก ${number(item.flags.length)})`, 'button button-secondary'); more.type = 'button';
    more.addEventListener('click', () => { const end = Math.min(shown + 100, item.flags.length); for (const flag of item.flags.slice(shown, end)) { const line = element('tr'); for (const value of display(flag)) line.append(element('td', rawText(value))); rowsTable.tBodies[0].append(line); } shown = end; more.textContent = `แสดงเพิ่ม (แสดง ${number(shown)} จาก ${number(item.flags.length)})`; if (shown === item.flags.length) more.hidden = true; }); container.append(more);
  }
}
function renderResults() {
  $('summary-cards').replaceChildren(); $('results-sections').replaceChildren();
  const uniqueRows = new Set(state.results.filter(item => item.id !== 'sequence').flatMap(item => item.flags.map(flag => flag.rowNumber).filter(value => value != null)));
  $('result-overview').textContent = `โหลด ${number(state.context.rowCount)} แถว พบ ${number(uniqueRows.size)} แถวที่ควรสอบทานจากเงื่อนไขต่าง ๆ แต่ละแถวอาจอยู่ในหลายประเภท; ช่องว่างลำดับและยอดควบคุมเป็นข้อสังเกตเพิ่มเติม`;
  for (const item of state.results) {
    const card = element('a', undefined, 'summary-card'); card.href = '#check-' + item.id;
    card.append(element('span', CHECK_INFO[item.id].title), element('strong', item.id === 'benford' ? item.skipped ? 'ข้าม' : 'กราฟ' : number(item.count)), element('span', item.id === 'sequence' ? 'ช่วงที่ไม่พบ' : item.id === 'completeness' ? 'ข้อสังเกต' : item.id === 'benford' ? `${number(item.usableCount)} จำนวนเงินที่ใช้ได้` : 'แถวที่ควรสอบทาน', 'field-help'));
    const section = element('details', undefined, 'check-section'); section.id = 'check-' + item.id;
    const header = element('summary', undefined, 'check-header'); header.append(element('span', CHECK_INFO[item.id].title), element('span', item.id === 'benford' ? item.message : `${number(item.count)} ${item.id === 'sequence' ? 'ช่วง' : item.id === 'completeness' ? 'ข้อสังเกต' : 'แถว'}`, 'check-count'));
    section.append(header); const content = element('div', undefined, 'check-content'); content.append(infoPopover(item.id)); resultDetails(item, content); section.append(content);
    card.addEventListener('click', () => { section.open = true; });
    $('summary-cards').append(card); $('results-sections').append(section);
    if (item.id === 'benford') section.addEventListener('toggle', () => { if (section.open) drawBenford(item); });
  }
  $('results-live').textContent = `ตรวจข้อมูลครบ 8 ประเภทแล้ว พบ ${number(uniqueRows.size)} แถวที่ควรสอบทาน`;
}
function drawBenford(item) {
  if (item.skipped || state.chart) return;
  if (!globalThis.Chart) { error('ไม่พบ Chart.js ดูตัวเลขได้จากตาราง Benford กรุณาตรวจ vendor/'); return; }
  state.chart = new Chart($('benford-chart'), { type: 'bar', data: { labels: item.distribution.map(d => String(d.digit)), datasets: [{ label: 'สัดส่วนที่พบ (%)', data: item.distribution.map(d => d.observed * 100), backgroundColor: '#267369' }, { label: 'สัดส่วนตาม Benford (%)', data: item.distribution.map(d => d.expected * 100), backgroundColor: '#bac7d1' }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { beginAtZero: true, title: { display: true, text: 'ร้อยละ' } }, x: { title: { display: true, text: 'เลขหลักแรก' } } } } });
}

$('sample-button').addEventListener('click', async () => {
  $('sample-button').disabled = true; error(''); $('loading-status').textContent = 'กำลังโหลดตัวอย่างสมมติ…';
  try { const response = await fetch(new URL('../data/sample.xlsx', import.meta.url)); if (!response.ok) throw new Error('ไม่พบ data/sample.xlsx'); await loadSource(await response.arrayBuffer(), 'sample.xlsx — ข้อมูลสมมติ'); } catch (cause) { error(cause.message); $('sample-button').disabled = false; }
});
$('file-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  if (!/\.(xlsx|csv)$/i.test(file.name)) { error('กรุณาเลือกไฟล์ .xlsx หรือ .csv'); return; }
  try { const csv = /\.csv$/i.test(file.name); await loadSource(csv ? await file.text() : await file.arrayBuffer(), file.name, csv); } catch (cause) { error(cause.message); }
  event.target.value = '';
});
$('paste-button').addEventListener('click', async () => { const text = $('paste-input').value; if (!text.trim()) { error('กรุณาวางข้อมูลพร้อมหัวคอลัมน์'); return; } $('paste-button').disabled = true; await loadSource(text, 'ข้อมูลที่วาง', true); });
$('sheet-select').addEventListener('change', () => { error(''); try { renderSheet(); } catch (cause) { error(cause.message); state.sheet = null; } });
$('run-button').addEventListener('click', async () => {
  error(''); $('run-button').disabled = true;
  try {
    if (!state.sheet) throw new Error('กรุณาเลือกแผ่นงานที่มีข้อมูล');
    const rows = mapRecords(state.sheet, state.mapping);
    if (!rows.length) throw new Error('ไม่พบรายการข้อมูลใต้แถวหัวคอลัมน์');
    const thresholds = [$('threshold-one').value, $('threshold-two').value].filter(text => text !== '').map(parseAmount);
    if (!thresholds.length || thresholds.some(value => value == null || value <= 0)) throw new Error('เกณฑ์จำนวนเงินกลมต้องเป็นตัวเลขมากกว่าศูนย์อย่างน้อยหนึ่งเกณฑ์');
    const expectedRows = $('expected-rows').value.trim() || null; const expectedAmount = $('expected-amount').value.trim() || null;
    if (expectedRows !== null && (parseAmount(expectedRows) === null || !Number.isSafeInteger(parseAmount(expectedRows)) || parseAmount(expectedRows) < 0)) throw new Error('ยอดควบคุมจำนวนแถวต้องเป็นจำนวนเต็มที่ไม่ติดลบ');
    if (expectedAmount !== null && parseAmount(expectedAmount) === null) throw new Error('กรุณาระบุยอดควบคุมจำนวนเงินในรูปแบบตัวเลข');
    $('loading-status').textContent = 'กำลังตรวจข้อมูลภายในเบราว์เซอร์…'; await holidayReady;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const options = { yearSystem: $('year-system').value, date1904: state.sheet.sourceMeta.date1904, expectedRows, expectedAmount, thresholds, sourceMeta: state.sheet.sourceMeta, holidays: state.holidays };
    state.results = runChecks(rows, options);
    if (state.holidayError) state.results.find(item => item.id === 'calendar').warnings.push('อ่านไฟล์ตารางวันหยุดไม่สำเร็จ ผลนี้ตรวจเฉพาะวันเสาร์/อาทิตย์');
    state.context = { sourceName: state.sourceName, sheetName: $('sheet-select').value, rowCount: rows.length, headerRowNumber: state.sheet.headerRowNumber, options, mappingHeaders: Object.fromEntries(Object.entries(state.mapping).map(([field, i]) => [field, i >= 0 ? state.sheet.headers[i] : 'ไม่ได้เลือก'])) };
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    renderResults(); stage('results'); focusHeading('results-title'); $('loading-status').textContent = 'ตรวจเสร็จแล้ว ข้อมูลต้นฉบับยังไม่ถูกแก้ไข';
  } catch (cause) { error(cause.message); }
  finally { $('run-button').disabled = false; }
});
$('back-button').addEventListener('click', () => { stage('mapping'); focusHeading('mapping-title'); });
$('export-button').addEventListener('click', () => { try { if (!state.results) throw new Error('กรุณารันตรวจข้อมูลก่อน'); downloadReport(state.results, state.context); $('results-live').textContent = 'สร้างรายงาน Excel แล้ว กรุณาตรวจไฟล์ดาวน์โหลด'; } catch (cause) { error(`ส่งออกรายงานไม่สำเร็จ: ${cause.message}`); } });
const restart = element('button', 'นำเข้าข้อมูลชุดใหม่', 'button button-secondary'); restart.type = 'button'; restart.addEventListener('click', () => { error(''); stage('import'); focusHeading('import-title'); }); $('mapping-panel').append(restart);
