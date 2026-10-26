import {
  HttpError, hashPassword, json, randomToken, safeEqual, sha256, signupCode, verifyPassword,
} from '../lib/util.js';
import { rollRepeats } from '../lib/repeats.js';

const SESSION_DAYS = 14;
const COOKIE = 'session';
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW = 15 * 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const now = () => Math.floor(Date.now() / 1000);

function need(cond, message, status = 400) {
  if (!cond) throw new HttpError(status, message);
}

function cleanText(v, max, label) {
  const s = String(v ?? '').trim();
  need(s.length > 0 && s.length <= max, `${label} is required (max ${max} characters)`);
  return s;
}

function parseAmount(v) {
  const n = Math.round(Number(v) * 100);
  need(Number.isFinite(n) && n >= 0 && n <= 1e11, 'Amount must be a valid number');
  return n;
}

function parseDate(v) {
  need(typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)), 'Due date is invalid');
  return v;
}

function postOut(r) {
  return {
    id: r.id, month: r.month, title: r.title, amount: r.amount_cents / 100, due_date: r.due_date,
    note: r.note, repeat: !!r.repeat, paid: !!r.paid, paid_at: r.paid_at,
  };
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function startSession(env, userId) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, now() + SESSION_DAYS * 86400).run();
  return cookieHeader(token, SESSION_DAYS * 86400);
}

function readCookie(request) {
  const m = /(?:^|;\s*)session=([a-f0-9]{64})/.exec(request.headers.get('cookie') || '');
  return m && m[1];
}

async function currentUser(env, request) {
  const token = readCookie(request);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), now()).first();
}

async function requireUser(env, request) {
  const user = await currentUser(env, request);
  need(user, 'Please sign in', 401);
  return user;
}

async function requireOwner(env, request) {
  const user = await requireUser(env, request);
  need(user.role === 'owner', 'Owner only', 403);
  return user;
}

