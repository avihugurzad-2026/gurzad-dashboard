# פרומפט פתיחה לקלוד קוד

הפעל קלוד קוד **מתוך תיקיית הריפו** והוסף את הוואלט כתיקייה נוספת:

```bash
cd ~/gibMacOS-master/gurzad-dashboard
claude --add-dir "$HOME/Documents/Obsidian Vault"
```

הדבק:

```
קרא את CLAUDE.md ו-docs/BUILD-SPEC.md, ואת docs/research/ לפי הצורך. אנחנו בונים את דשבורד הבעלים שלי לפי המפרט.

התחל במצב תוכנית (plan mode) עבור שלב 0 + שלב 1:
- שלב 0: migrations לסכמה (parameters, branches, entities, tasks, sync_runs, entity_history), RLS, אבטחה (הסרת הרשמה פתוחה, התחברות בעלים יחיד, JWT_SECRET חובה, CORS מוגבל), הסרת מע"מ 1.17 מהקוד ושימוש ב-Parameters, וסנכרון v2 (dry-run כברירת מחדל, upsert לפי id, אימותים).
- שלב 1: עמוד בית (פאנל "דורש תשומת לב", שורת גיבור, כרטיסי דומיינים), עמוד adigital, ומשימות — לפי סעיף 7.

כללים: אל תדחוף ל-GitHub ואל תפרוס ב-Vercel בלי אישור שלי. הסנכרון רץ רק ב---dry עד שאאשר. אחרי כל שלב: הרץ את בדיקות סעיף 10 והראה לי תוצאות (כולל צילום מסך מובייל ב-RTL).
הצג לי את התוכנית לפני שאתה כותב קוד, ושאל אותי רק על דברים שחוסמים.
```

אחרי ששלב 1 עובד מקומית: אני מאשר פריסה ל-Vercel (`DATABASE_URL`, `JWT_SECRET`, `OWNER_PASSWORD_HASH`), ואז ממשיכים לשלב 2 (OSPA).
