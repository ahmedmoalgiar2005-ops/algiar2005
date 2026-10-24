const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_FILE || path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  code TEXT NOT NULL,
  pass_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS functions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  syntax TEXT DEFAULT '',
  example TEXT DEFAULT '',
  result TEXT DEFAULT '',
  tip TEXT DEFAULT '',
  warning TEXT DEFAULT '',
  args TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

module.exports = db;
