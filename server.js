const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Pool (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

// VAT: 18% since 2025-01-01. TEMPORARY constant until Parameters table exists (see docs/BUILD-SPEC.md, phase 0).
const VAT_RATE = parseFloat(process.env.VAT_RATE || '0.18');

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET;

// Initialize Database
const initDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS businesses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        password VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS retainers (
        id SERIAL PRIMARY KEY,
        business_id INTEGER REFERENCES businesses(id),
        name VARCHAR(255) NOT NULL,
        amount INTEGER NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS debts (
        id SERIAL PRIMARY KEY,
        business_id INTEGER REFERENCES businesses(id),
        client TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'unpaid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        business_id INTEGER REFERENCES businesses(id),
        task TEXT NOT NULL,
        priority VARCHAR(20) DEFAULT 'medium',
        completed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ledger (
        id SERIAL PRIMARY KEY,
        business_id INTEGER REFERENCES businesses(id),
        type VARCHAR(20) NOT NULL,
        description TEXT,
        amount INTEGER NOT NULL,
        date VARCHAR(10) DEFAULT CURRENT_DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database tables initialized');
  } catch (err) {
    console.error('DB initialization error:', err);
  }
};

initDatabase();

// ========== AUTHENTICATION MIDDLEWARE ==========

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Ensure the business belongs to the logged-in user
app.param('businessId', async (req, res, next, id) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    let user;
    try { user = jwt.verify(token, JWT_SECRET); } catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
    const r = await pool.query('SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2', [id, user.userId]);
    if (!r.rows.length) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== AUTH ENDPOINTS ==========

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, hashedPassword, name]
    );

    const token = jwt.sign({ userId: result.rows[0].id, email }, JWT_SECRET);
    res.json({ token, user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== BUSINESS ENDPOINTS ==========

// Get user's businesses
app.get('/api/businesses', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM businesses WHERE user_id = $1 ORDER BY created_at',
      [req.user.userId]
    );
    res.json({ businesses: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create business
app.post('/api/businesses', authenticate, async (req, res) => {
  try {
    const { name, type, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO businesses (user_id, name, type, password) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.userId, name, type, hashedPassword]
    );

    res.json({ business: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== RETAINERS ENDPOINTS ==========

// Get retainers for business
app.get('/api/businesses/:businessId/retainers', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM retainers WHERE business_id = $1 ORDER BY name',
      [req.params.businessId]
    );

    let total = result.rows.reduce((sum, r) => sum + r.amount, 0);
    let totalWithVat = Math.round(total * (1 + VAT_RATE));

    res.json({ retainers: result.rows, total, totalWithVat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add retainer
app.post('/api/businesses/:businessId/retainers', authenticate, async (req, res) => {
  try {
    const { name, amount, note } = req.body;
    const result = await pool.query(
      'INSERT INTO retainers (business_id, name, amount, note) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.businessId, name, amount, note || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update retainer
app.put('/api/businesses/:businessId/retainers/:id', authenticate, async (req, res) => {
  try {
    const { amount, note } = req.body;
    await pool.query(
      'UPDATE retainers SET amount = $1, note = $2 WHERE id = $3 AND business_id = $4',
      [amount, note, req.params.id, req.params.businessId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete retainer
app.delete('/api/businesses/:businessId/retainers/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM retainers WHERE id = $1 AND business_id = $2', [req.params.id, req.params.businessId]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== DEBTS ENDPOINTS ==========

// Get debts
app.get('/api/businesses/:businessId/debts', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM debts WHERE business_id = $1 AND status = $2 ORDER BY client',
      [req.params.businessId, 'unpaid']
    );

    let total = result.rows.reduce((sum, d) => sum + d.amount, 0);
    res.json({ debts: result.rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add debt
app.post('/api/businesses/:businessId/debts', authenticate, async (req, res) => {
  try {
    const { client, amount } = req.body;
    const result = await pool.query(
      'INSERT INTO debts (business_id, client, amount, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.businessId, client, amount, 'unpaid']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark debt as paid
app.put('/api/businesses/:businessId/debts/:id/paid', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE debts SET status = $1 WHERE id = $2 AND business_id = $3', ['paid', req.params.id, req.params.businessId]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== TASKS ENDPOINTS ==========

// Get tasks
app.get('/api/businesses/:businessId/tasks', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE business_id = $1 AND completed = 0 ORDER BY priority DESC, created_at',
      [req.params.businessId]
    );
    res.json({ tasks: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add task
app.post('/api/businesses/:businessId/tasks', authenticate, async (req, res) => {
  try {
    const { task, priority } = req.body;
    const result = await pool.query(
      'INSERT INTO tasks (business_id, task, priority) VALUES ($1, $2, $3) RETURNING *',
      [req.params.businessId, task, priority || 'medium']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Complete task
app.put('/api/businesses/:businessId/tasks/:id/complete', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE tasks SET completed = 1 WHERE id = $1 AND business_id = $2', [req.params.id, req.params.businessId]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete task
app.delete('/api/businesses/:businessId/tasks/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1 AND business_id = $2', [req.params.id, req.params.businessId]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== LEDGER ENDPOINTS ==========

// Get ledger summary
app.get('/api/businesses/:businessId/ledger/summary', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT type, SUM(amount) as total FROM ledger WHERE business_id = $1 GROUP BY type',
      [req.params.businessId]
    );

    let summary = { income: 0, expenses: 0 };
    result.rows.forEach(row => {
      if (row.type === 'income') summary.income = row.total;
      else if (row.type === 'expense') summary.expenses = row.total;
    });

    res.json({ ...summary, net: summary.income - summary.expenses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add ledger entry
app.post('/api/businesses/:businessId/ledger', authenticate, async (req, res) => {
  try {
    const { type, description, amount, date } = req.body;
    const result = await pool.query(
      'INSERT INTO ledger (business_id, type, description, amount, date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.params.businessId, type, description, amount, date || new Date().toISOString().split('T')[0]]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== HEALTH CHECK ==========

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== SERVE HTML ==========

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

// ========== START SERVER ==========

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Dashboard running on http://localhost:${PORT}`);
  });
}

module.exports = app;
