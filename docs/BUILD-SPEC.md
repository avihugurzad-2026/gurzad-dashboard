# BUILD-SPEC — דשבורד בעלים (Avihu)

> מקור: מחקר שני דוחות ב-`docs/research/`. כל מספר/סף שמסומן **[הערכה]** הוא ברירת מחדל לכוונון, לא עובדה.
> הכרעות בעלות/מע"מ/מבנה כבר התקבלו (ראה "החלטות נעולות"). שאלות פתוחות בסוף.

## 1. מטרה
דשבורד אחד, נוח, קריאה-בלבד, בעברית RTL, שמציג את **כל** הנתונים של אביהו:
- **עסקי:** `adigital` (משרד פרסום), `head-spa-israel` (OSPA, מודיעין; אביהו 50%).
- **אישי:** `home`, `general-tasks`.
- **יזמות:** `real-estate`, `legal-and-tasks`, `investments`, `finance`.

מקור האמת = Obsidian vault (`~/Documents/Obsidian Vault`). הדשבורד לא נערך; הסנכרון חד-כיווני Vault → Supabase, ידני, באישור.

## 2. החלטות נעולות
1. **היררכיה:** `domain` ∈ {`business`,`personal`,`ventures`}; `branch` ∈ {`adigital`,`head-spa-israel`,`home`,`general-tasks`,`real-estate`,`legal-and-tasks`,`investments`,`finance`}. (המחקר השתמש ב-`gurzad` כ-domain; הוחלף.)
2. **מע"מ = 18% מ-2025-01-01** (לא 17%). אסור קבוע בקוד. כל מסמך נושא `vat_rate`; ברירת מחדל מ-`Parameters/vat-rates.md`.
3. **מספר הקצאה:** חשבונית מס מעל סף (לפני מע"מ) דורשת מספר. ספים ב-`Parameters/allocation-thresholds.md` (5,000 מ-2026-06-01). `allocation_required` **מחושב בסנכרון**, לא מוקלד. (הספים מקור רשמי; מנגנון/סנקציות מקורות משניים — לאמת עם רו"ח.)
4. **הכנסה/רווח ex-VAT; חובות ומזומן כולל מע"מ.**
5. **אין מחיקה:** `status: paid|void|archived`. הסנכרון עושה upsert לפי `id`; נעלם מה-vault → `deleted_at` (soft), לא DELETE.
6. **הכנסה/רווח כוללים:** מתג בסיס `100% מהעסקים` / `החלק שלי`. OSPA: חלקי = 50%. adigital: לפי `ownership_pct` (פתוח, ברירת מחדל 100%). **אסור** לחבר 100% של OSPA ל-adigital תחת "ההכנסה שלי".
7. דומיין/ענף ללא נתונים: "אין נתונים עדיין", לא `0`, ולא נכלל בסכומים.
8. משתמש יחיד (אביהו). אין הרשמה פתוחה.

## 3. ארכיטקטורה (ברירת מחדל — Claude Code רשאי להציע שינוי מנומק)
- Vercel (frontend סטטי + API serverless) + Supabase Postgres. הריפו הקיים: Express + `pg` + HTML בעברית.
- Frontend: HTML/JS בלי framework כבד; גרפים כ-**inline SVG** (sparklines, bullet bars, עמודות); ספרייה אחת לטרנד רק אם נדרש (uPlot ~50KB). אין עוגות/מדי-מחוג.
- **אבטחה (שלב 0, חובה לפני פריסה):**
  - להסיר `POST /api/auth/register` הפתוח. כניסה: סיסמה אחת מ-env (`OWNER_PASSWORD_HASH`, bcrypt) או Supabase Auth; JWT קצר + cookie `httpOnly; Secure; SameSite=Strict`.
  - `JWT_SECRET` חובה (אין ברירת מחדל). CORS מוגבל לדומיין. כותרות `noindex`, `Cache-Control: no-store`.
  - RLS מופעל על כל הטבלאות; מפתח `service_role` רק בשרת, אף פעם בצד לקוח.
  - מתג "הסתר סכומים" (ברירת מחדל מוסתר במכשיר חדש).
  - סכמה דרך migrations ב-`supabase/migrations/*.sql` (לא `CREATE TABLE` בעת הפעלת שרת).
  - גיבוי: בתוכנית Free אין גיבוי אוטומטי → סקריפט `npm run backup` (`supabase db dump`).

