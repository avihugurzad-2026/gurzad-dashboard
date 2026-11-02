'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const gm     = require('../lib/gmail');
const gcal   = require('../lib/gcal');

// Fake data only: invented shops, example.* domains, a fake token.
const TOKEN = 'fake-access-token-for-tests';
const b64u = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const u = new URL(String(url));
    calls.push({ url: u, init });
    for (const [match, reply] of routes) {
      if (u.pathname.endsWith(match) || u.pathname.includes(match)) {
        const r = typeof reply === 'function' ? reply(u) : reply;
        const status = r.status ?? 200;
        return new Response(JSON.stringify(r.body ?? r), { status, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('{}', { status: 404 });
  };
  return { impl, calls };
}

test('SCOPE_GMAIL is gmail.readonly; authUrl adds it only when asked, calendar unchanged', () => {
  assert.equal(gm.SCOPE_GMAIL, 'https://www.googleapis.com/auth/gmail.readonly');
  const base = { clientId: 'cid.apps.example', redirectUri: 'https://dash.example/api/google/callback', state: 'st' };
  const cal = new URL(gcal.authUrl(base)).searchParams;
  assert.equal(cal.get('scope'), gcal.SCOPE);
  const both = new URL(gcal.authUrl({ ...base, extraScopes: [gm.SCOPE_GMAIL, gm.SCOPE_GMAIL] })).searchParams;
  assert.equal(both.get('scope'), `${gcal.SCOPE} ${gm.SCOPE_GMAIL}`);
  assert.equal(both.get('include_granted_scopes'), 'true');
  assert.equal(both.get('access_type'), 'offline');
});

test('parseScopes reports gmail only when gmail.readonly is granted', () => {
  assert.equal(gcal.parseScopes(`${gcal.SCOPE} ${gm.SCOPE_GMAIL}`).gmail, true);
  assert.equal(gcal.parseScopes(`${gcal.SCOPE} ${gm.SCOPE_GMAIL}`).write, true);
  assert.equal(gcal.parseScopes(gcal.SCOPE).gmail, false);
  assert.equal(gcal.parseScopes(gm.SCOPE_GMAIL).read, false);
  assert.equal(gcal.parseScopes(null).gmail, false);
});

test('searchQuery: after: in epoch seconds, Hebrew + English terms in one OR group', () => {
  const q = gm.searchQuery({ since: '2026-07-01T00:00:00Z' });
  assert.match(q, /^after:1782864000 /);
  for (const t of ['חשבונית', 'קבלה', '"אישור תשלום"', 'invoice', 'receipt', '"payment confirmation"', 'filename:invoice'])
    assert.ok(q.includes(t), t);
  assert.match(q, /-in:chats/);
  assert.match(q, /\{[^{}]+\}$/);
  const dflt = Number(/after:(\d+)/.exec(gm.searchQuery())[1]);
  assert.ok(Math.abs(dflt - (Date.now() / 1000 - 90 * 86400)) < 60);
  assert.throws(() => gm.searchQuery({ since: 'nonsense' }));
});

test('searchQueries use complementary Hebrew, English and generic-PDF discovery queries', () => {
  const qs = gm.searchQueries({ since: '2026-07-01T00:00:00Z' });
  assert.equal(qs.length, 4);
  assert.ok(qs.every(q => q.startsWith('after:1782864000 -in:chats -category:social ')));
  assert.ok(qs.some(q => q.includes('חשבונית')));
  assert.ok(qs.some(q => q.includes('"tax invoice"')));
  assert.ok(qs.some(q => q.includes('filename:pdf')));
  assert.throws(() => gm.searchQueries({ since: 'nope' }));
});

test('listMessages: paginates, honours max, sends the bearer token and the query', async () => {
  let page = 0;
  const { impl, calls } = fakeFetch([['/messages', () => (++page === 1
    ? { messages: [{ id: 'aaa1', threadId: 't1' }, { id: 'bad id!' }, { id: 'aaa2', threadId: 't2' }], nextPageToken: 'p2' }
    : { messages: [{ id: 'aaa3', threadId: 't3' }, { id: 'aaa4', threadId: 't4' }], nextPageToken: 'p3' })]]);
  const out = await gm.listMessages(TOKEN, 'after:1 invoice', { max: 3, fetchImpl: impl });
  assert.deepEqual(out.map(m => m.id), ['aaa1', 'aaa2', 'aaa3']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('q'), 'after:1 invoice');
  assert.equal(calls[1].url.searchParams.get('pageToken'), 'p2');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('API errors become safe GoogleError codes (no body, no token)', async () => {
  const { impl } = fakeFetch([['/messages', { status: 403, body: { error: { errors: [{ reason: 'insufficientPermissions', message: 'secret detail' }] } } }]]);
  await assert.rejects(gm.listMessages(TOKEN, 'q', { fetchImpl: impl }), e => {
    assert.ok(e instanceof gcal.GoogleError);
    assert.equal(e.code, 'insufficientPermissions');
    assert.ok(!String(e.message).includes(TOKEN) && !String(e.message).includes('secret'));
    return true;
  });
  const { impl: i2 } = fakeFetch([['/profile', { status: 500, body: '<html>' }]]);
  await assert.rejects(gm.getProfile(TOKEN, { fetchImpl: i2 }), e => e.code === 'http_500');
  await assert.rejects(gm.getMessage(TOKEN, '../x', { fetchImpl: impl }), e => e.code === 'bad_id');
});

test('getMessage asks format=full; getAttachment returns the bytes; getProfile the address', async () => {
  const { impl, calls } = fakeFetch([
    ['/attachments/att1', { data: b64u('%PDF-fake'), size: 9 }],
    ['/messages/m1', { id: 'm1', payload: {} }],
    ['/profile', { emailAddress: 'someone@example.com' }],
  ]);
  await gm.getMessage(TOKEN, 'm1', { fetchImpl: impl });
  assert.equal(calls[0].url.searchParams.get('format'), 'full');
  const buf = await gm.getAttachment(TOKEN, 'm1', 'att1', { fetchImpl: impl });
  assert.equal(buf.toString('utf8'), '%PDF-fake');
  assert.deepEqual(await gm.getProfile(TOKEN, { fetchImpl: impl }), { email: 'someone@example.com' });
});

const MSG = {
  id: 'm1',
  internalDate: String(Date.parse('2026-09-14T22:30:00Z')), // 15/09 in Israel
  payload: {
    mimeType: 'multipart/mixed',
    headers: [{ name: 'Subject', value: 'קבלה על תשלום  - הזמנה 5521' }, { name: 'From', value: '"חנות הדוגמה בע\'\'מ" <billing@shop.example>' }],
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: b64u('תודה על הקנייה\nסה"כ לתשלום: 118.00 ₪') } },
        { mimeType: 'text/html', body: { data: b64u('<p>ignored</p>') } },
      ] },
      { mimeType: 'application/pdf', filename: 'invoice-5521.pdf', body: { attachmentId: 'att1', size: 20480 } },
      { mimeType: 'image/png', filename: 'logo.png', body: { data: b64u('png'), size: 3 } },
    ],
  },
};

