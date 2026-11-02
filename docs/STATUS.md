# מצב פרויקט — דשבורד בעלים
עדכון אחרון: 2026-10-07

---

## מה נבנה (שלב 0 + שלב 1)

### תשתית ואבטחה (שלב 0)
- **`supabase/migrations/`** — 3 קבצי SQL: סכמה (6 טבלאות), RLS, seed פרמטרים
- **`server.js`** — שכתוב מלא: cookie auth (httpOnly + Secure + SameSite=Strict), startup guards, rate limiting (5/15 דק׳/IP), CORS מוגבל, מע"מ מ-DB, endpoints: `/api/kpi/home`, `/api/kpi/adigital`, `/api/tasks`, `/api/entities`, `/api/health`
- **`scripts/sync-from-obsidian.js`** — v2: סריקת וואלט (קריאה בלבד), frontmatter עם js-yaml, אימותים, guard 20%, single transaction, soft-delete, `sync_runs`

### ממשק משתמש (שלב 1)
- **`public/styles.css`** — ספריית עיצוב מלאה: design tokens מ-DESIGN.md, dark mode, כל ה-components, RTL, mobile-first 375px
- **`public/login.html`** — שוכתב, cookie-based, ללא localStorage
- **`public/index.html`** — דף בית L0: attention panel, KPI row, domain cards, horizon 30 יום
- **`public/adigital.html`** — L2: MRR, retainers, concentration, tasks
- **`public/tasks.html`** — כל המשימות לפי ענף, filter chips, priority icons

---

## מה נבדק ועבר

| בדיקה | תוצאה |
|-------|--------|
| `node server.js` ללא JWT_SECRET | קריסה מפורשת |
| `node server.js` ללא OWNER_PASSWORD_HASH | קריסה מפורשת |
| `POST /api/auth/register` | 404 |
| `GET /api/kpi/home` ללא cookie | 401 `{"error":"לא מחובר"}` |
| `GET /api/health` ללא auth | 200 ok |
| `npm audit` | 0 vulnerabilities |
| `sync:dry` ללא DB | 20 ישויות, 0 שגיאות |
| `sync:dry` מול DB אמיתי | עבר, נכתב ל-`sync_runs` |
| סכומי וואלט | 9 retainers = ₪20,000 net, 11 debts = ₪76,504 gross, 5 tasks |
| `.env` לא ב-git | מאומת |
| אין localStorage/Bearer בדפים החדשים | מאומת |

---

## מה נשאר

### מיידי (לפני פריסה)
- **`sync:apply`** — ממתין לאישור אביהו לאחר סקירת `sync:dry`
- **Migrations** — להריץ ידנית ב-Supabase SQL Editor (3 קבצים בסדר: 0001→0002→0003)
- **בדיקות UI** — דפדפן + DevTools 375px RTL: login → index → adigital → tasks
- **gitleaks** — לא מותקן; להתקין ולהריץ לפני push

### שלב 2 (לא התחיל)
- **OSPA (`head-spa-israel`)** — עמוד L2 דומה לאדיג׳יטל; ממתין לנתוני וואלט
- **עמודי ventures** — נדל״ן, משפטי, השקעות, פיננסים
- **Paperless aging** — אימפורט חשבוניות עם `due_date` לחישוב aging buckets

### פריסה לוורסל
- להריץ `npm run hash-password -- "הסיסמה"` לקבל `OWNER_PASSWORD_HASH` אם נדרש שינוי
- לוודא `ALLOWED_ORIGIN`, `NODE_ENV=production` ב-Vercel env vars
- `vercel.json` מוכן (builds + routes + catch-all)

---

## החלטות שנקבעו

| נושא | החלטה |
|------|--------|
| Auth | OWNER_PASSWORD_HASH בלבד; אין טבלת users; אין register endpoint |
| Cookie | httpOnly; `secure: isProd` (false בlocal לsafari); SameSite=Strict |
| מע"מ | 17% עד 2024-12-31, 18% מ-2025-01-01 — מ-DB בלבד, לא hardcoded |
| סף הקצאה | 25,000→20,000→10,000→5,000 לפי תאריכים ב-`parameters` |
| וואלט | קריאה בלבד לעולם; סנכרון v2 לא כותב אליו |
| sync | `--dry` ברירת מחדל; `--apply` דורש אישור מפורש |
| תאריכי YAML | js-yaml ממיר ל-Date object → `deepStripBidi` ממיר ל-ISO string |
| קבצי `overview.md` | `type: branch` — נדלגים, לא entities |
| DB connection | pg Pool ישיר; עוקף RLS (service-level access) |
| CSS | קובץ משותף `styles.css`; אפס inline styles בHTML |

---

## שלב 0+ (DASHBOARD-SPEC-v2) — 2026-10-07