## 4. מודל נתונים (Supabase)
טבלה גנרית לישויות מונעת migration לכל סוג חדש:

```
parameters   (key text, effective_from date, value jsonb, source text, confidence text)  -- vat, allocation thresholds, alert thresholds
branches     (domain text, branch text, name_he text, sort int, PRIMARY KEY(domain,branch))
entities     (id text PRIMARY KEY, type text, domain text, branch text, status text,
              data jsonb, source_path text, content_hash text, updated_at timestamptz,
              synced_at timestamptz, deleted_at timestamptz)
tasks        (id text PRIMARY KEY,  -- hash(source_path + normalized text)
              domain text, branch text, text text, priority text, due date, done bool,
              source_path text, deleted_at timestamptz)
sync_runs    (id bigserial, started_at, finished_at, mode text, added int, changed int,
              soft_deleted int, errors jsonb, dry_run bool)
entity_history (id text, changed_at timestamptz, old jsonb, new jsonb)   -- audit
```
KPI מחושבים ב-SQL views / בשכבת ה-API מתוך `entities.data` (לא נשמרים כערכים).

## 5. חוזה הוואלט (מה הסנכרון קורא)
- שורש: `$OBSIDIAN_VAULT`. סורק `10_Business/**`, `20_Personal/**`, `30_Ventures/**`, `Parameters/**`.
- Entity = קובץ `.md` עם frontmatter שיש בו `type` + `id`. סוגים: `retainer`, `debt` (זמני), `invoice`, `ospa-monthly`, `partner`, `property`, `loan`, `matter`, `investment-account`, `bill`, `parameter`. תבניות ב-`Templates/`.
- משימות = שורות checklist ב-`tasks.md` של ענף: `- [ ] טקסט #high 📅 YYYY-MM-DD`. (Tasks-plugin format; בלי בדיקת הרחבה — לפרש `[ ]`/`[x]`, תגית עדיפות, תאריך.)
- קריאת frontmatter ע"י parser של YAML (לא regex). הסנכרון **לעולם לא כותב לוואלט**.
- הסרת תווי bidi נסתרים בפרסור; מפתחות/enums באנגלית; עברית רק בערכי טקסט.

## 6. סנכרון v2 (`scripts/sync-from-obsidian.js` — להחליף את הישן)
- `--dry` ברירת מחדל; כתיבה רק עם `--apply`.
- **Upsert לפי `id`** + `content_hash`; שינוי → שורה ב-`entity_history`.
- **אימותים (כשל = עצירה, אין כתיבה):** `id` כפול; `type` חסר; `vat_amount ≈ amount_net×vat_rate` (סטייה > 0.01 לשורה); `vat_rate` חסר; `allocation_required && !allocation_number` → **אזהרה אדומה** (לא עצירה); תאריך לא ISO.
- **Guard:** אם > 20% מהישויות נעלמו מול הריצה הקודמת — לעצור ולדרוש `--force`.
- `allocation_required = amount_net > threshold(issue_date)` מ-`Parameters`.
- פלט: סיכום (added/changed/soft_deleted/warnings) ושורה ב-`sync_runs`. טרנזקציה אחת.
- כל הרשומות הקיימות היום: 9 `retainer`, 11 `debt`, 5 משימות ב-`10_Business/Adigital/`. OSPA/אישי/יזמות — `overview.md` בלבד.

## 7. מסכים ו-KPI לפי שלבים

