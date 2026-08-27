import { Router } from 'express';
import { countUsers } from '../../lib/auth.js';
import { requireAuth } from './guard.js';
import authRoutes from './auth.js';
import dashboardRoutes from './dashboard.js';
import projectRoutes from './projects.js';
import researchRoutes from './research.js';
import skillRoutes from './skills.js';
import educationRoutes from './education.js';
import pageRoutes from './pages.js';
import mediaRoutes from './media.js';
import iconRoutes from './icons.js';
import settingsRoutes from './settings.js';
import blockRoutes from './blocks.js';

const router = Router();

/** Read-and-clear flash messages, and give routes a way to set them. */
function flash(req, res, next) {
  const raw = req.cookies?.flash;
  if (raw) {
    try {
      res.locals.flash = JSON.parse(raw);
    } catch {
      res.locals.flash = null;
    }
    res.clearCookie('flash', { path: '/' });
  }
  res.flash = (type, message) => {
    res.cookie('flash', JSON.stringify({ type, message }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.app.locals.cookieSecure,
      path: '/',
      maxAge: 15000
    });
  };
  next();
}

router.use(flash);

// Admin pages must never be cached or indexed.
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// First run: force account creation before anything else is reachable.
router.use((req, res, next) => {
  if (countUsers() > 0) return next();
  if (req.path === '/setup') return next();
  return res.redirect('/admin/setup');
});

router.use('/', authRoutes);

// Every route below this point requires a valid server-side session.
router.use(requireAuth);

router.use('/', dashboardRoutes);
router.use('/projects', projectRoutes);
router.use('/research', researchRoutes);
router.use('/skills', skillRoutes);
router.use('/education', educationRoutes);
router.use('/pages', pageRoutes);
router.use('/media', mediaRoutes);
router.use('/icons', iconRoutes);
router.use('/settings', settingsRoutes);
router.use('/blocks', blockRoutes);

export default router;