- `lib/` חדש: `vault.js` (פרסור ואימות), `kpi.js` (MRR, חובות, aging, מע"מ, הקצאה, ריכוז), `params.js`, `snapshots.js`. בדיקות ב-`test/` (`npm test`, ‏node:test).
- migrations (שמות תואמים להיסטוריה ב-Supabase, כולן הורצו): `20261007132734` מפתח ראשי ל-`entity_history`, `20261007134338` טבלאות `kpi_snapshots` ו-`alerts` עם RLS, `20261007134349` ספי v2 (הערכה).
- סנכרון: סוגי ישות `cash-account`, `fixed-commitment` (וסוגי BUILD-SPEC §5); snapshot שבועי ב-`--apply`; `--dry` עובד בלי DB ומציג סכומים לפי סוג; `allocation_required` רק לחשבוניות מס; בלי סף קבוע בקוד.
- שרת ודפים: בלי מע"מ/סף קבועים בקוד (`missing_params`); בלי נתונים = `null` ו"אין נתונים עדיין", לא 0.
- `business.html`, `dashboard.html` הועברו ל-`legacy/` (לא מוגשים).
- תבניות לוואלט: `docs/vault-templates/`.
- ממתין: `npm run sync:apply` (על המק); `npm audit` ו-gitleaks על המק.

## שלב 1א (DASHBOARD-SPEC-v2) — התראות מתמידות + שלמות נתונים — 2026-10-07

- `lib/alerts.js`: כללים (הקצאה חסרה בחשבונית, חוב באיחור לפי `due_date` — כתום עד `overdue_red_days`, אדום מעבר; הבטחת תשלום שעברה; מועד הודעה ב-retainer תוך 60 יום; משימה באיחור) + reconcile: חדש → insert, קיים → `last_seen`, נעלם → `resolved_at`. snooze נשמר ולא נדרס.
- רץ בכל `sync --apply` (שלב 6 בסקריפט); `--dry` מציג כמה התראות יחושבו.
- API: `GET /api/alerts`, `POST /api/alerts/:id/snooze` (כתיבה ל-Supabase בלבד), `GET /api/integrity`. הכול מאחורי cookie.
- בית: הפאנל נקרא מ-`alerts`, עד 7 + "ועוד N", "פתוח X ימים", דחייה עם תאריך, "נתון ישן" מחושב מ-`stale_days`.
- `/health`: התראות פתוחות ונדחות, למה "אין נתונים", גיל סנכרון לענף, ריצות אחרונות, פרמטרים חסרים והערכות.
- היום הנתונים לא מייצרים התראות (אין `due_date`, אין חשבוניות, משימות לא באיחור) — מצב "הכול תקין" אמיתי.

## שלב 1.5 (DASHBOARD-SPEC-v2) — סקירה שבועית, Scorecard, תחזית 13 שבועות — 2026-10-07

- `lib/forecast.js`: תחזית 13 שבועות (כניסות לפי `due_date`/`promise_to_pay_date`, retainers עם `billing_day`, יציאות מ-`fixed-commitment` ו-`loan`), מזומן תפעולי/מוגבל/רזרבה בנפרד, שבוע שפל, רצפה = `cash_floor_months` × הוצאות קבועות חודשיות, שבועות הוצאה בבנק, 3 תרחישים. בלי תאריך = לא נכנס לתחזית ומופיע ב"נתונים חלקיים".
- `lib/scorecard.js`: 13 שבועות מ-`kpi_snapshots`, סטטוס לפי כיוון, הצעת Issue אחרי שבועיים חורגים, נעילת יעד 13 שבועות (שינוי רק עם `quarterly_planning`; יעד ראשון מותר).
- `lib/review.js`: החלטה = טקסט + בעלים + שבוע (אחרת 400), ייצוא markdown בפורמט Tasks-plugin להעתקה לוואלט (Issues → tasks דרך הוואלט, לא כתיבה ישירה ל-`tasks`).
- migration `20261007140000_review_scorecard_forecast`: `scorecard_measures` (7 מדדים, יעדי 0 נעולים; השאר ריקים עד שתקבע), `weekly_reviews`, `cash_forecast_snapshots`, RLS. הורץ ב-Supabase.
- סנכרון: snapshots נוספים (ריכוז, הקצאה חסרה, חוב >30, מזומן נגיש — כל אחד רק כשיש נתון) ושמירת תחזית שבועית כשיש `cash-account`.
- API: `/api/forecast`, `/api/scorecard`, `PUT /api/scorecard/:key/goal`, `GET/POST /api/review`, `/api/review/:id/export`. דפים: `/review`, `/scorecard`. בבית: קישורים, "נסקר לאחרונה", התראה כתומה אחרי `review_stale_days`.
