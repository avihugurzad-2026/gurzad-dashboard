# 🎯 All In One - Financial & Business Dashboard

מערכת ניהול עסקית כוללת עבור עסקים מרובים (Multi-tenant).

## ✨ תכונות

- 🔐 **הרשמה והתחברות** - משתמשים וסיסמאות מאובטחות
- 💼 **ניהול עסקים מרובים** - כל משתמש יכול להנהל עסקים שונים
- 💰 **ניהול ריטיינרים** - לקוחות עם הכנסה קבועה + מעמ
- 💳 **ניהול חובות** - עדכון חובות ופעולות שולמו
- ✅ **ניהול משימות** - משימות עם עדיפויות
- 📊 **דוח כלכלי** - הכנסות/הוצאות וחישוב רווח נקי
- 🌍 **RTL Hebrew** - ממשק מלא בעברית

## 🛠️ ייחוד טכנולוגי

- **Backend:** Node.js + Express
- **Database:** PostgreSQL (Supabase)
- **Auth:** JWT Tokens
- **Frontend:** HTML5 + CSS3 + JavaScript
- **Security:** bcryptjs for password hashing

## 📦 קבצים

```
gurzad-dashboard/
├── package.json           ← תלויות Node.js
├── server.js             ← API ו-Backend
├── .env.example          ← משתנים סביבה
├── .gitignore            ← קבצים להתעלם
├── public/
│   ├── login.html        ← כניסה/הרשמה
│   ├── dashboard.html    ← בחירת עסק
│   └── business.html     ← לוח הבקרה בעסק
└── README.md             ← קובץ זה
```

## 🚀 התקנה

### 1. Clone Repository
```bash
git clone https://github.com/YOUR_USERNAME/gurzad-dashboard.git
cd gurzad-dashboard
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Environment Variables
1. צור קובץ `.env` (העתק מ-`.env.example`)
2. רוץ `DATABASE_URL` מSupabase
3. שנה `JWT_SECRET`

```bash
DATABASE_URL=postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres
JWT_SECRET=your-super-secret-key-change-this
PORT=3000
NODE_ENV=production
```

### 4. Start Server
```bash
npm start
```

Server יהיה זמין ב-`http://localhost:3000`

## 📝 API Endpoints

### Authentication
- `POST /api/auth/register` - הרשמה חדשה
- `POST /api/auth/login` - כניסה

### Businesses
- `GET /api/businesses` - קבל את העסקים שלך
- `POST /api/businesses` - צור עסק חדש

### Retainers (עבור כל עסק)
- `GET /api/businesses/:id/retainers` - קבל ריטיינרים
- `POST /api/businesses/:id/retainers` - הוסף ריטיינר
- `PUT /api/businesses/:id/retainers/:rid` - עדכן ריטיינר
- `DELETE /api/businesses/:id/retainers/:rid` - מחק ריטיינר

### Debts
- `GET /api/businesses/:id/debts` - קבל חובות
- `POST /api/businesses/:id/debts` - הוסף חוב
- `PUT /api/businesses/:id/debts/:did/paid` - סימן כשולם

### Tasks
- `GET /api/businesses/:id/tasks` - קבל משימות
- `POST /api/businesses/:id/tasks` - הוסף משימה
- `PUT /api/businesses/:id/tasks/:tid/complete` - סימן כהושלמה
- `DELETE /api/businesses/:id/tasks/:tid` - מחק משימה

### Ledger
- `GET /api/businesses/:id/ledger/summary` - סיכום כלכלי
- `POST /api/businesses/:id/ledger` - הוסף רשומה

## 🌐 פריסה ב-Vercel

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Initial dashboard"
   git push
   ```

2. **Connect to Vercel:**
   - עשה ביקור ב-vercel.com
   - בחר "Import Project"
   - בחר את ה-repository

3. **Set Environment Variables:**
   - הוסף `DATABASE_URL` ו-`JWT_SECRET`
   - Deploy!

## 🔒 ביטחון

⚠️ **חשוב:**
- שנה את `JWT_SECRET` ב-.env
- אל תשתח את `.env` ב-GitHub (זה ב-.gitignore)
- השתמש ב-HTTPS בפרסום
- סיסמאות מהוצפנות עם bcryptjs

## 📱 שימוש

1. **הרשמה:** הכנס אימייל וסיסמה
2. **בחר/צור עסק:** בחר עסק קיים או צור חדש
3. **ניהול:** עדכן ריטיינרים, חובות, משימות וחשבונות

## 🎨 Customization

### שינוי צבעים:
בתוכן `<style>` בקבצי HTML, שנה את:
- `#667eea` - צבע ראשי (כחול)
- `#764ba2` - צבע משני (סגול)

### שינוי שפה:
קבצי HTML הם בעברית (RTL). ניתן להתאים כל שדה.

## 🐛 Troubleshooting

### "Cannot find module 'pg'"
```bash
npm install pg
```

### "Database connection failed"
- בדוק את `DATABASE_URL` ב-.env
- בדוק שSupabase שלך פעיל

### "JWT verify error"
- בדוק שה-token תקין
- בדוק שה-`JWT_SECRET` זהה בכל המקומות

## 📞 Support

אם יש בעיות:
1. בדוק את ה-console logs בדפדפן (F12)
2. בדוק את ה-server logs בterminal
3. בדוק את ה-.env variables

## 📄 License

MIT License - Feel free to use and modify

---

**Built with ❤️ for Gurzad**
