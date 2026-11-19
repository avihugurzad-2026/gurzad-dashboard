# גורזאד — דשבורד בית, עסקים והשקעות (v3)

דשבורד אישי בעברית (RTL) בשלושה תחומים: **ניהול הבית**, **ניהול עסקים** (כמה עסקים) ו**ניהול השקעות/נכסים**, עם שיתוף במייל, כניסה ב־OTP, סוכן וואטסאפ (Kapso), מסך סטטוס ונקודת חיבור ל־Gemini.

- מערכת העיצוב: [`docs/v3/DESIGN-SYSTEM.md`](docs/v3/DESIGN-SYSTEM.md) · טוקנים: `src/styles/tokens.css`
- תוכנית ומסכים + ביקורת 0–10: [`docs/v3/PLAN.md`](docs/v3/PLAN.md)
- ביקורות עיצוב ואנימציה: [`docs/v3/REVIEWS.md`](docs/v3/REVIEWS.md)
- הגרסה הקודמת (Express + וואלט Obsidian) שמורה ב־`legacy/` בלי שינוי.

## הרצה מקומית
```bash
npm install
npm run dev        # http://localhost:5173
```
בלי משתני סביבה האפליקציה רצה ב**מצב הדגמה**: נתוני דוגמה ב־localStorage, קוד OTP `123456`.

## מעבר לנתונים אמיתיים
1. **Supabase** — להריץ את `supabase/migrations/20261116000001_gd_v3.sql` על הפרויקט. כל האובייקטים בתחילית `gd_` (הפרויקט משותף לאפליקציות אחרות); אין שינוי בטבלאות קיימות ואין טריגר על `auth.users`.
2. **משתני סביבה** (Vercel → Settings → Environment Variables), לפי `.env.example`:
   | משתנה | בשביל מה |
   |---|---|
   | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | צד לקוח |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | פונקציות השרת בלבד |
   | `OWNER_EMAIL` | המייל שהופך לבעלים בכניסה הראשונה |
   | `RESEND_API_KEY`, `MAIL_FROM` | מיילי OTP והזמנות |
   | `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_SECRET`, `WHATSAPP_ALLOWED_NUMBERS` | סוכן וואטסאפ |
   | `GEMINI_API_KEY` | שפה חופשית לסוכן + סריקת קבלות |
   | `APP_URL`, `CRON_SECRET` | קישור במייל ההזמנה; בדיקות סטטוס מתוזמנות |
3. **התראות פוש** — להריץ גם את `supabase/migrations/20261117000001_gd_push.sql`, ליצור זוג מפתחות (`npx web-push generate-vapid-keys`) ולהגדיר `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` ו־`CRON_SECRET`. ה־cron ‏`/api/notify` רץ כל בוקר ושולח רק מה שחדש.
4. **Kapso** — להגדיר Webhook לאירוע `whatsapp.message.received` אל `https://<domain>/api/whatsapp-webhook` עם אותו secret.

## אפליקציה בטלפון (PWA)
- `public/manifest.webmanifest` + `public/sw.js`: התקנה למסך הבית, מסך מלא, מעטפת שעובדת בלי רשת (נתונים לא נשמרים במטמון), מספר התראות על האייקון.
- התראות: `shared/alerts.ts` הוא מנוע ההתראות היחיד, משותף למסך ולשרת. `api/push.ts` רושם מכשירים, `api/notify.ts` (cron יומי) שולח את מה שחדש, `api/status-check.ts` שולח מיד כשאתר נופל. באייפון ובאייפד התראות עובדות רק אחרי ״הוספה למסך הבית״ (iOS 16.4 ומעלה).
- סנכרון חי: שינוי ממכשיר אחר או מחבר צוות מופיע בלי רענון (Supabase Realtime על `gd_records`, כפוף ל־RLS).

## מבנה
```
src/            אפליקציית React (Vite + TS)
  styles/       tokens.css (פלטה/טיפוגרפיה/תנועה) · components.css
  ui/           קומפוננטות: kit, charts, overlay (Sheet/Toast/טפסים), lists, crud
  data/         schemas (שדות לכל סוג רשומה) · store (demo/Supabase) · derive (KPI והתראות) · seed
  pages/        Overview · home/ · business/ · invest/ · Tools (וואטסאפ, סטטוס, צוות, הגדרות) · Login
shared/agent.ts ליבת סוכן הוואטסאפ: כלים + מנוע פקודות (משותף לדפדפן ולשרת)
api/            פונקציות Vercel: auth/send-otp, auth/verify-otp, invite, whatsapp-webhook,
                status-check, health,
                push (רישום מכשירים), notify (cron התראות)
supabase/       migrations
legacy/         v2
```

## אבטחה
- כניסה רק למייל הבעלים ולמוזמנים; קודי OTP נשמרים כ־HMAC, תקפים 10 דקות, עד 5 ניסיונות, הגבלת קצב.
- RLS על כל טבלאות `gd_*`: כל חבר רואה רק את התחומים שנפתחו לו; צופה לא יכול לכתוב.
- Webhook של Kapso מאומת ב־HMAC‑SHA256 ומגיב רק למספרים ב־`WHATSAPP_ALLOWED_NUMBERS`.
- `api/status-check` חוסם כתובות פנימיות (SSRF) ודורש משתמש מחובר.
- אין מפתחות בריפו. מע״מ וסף הקצאה נקראים מפרמטרים מתוארכים, לא קבועים בקוד.
