// Importing bank / credit-card statements (CSV, XLSX, text PDFs) and reading receipts, as pure
// functions over Buffers and strings. Node built-ins only (zlib, Buffer, TextDecoder) — no xlsx,
// pdf or OCR packages. Nothing is invented: unreadable values come back null with a warning.
'use strict';

const zlib = require('zlib');

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;
const clean = s => String(s ?? '').replace(BIDI, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// ── Text decoding ─────────────────────────────────────────────────────────────
// windows-1255: Hebrew letters 0xE0..0xFA → U+05D0..U+05EA (used when ICU lacks the codec)
function decode1255(buf) {
  let out = '';
  for (const b of buf) {
    if (b >= 0xe0 && b <= 0xfa) out += String.fromCharCode(0x05d0 + b - 0xe0);
    else if (b === 0xa4) out += '₪';
    else if (b === 0x80) out += '€';
    else if (b === 0xfd) out += '‎';
    else if (b === 0xfe) out += '‏';
    else out += String.fromCharCode(b);
  }
  return out;
}

function decodeText(buf) {
  if (!buf || !buf.length) return '';
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { /* not UTF-8 */ }
  try { return new TextDecoder('windows-1255').decode(b); } catch { /* codec unavailable */ }
  try { return decode1255(b); } catch { return b.toString('latin1'); }
}

// ── CSV ───────────────────────────────────────────────────────────────────────
const DELIMS = [',', ';', '\t', '|'];

// Counts of `d` outside quotes, per line, over the first lines of the text
function delimCounts(text, d) {
  const counts = [];
  let n = 0, q = false;
  for (let i = 0; i < text.length && counts.length < 20; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    else if (!q && c === d) n++;
    else if (!q && c === '\n') { counts.push(n); n = 0; }
  }
  if (n || !counts.length) counts.push(n);
  return counts;
}

function detectDelimiter(text) {
  let best = ',', bestScore = 0;
  for (const d of DELIMS) {
    const c = delimCounts(text, d).filter(x => x > 0);
    if (!c.length) continue;
    // Lines that share the most common count, weighted by that count
    const freq = {};
    for (const x of c) freq[x] = (freq[x] || 0) + 1;
    const [mode, times] = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = times * 10 + Number(mode);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const d = detectDelimiter(s);
  const rows = [];
  let row = [], cell = '', q = false;
  const endCell = () => { row.push(cell.trim()); cell = ''; };
  const endRow = () => { endCell(); if (row.some(c => c !== '')) rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell.trim() === '') { cell = ''; q = true; }
    else if (c === d) endCell();
    else if (c === '\r') { if (s[i + 1] !== '\n') endRow(); }
    else if (c === '\n') endRow();
    else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

// ── ZIP + XLSX ────────────────────────────────────────────────────────────────
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('קובץ ZIP פגום');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    files[name] = { method, data };
  }
  return {
    has: n => n in files,
    text(n) {
      const f = files[n];
      if (!f) return null;
      if (f.method === 0) return f.data.toString('utf8');
      if (f.method === 8) return zlib.inflateRawSync(f.data).toString('utf8');
      throw new Error(`שיטת דחיסה לא נתמכת (${f.method})`);
    },
  };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});
const attr = (s, name) => { const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(s); return m ? unescapeXml(m[2] ?? m[3]) : null; };
// Text of all <t> runs (skipping phonetic <rPh> hints)
const runsText = xml => {
  let out = '';
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
  let m;
  const s = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  while ((m = re.exec(s))) out += unescapeXml(m[1]);
  return out;
};

function colIndex(ref) {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Excel serial day → yyyy-mm-dd (1900 system with its phantom 29 Feb 1900; or the 1904 system)
function excelDate(serial, date1904 = false) {
  let d = Math.floor(Number(serial));
  if (!Number.isFinite(d)) return null;
  if (date1904) d += 1462;
  else if (d < 60) d += 1;
  const ms = Date.UTC(1899, 11, 30) + d * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function isDateFormat(code) {
  const s = String(code).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmy]/i.test(s) && !/^[#0.,%\s]*$/.test(s);
}

// Which style indexes (cellXfs) are dates
function dateStyles(stylesXml) {
  const out = new Set();
  if (!stylesXml) return out;
  const custom = {};
  for (const m of stylesXml.matchAll(/<(?:\w+:)?numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1], 'numFmtId'));
    custom[id] = attr(m[1], 'formatCode') || '';
  }
  const xfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stylesXml);
  if (!xfs) return out;
  let i = 0;
  for (const m of xfs[1].matchAll(/<(?:\w+:)?xf\b([^>]*?)(\/>|>)/g)) {
    const id = Number(attr(m[1], 'numFmtId') || 0);
    if (DATE_FMT_IDS.has(id) || (custom[id] !== undefined && isDateFormat(custom[id]))) out.add(i);
    i++;
  }
  return out;
}

const numText = v => { const n = Number(v); return Number.isFinite(n) ? String(parseFloat(n.toPrecision(15))) : String(v); };

