import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const CSRF_COOKIE = 'portfolio_csrf';

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

/**
 * Signed double-submit CSRF tokens.
 *
 * A random id lives in an httpOnly cookie; the token rendered into each form is
 * `id.hmac(id)`. A forged cross-site request can neither read the cookie nor
 * produce a valid signature, and the token works before login too (the login
 * form needs one as well).
 */
export function csrf(secret) {
  return function csrfMiddleware(req, res, next) {
    let id = req.cookies?.[CSRF_COOKIE];
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = randomBytes(18).toString('base64url');
      res.cookie(CSRF_COOKIE, id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure || process.env.COOKIE_SECURE === 'true',
        path: '/',
        maxAge: 1000 * 60 * 60 * 12
      });
      req.cookies = { ...req.cookies, [CSRF_COOKIE]: id };
    }

    const token = `${id}.${sign(id, secret)}`;
    res.locals.csrfToken = token;

    const reject = () => {
      const err = new Error('Invalid or missing CSRF token. Please reload the page and try again.');
      err.status = 403;
      return err;
    };

    // File uploads are parsed later by multer, so their token is not readable
    // yet. Those routes must call req.assertCsrf() once the body is available.
    const isMultipart = (req.get('content-type') || '').startsWith('multipart/form-data');
    req.assertCsrf = () => {
      const submitted = req.body?._csrf || req.get('x-csrf-token') || '';
      if (!verify(submitted, id, secret)) throw reject();
    };

    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || isMultipart) return next();

    const submitted = req.body?._csrf || req.get('x-csrf-token') || '';
    if (!verify(submitted, id, secret)) return next(reject());
    next();
  };
}

function verify(submitted, id, secret) {
  if (typeof submitted !== 'string' || !submitted.includes('.')) return false;
  const [submittedId, sig] = submitted.split('.');
  if (submittedId !== id) return false;
  const expected = Buffer.from(sign(id, secret));
  const actual = Buffer.from(String(sig));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
