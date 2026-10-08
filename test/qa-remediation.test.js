'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('household is an accepted task domain', () => {
  assert.match(read('src/app/actions.ts'), /DOMAINS = new Set\(\['business', 'personal', 'household', 'ventures'\]\)/);
});

test('cancelled tasks cannot be completed by the quick-toggle', () => {
  const row = read('src/components/work/task-row.tsx');
  assert.match(row, /disabled=\{vault \|\| pending \|\| item\.status === 'cancelled'\}/);
  assert.match(row, /item\.status === 'cancelled' \? 'משימה מבוטלת/);
});

test('personal task and goal creation reject a forged owner or shared scope', () => {
  const actions = read('src/app/actions.ts');
  assert.match(actions, /p\.domain === 'personal' && \(\(assigned && assigned !== u\.id\) \|\| str\(f, 'scope'\) === 'shared'\)/);
  assert.match(actions, /p\.domain === 'personal' && \(owner !== u\.id \|\| str\(f, 'scope'\) === 'shared'\)/);
});

test('privacy hides the monetary string semantically instead of blurring it', () => {
  const value = read('src/components/shell/privacy-value.tsx');
  assert.match(value, /hidden \? '₪••••' : children/);
  assert.doesNotMatch(read('src/app/globals.css'), /filter:\s*blur\(7px\)/);
});

test('today quick-add retains the selected date', () => {
  assert.match(read('src/app/(app)/today/page.tsx'), /defaultDate=\{isToday \? undefined : date\}/);
});