function readSheet(xml, shared, dates, date1904) {
  const rows = [];
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const r = Number(attr(rm[1], 'r'));
    const ri = Number.isFinite(r) && r > 0 ? r - 1 : rows.length;
    while (rows.length < ri) rows.push([]);
    const row = [];
    for (const cm of (rm[2] || '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a = cm[1], body = cm[2] || '';
      let ci = colIndex(attr(a, 'r'));
      if (ci < 0) ci = row.length;
      const t = attr(a, 't') || 'n';
      const vm = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body);
      const v = vm ? unescapeXml(vm[1]) : '';
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = runsText(body);
      else if (t === 'str' || t === 'e') val = v;
      else if (t === 'b') val = v === '1' ? 'TRUE' : v === '' ? '' : 'FALSE';
      else if (t === 'd') val = v.slice(0, 10);
      else if (v !== '') val = dates.has(Number(attr(a, 's') || 0)) ? excelDate(v, date1904) || v : numText(v);
      while (row.length < ci) row.push('');
      row[ci] = clean(val);
    }
    rows[ri] = row;
  }
  return rows;
}

function readXlsx(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length >= 4 && b.readUInt32BE(0) === 0xd0cf11e0) throw new Error('קובץ Excel ישן (xls) — שמור כ-xlsx או CSV');
  if (b.length < 22 || b[0] !== 0x50 || b[1] !== 0x4b) throw new Error('הקובץ אינו קובץ xlsx תקין');
  const zip = unzip(b);
  const wb = zip.text('xl/workbook.xml');
  if (!wb) throw new Error('הקובץ אינו קובץ xlsx תקין (חסר workbook)');
  const date1904 = /date1904\s*=\s*["'](1|true)["']/.test(wb);
  const rels = {};
  for (const m of (zip.text('xl/_rels/workbook.xml.rels') || '').matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    rels[attr(m[1], 'Id')] = attr(m[1], 'Target');
  }
  const shared = [];
  for (const m of (zip.text('xl/sharedStrings.xml') || '').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\s*\/>/g)) {
    shared.push(m[1] ? runsText(m[1]) : '');
  }
  const dates = dateStyles(zip.text('xl/styles.xml'));
  const sheets = [];
  let i = 0;
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    i++;
    const name = attr(m[1], 'name') || `Sheet${i}`;
    const rid = attr(m[1], 'r:id') || attr(m[1], 'id');
    let target = rels[rid] || `worksheets/sheet${i}.xml`;
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, '/');
    const xml = zip.text(target);
    sheets.push({ name, rows: xml ? readSheet(xml, shared, dates, date1904) : [] });
  }
  return sheets;
}

// Tables from HTML ("xls" exports that are really HTML) and Excel 2003 XML spreadsheets
const stripTags = s => clean(unescapeXml(String(s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')));
function htmlTable(text) {
  const rows = [];
  for (const tr of text.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table|$)/gi)) {
    const row = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr|$)/gi)].map(c => stripTags(c[1].replace(/<\/t[dh]>[\s\S]*$/i, '')));
    if (row.some(c => c)) rows.push(row);
  }
  return rows;
}
function xmlSpreadsheet(text) {
  const rows = [];
  for (const r of text.matchAll(/<(?:ss:)?Row\b[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/g)) {
      const idx = Number(attr(c[1], 'ss:Index'));
      if (idx > 0) while (row.length < idx - 1) row.push('');
      const d = /<(?:ss:)?Data\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Data>/.exec(c[2] || '');
      let v = d ? stripTags(d[2]) : '';
      if (d && attr(d[1], 'ss:Type') === 'DateTime') v = v.slice(0, 10);
      row.push(v);
    }
    if (row.some(x => x)) rows.push(row);
  }
  return rows;
}

// ── PDF ───────────────────────────────────────────────────────────────────────
function inflate(data) {
  for (const f of [zlib.inflateSync, zlib.inflateRawSync]) {
    try { return f(data); } catch { /* try the next */ }
  }
  try { return zlib.inflateRawSync(data.subarray(2)); } catch { return null; }
}

// All objects: num → { dict, stream (decoded Buffer|null) }, including those inside object streams
function pdfObjects(buf) {
  const s = buf.toString('latin1');
  const objs = {};
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    let body = s.slice(start, end);
    let stream = null;
    const si = body.search(/\bstream\r?\n/);
    if (si >= 0) {
      const dict = body.slice(0, si);
      let ds = start + si + 6;
      if (s[ds] === '\r') ds++;
      if (s[ds] === '\n') ds++;
      const lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let de = s.indexOf('endstream', ds);
      if (lenM && ds + Number(lenM[1]) <= s.length && s.slice(ds + Number(lenM[1]), ds + Number(lenM[1]) + 12).includes('endstream')) de = ds + Number(lenM[1]);
      if (de < 0) de = end;
      let data = buf.subarray(ds, de);
      if (/\/FlateDecode|\/Fl\b/.test(dict)) data = inflate(data);
      else if (/\/Filter/.test(dict)) data = null; // images / other filters: not text
      stream = data;
      body = dict;
      re.lastIndex = Math.max(re.lastIndex, de);
    } else re.lastIndex = end;
    objs[num] = { dict: body, stream };
  }
  // Objects packed inside /ObjStm streams
  for (const o of Object.values(objs)) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.stream) continue;
    const n = Number((/\/N\s+(\d+)/.exec(o.dict) || [])[1] || 0);
    const first = Number((/\/First\s+(\d+)/.exec(o.dict) || [])[1] || 0);
    const t = o.stream.toString('latin1');
    const head = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) {
      const num = head[2 * k], off = first + head[2 * k + 1];
      const next = k + 1 < n ? first + head[2 * k + 3] : t.length;
      if (Number.isFinite(num) && !objs[num]) objs[num] = { dict: t.slice(off, next), stream: null };
    }
  }
  return objs;
}

const utf16be = hex => {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
};

