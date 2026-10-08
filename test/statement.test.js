'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const S = require('../lib/statement');

// ── Fixture builders (fake demo data only) ───────────────────────────────────
// Hebrew → windows-1255 bytes (letters only; everything else ASCII)
const to1255 = s => Buffer.from([...s].map(c => {
  const cp = c.codePointAt(0);
  if (cp >= 0x05d0 && cp <= 0x05ea) return 0xe0 + cp - 0x05d0;
  if (cp < 0x80) return cp;
  throw new Error(`no 1255 byte for ${c}`);
}));

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zip(files) {
  const locals = [], centrals = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nm = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, comp);
    centrals.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length / 2, 8); eocd.writeUInt16LE(centrals.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

// A card statement: shared strings (one rich text), an inline string, a date cell (style 1 → numFmt 14)
// and a custom date format (style 2 → numFmt 164 "dd/mm/yyyy"); column C left empty on purpose
function cardXlsx() {
  const sst = ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'קפה הדמו', 'סה"כ', 'מטבע'];
  const si = sst.map((s, i) => (i === 1 ? '<si><r><rPr><b/></rPr><t>שם בית</t></r><r><t xml:space="preserve"> העסק</t></r></si>' : `<si><t>${s.replace(/"/g, '&quot;')}</t></si>`)).join('');
  // 46000 = 2025-12-09 ; 46001 = 2025-12-10
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>דוח דמו &amp; בדיקה</t></is></c></row>
<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="D3" t="s"><v>2</v></c><c r="E3" t="s"><v>5</v></c></row>
<row r="4"><c r="A4" s="1"><v>46000</v></c><c r="B4" t="s"><v>3</v></c><c r="D4"><v>42.5</v></c><c r="E4" t="str"><v>₪</v></c></row>
<row r="5"><c r="A5" s="2"><v>46001</v></c><c r="B5" t="inlineStr"><is><t>חנות &quot;בדיה&quot;</t></is></c><c r="D5"><v>-19.9</v></c></row>
<row r="6"><c r="B6" t="s"><v>4</v></c><c r="D6"><v>22.6</v></c></row>
</sheetData></worksheet>`;
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ריק" sheetId="1" r:id="rId2"/><sheet name="עסקאות" sheetId="2" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/empty.xml"/></Relationships>',
    'xl/worksheets/empty.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>הערות</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst count="${sst.length}">${si}</sst>`,
    'xl/styles.xml': '<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164"/></cellXfs></styleSheet>',
  });
}

