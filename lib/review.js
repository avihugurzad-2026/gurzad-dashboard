// Weekly review (DASHBOARD-SPEC-v2 §5.1). Every decision needs text + owner + week, or the
// review isn't saved. Decisions live in Supabase only; they leave the dashboard as a markdown
// checklist the owner pastes into the vault, where the next sync turns them into tasks.
'use strict';

const ISO_WEEK = /^(\d{4})-W(\d{2})$/;

// Date of a weekday in an ISO week (1 = Monday … 7 = Sunday)
function weekToDate(isoWeek, isoDay = 4) {
  const m = ISO_WEEK.exec(isoWeek || '');
  if (!m) return null;
  const year = Number(m[1]), week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday1 = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86400000);
  const d = new Date(monday1.getTime() + ((week - 1) * 7 + (isoDay - 1)) * 86400000);
  return d.toISOString().split('T')[0];
}

function validateDecisions(decisions) {
  const errors = [];
  if (!Array.isArray(decisions)) return { ok: false, errors: ['decisions חייב להיות רשימה'] };
  decisions.forEach((d, i) => {
    const n = i + 1;
    if (!d || typeof d.text !== 'string' || !d.text.trim())   errors.push(`החלטה ${n}: חסר טקסט`);
    if (!d || typeof d.owner !== 'string' || !d.owner.trim()) errors.push(`החלטה ${n}: חסר בעלים`);
    if (!d || !weekToDate(d.due_week))                        errors.push(`החלטה ${n}: חסר שבוע יעד (YYYY-Www)`);
  });
  return { ok: errors.length === 0, errors };
}

const clean = s => String(s).replace(/[\r\n]+/g, ' ').trim();

// Tasks-plugin checklist (BUILD-SPEC §5): "- [ ] text #high 📅 YYYY-MM-DD". Due = Thursday of the week.
function exportMarkdown(review) {
  const date = String(review.reviewed_at instanceof Date ? review.reviewed_at.toISOString() : review.reviewed_at).slice(0, 10);
  const lines = [
    `## סקירה שבועית ${review.period} (${date})`,
    '',
    'להעתיק ל-`tasks.md` של הענף המתאים בוואלט:',
    '',
    ...(review.decisions || []).map(d => `- [ ] ${clean(d.text)} (בעלים: ${clean(d.owner)}) #high 📅 ${weekToDate(d.due_week)}`),
  ];
  if (review.notes) lines.push('', '### הערות', '', clean(review.notes));
  return lines.join('\n') + '\n';
}

module.exports = { weekToDate, validateDecisions, exportMarkdown };