// ToUnicode CMap → { map: { HEXCODE: string }, widths: [byte lengths, longest first] }
function parseCMap(text) {
  const map = {};
  const widths = new Set();
  for (const b of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const r of b[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) widths.add(Math.ceil(r[1].length / 2));
  }
  for (const b of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of b[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
      map[r[1].toUpperCase()] = utf16be(r[2]);
      widths.add(Math.ceil(r[1].length / 2));
    }
  }
  for (const b of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of b[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<([0-9a-f]*)>|\[([^\]]*)\])/gi)) {
      const lo = parseInt(r[1], 16), hi = parseInt(r[2], 16), len = r[1].length;
      widths.add(Math.ceil(len / 2));
      if (hi - lo > 0xffff) continue;
      const arr = r[5] !== undefined ? [...r[5].matchAll(/<([0-9a-f]*)>/gi)].map(x => x[1]) : null;
      for (let c = lo; c <= hi; c++) {
        const key = c.toString(16).toUpperCase().padStart(len, '0');
        if (arr) { if (arr[c - lo] !== undefined) map[key] = utf16be(arr[c - lo]); }
        else {
          const dst = r[4];
          const last = parseInt(dst.slice(-4) || '0', 16) + (c - lo);
          map[key] = utf16be(dst.slice(0, -4) + (last & 0xffff).toString(16).padStart(4, '0'));
        }
      }
    }
  }
  return { map, widths: [...widths].sort((a, b) => b - a) };
}

// Font resource name (/F1) → its ToUnicode map, plus a merged map for unresolved names
function pdfFonts(objs) {
  const cmaps = {};
  const fontMap = num => {
    if (num in cmaps) return cmaps[num];
    cmaps[num] = null;
    const o = objs[num];
    const tu = o && /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.dict);
    const st = tu && objs[tu[1]] && objs[tu[1]].stream;
    if (st) cmaps[num] = parseCMap(st.toString('latin1'));
    return cmaps[num];
  };
  const byName = {};
  const addPairs = text => {
    for (const p of text.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      if (!(p[1] in byName)) byName[p[1]] = fontMap(Number(p[2]));
    }
  };
  for (const o of Object.values(objs)) {
    for (const f of o.dict.matchAll(/\/Font\s*(<<([\s\S]*?)>>|(\d+)\s+\d+\s+R)/g)) {
      if (f[2] !== undefined) addPairs(f[2]);
      else if (objs[f[3]]) addPairs(objs[f[3]].dict);
    }
  }
  const merged = { map: {}, widths: new Set() };
  for (const c of Object.values(cmaps)) {
    if (!c) continue;
    Object.assign(merged.map, c.map);
    c.widths.forEach(w => merged.widths.add(w));
  }
  return { byName, merged: Object.keys(merged.map).length ? { map: merged.map, widths: [...merged.widths].sort((a, b) => b - a) } : null };
}

// Content streams in page order (falls back to every stream that has text operators)
function pdfContents(objs) {
  const refs = t => [...String(t || '').matchAll(/(\d+)\s+\d+\s+R/g)].map(x => Number(x[1]));
  const out = [];
  const seen = new Set();
  const walk = (num, depth) => {
    const o = objs[num];
    if (!o || seen.has(num) || depth > 50) return;
    seen.add(num);
    if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) {
      const c = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(o.dict);
      for (const r of refs(c && c[1])) {
        const co = objs[r];
        if (co && co.stream) out.push(co.stream);
        else if (co) for (const r2 of refs(co.dict)) if (objs[r2] && objs[r2].stream) out.push(objs[r2].stream);
      }
    } else {
      const k = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
      for (const r of refs(k && k[1])) walk(r, depth + 1);
    }
  };
  const cat = Object.entries(objs).find(([, o]) => /\/Type\s*\/Catalog/.test(o.dict));
  const root = cat && /\/Pages\s+(\d+)\s+\d+\s+R/.exec(cat[1].dict);
  if (root) walk(Number(root[1]), 0);
  const used = new Set(out);
  for (const o of Object.values(objs)) {
    if (!o.stream || used.has(o.stream)) continue;
    if (out.length && !/\/Subtype\s*\/Form/.test(o.dict)) continue;
    if (/\/Type\s*\/(ObjStm|XRef)|\/Subtype\s*\/Image|\/Length1|CIDInit/.test(o.dict)) continue;
    const t = o.stream.toString('latin1');
    if (/\bBT\b/.test(t) && /\bT[jJ]\b|'|"/.test(t)) out.push(o.stream);
  }
  return out;
}

