'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const v      = require('../lib/vault');

test('new v2 types are entity types', () => {
  assert.ok(v.ENTITY_TYPES.has('cash-account'));
  assert.ok(v.ENTITY_TYPES.has('fixed-commitment'));
  assert.ok(!v.ENTITY_TYPES.has('branch'));
});

test('cash-account: valid operating account passes', () => {
  const r = v.validateEntity({ type: 'cash-account', id: 'cash-adigital-main', cash_class: 'operating',
    balance: 12000, balance_date: '2026-10-07', source: 'bank' });
  assert.deepEqual(r.errors, []);
});

test('cash-account: restricted needs a reason; bad class/date rejected', () => {
  const r1 = v.validateEntity({ type: 'cash-account', id: 'x', cash_class: 'restricted', balance: 1, balance_date: '2026-10-07' });
  assert.ok(r1.errors.some(e => e.includes('restricted_reason')));
  const r2 = v.validateEntity({ type: 'cash-account', id: 'x', cash_class: 'savings', balance: 'abc', balance_date: '7/10/2026' });
  assert.ok(r2.errors.some(e => e.includes('cash_class')));
  assert.ok(r2.errors.some(e => e.includes('balance')));
  assert.ok(r2.errors.some(e => e.includes('balance_date')));
});

test('fixed-commitment: required fields', () => {
  const ok = v.validateEntity({ type: 'fixed-commitment', id: 'rent', payee: 'משכיר', amount: 4500,
    frequency: 'monthly', next_due: '2026-11-01', vat_included: true });
  assert.deepEqual(ok.errors, []);
  const bad = v.validateEntity({ type: 'fixed-commitment', id: 'rent', amount: 4500, frequency: 'sometimes' });
  assert.equal(bad.errors.length, 4); // payee, frequency, next_due, vat_included
});

test('vat_amount mismatch is an error; missing vat_rate is an error', () => {
  assert.ok(v.validateEntity({ type: 'invoice', id: 'i', amount_net: 1000, vat_rate: 0.18, vat_amount: 170 })
    .errors.some(e => e.includes('vat_amount')));
  assert.ok(v.validateEntity({ type: 'invoice', id: 'i', amount_net: 1000 }).errors.includes('חסר vat_rate'));
});

test('frontmatter: YAML dates → ISO strings, bidi marks stripped', () => {
  const p = v.parseFrontmatterText('---\ntype: debt\nid: d1\nclient: "‏לקוח"\ndue_date: 2026-11-01\n---\nbody');
  assert.equal(p.fm.due_date, '2026-11-01');
  assert.equal(p.fm.client, 'לקוח');
});

test('task lines: done, priority, due, stable id', () => {
  const t = v.parseTaskLines('- [ ] לשלוח הצעה #high 📅 2026-10-10\n- [x] סגור\ntext', '10_Business/Adigital/tasks.md');
  assert.equal(t.length, 2);
  assert.deepEqual({ ...t[0], id: undefined }, { id: undefined, done: false, text: 'לשלוח הצעה', priority: 'high', due: '2026-10-10' });
  assert.equal(t[1].done, true);
  assert.equal(t[0].id, v.parseTaskLines('- [x] לשלוח הצעה #low', '10_Business/Adigital/tasks.md')[0].id);
});
