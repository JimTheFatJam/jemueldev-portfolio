import { Router } from 'express';
import {
  SESSION_COOKIE,
  cookieOptions,
  countUsers,
  createSession,
  createUser,
  destroyAllSessions,
  destroySession,
  findUserByUsername,
  verifyPassword,
  updatePassword,
  isLockedOut,
  recordFailedLogin,
  clearLoginAttempts
} from '../../lib/auth.js';
import { run, now } from '../../db/index.js';
import { requireAuth } from './guard.js';

const router = Router();

const MIN_PASSWORD_LENGTH = 12;

/** Only allow redirecting back to an internal admin path. */
function safeNext(value) {
  const target = String(value || '');
  if (target.startsWith('/admin') && !target.startsWith('//')) return target;
  return '/admin';
}

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// ---------------------------------------------------------------------------
// First-run setup
// ---------------------------------------------------------------------------

router.get('/setup', (req, res) => {
  if (countUsers() > 0) return res.redirect('/admin/login');
  res.render('admin/setup', { pageTitle: 'Create your account', error: null, username: '' });
});

router.post('/setup', (req, res) => {
  if (countUsers() > 0) return res.redirect('/admin/login');

  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');

  const fail = (error) =>
    res.status(400).render('admin/setup', { pageTitle: 'Create your account', error, username });

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return fail('Username must be 3–40 characters: letters, numbers, dot, dash or underscore.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password !== confirm) return fail('The two passwords do not match.');

  const userId = createUser(username, password);
  const { token } = createSession(userId, req.get('user-agent'));
  res.cookie(SESSION_COOKIE, token, cookieOptions(req.app.locals.cookieSecure));
  res.redirect('/admin');
});

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  res.render('admin/login', {
    pageTitle: 'Sign in',
    error: null,
    username: '',
    next: safeNext(req.query.next)
  });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const target = safeNext(req.body.next);
  const ip = clientIp(req);

  const fail = (error, status = 401) =>
    res.status(status).render('admin/login', {
      pageTitle: 'Sign in',
      error,
      username,
      next: target
    });

  if (isLockedOut(ip)) {
    return fail('Too many failed attempts. Try again in a few minutes.', 429);
  }

  const user = findUserByUsername(username);
  // Always run a verification so a missing user and a wrong password cost the same.
  const placeholder = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==';
  const ok = verifyPassword(password, user ? user.password_hash : placeholder);

  if (!user || !ok) {
    recordFailedLogin(ip);
    return fail('Incorrect username or password.');
  }

  clearLoginAttempts(ip);
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
  const { token } = createSession(user.id, req.get('user-agent'));
  res.cookie(SESSION_COOKIE, token, cookieOptions(req.app.locals.cookieSecure));
  res.redirect(target);
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.redirect('/admin/login');
});

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

router.get('/account', requireAuth, (req, res) => {
  res.render('admin/account', { pageTitle: 'Account', section: 'account', error: null });
});

router.post('/account/password', requireAuth, (req, res) => {
  const current = String(req.body.current || '');
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');

  const user = findUserByUsername(req.user.username);
  const fail = (error) =>
    res.status(400).render('admin/account', { pageTitle: 'Account', section: 'account', error });

  if (!user || !verifyPassword(current, user.password_hash)) {
    return fail('Your current password is not correct.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password !== confirm) return fail('The two new passwords do not match.');

  updatePassword(user.id, password);
  // Changing the password signs out every device, including this one.
  destroyAllSessions(user.id);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.flash('success', 'Password changed. Please sign in again.');
  res.redirect('/admin/login');
});

export default router;
