// Scorecard table, shared by /review and /scorecard (DASHBOARD-SPEC-v2 §5.2)
'use strict';

const SC_MONEY = new Set(['cash_operating', 'mrr', 'open_debts', 'overdue_debt_30']);
const scIls = n => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n);
const scEsc = s => (s === null || s === undefined ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

function scFormat(key, v) {
  if (v === null || v === undefined) return '';
  if (SC_MONEY.has(key)) return `<bdi class="amount">${scIls(v)}</bdi>`;
  if (key.endsWith('_pct')) return `${v}%`;
  return String(v);
}

// opts.editable: show goal editing controls
function renderScorecardTable(el, data, opts = {}) {
  if (!data.measures.length) { el.innerHTML = '<p class="empty-state">אין מדדים מוגדרים</p>'; return; }
  const head = data.weeks.map(w => `<th scope="col" class="sc-week">${scEsc(w.slice(5))}</th>`).join('');
  const rows = data.measures.map(m => {
    const cells = m.cells.map(c => {
      const icon = c.status === 'off' ? '<span aria-label="חורג">⚠︎ </span>' : '';
      return `<td class="sc-cell ${c.status === 'off' ? 'sc-cell--off' : ''}">${c.value === null ? '<span class="sc-nodata" title="אין נתונים">–</span>' : icon + scFormat(m.key, c.value)}</td>`;
    }).join('');
    const goal = m.weekly_goal === null ? '<span class="sc-nodata">טרם נקבע</span>' : scFormat(m.key, m.weekly_goal);
    const lock = m.locked_until ? `<div class="sc-meta">נעול עד ${scEsc(m.locked_until)}</div>` : '';
    const edit = opts.editable ? `
      <form class="sc-goal-form" data-key="${scEsc(m.key)}">
        <input class="form-input sc-goal-input" type="number" step="any" name="goal" aria-label="יעד שבועי" placeholder="יעד" required>
        ${m.locked_until && m.weekly_goal !== null ? '<label class="sc-meta"><input type="checkbox" name="quarterly"> תכנון רבעוני</label>' : ''}
        <button class="btn-secondary" type="submit">שמור</button>
      </form>` : '';
    return `<tr>
      <th scope="row" class="sc-name">${scEsc(m.name_he)}
        <div class="sc-meta">${scEsc(m.owner || '')} · ${m.direction === 'lower_better' ? 'נמוך = טוב' : 'גבוה = טוב'}</div>
        ${m.suggest_issue ? '<div class="sc-issue">⚠︎ חורג שבועיים ברצף: לפתוח Issue בסקירה</div>' : ''}
      </th>
      <td class="sc-goal">${goal}${lock}${edit}</td>
      ${cells}
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="sc-scroll"><table class="sc-table">
    <thead><tr><th scope="col">מדד</th><th scope="col">יעד שבועי</th>${head}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
