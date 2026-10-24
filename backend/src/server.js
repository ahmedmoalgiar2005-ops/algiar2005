const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { sign, requireAuth, bcrypt } = require('./auth');

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// CORS: only the origins listed in CORS_ORIGIN may call the API
const origins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// First run: create the admin account from environment variables
if (!db.prepare('SELECT 1 FROM admins WHERE id = 1').get()) {
  if (!process.env.ADMIN_CODE || !process.env.ADMIN_PASS) throw new Error('Set ADMIN_CODE and ADMIN_PASS in .env');
  db.prepare('INSERT INTO admins (id, code, pass_hash) VALUES (1, ?, ?)')
    .run(process.env.ADMIN_CODE, bcrypt.hashSync(process.env.ADMIN_PASS, 10));
}


// First run: load the function library from seed/functions.json
const seedFile = path.join(__dirname, '..', 'seed', 'functions.json');
if (db.prepare('SELECT COUNT(*) AS c FROM functions').get().c === 0 && fs.existsSync(seedFile)) {
  const rows = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  const ins = db.prepare(`INSERT OR IGNORE INTO functions
    (name, category, description, syntax, example, result, tip, warning, args) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => rows.forEach(f => ins.run(f.name, f.category, f.description, f.syntax,
    f.example, f.result, f.tip, f.warning, JSON.stringify(f.args || []))))();
}

// Login throttling: 10 failed attempts per IP every 15 minutes
const failures = new Map();
const WINDOW = 15 * 60 * 1000;
function recentFailures(ip) {
  const list = (failures.get(ip) || []).filter(t => Date.now() - t < WINDOW);
  failures.set(ip, list);
  return list.length;
}

// ---------- Auth ----------
app.post('/api/auth/login', (req, res) => {
  if (recentFailures(req.ip) >= 10) return res.status(429).json({ error: 'too many attempts' });
  const code = String(req.body.code || '').trim();
  const pass = String(req.body.pass || '');

  const admin = db.prepare('SELECT * FROM admins WHERE id = 1').get();
  if (code === admin.code && bcrypt.compareSync(pass, admin.pass_hash)) {
    return res.json({ token: sign({ role: 'admin' }), role: 'admin' });
  }
  const student = db.prepare('SELECT * FROM students WHERE code = ?').get(code);
  if (student && bcrypt.compareSync(pass, student.pass_hash)) {
    if (!student.paid) return res.status(403).json({ error: 'subscription inactive' });
    return res.json({ token: sign({ role: 'student', id: student.id }), role: 'student', name: student.name });
  }
  failures.set(req.ip, [...(failures.get(req.ip) || []), Date.now()]);
  res.status(401).json({ error: 'invalid credentials' });
});

app.get('/api/me', requireAuth(), (req, res) => {
  if (req.user.role === 'admin') return res.json({ role: 'admin' });
  const s = db.prepare('SELECT name, paid FROM students WHERE id = ?').get(req.user.id);
  if (!s || !s.paid) return res.status(403).json({ error: 'inactive' });
  res.json({ role: 'student', name: s.name });
});

// ---------- Functions (students and admin) ----------
const parseRow = r => ({ ...r, args: JSON.parse(r.args || '[]') });

app.get('/api/functions', requireAuth(), (req, res) => {
  res.json(db.prepare('SELECT name, category, description FROM functions ORDER BY name').all());
});

app.get('/api/functions/all', requireAuth(), (req, res) => {
  res.json(db.prepare('SELECT * FROM functions ORDER BY name').all().map(parseRow));
});

app.get('/api/functions/:name', requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM functions WHERE name = ?').get(req.params.name);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(parseRow(row));
});

// ---------- Admin: students ----------
const admin = requireAuth('admin');

app.get('/api/admin/students', admin, (req, res) => {
  res.json(db.prepare('SELECT id, name, code, paid, created_at FROM students ORDER BY id DESC').all());
});

app.post('/api/admin/students', admin, (req, res) => {
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim();
  const pass = String(req.body.pass || '');
  if (!name || !code || !pass) return res.status(400).json({ error: 'missing fields' });
  try {
    const r = db.prepare('INSERT INTO students (name, code, pass_hash) VALUES (?, ?, ?)')
      .run(name, code, bcrypt.hashSync(pass, 10));
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'code already exists' });
  }
});

app.patch('/api/admin/students/:id', admin, (req, res) => {
  const r = db.prepare('UPDATE students SET paid = ? WHERE id = ?').run(req.body.paid ? 1 : 0, req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'not found' });
});

app.delete('/api/admin/students/:id', admin, (req, res) => {
  const r = db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'not found' });
});

// ---------- Admin: payments ----------
app.get('/api/admin/payments', admin, (req, res) => {
  res.json(db.prepare(`SELECT p.id, p.amount, p.note, p.created_at, s.name, s.code
    FROM payments p JOIN students s ON s.id = p.student_id ORDER BY p.id DESC`).all());
});

app.post('/api/admin/payments', admin, (req, res) => {
  const studentId = Number(req.body.student_id);
  const amount = Number(req.body.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'invalid amount' });
  const exists = db.prepare('SELECT 1 FROM students WHERE id = ?').get(studentId);
  if (!exists) return res.status(404).json({ error: 'student not found' });
  db.transaction(() => {
    db.prepare('INSERT INTO payments (student_id, amount, note) VALUES (?, ?, ?)')
      .run(studentId, amount, String(req.body.note || ''));
    db.prepare('UPDATE students SET paid = 1 WHERE id = ?').run(studentId);
  })();
  res.status(201).json({ ok: true });
});

app.delete('/api/admin/payments/:id', admin, (req, res) => {
  const r = db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'not found' });
});

// ---------- Admin: functions ----------
const FIELDS = ['category', 'description', 'syntax', 'example', 'result', 'tip', 'warning'];

app.post('/api/admin/functions', admin, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const v = FIELDS.map(f => String(req.body[f] || ''));
  try {
    db.prepare(`INSERT INTO functions (name, ${FIELDS.join(', ')}, args) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(name, ...v, JSON.stringify(req.body.args || []));
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: 'function already exists' });
  }
});

app.put('/api/admin/functions/:name', admin, (req, res) => {
  const v = FIELDS.map(f => String(req.body[f] || ''));
  const r = db.prepare(`UPDATE functions SET ${FIELDS.map(f => f + ' = ?').join(', ')},
    args = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?`)
    .run(...v, JSON.stringify(req.body.args || []), req.params.name);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'not found' });
});

// ---------- Admin: account ----------
app.put('/api/admin/account', admin, (req, res) => {
  const code = String(req.body.code || '').trim();
  const pass = String(req.body.pass || '');
  if (!code || !pass) return res.status(400).json({ error: 'code and pass required' });
  db.prepare('UPDATE admins SET code = ?, pass_hash = ? WHERE id = 1').run(code, bcrypt.hashSync(pass, 10));
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AL.GIAR API listening on port ${port}`));
