import express from 'express';
import ejs from 'ejs';
import helmet from 'helmet';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, get, run, UPLOAD_DIR } from './db/index.js';
import { cookieParser } from './lib/cookies.js';
import { csrf } from './lib/csrf.js';
import { SESSION_COOKIE, getSessionUser, purgeExpiredSessions } from './lib/auth.js';
import { getSettings } from './lib/settings.js';
import { renderMarkdown, renderInlineMarkdown, safeUrl, toPlainText } from './lib/markdown.js';
import { srcset, formatBytes, mediaByIds } from './lib/media.js';
import { listPages, listProjects, listSkillCategories } from './lib/content.js';
import { BLOCK_TYPES } from './lib/blocks.js';
import { renderIcon } from './lib/icons.js';
import { THEMES, THEMES_DIR, assetBase, assetsDir, getTheme } from './themes/index.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The signing secret for sessions/CSRF. Prefer the environment; otherwise keep
 * a generated one in the database so restarts do not invalidate logins. It is
 * never sent to the client either way.
 */
function resolveSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  const row = get("SELECT value FROM settings WHERE key = '_secret'");
  if (row) return JSON.parse(row.value);
  const generated = randomBytes(48).toString('base64url');
  run("INSERT INTO settings (key, value) VALUES ('_secret', ?)", JSON.stringify(generated));
  if (process.env.NODE_ENV === 'production') {
    console.warn('[portfolio] SESSION_SECRET is not set; using a generated secret stored in the database.');
  }
  return generated;
}

export function createApp() {
  const app = express();
  const secret = resolveSecret();
  const isProd = process.env.NODE_ENV === 'production';
  const cookieSecure = process.env.COOKIE_SECURE === 'true' || isProd;

  // Two roots: admin and shared partials under views/, public themes under
  // themes/. A theme template that includes 'shared/…' falls through to the
  // first root, so themes never copy the block or image partials.
  const viewRoots = [join(__dirname, 'views'), THEMES_DIR];
  app.set('view engine', 'ejs');
  app.set('views', viewRoots);

  // EJS normally discovers the view roots through Express's `settings` local,
  // but this app puts its own site settings under that name. Hand EJS the
  // roots directly so include('shared/…') resolves from any theme.
  app.engine('ejs', (file, data, callback) =>
    ejs.renderFile(file, data, { views: viewRoots, cache: data.cache }, callback)
  );

  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.set('x-powered-by', false);
  app.locals.cookieSecure = cookieSecure;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
          upgradeInsecureRequests: isProd ? [] : null
        }
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    })
  );

  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser);

  // Static assets. Uploads get a long cache because filenames are content-unique.
  const staticDir = join(__dirname, '..', 'public');
  app.use(
    '/uploads',
    express.static(UPLOAD_DIR, {
      maxAge: isProd ? '365d' : 0,
      immutable: isProd,
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
    })
  );
  app.use(
    express.static(staticDir, {
      maxAge: isProd ? '7d' : 0,
      index: false,
      dotfiles: 'deny'
    })
  );

  // Each theme serves only its own assets/ directory; templates stay private.
  for (const theme of THEMES) {
    app.use(
      assetBase(theme.id),
      express.static(assetsDir(theme.id), {
        maxAge: isProd ? '7d' : 0,
        index: false,
        dotfiles: 'deny'
      })
    );
  }

  // Identify the current admin user (if any) before CSRF so forms can bind to it.
  app.use((req, _res, next) => {
    req.user = getSessionUser(req.cookies?.[SESSION_COOKIE]);
    next();
  });

  app.use(csrf(secret));

  // Values every template can rely on.
  app.use((req, res, next) => {
    const settings = getSettings();
    res.locals.settings = settings;
    res.locals.user = req.user;
    res.locals.currentPath = req.path;
    res.locals.navPages = listPages({ status: 'published' }).filter((page) => page.showInNav);
    res.locals.md = renderMarkdown;
    res.locals.mdInline = renderInlineMarkdown;
    res.locals.plain = toPlainText;
    res.locals.safeUrl = safeUrl;
    res.locals.srcset = srcset;
    res.locals.formatBytes = formatBytes;
    res.locals.mediaByIds = mediaByIds;
    res.locals.blockDefs = BLOCK_TYPES;

    // The public theme for this request, plus a render helper so routes name
    // a page ("home") rather than a template path.
    const theme = getTheme(settings.appearance.publicTheme);
    res.locals.theme = theme;
    res.locals.themeAssets = assetBase(theme.id);
    res.renderPublic = (view, locals) => res.render(`${theme.id}/views/${view}`, locals);

    res.locals.renderIcon = renderIcon;
    res.locals.skillIconStyle = settings.appearance.skillIconStyle === 'mono' ? 'mono' : 'color';
    // Lazily used by the admin block editor only.
    res.locals.pickProjects = () => listProjects();
    res.locals.pickSkillCategories = () => listSkillCategories();
    res.locals.flash = null;
    res.locals.pageTitle = '';
    res.locals.metaDescription = '';
    res.locals.canonicalPath = req.path;
    res.locals.ogImage = null;
    res.locals.bodyClass = '';
    next();
  });

  app.use('/admin', adminRoutes);
  app.use('/', publicRoutes);

  app.use((req, res) => {
    res.status(404);
    if (req.path.startsWith('/admin')) return res.redirect('/admin');
    res.renderPublic('404', { pageTitle: 'Page not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 && isProd ? 'Something went wrong on our end.' : err.message;
    res.status(status);
    if (req.accepts('html') && res.renderPublic) {
      return res.renderPublic('error', { pageTitle: 'Error', status, message });
    }
    res.json({ error: message });
  });

  // Housekeeping: drop expired sessions hourly.
  const timer = setInterval(purgeExpiredSessions, 60 * 60 * 1000);
  timer.unref?.();
  purgeExpiredSessions();

  app.locals.close = () => {
    clearInterval(timer);
    db.close();
  };

  return app;
}