// Brute-force guard, keyed by email + client IP.
async function checkThrottle(env, key) {
  const row = await env.DB.prepare('SELECT count, first_at FROM login_attempts WHERE key = ?').bind(key).first();
  if (row && now() - row.first_at < ATTEMPT_WINDOW && row.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  }
}
async function recordFailure(env, key) {
  await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, first_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ? - first_at >= ? THEN 1 ELSE count + 1 END,
       first_at = CASE WHEN ? - first_at >= ? THEN ? ELSE first_at END`,
  ).bind(key, now(), now(), ATTEMPT_WINDOW, now(), ATTEMPT_WINDOW, now()).run();
}
const clearFailures = (env, key) => env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();

// ---------- auth ----------

async function login(env, request, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  need(email && password, 'Email and password are required');
  const key = `${email}|${request.headers.get('cf-connecting-ip') || ''}`;
  await checkThrottle(env, key);

  let user = null;
  const ownerEmail = (env.OWNER_EMAIL || '').trim().toLowerCase();
  if (ownerEmail && email === ownerEmail) {
    // Owner credentials live in Cloudflare secrets, never in the database or repo.
    if (env.OWNER_PASSWORD && safeEqual(password, env.OWNER_PASSWORD)) {
      await env.DB.prepare(
        `INSERT INTO users (email, name, role) VALUES (?, 'Owner', 'owner')
         ON CONFLICT(email) DO NOTHING`,
      ).bind(email).run();
      user = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND role = 'owner'").bind(email).first();
    }
  } else {
    const row = await env.DB.prepare("SELECT id, password_hash, salt FROM users WHERE email = ? AND role = 'member'")
      .bind(email).first();
    if (row && await verifyPassword(password, row.password_hash, row.salt)) user = row;
  }
  if (!user) {
    await recordFailure(env, key);
    throw new HttpError(401, 'Wrong email or password');
  }
  await clearFailures(env, key);
  return json({ ok: true }, 200, { 'set-cookie': await startSession(env, user.id) });
}

// Member signs up with the 10-character code the owner gave them.
async function activate(env, request, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim().toUpperCase();
  const password = String(body.password || '');
  need(password.length >= 8, 'Password must be at least 8 characters');
  const key = `activate|${request.headers.get('cf-connecting-ip') || ''}`;
  await checkThrottle(env, key);

  const row = await env.DB.prepare("SELECT id, signup_code FROM users WHERE email = ? AND role = 'member'")
    .bind(email).first();
  if (!row || !row.signup_code || !safeEqual(code, row.signup_code)) {
    await recordFailure(env, key);
    throw new HttpError(400, 'Email or code is not correct');
  }
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare('UPDATE users SET password_hash = ?, salt = ?, signup_code = NULL WHERE id = ?')
    .bind(hash, salt, row.id).run();
  await clearFailures(env, key);
  return json({ ok: true }, 200, { 'set-cookie': await startSession(env, row.id) });
}

async function changePassword(env, user, body) {
  need(user.role === 'member', 'The owner password is changed in Cloudflare settings');
  need(String(body.password || '').length >= 8, 'Password must be at least 8 characters');
  const row = await env.DB.prepare('SELECT password_hash, salt FROM users WHERE id = ?').bind(user.id).first();
  need(await verifyPassword(String(body.current || ''), row.password_hash, row.salt), 'Current password is wrong');
  const { hash, salt } = await hashPassword(body.password);
  await env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, user.id).run();
  return json({ ok: true });
}

// ---------- members (owner only) ----------

const memberOut = (r) => ({
  id: r.id, name: r.name, email: r.email, status: r.signup_code ? 'pending' : 'active',
  signup_code: r.signup_code || null, created_at: r.created_at,
});

async function listMembers(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, email, signup_code, created_at FROM users WHERE role = 'member' ORDER BY name COLLATE NOCASE",
  ).all();
  return json({ members: results.map(memberOut) });
}

async function addMember(env, body) {
  const name = cleanText(body.name, 80, 'Name');
  const email = String(body.email || '').trim().toLowerCase();
  need(EMAIL_RE.test(email) && email.length <= 120, 'Email is invalid');
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  need(!exists, 'That email already has an account', 409);
  const code = signupCode();
  await env.DB.prepare("INSERT INTO users (email, name, role, signup_code) VALUES (?, ?, 'member', ?)")
    .bind(email, name, code).run();
  return json({ ok: true, signup_code: code }, 201);
}

async function editMember(env, id, body) {
  const m = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'member'").bind(id).first();
  need(m, 'Member not found', 404);
  if (body.name !== undefined) {
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(cleanText(body.name, 80, 'Name'), id).run();
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    need(EMAIL_RE.test(email) && email.length <= 120, 'Email is invalid');
    const dupe = await env.DB.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').bind(email, id).first();
    need(!dupe, 'That email already has an account', 409);
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, id).run();
  }
  let code = null;
  if (body.reset_code) {
    // New code: member must sign up again, old password and sessions stop working.
    code = signupCode();
    await env.DB.prepare('UPDATE users SET signup_code = ?, password_hash = NULL, salt = NULL WHERE id = ?')
      .bind(code, id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  }
  return json({ ok: true, signup_code: code });
}

async function removeMember(env, id) {
  const m = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'member'").bind(id).first();
  need(m, 'Member not found', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM posts WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

// ---------- posts (always scoped to the signed-in user) ----------

const addMonths = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

function requireMonth(v) {
  need(typeof v === 'string' && MONTH_RE.test(v) && Number(v.slice(5)) >= 1 && Number(v.slice(5)) <= 12, 'Month is invalid');
  return v;
}

async function listPosts(env, user, url) {
  const month = requireMonth(url.searchParams.get('month'));
  const thisMonth = requireMonth((url.searchParams.get('today') || '').slice(0, 7));
  if (month <= addMonths(thisMonth, 1)) await rollRepeats(env, user.id, month);
  const { results } = await env.DB.prepare(
    'SELECT * FROM posts WHERE user_id = ? AND month = ? ORDER BY paid, due_date, id',
  ).bind(user.id, month).all();
  return json({ posts: results.map(postOut) });
}

async function reminders(env, user, url) {
  const today = parseDate(url.searchParams.get('today'));
  await rollRepeats(env, user.id, today.slice(0, 7));
  const soon = new Date(Date.parse(today) + 3 * 86400000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    'SELECT * FROM posts WHERE user_id = ? AND paid = 0 AND due_date <= ? ORDER BY due_date, id',
  ).bind(user.id, soon).all();
  return json({ reminders: results.map(postOut) });
}

async function createPost(env, user, body) {
  const due = parseDate(body.due_date);
  const month = body.month ? requireMonth(body.month) : due.slice(0, 7);
  await env.DB.prepare(
    `INSERT INTO posts (user_id, series_id, month, title, amount_cents, due_date, note, repeat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    user.id, randomToken().slice(0, 16), month, cleanText(body.title, 100, 'Title'), parseAmount(body.amount), due,
    String(body.note || '').trim().slice(0, 500), body.repeat ? 1 : 0,
  ).run();
  return json({ ok: true }, 201);
}

