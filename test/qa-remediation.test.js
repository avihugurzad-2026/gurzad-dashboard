'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('household is an accepted task domain', () => {
  assert.match(read('src/app/actions.ts'), /DOMAINS = new Set\(\['business', 'personal', 'household', 'ventures'\]\)/);
});

test('cancelled tasks cannot be completed by the quick-toggle (it reopens them instead)', () => {
  const row = read('src/components/work/task-row.tsx');
  assert.match(row, /const closed = item\.status === 'done' \|\| item\.status === 'cancelled'/);
  assert.match(row, /setTaskStatus\(item\.id, closed \? 'todo' : 'done', path\)/);
  assert.doesNotMatch(row, /item\.status === 'done' \? 'todo' : 'done'/);
});

test('personal task and goal creation reject a forged owner or shared scope', () => {
  const actions = read('src/app/actions.ts');
  // shared scope is refused in Personal for both tasks and goals
  assert.equal((actions.match(/p\.domain === 'personal' && str\(f, 'scope'\) === 'shared'\) return NO_ACCESS/g) ?? []).length, 2);
  // a task can't be handed to someone else in Personal; a goal can't be owned by someone else there
  assert.match(actions, /if \(p\.domain === 'personal'\) return 'משימה אישית נשארת שלך/);
  assert.match(actions, /if \(p\.domain === 'personal'\) return \{ ok: false, error: 'יעד אישי נשאר שלך/);
});

test('privacy hides the monetary string semantically instead of blurring it', () => {
  const value = read('src/components/shell/privacy-value.tsx');
  assert.match(value, /hidden \? '₪••••' : children/);
  assert.doesNotMatch(read('src/app/globals.css'), /filter:\s*blur\(7px\)/);
});

test('today quick-add retains the selected date', () => {
  assert.match(read('src/app/(app)/today/page.tsx'), /<QuickTask path=\{link\(date\)\} defaultDate=\{date\} \/>/);
});
