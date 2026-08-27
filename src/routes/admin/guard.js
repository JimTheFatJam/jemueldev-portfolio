/**
 * Server-side gate for every admin route. Kept in its own module so route
 * files can import it without a circular dependency on the admin router.
 */
export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method !== 'GET' || req.xhr || (req.get('accept') || '').includes('application/json')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
}