// A one-page PDF with a FlateDecode content stream (Tj, TJ, Td line breaks), xref omitted (readers tolerate it)
function pdf(content, extraObjs = []) {
  const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const parts = [
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n'),
    Buffer.from(`4 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from('\nendstream\nendobj\n'),
    Buffer.from('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'),
    ...extraObjs.map(o => Buffer.from(o)),
    Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n'),
  ];
  return Buffer.concat(parts);
}

// ── decodeText / parseCsv ────────────────────────────────────────────────────
test('decodeText: UTF-8 with BOM, windows-1255 fallback', () => {
  assert.equal(S.decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('תאריך,סכום')])), 'תאריך,סכום');
  assert.equal(S.decodeText(to1255('תאריך,סכום,קפה הדמו')), 'תאריך,סכום,קפה הדמו');
  assert.equal(S.decodeText(Buffer.alloc(0)), '');
});

test('parseCsv: quotes, escaped quotes, CRLF, delimiter detection, trimming', () => {
  assert.deepEqual(S.parseCsv('a,b,c\r\n"1,5", "say ""hi""" ,3\r\n\r\nx,y,z'), [['a', 'b', 'c'], ['1,5', 'say "hi"', '3'], ['x', 'y', 'z']]);
  assert.deepEqual(S.parseCsv('a;b\n1,5;2\n3;4'), [['a', 'b'], ['1,5', '2'], ['3', '4']]);
  assert.deepEqual(S.parseCsv('a\tb\tc\n1\t2\t3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(S.parseCsv('a|b\n"multi\nline"|2'), [['a', 'b'], ['multi\nline', '2']]);
});

// ── values ───────────────────────────────────────────────────────────────────
test('parseAmount / parseDate: Israeli formats', () => {
  assert.deepEqual(S.parseAmount('1,234.50'), { value: 1234.5, currency: null });
  assert.equal(S.parseAmount('‎-1,234.50').value, -1234.5);
  assert.equal(S.parseAmount('1,234.50-').value, -1234.5);
  assert.equal(S.parseAmount('(1,234.50)').value, -1234.5);
  assert.deepEqual(S.parseAmount('₪ 99.90'), { value: 99.9, currency: 'ILS' });
  assert.deepEqual(S.parseAmount('$12'), { value: 12, currency: 'USD' });
  assert.equal(S.parseAmount('abc'), null);
  assert.equal(S.parseAmount(''), null);
  assert.equal(S.parseDate('05/03/2026'), '2026-03-05');
  assert.equal(S.parseDate('5.3.26'), '2026-03-05');
  assert.equal(S.parseDate('05-03-2026 10:22'), '2026-03-05');
  assert.equal(S.parseDate('2026-03-05'), '2026-03-05');
  assert.equal(S.parseDate('31/02/2026'), null);
  assert.equal(S.excelDate(46000), '2025-12-09');
  assert.equal(S.excelDate(1), '1900-01-01');
});

// ── tables ───────────────────────────────────────────────────────────────────
test('card statement CSV (windows-1255): header found below a title, charge amount preferred, refund = income, total skipped', () => {
  const csv = [
    'פירוט עסקאות דמו',
    '',
    'תאריך עסקה,שם בית העסק,סכום עסקה,סכום חיוב,הערות',
    '01/09/2026,סופר הדמו,"1,250.00","1,250.00",',
    '03/09/26,מסעדה בדויה,$40.00,152.80,עסקה במטבע חוץ',
    '07/09/2026,סופר הדמו,-80.00,-80.00,זיכוי',
    ',סה"כ,,"1,322.80",',
    'לא תאריך,משהו,10,10,',
  ].join('\r\n');
  const r = S.parseStatement(to1255(csv), 'card.csv', 'text/csv');
  assert.equal(r.format, 'csv');
  assert.equal(r.error, undefined);
  assert.equal(r.kind, 'card');
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows[0], { occurred_on: '2026-09-01', amount: 1250, direction: 'expense', merchant: 'סופר הדמו', description: null, currency: 'ILS', reference: null, raw: ['01/09/2026', 'סופר הדמו', '1,250.00', '1,250.00', ''] });
  assert.equal(r.rows[1].amount, 152.8);
  assert.equal(r.rows[1].currency, 'ILS');
  assert.equal(r.rows[1].description, 'עסקה במטבע חוץ');
  assert.equal(r.rows[2].direction, 'income');
  assert.equal(r.rows[2].amount, 80);
  assert.equal(r.columns.charge_amount, 3);
  assert.ok(r.warnings.some(w => w.includes('1 שורות סיכום')));
  assert.ok(r.warnings.some(w => w.includes('1 שורות ללא תאריך')));
});

test('bank statement: debit/credit columns, balance ignored, reference kept', () => {
  const table = [
    ['תאריך', 'תאריך ערך', 'תיאור התנועה', 'אסמכתא', 'חובה', 'זכות', 'יתרה בש"ח'],
    ['02.09.2026', '02.09.2026', 'העברה מלקוח דמו', '99001', '', '5,000.00', '12,000.00'],
    ['04.09.2026', '04.09.2026', 'שכר דירה דמו', '99002', '3,200.00', '', '8,800.00'],
    ['', '', 'יתרת סגירה', '', '', '', '8,800.00'],
  ];
  const r = S.tableToRows(table);
  assert.equal(r.headerRow, 0);
  assert.equal(r.kind, 'bank');
  assert.deepEqual(r.rows.map(x => [x.occurred_on, x.amount, x.direction, x.merchant, x.reference]), [
    ['2026-09-02', 5000, 'income', 'העברה מלקוח דמו', '99001'],
    ['2026-09-04', 3200, 'expense', 'שכר דירה דמו', '99002'],
  ]);
  assert.equal(r.columns.balance, 6);
});

test('bank statement with a single signed amount column; English headers; kind override', () => {
  const table = [['Date', 'Description', 'Amount', 'Currency'], ['2026-09-01', 'Demo Client', '1,000.00', 'USD'], ['2026-09-02', 'Demo Hosting', '-25.00', 'USD'], ['', 'Total', '975.00', '']];
  const r = S.tableToRows(table);
  assert.deepEqual(r.rows.map(x => [x.direction, x.amount, x.currency]), [['income', 1000, 'USD'], ['expense', 25, 'USD']]);
  const asCard = S.tableToRows(table, { kind: 'card' });
  assert.deepEqual(asCard.rows.map(x => x.direction), ['expense', 'income']);
  assert.ok(S.tableToRows([['x', 'y'], ['1', '2']]).warnings[0].includes('כותרות'));
});

// ── XLSX ─────────────────────────────────────────────────────────────────────
test('readXlsx: shared strings (rich text), inline strings, date formats, gaps, sheet names', () => {
  const sheets = S.readXlsx(cardXlsx());
  assert.deepEqual(sheets.map(s => s.name), ['ריק', 'עסקאות']);
  const rows = sheets[1].rows;
  assert.deepEqual(rows[0], ['דוח דמו & בדיקה']);
  assert.deepEqual(rows[1], []);
  assert.deepEqual(rows[2], ['תאריך עסקה', 'שם בית העסק', '', 'סכום חיוב', 'מטבע']);
  assert.deepEqual(rows[3], ['2025-12-09', 'קפה הדמו', '', '42.5', '₪']);
  assert.equal(rows[4][0], '2025-12-10');
  assert.equal(rows[4][1], 'חנות "בדיה"');
  assert.throws(() => S.readXlsx(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), /xls/);
});

test('parseStatement xlsx: picks the first sheet with rows, card refund, totals row skipped', () => {
  const r = S.parseStatement(cardXlsx(), 'demo.xlsx');
  assert.equal(r.format, 'xlsx');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows.map(x => [x.occurred_on, x.merchant, x.amount, x.direction]), [
    ['2025-12-09', 'קפה הדמו', 42.5, 'expense'],
    ['2025-12-10', 'חנות "בדיה"', 19.9, 'income'],
  ]);
  assert.ok(r.warnings.some(w => w.includes('עסקאות')));
  assert.ok(r.warnings.some(w => w.includes('סיכום')));
});

// ── PDF ──────────────────────────────────────────────────────────────────────
test('pdfText: FlateDecode stream with Tj / TJ, escapes and line breaks', () => {
  const content = 'BT /F1 10 Tf 50 700 Td (Demo Bank Statement) Tj 0 -14 Td (01/09/2026 Demo Coffee \\(TLV\\)) Tj [( -) -300 (42.50)] TJ 0 -14 Td <30322F30392F32303236> Tj ( Demo Salary 5,000.00) Tj T* (Total 4,957.50) Tj ET';
  const text = S.pdfText(pdf(content));
  assert.deepEqual(text.split('\n'), ['Demo Bank Statement', '01/09/2026 Demo Coffee (TLV) - 42.50', '02/09/2026 Demo Salary 5,000.00', 'Total 4,957.50']);
  const r = S.parseStatement(pdf(content), 'statement.pdf', 'application/pdf', { kind: 'bank' });
  assert.equal(r.format, 'pdf');
  assert.deepEqual(r.rows.map(x => [x.occurred_on, x.amount, x.direction]), [['2026-09-01', 42.5, 'expense'], ['2026-09-02', 5000, 'income']]);
  assert.equal(r.rows[0].merchant, 'Demo Coffee (TLV)');
});

test('pdfText: ToUnicode CMap (bfchar + bfrange) decodes a Hebrew CID font by resource name', () => {
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange\n'
    + '2 beginbfchar <0001> <05E7> <0002> <0020> endbfchar\n1 beginbfrange <0010> <0012> <05E4> endbfrange\n'
    + '1 beginbfrange <0020> <0021> [<0031> <0032>] endbfrange endcmap end end';
  const extra = [
    '6 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /DemoHebrew /Encoding /Identity-H /ToUnicode 7 0 R >>\nendobj\n',
    `7 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj\n`,
  ];
  // 0001→ק, 0010..0011→פ ץ (range), 0002→space, 0020..0021→1 2 (array range)
  const content = 'BT /F2 12 Tf 10 10 Td <0001001000110002> Tj <00200021> Tj ET BT /F1 12 Tf 10 30 Tm (Latin) Tj ET';
  assert.deepEqual(S.pdfText(pdf(content, extra)).split('\n'), ['קפץ 12', 'Latin']);
});

test('pdfText / parseStatement never throw on garbage; scanned PDFs report OCR', () => {
  assert.equal(S.pdfText(Buffer.from('%PDF-1.4 garbage stream\nxx\nendstream')), '');
  assert.equal(S.pdfText(Buffer.alloc(0)), '');
  assert.equal(S.pdfText(Buffer.from([1, 2, 3, 4, 5])), '');
  assert.match(S.parseStatement(Buffer.from('%PDF-1.4\n%%EOF'), 'scan.pdf').error, /OCR/);
  assert.match(S.parseStatement(Buffer.alloc(0), 'x.csv').error, /ריק/);
  assert.match(S.parseStatement(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]), 'old.xls').error, /xls/);
  assert.match(S.parseStatement(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'r.jpg').error, /OCR/);
  assert.ok(S.parseStatement(Buffer.from('PK\x03\x04broken'), 'b.xlsx').error);
  assert.ok(S.parseStatement(Buffer.from('just some words\nno data'), 'n.csv').error);
});

test('parseStatement: an "xls" that is really an HTML table', () => {
  const html = '<html><body><table><tr><th>תאריך</th><th>תיאור</th><th>חובה</th><th>זכות</th></tr>'
    + '<tr><td>10/09/2026</td><td>חברת&nbsp;דמו</td><td>150.00</td><td></td></tr></table></body></html>';
  const r = S.parseStatement(Buffer.from(html), 'export.xls');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows.map(x => [x.occurred_on, x.merchant, x.amount, x.direction]), [['2026-09-10', 'חברת דמו', 150, 'expense']]);
});

test('textToRows: lines with a date and an amount; totals skipped', () => {
  const r = S.textToRows('פירוט כרטיס דמו\n05/09/2026 חנות דמו 120.00\n06/09/2026 החזר חנות דמו -30.00\nסה"כ 90.00 30/09/2026\nשורה בלי סכום 07/09/2026');
  assert.equal(r.kind, 'card');
  assert.deepEqual(r.rows.map(x => [x.occurred_on, x.merchant, x.amount, x.direction]), [
    ['2026-09-05', 'חנות דמו', 120, 'expense'], ['2026-09-06', 'החזר חנות דמו', 30, 'income'],
  ]);
  assert.ok(r.warnings.some(w => w.includes('סיכום')));
});

// ── receipts ─────────────────────────────────────────────────────────────────
test('parseReceiptText: Hebrew tax invoice', () => {
  const text = [
    'סטודיו דמו בע"מ',
    'ח.פ. 512345678',
    'רחוב הבדיה 1, תל אביב  טל 03-0000000',
    'חשבונית מס / קבלה מס\' 2045',
    'תאריך: 14/09/2026',
    'שירותי עיצוב   1   500.00',
    'סה"כ לפני מע"מ 500.00',
    'מע"מ 18% 90.00',
    'סה״כ לתשלום ₪590.00',
  ].join('\n');
  assert.deepEqual(S.parseReceiptText(text), {
    supplier: 'סטודיו דמו בע"מ', date: '2026-09-14', document_number: '2045', total: 590, vat: 90, vat_rate: 0.18, currency: 'ILS', tax_id: '512345678',
  });
});

test('parseReceiptText: English invoice; nothing invented when absent', () => {
  const text = 'Demo Widgets Ltd\nInvoice #INV-1042\nDate: 2026-09-20\nSubtotal 100.00\nVAT 17% 17.00\nTotal $117.00\nAmount due 117.00';
  assert.deepEqual(S.parseReceiptText(text), {
    supplier: 'Demo Widgets Ltd', date: '2026-09-20', document_number: 'INV-1042', total: 117, vat: 17, vat_rate: 0.17, currency: 'USD', tax_id: null,
  });
  assert.deepEqual(S.parseReceiptText('Demo Shop\nthanks!'), {
    supplier: 'Demo Shop', date: null, document_number: null, total: null, vat: null, vat_rate: null, currency: null, tax_id: null,
  });
  assert.equal(S.parseReceiptText('').supplier, null);
});