test('messageParts: headers, Israel date, plain text first, attachments listed (not fetched)', () => {
  const p = gm.messageParts(MSG);
  assert.equal(p.id, 'm1');
  assert.equal(p.subject, 'קבלה על תשלום  - הזמנה 5521');
  assert.equal(p.date, '2026-09-15');
  assert.match(p.text, /סה"כ לתשלום: 118\.00/);
  assert.ok(!p.text.includes('ignored'));
  assert.equal(p.attachments.length, 2);
  assert.deepEqual(p.attachments[0], { filename: 'invoice-5521.pdf', mimeType: 'application/pdf', attachmentId: 'att1', size: 20480 });
  assert.equal(p.attachments[1].data, b64u('png'));
  assert.equal(gm.isPdf(p.attachments[0]), true);
  assert.equal(gm.isPdf(p.attachments[1]), false);
});

test('messageParts: HTML-only body becomes text; windows-1255 charset decodes', () => {
  const html = '<html><head><style>p{}</style></head><body><table><tr><td>Total</td><td>&#36;42.50</td></tr></table><p>Thanks&nbsp;&amp; bye</p><script>x()</script></body></html>';
  const p = gm.messageParts({ id: 'h1', payload: { mimeType: 'text/html', headers: [{ name: 'Date', value: 'Mon, 07 Sep 2026 08:00:00 +0000' }], body: { data: b64u(html) } } });
  assert.equal(p.text, 'Total $42.50\nThanks & bye');
  assert.equal(p.date, '2026-09-07');
  const heb = Buffer.from([0xf7, 0xe1, 0xec, 0xe4]); // "קבלה" in windows-1255
  const q = gm.messageParts({ payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="windows-1255"' }], body: { data: heb.toString('base64url') } } });
  assert.equal(q.text, 'קבלה');
  assert.deepEqual(gm.messageParts(null).attachments, []);
});

test('parseFrom: display name, address, domain', () => {
  assert.deepEqual(gm.parseFrom('"Shop Ltd" <Billing@Shop.Example>'), { name: 'Shop Ltd', address: 'billing@shop.example', domain: 'shop.example' });
  assert.deepEqual(gm.parseFrom('noreply@pay.example.co.il'), { name: null, address: 'noreply@pay.example.co.il', domain: 'pay.example.co.il' });
  assert.deepEqual(gm.parseFrom('a@b.example <a@b.example>'), { name: null, address: 'a@b.example', domain: 'b.example' });
  assert.deepEqual(gm.parseFrom(null), { name: null, address: null, domain: null });
});

const PDF_TEXT = [
  'מאפייה לדוגמה בע"מ',
  'ע.מ 512345678',
  'חשבונית מס קבלה 10042',
  'תאריך: 12/09/2026',
  'סה"כ לפני מע"מ 100.00',
  'מע"מ 18% 18.00',
  'סה"כ לתשלום 118.00',
].join('\n');

test('extractFromMessage: the attachment wins (amount, VAT, number, supplier, date)', () => {
  const r = gm.extractFromMessage({ subject: 'Your receipt', from: 'Bakery <x@bakery.example>', date: '2026-09-15', text: 'Total: 999.00' }, [PDF_TEXT]);
  assert.equal(r.amount, 118);
  assert.equal(r.vat_amount, 18);
  assert.equal(r.document_number, '10042');
  assert.equal(r.occurred_on, '2026-09-12');
  assert.equal(r.merchant, 'מאפייה לדוגמה בע"מ');
  assert.equal(r.direction, 'expense');
  assert.equal(r.description, 'Your receipt');
});

test('extractFromMessage: body when no attachment; merchant from sender name, then domain', () => {
  const r = gm.extractFromMessage({ subject: 'Payment confirmation', from: 'Cloud Example <billing@cloud.example>', date: '2026-09-01', text: 'Hello,\nAmount due: $25.00\nThanks' }, []);
  assert.equal(r.amount, 25);
  assert.equal(r.currency, 'USD');
  assert.equal(r.merchant, 'Cloud Example');
  assert.equal(r.occurred_on, '2026-09-01');
  const d = gm.extractFromMessage({ subject: 'Invoice', from: 'noreply@tools.example', date: '2026-09-02', text: 'Total 40.00' }, []);
  assert.equal(d.merchant, 'tools.example');
});

test('extractFromMessage: nothing stated → nulls, never an invented amount', () => {
  const r = gm.extractFromMessage({ subject: 'חשבונית חודשית זמינה באתר', from: 'Service <info@service.example>', date: '2026-09-03', text: 'החשבונית שלך זמינה להורדה באזור האישי.' }, ['', '   ']);
  assert.equal(r.amount, null);
  assert.equal(r.vat_amount, null);
  assert.equal(r.document_number, null);
  assert.equal(r.occurred_on, '2026-09-03');
  assert.equal(r.merchant, 'Service');
  const empty = gm.extractFromMessage({}, []);
  assert.deepEqual([empty.amount, empty.merchant, empty.occurred_on, empty.description], [null, null, null, null]);
});

test('classifyMessage accepts generic-PDF invoices, sends ambiguous mail to review, and rejects pro-formas', () => {
  const invoice = gm.classifyMessage({ subject: 'מסמך מצורף', text: '', attachments: [{ filename: 'document.pdf', mimeType: 'application/pdf' }] }, [PDF_TEXT]);
  assert.equal(invoice.rejected, false);
  assert.equal(invoice.confidence, 'high');
  assert.ok(invoice.score >= 70);

  const uncertain = gm.classifyMessage({ subject: 'הודעה', text: 'תודה', attachments: [{ filename: 'file.pdf', mimeType: 'application/pdf' }] }, []);
  assert.equal(uncertain.rejected, false);
  assert.equal(uncertain.confidence, 'low');

  const newsletter = gm.classifyMessage({ subject: 'עדכון שבועי', text: 'לקריאה נוספת', attachments: [] }, []);
  assert.equal(newsletter.rejected, true);

  const quote = gm.classifyMessage({ subject: 'Invoice / Proforma Invoice', text: 'Total 400.00', attachments: [{ filename: 'invoice.pdf', mimeType: 'application/pdf' }] }, []);
  assert.equal(quote.rejected, true);
  assert.ok(quote.reasons.includes('סוג מסמך לא מתאים'));
});
