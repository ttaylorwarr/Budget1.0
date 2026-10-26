CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  password_hash TEXT,          -- null for owner (password comes from secret) and pending members
  salt TEXT,
  signup_code TEXT,            -- 10-character code, cleared once the member signs up
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Only one owner can ever exist.
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON users(role) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL,     -- groups the monthly copies of a repeating bill
  month TEXT NOT NULL,         -- YYYY-MM
  title TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,      -- YYYY-MM-DD
  note TEXT NOT NULL DEFAULT '',
  repeat INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  last_reminded TEXT,          -- YYYY-MM-DD of the last reminder email
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS posts_user_month ON posts(user_id, month);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);
