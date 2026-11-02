'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const r      = require('../lib/review');

test('ISO week → date (Thursday by default)', () => {
  assert.equal(r.weekToDate('2026-W41'), '2026-10-08');
  assert.equal(r.weekToDate('2026-W41', 1), '2026-10-05');
  assert.equal(r.weekToDate('2026-W01', 1), '2025-12-29');
  assert.equal(r.weekToDate('2026-41'), null);
});

test('decision without owner or week is rejected', () => {
  const v = r.validateDecisions([
    { text: 'לשלוח תזכורת ללקוח א', owner: 'אביהו', due_week: '2026-W42' },
    { text: 'להחליף רו"ח', owner: '', due_week: '2026-W43' },
    { text: 'לבדוק ערבות', owner: 'אביהו' },
    { owner: 'אביהו', due_week: '2026-W44' },
  ]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, ['החלטה 2: חסר בעלים', 'החלטה 3: חסר שבוע יעד (YYYY-Www)', 'החלטה 4: חסר טקסט']);
});

test('valid decisions pass; empty list is a valid review', () => {
  assert.equal(r.validateDecisions([{ text: 'x', owner: 'y', due_week: '2026-W42' }]).ok, true);
  assert.equal(r.validateDecisions([]).ok, true);
  assert.equal(r.validateDecisions('x').ok, false);
});

test('export: Tasks-plugin checklist lines the sync can read back', () => {
  const md = r.exportMarkdown({ period: '2026-W41', reviewed_at: '2026-10-07T10:00:00Z', notes: 'שורה\nשנייה',
    decisions: [{ text: 'לשלוח תזכורת', owner: 'אביהו', due_week: '2026-W42' }] });
  assert.match(md, /^- \[ \] לשלוח תזכורת \(בעלים: אביהו\) #high 📅 2026-10-15$/m);
  assert.match(md, /שורה שנייה/);
  const { parseTaskLines } = require('../lib/vault');
  const t = parseTaskLines(md, 'x/tasks.md');
  assert.deepEqual([t[0].text, t[0].priority, t[0].due], ['לשלוח תזכורת (בעלים: אביהו)', 'high', '2026-10-15']);
});