// Tokens of a content stream: { t: 'str', v: bytes-as-latin1 } | num | name | arr | op
function* pdfTokens(s) {
  let i = 0;
  const n = s.length;
  const ws = c => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
  const delim = c => '()<>[]{}/%'.includes(c);
  while (i < n) {
    const c = s[i];
    if (ws(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      let depth = 1, out = '';
      i++;
      while (i < n && depth > 0) {
        const ch = s[i++];
        if (ch === '\\') {
          const e = s[i++];
          if (e === 'n') out += '\n'; else if (e === 'r') out += '\r'; else if (e === 't') out += '\t';
          else if (e === 'b') out += '\b'; else if (e === 'f') out += '\f';
          else if (e === '\r') { if (s[i] === '\n') i++; }
          else if (e === '\n') { /* line continuation */ }
          else if (e >= '0' && e <= '7') {
            let o = e;
            while (o.length < 3 && s[i] >= '0' && s[i] <= '7') o += s[i++];
            out += String.fromCharCode(parseInt(o, 8) & 0xff);
          } else if (e !== undefined) out += e;
        } else if (ch === '(') { depth++; out += ch; }
        else if (ch === ')') { if (--depth) out += ch; }
        else out += ch;
      }
      yield { t: 'str', v: out };
      continue;
    }
    if (c === '<' && s[i + 1] !== '<') {
      const e = s.indexOf('>', i);
      let hex = s.slice(i + 1, e < 0 ? n : e).replace(/[^0-9a-f]/gi, '');
      if (hex.length % 2) hex += '0';
      let out = '';
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      i = e < 0 ? n : e + 1;
      yield { t: 'str', v: out };
      continue;
    }
    if (c === '<' || c === '>') { i += 2; yield { t: 'op', v: c + c }; continue; }
    if (c === '[' || c === ']') { i++; yield { t: c }; continue; }
    if (c === '{' || c === '}') { i++; continue; }
    if (c === '/') {
      let j = i + 1;
      while (j < n && !ws(s[j]) && !delim(s[j])) j++;
      yield { t: 'name', v: s.slice(i + 1, j) };
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !ws(s[j]) && !delim(s[j])) j++;
    if (j === i) { i++; continue; }
    const w = s.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) { yield { t: 'num', v: Number(w) }; continue; }
    if (w === 'ID') { // inline image data: skip to EI
      const e = s.indexOf('EI', i);
      i = e < 0 ? n : e + 2;
      continue;
    }
    yield { t: 'op', v: w };
  }
}