### עמוד הבית (L0) — נבנה בשלב 1
סדר (מובייל: עמודה אחת):
1. כותרת: "סונכרן לאחרונה" לכל דומיין (ישן > 3 ימים = אזהרה; חודשי > 35), מתג הסתר סכומים.
2. **דורש תשומת לב היום:** עד 7 פריטים, ממוין לפי חומרה ואז תאריך; כל פריט: מה / כמה / למי / פעולה מוצעת; "ועוד N"; מצב "הכול תקין"; snooze עם תאריך.
3. שורת גיבור: הכנסה חודשית (ex-VAT) מול חודש קודם; רווח חודשי; חובות פתוחים (כולל מע"מ) ומתוכם באיחור; משימות באיחור. כל מספר: דלתא + sparkline 12 חודשים. מתג בסיס (100% / החלק שלי).
4. כרטיס לכל דומיין (מבנה זהה: כותרת, מספר ראשי, דלתא, sparkline, סטטוס).
5. 30 הימים הקרובים (תשלומים, גבייה צפויה, מועדים).

ניווט: L0 בית → L1 דומיין → L2 ענף → L3 רשומה. לא יותר.

### שלב 0 — תשתית (קודם לכל גרף)
סכמה + migrations, `Parameters`, אימותי סנכרון, אבטחה (סעיף 3), RLS, חותמת סנכרון, הסרת `1.17` מ-`server.js`.

### שלב 1 — adigital + משימות + עמוד בית
| KPI | נוסחה | שדות |
|---|---|---|
| MRR retainer | Σ `monthly_fee_net` של `status: active` | retainer: `monthly_fee_net`, `contract_start/end`, `status` |
| חיוב מול גבייה | חיוב = Σ `amount_net` שהונפקו בחודש; גבייה = מזומן שנכנס / (פתיחה + חיוב כולל מע"מ) | invoice: `issue_date`, `amount_net`, `paid_amount` |
| Aging חובות | `days_past_due = today − due_date`; דליים: שוטף, 1-30, 31-60, 61-90, 90+; כולל מע"מ, לפי לקוח | `due_date`, `amount_gross`, `paid_amount`, `promise_to_pay_date`, `dispute` |
| ריכוז לקוחות | מקס לקוח / סך (3 חודשים); גם top-3 | מחושב |
| מע"מ משוער | מע"מ עסקאות − תשומות | `vat_amount` |
| חידושים | `notice_deadline = contract_end − notice_period_days` | `auto_renew`, `notice_period_days`, `last_price_increase_date` |
| רווח חודשי | הכנסה ex-VAT − הוצאות ex-VAT | expense: `category`, `date`, `amount_net` |

הערה: היום `debt` הוא יתרה בלי `due_date`. עד שיש חשבוניות עם `due_date` (ייבוא Paperless) — aging מוצג "אין נתונים", וסה"כ חובות בלבד.

### שלב 2 — OSPA
Note חודשי אחד לענף (`ospa-monthly`, תבנית ב-Templates) + עמוד branch יחיד (מודיעין) שמוכן להוסיף עמודות (ירושלים/רמת גן/בית שמש) + פאנל שותף.
KPI (נוסחאות מתועדות Zenoti/Boulevard): הכנסה נטו לפי זרם; avg ticket = `revenue_services_net/service_tickets`; ניצול חדרים = `booked_treatment_hours/available_room_hours`; no-show+ביטול מאוחר = `(noshow+late_cancel)/booked_appts`; חדשים/חוזרים, `second_visit_90d`; rebooking = `rebooked_visits/completed_visits`; עלות עבודה % = `labor_cost_total/revenue`; COGS %, שכירות %; **תרומת branch** = הכנסה − COGS − עבודה − תפוסה − שיווק − שונות; CAC גס = `marketing_spend/new_clients`; הכנסה נדחית (גיפט קארד/חבילות) = פתיחה + מכירות − מימושים.
**פאנל שותף 50%:** חשבון הון = פתיחה + הון שהוזרם + חלק ברווח − משיכות ± הלוואות. `cash_available_to_distribute` = מזומן − רזרבה (1-3 חודשי הוצאות **[הערכה]**) − הכנסה נדחית − מע"מ ומס לשלם − capex. התראה: הלוואת שותף מעל 80,000 ש"ח או מעל שנתיים (סעיף 3(ט) — לאמת עם רו"ח).
יעדים (`plan_*`) נקבעים מנתוני מודיעין בפועל — לא מבנצ'מרקים אמריקאיים.

### שלב 3 — רישומים יציבים
נדל"ן (rent roll, תפוסה, תשואה ברוטו = שכירות שנתית/מחיר רכישה, NOI, LTV, סולם חוזים 120/90/60, הלוואות: `track_type`, `rate`, `next_reset_date`), משפטי (תיקים, מועד הבא, `limitation_date` + `limitation_verified_by_lawyer`, שכ"ט מול תקציב), חיובים קבועים אישיים (`next_due`), רישום בעלות ישויות.

### שלב 4 — השקעות וכספים מאוחדים
הקצאה, ריכוז (>10% בנייר = חריג **[הערכה]**), runway = נזילות/burn, סולם פירעון, ריבית משוקללת, DSCR. שווי נקי = Σ(אחוז בעלות × הון ישות) + אישי − התחייבויות אישיות — **בלי ספירה כפולה**.

### נדחה
רווחיות לקוח לפי שעות, CAC לפי ערוץ, NPS, XIRR/TWR, cohorts, ramp-up/cannibalisation (עד סניף שני), רווחיות לפי מטפלת, breakage, תרחישים.

## 8. כללי התראה (ספים ב-`Parameters/thresholds.md`)
אדום: חשבונית מס מעל סף בלי `allocation_number`; `vat_amount` לא תואם / `vat_rate` חסר; איחור > 30 יום; מועד משפטי קשיח ≤ 3 ימים; מזומן מתחת לרצפה / runway < 3 חודשים.
כתום: איחור 1-30; `promise_to_pay_date` שעבר; retainer שלא הונפק ב-3 ימי עבודה ראשונים; `notice_deadline` תוך 60/30; מועד דיווח מע"מ ≤ 7 ימים עם מסמכים לא מותאמים; סיום חוזה שכירות 120/90/60; ניצול OSPA מתחת ליעד 2 חודשים; הלוואת שותף > 80,000; נתון ישן.
כל התראה: אייקון + טקסט (לא צבע בלבד). מקסימום 7 בפאנל.

## 9. עיצוב ו-RTL
- `<html lang="he" dir="rtl">`; CSS logical properties (`margin-inline-start`, `text-align: start`); `dir="auto"` בקלט; מחרוזות מעורבות ב-`<bdi>`.
- כסף: `Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS'})`; ספרות לטיניות, tabular.
- כרטיס מספר + דלתא + sparkline; bullet bars מול יעד; עמודות מתחילות באפס; צבע סטטוס רק לחריגים; מטרות מגע ≥ 44px; ניגודיות 4.5:1; מובייל-קודם; מצב כהה/בהיר.
- **כיוון ציר זמן בגרפים עבריים:** אין מקור מוסמך → דגל `chart_time_direction` (ברירת מחדל שמאל→ימין), לבדוק עם אביהו.
- פונט: Heebo (קיים) או Assistant/Rubik.
- מצבי ריק מפורשים; חותמת "עודכן" בכל כרטיס.

## 10. אימות (חובה לפני "סיימתי")
- בדיקות יחידה לחישובי KPI (aging, MRR, מע"מ, `allocation_required` בגבולות הסף: 4,999/5,000/5,001 ומעבר תאריך סף).
- `sync --dry` על הוואלט האמיתי: ציפייה — 9 retainers (סך 20,000 ex-VAT = 23,600 עם 18%), 11 debts (סך 76,504), 5 משימות.
- סריקת סודות (`gitleaks`) לפני כל push; `.env` ב-`.gitignore`.
- בדיקה ידנית בדפדפן במובייל וב-RTL (צילומי מסך), כולל מצב ריק.
- `npm audit`; אימות שאין endpoint פתוח (curl בלי token → 401).

## 11. פריסה
Vercel env: `DATABASE_URL`, `JWT_SECRET`, `OWNER_PASSWORD_HASH`. סנכרון רץ **מקומית** על ה-Mac (לא ב-Vercel) כי הוא קורא את הוואלט. אין remote ל-git של הוואלט.

## 12. שאלות פתוחות (לא חוסמות שלבים 0-1)
1. אחוז בעלות ב-adigital (ברירת מחדל 100%) והגדרת "רווח" (לפני/אחרי שכר בעלים).
2. עמודות ה-CSV של Paperless (מספר הקצאה? `due_date`? סטטוס תשלום? מע"מ?) → קובע מיפוי ייבוא.
3. סטטוס מע"מ (חודשי/דו-חודשי), ומועד דיווח; האם הלקוחות עוסקים מורשים — לאמת עם רו"ח.
4. OSPA: מבנה משפטי, ייצוא מערכת תורים/קופה, אופן תשלום שכר ניהול.
5. עורך הדין שמאשר תאריכי התיישנות; תיקים פעילים.
6. כיוון ציר הזמן בגרפים; האם הדשבורד נגיש מכל מכשיר.
