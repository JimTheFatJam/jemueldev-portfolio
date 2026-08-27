import { Router } from 'express';
import { run, get, now } from '../../db/index.js';
import { listPages, getPage, deletePage, reorder, nextPosition } from '../../lib/content.js';
import { listBlocks, deleteBlocksFor, BLOCK_TYPE_LIST } from '../../lib/blocks.js';
import { str, bool, int, oneOf, slugify, uniqueSlug } from '../../lib/validate.js';

const router = Router();

/** Slugs that would collide with a built-in route. */
const RESERVED = new Set(['admin', 'projects', 'research', 'uploads', 'css', 'js', 'sitemap.xml', 'robots.txt', 'favicon.svg']);

function parseForm(body, id = null) {
  const title = str(body.title, 160) || 'Untitled page';
  let slug = slugify(str(body.slug, 100) || title, 'page');
  if (RESERVED.has(slug)) slug = slug + '-page';
  return {
    title,
    slug: uniqueSlug(get, 'pages', slug, id),
    meta_description: str(body.meta_description, 300),
    status: oneOf(body.status, ['draft', 'published'], 'draft'),
    show_in_nav: bool(body.show_in_nav)
  };
}

router.get('/', (req, res) => {
  res.render('admin/pages/list', {
    pageTitle: 'Pages',
    section: 'pages',
    pages: listPages()
  });
});

router.get('/new', (req, res) => {
  res.render('admin/pages/form', {
    pageTitle: 'New page',
    section: 'pages',
    page: { id: null, title: '', slug: '', meta_description: '', status: 'draft', showInNav: false },
    blocks: [],
    blockTypes: BLOCK_TYPE_LIST,
    isNew: true
  });
});

router.post('/', (req, res) => {
  const data = parseForm(req.body);
  const timestamp = now();
  const info = run(
    `INSERT INTO pages (slug, title, meta_description, status, show_in_nav, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    data.slug,
    data.title,
    data.meta_description,
    data.status,
    data.show_in_nav ? 1 : 0,
    nextPosition('pages'),
    timestamp,
    timestamp
  );
  res.flash('success', 'Page created. Add content blocks below.');
  res.redirect('/admin/pages/' + Number(info.lastInsertRowid));
});

router.get('/:id', (req, res, next) => {
  const page = getPage(req.params.id);
  if (!page) return next();
  res.render('admin/pages/form', {
    pageTitle: page.title,
    section: 'pages',
    page,
    blocks: listBlocks('page', page.id),
    blockTypes: BLOCK_TYPE_LIST,
    isNew: false
  });
});

router.post('/:id', (req, res, next) => {
  const page = getPage(req.params.id);
  if (!page) return next();
  const data = parseForm(req.body, page.id);
  run(
    `UPDATE pages SET slug = ?, title = ?, meta_description = ?, status = ?, show_in_nav = ?, updated_at = ?
     WHERE id = ?`,
    data.slug,
    data.title,
    data.meta_description,
    data.status,
    data.show_in_nav ? 1 : 0,
    now(),
    page.id
  );
  res.flash('success', 'Page saved.');
  res.redirect('/admin/pages/' + page.id);
});

router.post('/:id/move', (req, res) => {
  reorder('pages', int(req.params.id), req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/pages');
});

router.post('/:id/delete', (req, res, next) => {
  const page = getPage(req.params.id);
  if (!page) return next();
  deleteBlocksFor('page', page.id);
  deletePage(page.id);
  res.flash('success', `Deleted “${page.title}”.`);
  res.redirect('/admin/pages');
});

export default router;