async function editPost(env, user, id, body) {
  const p = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  need(p, 'Post not found', 404);
  const next = { ...p };
  if (body.title !== undefined) next.title = cleanText(body.title, 100, 'Title');
  if (body.amount !== undefined) next.amount_cents = parseAmount(body.amount);
  if (body.due_date !== undefined) { next.due_date = parseDate(body.due_date); next.month = next.due_date.slice(0, 7); }
  if (body.note !== undefined) next.note = String(body.note).trim().slice(0, 500);
  if (body.repeat !== undefined) next.repeat = body.repeat ? 1 : 0;
  if (body.paid !== undefined) {
    next.paid = body.paid ? 1 : 0;
    next.paid_at = body.paid ? new Date().toISOString() : null;
  }
  await env.DB.prepare(
    `UPDATE posts SET title = ?, amount_cents = ?, due_date = ?, month = ?, note = ?, repeat = ?, paid = ?, paid_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(next.title, next.amount_cents, next.due_date, next.month, next.note, next.repeat, next.paid, next.paid_at, id, user.id).run();
  return json({ ok: true });
}

async function deletePost(env, user, id) {
  const r = await env.DB.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  need(r.meta.changes > 0, 'Post not found', 404);
  return json({ ok: true });
}

// ---------- router ----------

async function route(request, env) {
  need(env.DB, 'Database is not connected', 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = request.method;
  const [a, b] = path.split('/');
  const id = /^\d+$/.test(b || '') ? Number(b) : null;

  let body = {};
  if (method !== 'GET') {
    // Requiring JSON blocks cross-site form posts; combined with SameSite=Strict this stops CSRF.
    need((request.headers.get('content-type') || '').startsWith('application/json'), 'JSON body required', 415);
    body = await request.json().catch(() => { throw new HttpError(400, 'Invalid JSON'); });
  }

  if (path === 'login' && method === 'POST') return login(env, request, body);
  if (path === 'activate' && method === 'POST') return activate(env, request, body);
  if (path === 'logout' && method === 'POST') {
    const token = readCookie(request);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0) });
  }
  if (path === 'me' && method === 'GET') {
    const user = await currentUser(env, request);
    return json({ user: user ? { name: user.name, email: user.email, role: user.role } : null });
  }

  const user = await requireUser(env, request);
  if (path === 'password' && method === 'POST') return changePassword(env, user, body);

  if (a === 'members') {
    await requireOwner(env, request);
    if (!b && method === 'GET') return listMembers(env);
    if (!b && method === 'POST') return addMember(env, body);
    if (id && method === 'PATCH') return editMember(env, id, body);
    if (id && method === 'DELETE') return removeMember(env, id);
  }
  if (a === 'posts') {
    if (!b && method === 'GET') return listPosts(env, user, url);
    if (!b && method === 'POST') return createPost(env, user, body);
    if (id && method === 'PATCH') return editPost(env, user, id, body);
    if (id && method === 'DELETE') return deletePost(env, user, id);
  }
  if (path === 'reminders' && method === 'GET') return reminders(env, user, url);
  throw new HttpError(404, 'Not found');
}

export async function onRequest({ request, env }) {
  try {
    return await route(request, env);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Server error' }, 500);
  }
}
