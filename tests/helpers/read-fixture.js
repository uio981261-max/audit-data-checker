// Independent, test-only readers for the generated fixtures. Browser import/export
// still uses the vendored SheetJS bundle. This is not a general XLSX library.
import { inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';

const fail = message => { throw new Error(`Invalid fixture: ${message}`); };
const xmlText = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
  if (entity[0] === '#') {
    const hexadecimal = entity[1].toLowerCase() === 'x';
    return String.fromCodePoint(parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10));
  }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()];
});
const attributes = source => Object.fromEntries([...source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1], xmlText(match[2] ?? match[3])]));
const textNodes = source => [...source.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(match => xmlText(match[1])).join('');

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function readZip(input) {
  const bytes = Buffer.from(input);
  const requireRange = (offset, length) => {
    if (offset < 0 || offset + length > bytes.length) fail('truncated ZIP archive');
  };
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) fail('ZIP end record missing');
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) fail('multi-disk ZIP unsupported');
  const entryCount = bytes.readUInt16LE(end + 10);
  if (entryCount === 0xffff) fail('ZIP64 unsupported');
  let cursor = bytes.readUInt32LE(end + 16);
  const centralSize = bytes.readUInt32LE(end + 12);
  requireRange(cursor, centralSize);
  const centralEnd = cursor + centralSize;
  const files = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    requireRange(cursor, 46);
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) fail('ZIP directory entry missing');
    const flags = bytes.readUInt16LE(cursor + 8);
    const compression = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressedLength = bytes.readUInt32LE(cursor + 20);
    const originalLength = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    requireRange(cursor + 46, nameLength + extraLength + commentLength);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (flags & 1) fail('encrypted ZIP entry unsupported');
    if (![0, 8].includes(compression)) fail(`ZIP compression ${compression} unsupported`);
    requireRange(localOffset, 30);
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) fail('ZIP local header missing');
    const dataOffset = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    requireRange(dataOffset, compressedLength);
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedLength);
    const content = compression === 8 ? inflateRawSync(compressed) : compressed;
    if (content.length !== originalLength || crc32(content) !== checksum) fail(`ZIP size or checksum mismatch: ${name}`);
    if (files.has(name)) fail(`duplicate ZIP path: ${name}`);
    files.set(name, content.toString('utf8'));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralEnd) fail('ZIP directory size mismatch');
  return files;
}

export function readFixtureXlsx(input) {
  const files = readZip(input);
  const workbook = files.get('xl/workbook.xml');
  const relationships = files.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !relationships) fail('workbook metadata missing');
  const firstSheet = /<sheet\s([^>]*?)\/?\s*>/.exec(workbook);
  if (!firstSheet) fail('workbook has no worksheet');
  const sheetAttributes = attributes(firstSheet[1]);
  const relation = [...relationships.matchAll(/<Relationship\s([^>]*?)\/?\s*>/g)]
    .map(match => attributes(match[1])).find(item => item.Id === sheetAttributes['r:id']);
  if (!relation || relation.TargetMode === 'External') fail('worksheet relationship missing');
  const target = relation.Target.startsWith('/') ? relation.Target.slice(1) : posix.normalize(`xl/${relation.Target}`);
  const worksheet = files.get(target);
  if (!worksheet) fail('worksheet XML missing');
  const sharedStrings = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match => textNodes(match[1]));
  const rows = [];
  for (const match of worksheet.matchAll(/<row\s([^>]*?)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attributes(match[1]).r);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) fail('invalid row number');
    if (rows[rowNumber - 1]) fail('duplicate row number');
    const values = [];
    for (const cell of match[2].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const properties = attributes(cell[1]);
      const address = /^([A-Z]+)(\d+)$/.exec(properties.r ?? '');
      if (!address || Number(address[2]) !== rowNumber) fail('invalid cell address');
      const column = [...address[1]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const content = cell[2] ?? '';
      const rawValue = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(content)?.[1];
      let value = '';
      if (properties.t === 'inlineStr') value = textNodes(content);
      else if (properties.t === 's') {
        const index = Number(rawValue);
        if (rawValue === undefined || !Number.isSafeInteger(index) || sharedStrings[index] === undefined) fail('invalid shared string reference');
        value = sharedStrings[index];
      } else if (properties.t === 'str') value = xmlText(rawValue ?? '');
      else if (properties.t === 'b') value = rawValue === '1';
      else if (rawValue !== undefined) {
        value = Number(rawValue);
        if (!Number.isFinite(value)) fail('invalid numeric cell');
      }
      values[column] = value;
    }
    rows[rowNumber - 1] = values;
  }
  const width = Math.max(0, ...rows.map(row => row?.length ?? 0));
  return Array.from({ length: rows.length }, (_, row) => Array.from({ length: width }, (_, column) => rows[row]?.[column] ?? ''));
}

export function readFixtureCsv(input) {
  const source = String(input).replace(/^\uFEFF/, '');
  if (!source) return [];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  let hadContent = false;
  const pushRow = () => {
    rows.push(hadContent || row.length ? [...row, field] : []);
    row = [];
    field = '';
    closedQuote = false;
    hadContent = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') { quoted = false; closedQuote = true; }
      else field += character;
      continue;
    }
    if (character === ',') { row.push(field); field = ''; closedQuote = false; hadContent = true; }
    else if (character === '\r' || character === '\n') {
      pushRow();
      if (character === '\r' && source[index + 1] === '\n') index += 1;
    } else if (character === '"' && field === '' && !closedQuote) { quoted = true; hadContent = true; }
    else {
      if (closedQuote || character === '"') fail('malformed quoted CSV field');
      field += character;
      hadContent = true;
    }
  }
  if (quoted) fail('unterminated quoted CSV field');
  if (hadContent || row.length) pushRow();
  return rows;
}