function showBytes(bytes, cmap) {
  if (cmap) {
    let out = '';
    for (let i = 0; i < bytes.length;) {
      let hit = false;
      for (const w of cmap.widths) {
        if (i + w > bytes.length) continue;
        let key = '';
        for (let k = 0; k < w; k++) key += bytes.charCodeAt(i + k).toString(16).toUpperCase().padStart(2, '0');
        if (key in cmap.map) { out += cmap.map[key]; i += w; hit = true; break; }
      }
      if (!hit) i += cmap.widths[cmap.widths.length - 1] || 1;
    }
    return out;
  }
  if (bytes.charCodeAt(0) === 0xfe && bytes.charCodeAt(1) === 0xff) return utf16be([...bytes.slice(2)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  return bytes.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

function contentText(stream, fonts) {
  const lines = [];
  let line = '', cmap = fonts.merged, y = null;
  const br = () => { if (line.trim()) lines.push(line.replace(/\s+/g, ' ').trim()); line = ''; };
  const show = b => { line += showBytes(b, cmap); };
  const ops = [];
  let arr = null;
  for (const tk of pdfTokens(stream.toString('latin1'))) {
    if (tk.t === '[') { arr = []; continue; }
    if (tk.t === ']') { ops.push({ t: 'arr', v: arr || [] }); arr = null; continue; }
    if (arr && tk.t !== 'op') { arr.push(tk); continue; }
    if (tk.t !== 'op') { ops.push(tk); continue; }
    const o = tk.v, a = ops.splice(0);
    const num = k => (a[a.length - k] && a[a.length - k].t === 'num' ? a[a.length - k].v : 0);
    if (o === 'BT' || o === 'ET') { /* keep the line open: the next block may continue it */ }
    else if (o === 'Tf') {
      const nm = a.find(x => x.t === 'name');
      if (nm) cmap = nm.v in fonts.byName ? fonts.byName[nm.v] : fonts.merged;
    } else if (o === 'Td' || o === 'TD') {
      const ty = num(1), tx = num(2);
      const ny = (y ?? 0) + ty;
      if (y !== null && Math.abs(ty) > 0.5) br(); else if (tx > 0) line += ' ';
      y = ny;
    } else if (o === 'Tm') {
      const f = num(1);
      if (y !== null && Math.abs(f - y) > 0.5) br(); else line += ' ';
      y = f;
    } else if (o === 'T*') br();
    else if (o === 'Tj') { const s = a.find(x => x.t === 'str'); if (s) show(s.v); }
    else if (o === "'" || o === '"') { br(); const s = a.find(x => x.t === 'str'); if (s) show(s.v); }
    else if (o === 'TJ') {
      const list = (a.find(x => x.t === 'arr') || { v: [] }).v;
      for (const x of list) {
        if (x.t === 'str') show(x.v);
        else if (x.t === 'num' && x.v < -200) line += ' ';
      }
    }
  }
  br();
  return lines;
}

function pdfText(buf) {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
    if (!b.length) return '';
    const objs = pdfObjects(b);
    const fonts = pdfFonts(objs);
    const lines = [];
    for (const st of pdfContents(objs)) lines.push(...contentText(st, fonts));
    const text = lines.join('\n').trim();
    return /[\p{L}\p{N}]/u.test(text) ? text : '';
  } catch {
    return '';
  }
}

// ── Values ────────────────────────────────────────────────────────────────────
const CURRENCY = [
  [/₪|ש"ח|ש״ח|שח|שקל|\bNIS\b|\bILS\b/i, 'ILS'],
  [/\$|\bUSD\b|דולר/i, 'USD'],
  [/€|\bEUR\b|יורו|אירו/i, 'EUR'],
  [/£|\bGBP\b|ליש"ט|לירה/i, 'GBP'],
  [/\bJPY\b|¥|ין/i, 'JPY'],
  [/\bCHF\b|פרנק/i, 'CHF'],
];
function currencyOf(s) {
  const t = clean(s);
  if (!t) return null;
  if (/^[A-Z]{3}$/i.test(t)) return t.toUpperCase() === 'NIS' ? 'ILS' : t.toUpperCase();
  for (const [re, code] of CURRENCY) if (re.test(t)) return code;
  return null;
}

// "1,234.50" "-1,234.50" "1,234.50-" "(1,234.50)" "₪ 99.90" "$12" → { value, currency } | null
function parseAmount(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? { value: s, currency: null } : null;
  let t = clean(s);
  if (!t) return null;
  const currency = currencyOf(t);
  t = t.replace(/₪|ש"ח|ש״ח|NIS|ILS|USD|EUR|GBP|[$€£¥]/gi, '').replace(/\s+/g, '').replace(/−/g, '-');
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/^-/.test(t)) { neg = !neg; t = t.slice(1); }
  else if (/-$/.test(t)) { neg = !neg; t = t.slice(0, -1); }
  if (/^\+/.test(t)) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  if (t.includes(',') && t.includes('.')) {
    t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (t.includes(',')) {
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : /^\d+,\d{1,2}$/.test(t) ? t.replace(',', '.') : null;
    if (t === null) return null;
  } else if ((t.match(/\./g) || []).length > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(t)) return null;
    t = t.replace(/\./g, '');
  }
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return { value: round2(neg ? -v : v), currency };
}

const validYmd = (y, m, d) => {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const DATE_RE = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)|(?<![\d.])(\d{1,2})([./-])(\d{1,2})\5(\d{4}|\d{2})(?![\d])/;

// First date in a string, Israeli day-first → yyyy-mm-dd | null
function parseDate(s) {
  const t = clean(s);
  if (!t) return null;
  const m = DATE_RE.exec(t);
  if (!m) return null;
  if (m[1]) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  let y = Number(m[7]);
  if (m[7].length === 2) y += y < 70 ? 2000 : 1900;
  return validYmd(y, Number(m[6]), Number(m[4]));
}

// ── Tables → rows ─────────────────────────────────────────────────────────────
const HEADERS = {
  date: ['תאריך', 'תאריך עסקה', 'תאריך העסקה', 'תאריך רכישה', 'תאריך פעולה', 'תאריך התנועה', 'date', 'transaction date', 'trans date', 'posting date', 'booking date'],
  charge_date: ['תאריך חיוב', 'תאריך ערך', 'מועד חיוב', 'charge date', 'value date', 'billing date'],
  merchant: ['שם בית העסק', 'שם בית עסק', 'בית עסק', 'בית העסק', 'שם העסק', 'merchant', 'merchant name', 'payee', 'business name'],
  description: ['תיאור', 'פרטים', 'תיאור התנועה', 'תאור', 'תאור התנועה', 'הפעולה', 'סוג פעולה', 'description', 'details', 'memo', 'narrative'],
  reference: ['אסמכתא', 'אסמכתה', 'מספר אסמכתא', 'מס שובר', 'reference', 'ref', 'reference number'],
  charge_amount: ['סכום חיוב', 'סכום החיוב', 'סכום לחיוב', 'charge amount', 'billing amount', 'billed amount'],
  tx_amount: ['סכום העסקה', 'סכום עסקה', 'סכום עסקה מקורי', 'סכום מקורי', 'transaction amount', 'original amount'],
  amount: ['סכום', 'סכום בש"ח', 'amount', 'sum'],
  debit: ['חובה', 'בחובה', 'חיוב', 'debit', 'withdrawal', 'withdrawals', 'paid out', 'money out'],
  credit: ['זכות', 'בזכות', 'זיכוי', 'credit', 'deposit', 'deposits', 'paid in', 'money in'],
  balance: ['יתרה', 'יתרה בש"ח', 'יתרה משוערכת', 'balance', 'running balance'],
  currency_charge: ['מטבע חיוב', 'מטבע החיוב', 'charge currency', 'billing currency'],
  currency_tx: ['מטבע עסקה', 'מטבע העסקה', 'מטבע מקור', 'מטבע מקורי', 'transaction currency', 'original currency'],
  currency: ['מטבע', 'currency'],
  notes: ['הערות', 'הערה', 'notes', 'note', 'comments'],
};
const normHead = s => clean(s).toLowerCase().replace(/[״]/g, '"').replace(/[׳]/g, "'").replace(/\([^)]*\)|[₪$€:*]/g, '').replace(/['.]/g, ' ').replace(/\s+/g, ' ').trim();
const ALIASES = Object.entries(HEADERS).flatMap(([f, list]) => list.map(a => [normHead(a), f])).sort((a, b) => b[0].length - a[0].length);

function headerField(cell) {
  const h = normHead(cell);
  if (!h || h.length > 40) return null;
  for (const [a, f] of ALIASES) if (h === a) return f;
  for (const [a, f] of ALIASES) if (a.length >= 3 && (h.startsWith(a + ' ') || h.endsWith(' ' + a) || h.includes(' ' + a + ' '))) return f;
  return null;
}

function headerColumns(row) {
  const cols = {};
  row.forEach((c, i) => {
    const f = headerField(c);
    if (f && !(f in cols)) cols[f] = i;
  });
  return cols;
}

const hasDate = c => 'date' in c || 'charge_date' in c;
const hasAmount = c => ['amount', 'charge_amount', 'tx_amount', 'debit', 'credit'].some(f => f in c);
const TOTAL_RE = /סה"כ|סה״כ|סהכ|סך הכל|סך הכול|\btotal\b|\bsubtotal\b|יתרת סגירה|יתרה לסוף/i;

function guessKind(columns, text) {
  if ('merchant' in columns || 'charge_amount' in columns || 'tx_amount' in columns) return 'card';
  if ('debit' in columns || 'credit' in columns || 'balance' in columns) return 'bank';
  if (text && /כרטיס|בית העסק|credit card|card ending|מסטרקארד|ויזה|visa|mastercard|אמריקן אקספרס|ישראכרט/i.test(text)) return 'card';
  return 'bank';
}

function skipWarnings(skipped) {
  const w = [];
  if (skipped.total) w.push(`דולגו ${skipped.total} שורות סיכום`);
  if (skipped.date) w.push(`דולגו ${skipped.date} שורות ללא תאריך תקין`);
  if (skipped.amount) w.push(`דולגו ${skipped.amount} שורות ללא סכום`);
  return w;
}

function tableToRows(table, opts = {}) {
  const t = (table || []).map(r => (r || []).map(c => clean(c)));
  let headerRow = -1, columns = {}, bestScore = 0;
  for (let i = 0; i < Math.min(30, t.length); i++) {
    const c = headerColumns(t[i]);
    const score = Object.keys(c).length;
    if (hasDate(c) && hasAmount(c) && score >= 2) { headerRow = i; columns = c; break; }
    if (score >= 2 && score > bestScore) { bestScore = score; headerRow = i; columns = c; }
  }
  const empty = (warnings, kind) => ({ rows: [], columns, headerRow, warnings, kind });
  if (headerRow < 0) return empty(['לא נמצאה שורת כותרות (תאריך / סכום) ב-30 השורות הראשונות'], null);
  if (!hasDate(columns) || !hasAmount(columns)) return empty([`בשורת הכותרות חסרה עמודת ${hasDate(columns) ? 'סכום' : 'תאריך'}`], null);
  const kind = opts.kind && opts.kind !== 'auto' ? opts.kind : guessKind(columns);
  const cell = (r, f) => (f in columns ? r[columns[f]] ?? '' : '');
  const rows = [];
  const skipped = { total: 0, date: 0, amount: 0 };
  for (let i = headerRow + 1; i < t.length; i++) {
    const r = t[i];
    if (!r.some(c => c)) continue;
    if (r.some(c => TOTAL_RE.test(c))) { skipped.total++; continue; }
    const occurred = parseDate(cell(r, 'date')) || parseDate(cell(r, 'charge_date'));
    if (!occurred) {
      // a repeated header (multi-section exports) is not an error
      if (Object.keys(headerColumns(r)).length < 2) skipped.date++;
      continue;
    }
    let amount = null, direction = null, currency = null;
    const deb = parseAmount(cell(r, 'debit')), cre = parseAmount(cell(r, 'credit'));
    if ((deb && deb.value) || (cre && cre.value)) {
      const d = deb ? deb.value : 0, c = cre ? cre.value : 0;
      const net = round2(Math.abs(c) - Math.abs(d));
      if (Math.abs(d) && Math.abs(c)) { amount = Math.abs(net); direction = net < 0 ? 'expense' : 'income'; }
      else if (Math.abs(d)) { amount = Math.abs(d); direction = 'expense'; }
      else { amount = Math.abs(c); direction = 'income'; }
      currency = (deb && deb.currency) || (cre && cre.currency);
    } else {
      const charge = parseAmount(cell(r, 'charge_amount'));
      const src = charge && charge.value ? ['charge_amount', charge] : [['amount'], ['tx_amount']].map(([f]) => [f, parseAmount(cell(r, f))]).find(([, a]) => a && a.value);
      if (src) {
        const [f, a] = src;
        amount = Math.abs(a.value);
        direction = kind === 'card' ? (a.value < 0 ? 'income' : 'expense') : (a.value < 0 ? 'expense' : 'income');
        currency = a.currency || currencyOf(cell(r, f === 'charge_amount' ? 'currency_charge' : f === 'tx_amount' ? 'currency_tx' : 'currency'));
        if (!currency && f === 'charge_amount' && !('currency_charge' in columns)) currency = 'ILS';
      }
    }
    if (!amount) { skipped.amount++; continue; }
    if (!currency) currency = currencyOf(cell(r, 'currency')) || 'ILS';
    const merchantCol = cell(r, 'merchant');
    const desc = cell(r, 'description');
    const notes = cell(r, 'notes');
    const merchant = merchantCol || desc || notes || '';
    const description = [merchantCol ? desc : '', merchant !== notes ? notes : ''].filter(Boolean).join(' · ') || null;
    rows.push({
      occurred_on: occurred, amount: round2(amount), direction, merchant, description, currency,
      reference: cell(r, 'reference') || null, raw: r,
    });
  }
  const warnings = skipWarnings(skipped);
  if (!rows.length) warnings.push('לא נמצאו תנועות');
  return { rows, columns, headerRow, warnings, kind };
}

// ── Free text (PDF) → rows ────────────────────────────────────────────────────
const AMOUNT_TOKEN = /(?<![\d.,/:])(?:[-−]\s?)?(?:[₪$€£]\s?)?(?:\(\s?)?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?:\s?\))?(?:\s?-)?(?:\s?[₪$€£])?(?![\d,/])/g;
const DATE_TOKEN = /(?<!\d)(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2}))(?![\d])/g;

function textToRows(text, opts = {}) {
  const lines = String(text ?? '').split(/\r?\n/).map(clean).filter(Boolean);
  const kind = opts.kind && opts.kind !== 'auto' ? opts.kind : guessKind({}, text);
  const rows = [];
  const skipped = { total: 0, date: 0, amount: 0 };
  let multi = 0;
  for (const line of lines) {
    const dates = line.match(DATE_TOKEN) || [];
    const amounts = (line.replace(DATE_TOKEN, ' ').match(AMOUNT_TOKEN) || []).map(a => parseAmount(a)).filter(Boolean);
    if (!dates.length || !amounts.length) continue;
    if (TOTAL_RE.test(line)) { skipped.total++; continue; }
    const occurred = dates.map(parseDate).find(Boolean);
    if (!occurred) { skipped.date++; continue; }
    const a = amounts[0];
    if (!a.value) { skipped.amount++; continue; }
    if (amounts.length > 1) multi++;
    let rest = line.replace(DATE_TOKEN, ' ').replace(AMOUNT_TOKEN, ' ');
    const refM = /(?<![\d.,])\d{5,}(?![\d.,])/.exec(rest);
    if (refM) rest = rest.replace(refM[0], ' ');
    const merchant = clean(rest.replace(/[₪$€£|]/g, ' ').replace(/(^|\s)[-–—:]+(?=\s|$)/g, ' '));
    rows.push({
      occurred_on: occurred, amount: Math.abs(a.value),
      direction: kind === 'card' ? (a.value < 0 ? 'income' : 'expense') : (a.value < 0 ? 'expense' : 'income'),
      merchant, description: null, currency: a.currency || currencyOf(line) || 'ILS',
      reference: refM ? refM[0] : null, raw: [line],
    });
  }
  const warnings = skipWarnings(skipped);
  if (multi) warnings.push(`ב-${multi} שורות נמצאו כמה סכומים — נלקח הראשון; יש לבדוק`);
  if (rows.length) warnings.push('חילוץ מ-PDF הוא משוער — בדוק כיוון (הוצאה/הכנסה) וסכומים לפני שמירה');
  else warnings.push('לא נמצאו שורות עם תאריך וסכום');
  return { rows, columns: {}, headerRow: -1, warnings, kind };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
function parseStatement(buf, filename = '', mime = '', opts = {}) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const ext = (/\.([a-z0-9]+)$/i.exec(filename || '') || [])[1]?.toLowerCase() || '';
  const mt = String(mime || '').toLowerCase();
  const fail = (format, error, warnings = []) => ({ format, rows: [], columns: {}, warnings, error });
  const magic = b.subarray(0, 8);
  let format = 'csv';
  if (magic[0] === 0x50 && magic[1] === 0x4b) format = 'xlsx';
  else if (b.subarray(0, 1024).toString('latin1').includes('%PDF')) format = 'pdf';
  else if (ext === 'xlsx' || ext === 'xls' || /spreadsheet|excel/.test(mt)) format = 'xlsx';
  else if (ext === 'pdf' || mt === 'application/pdf') format = 'pdf';
  try {
    if (!b.length) return fail(format, 'הקובץ ריק');
    if (magic.length >= 4 && magic.readUInt32BE(0) === 0xd0cf11e0) return fail('xlsx', 'קובץ Excel ישן (xls) — שמור כ-xlsx או CSV');
    if ((magic[0] === 0xff && magic[1] === 0xd8) || magic.toString('latin1', 1, 4) === 'PNG' || /^image\//.test(mt)) {
      return fail(format, 'קובץ תמונה — נדרש OCR שאינו זמין כאן; העלה CSV, Excel או PDF טקסטואלי');
    }
    if (format === 'xlsx' && magic[0] === 0x50) {
      const sheets = readXlsx(b);
      let first = null;
      for (const s of sheets) {
        const r = tableToRows(s.rows, opts);
        if (r.rows.length) return { format, rows: r.rows, columns: r.columns, warnings: sheets.length > 1 ? [`נקרא הגיליון "${s.name}"`, ...r.warnings] : r.warnings, kind: r.kind };
        first = first || r;
      }
      return { ...fail(format, 'לא נמצאו תנועות בקובץ', first ? first.warnings : []), columns: first ? first.columns : {} };
    }
    if (format === 'pdf') {
      const text = pdfText(b);
      if (!text) return fail('pdf', 'לא נמצא טקסט קריא ב-PDF (ייתכן שהוא סרוק — נדרש OCR שאינו זמין כאן)');
      const r = textToRows(text, opts);
      if (!r.rows.length) return fail('pdf', 'לא נמצאו תנועות ב-PDF', r.warnings);
      return { format, rows: r.rows, columns: r.columns, warnings: r.warnings, kind: r.kind };
    }
    // Text: CSV/TSV, or an "xls" that is really HTML / Excel-2003 XML
    const sample = b.subarray(0, 4096);
    if (sample.filter(x => x === 0).length > 8) return fail(format, 'סוג קובץ לא נתמך');
    const text = decodeText(b);
    let table, warnings = [];
    if (/<table\b/i.test(text)) { table = htmlTable(text); warnings.push('הקובץ הוא טבלת HTML (ייצוא "xls" של הבנק)'); }
    else if (/<(?:ss:)?Workbook\b/.test(text)) { table = xmlSpreadsheet(text); warnings.push('הקובץ הוא Excel 2003 XML'); }
    else table = parseCsv(text);
    let r = tableToRows(table, opts);
    if (!r.rows.length && r.headerRow < 0) {
      const t = textToRows(text, opts);
      if (t.rows.length) r = t;
    }
    if (!r.rows.length) return { ...fail(format, 'לא נמצאו תנועות בקובץ', [...warnings, ...r.warnings]), columns: r.columns };
    return { format, rows: r.rows, columns: r.columns, warnings: [...warnings, ...r.warnings], kind: r.kind };
  } catch (e) {
    return fail(format, e && /[֐-׿]/.test(e.message) ? e.message : `שגיאה בקריאת הקובץ: ${e && e.message}`);
  }
}

// ── Receipts / invoices ───────────────────────────────────────────────────────
const NUM_IN_LINE = /(?<![\d.,/\-:])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?![\d/%:]|\.\d|\s?%)/g;
const lineAmounts = line => (line.replace(DATE_TOKEN, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ').match(NUM_IN_LINE) || [])
  .map(x => parseAmount(x)).filter(Boolean).map(a => a.value);

function parseReceiptText(text) {
  const raw = String(text ?? '').replace(/״/g, '"').replace(/׳/g, "'").replace(/[“”]/g, '"');
  const lines = raw.split(/\r?\n/).map(clean).filter(Boolean);
  const out = { supplier: null, date: null, document_number: null, total: null, vat: null, vat_rate: null, currency: null, tax_id: null };

  const TAX_RE = /(?:ע\.\s?מ\.?|ח\.\s?פ\.?|ע"מ|ח"פ|עוסק\s+(?:מורשה|פטור)|מס['\s]*עוסק|tax\s*id|vat\s*(?:no|number|reg(?:istration)?)\.?|company\s*(?:no|id)\.?|reg\.?\s*no\.?)\s*[:#.]?\s*(?:מס['.]?\s*)?[:#]?\s*(\d[\d-]{3,10}\d)/i;
  for (const l of lines) {
    const m = TAX_RE.exec(l);
    if (m) { const d = m[1].replace(/-/g, ''); if (d.length >= 5 && d.length <= 9) { out.tax_id = d; break; } }
  }

  const DOC_RE = /(?:חשבונית\s+מס(?:\s*\/?\s*קבלה)?|חשבונית|קבלה|תעודת\s+משלוח|invoice|receipt|tax\s+invoice)\s*(?:מס['.]?|מספר|#|no\.?|number)?\s*[:#.]?\s*([A-Z]{0,4}-?\d[\d/-]{1,19})/i;
  const DOC2_RE = /(?:^|\s)(?:מס['.]|מספר\s+מסמך|מספר)\s*[:#]?\s*(\d[\d/-]{1,19})/;
  for (const l of lines) {
    if (/עוסק|ח\.\s?פ|ע\.\s?מ|ח"פ|ע"מ|טל|phone|tel|fax|פקס/i.test(l) && !/חשבונית|קבלה|invoice|receipt/i.test(l)) continue;
    const m = DOC_RE.exec(l) || DOC2_RE.exec(l);
    if (m && !parseDate(m[1])) { out.document_number = m[1]; break; }
  }

  for (const l of lines) { const d = parseDate(l); if (d) { out.date = d; break; } }

  const TOTAL_LBL = /סה"כ|סה כ|סך הכל|סך הכול|לתשלום|\btotal\b|amount\s+due|balance\s+due|grand\s+total/i;
  const VAT_LBL = /מע"מ|מעמ|\bvat\b/i;
  const totals = [];
  lines.forEach((l, i) => {
    if (!TOTAL_LBL.test(l)) return;
    let nums = lineAmounts(l).filter(v => v > 0);
    if (!nums.length && lines[i + 1] && !/[\p{L}]{2,}/u.test(lines[i + 1])) nums = lineAmounts(lines[i + 1]).filter(v => v > 0);
    totals.push(...nums);
  });
  if (totals.length) out.total = Math.max(...totals);

  for (const l of lines) {
    if (!VAT_LBL.test(l)) continue;
    if (/כולל|incl|לפני|before|ללא|excl|without|פטור|exempt/i.test(l)) {
      const p = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(l);
      if (p && out.vat_rate === null) out.vat_rate = Number((Number(p[1]) / 100).toFixed(4));
      continue;
    }
    const p = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(l);
    if (p && out.vat_rate === null) out.vat_rate = Number((Number(p[1]) / 100).toFixed(4));
    const nums = lineAmounts(l.replace(/(\d{1,2}(?:\.\d+)?)\s*%/g, ' ')).filter(v => v > 0);
    if (nums.length && out.vat === null) out.vat = nums[nums.length - 1];
  }
  if (out.vat !== null && out.total !== null && out.vat >= out.total) out.vat = null;

  for (const [re, code] of CURRENCY.slice(0, 4)) if (re.test(raw)) { out.currency = code; break; }

  const LABEL = /חשבונית|קבלה|העתק|מקור|נאמן למקור|תאריך|invoice|receipt|copy|original|date|page|עמוד|טל|tel|phone|fax|פקס|www\.|@|http|כתובת|address|לכבוד|bill to|customer|לקוח/i;
  for (const l of lines.slice(0, 12)) {
    if (LABEL.test(l) || TAX_RE.test(l) || TOTAL_LBL.test(l) || VAT_LBL.test(l)) continue;
    if (parseDate(l) || !/[\p{L}]{2,}/u.test(l)) continue;
    if ((l.match(/\d/g) || []).length > l.length / 3) continue;
    out.supplier = l;
    break;
  }
  return out;
}

module.exports = {
  decodeText, parseCsv, readXlsx, pdfText, tableToRows, textToRows, parseStatement, parseReceiptText,
  parseAmount, parseDate, excelDate, currencyOf,
};
