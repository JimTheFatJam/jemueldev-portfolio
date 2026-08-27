import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { get, run, now } from '../db/index.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
export const SESSION_COOKIE = 'portfolio_session';

/** Hash a plaintext password with scrypt + per-password random salt. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/** Constant-time password check. Never throws on malformed stored hashes. */
export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p)
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Create a session row and return the raw token to put in the cookie. */
export function createSession(userId, userAgent = '') {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    sha256(token),
    userId,
    now(),
    expiresAt,
    String(userAgent).slice(0, 300)
  );
  return { token, expiresAt };
}

/** Resolve a raw session token to a user, or null. Expired rows are dropped. */
export function getSessionUser(token) {
  if (!token || typeof token !== 'string') return null;
  const id = sha256(token);
  const row = get(
    `SELECT s.id, s.expires_at, u.id AS user_id, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    id
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run('DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  return { id: row.user_id, username: row.username };
}

export function destroySession(token) {
  if (!token) return;
  run('DELETE FROM sessions WHERE id = ?', sha256(token));
}

export function destroyAllSessions(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', now());
}

export function cookieOptions(secure) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS
  };
}

// ---------------------------------------------------------------------------
// Login throttling (per IP, persisted so a restart cannot clear a lockout)
// ---------------------------------------------------------------------------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function recordFailedLogin(ip) {
  run('INSERT INTO login_attempts (ip, at) VALUES (?, ?)', String(ip), now());
}

export function clearLoginAttempts(ip) {
  run('DELETE FROM login_attempts WHERE ip = ?', String(ip));
}

export function isLockedOut(ip) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  run('DELETE FROM login_attempts WHERE at < ?', since);
  const row = get('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at >= ?', String(ip), since);
  return (row?.n ?? 0) >= MAX_ATTEMPTS;
}

export function findUserByUsername(username) {
  return get('SELECT * FROM users WHERE username = ?', String(username).trim().toLowerCase());
}

export function createUser(username, password) {
  const info = run(
    'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
    String(username).trim().toLowerCase(),
    hashPassword(password),
    now()
  );
  return Number(info.lastInsertRowid);
}

export function updatePassword(userId, password) {
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), userId);
}

export function countUsers() {
  return get('SELECT COUNT(*) AS n FROM users').n;
}
