import { Router } from 'express';
import { get } from '../../db/index.js';
import {
  listResearch,
  getResearch,
  createResearch,
  updateResearch,
  deleteResearch,
  reorder
} from '../../lib/content.js';
import { listBlocks, deleteBlocksFor, BLOCK_TYPE_LIST } from '../../lib/blocks.js';
import { safeUrl } from '../../lib/markdown.js';
import { str, text, bool, jsonArray, mediaId, oneOf, slugify, uniqueSlug } from '../../lib/validate.js';

const router = Router();

function parseForm(body, id = null) {
  const title = str(body.title, 200) || 'Untitled research';
  const slugSource = str(body.slug, 100) || title;
  return {
    title,
    slug: uniqueSlug(get, 'research', slugify(slugSource, 'research'), id),
    abstract: text(body.abstract, 20000),
    authors: str(body.authors, 300),
    institution: str(body.institution, 200),
    date: str(body.date, 60),
    work_status: str(body.work_status, 60),
    paper_url: safeUrl(body.paper_url),
    github_url: safeUrl(body.github_url),
    links: jsonArray(
      body.links,
      (item) => {
        const label = str(item?.label, 80);
        const url = safeUrl(item?.url);
        return label && url ? { label, url } : null;
      },
      12
    ),
    keywords: jsonArray(body.keywords, (entry) => str(entry, 60) || null, 24),
    thumbnail_id: mediaId(body.thumbnail_id),
    gallery: jsonArray(body.gallery, (value) => mediaId(value), 40),
    featured: bool(body.featured),
    status: oneOf(body.status, ['draft', 'published'], 'draft'),
    has_detail_page: bool(body.has_detail_page),
    meta_description: str(body.meta_description, 300)
  };
}

router.get('/', (req, res) => {
  res.render('admin/research/list', {
    pageTitle: 'Research',
    section: 'research',
    items: listResearch()
  });
});

router.get('/new', (req, res) => {
  res.render('admin/research/form', {
    pageTitle: 'New research item',
    section: 'research',
    item: {
      id: null,
      title: '',
      slug: '',
      abstract: '',
      authors: '',
      institution: '',
      date: '',
      work_status: '',
      paper_url: '',
      github_url: '',
      links: [],
      keywords: [],
      thumbnail: null,
      thumbnail_id: null,
      gallery: [],
      galleryIds: [],
      featured: false,
      status: 'draft',
      hasDetailPage: true,
      meta_description: ''
    },
    blocks: [],
    blockTypes: BLOCK_TYPE_LIST,
    isNew: true
  });
});

router.post('/', (req, res) => {
  const id = createResearch(parseForm(req.body));
  res.flash('success', 'Research item created.');
  res.redirect('/admin/research/' + id);
});

router.get('/:id', (req, res, next) => {
  const item = getResearch(req.params.id);
  if (!item) return next();
  res.render('admin/research/form', {
    pageTitle: item.title,
    section: 'research',
    item,
    blocks: listBlocks('research', item.id),
    blockTypes: BLOCK_TYPE_LIST,
    isNew: false
  });
});

router.post('/:id', (req, res, next) => {
  const item = getResearch(req.params.id);
  if (!item) return next();
  updateResearch(item.id, parseForm(req.body, item.id));
  res.flash('success', 'Research item saved.');
  res.redirect('/admin/research/' + item.id);
});

router.post('/:id/status', (req, res, next) => {
  const item = getResearch(req.params.id);
  if (!item) return next();
  const status = oneOf(req.body.status, ['draft', 'published'], 'draft');
  updateResearch(item.id, { ...item, status, gallery: item.galleryIds });
  res.flash('success', status === 'published' ? 'Research published.' : 'Research moved back to draft.');
  res.redirect(req.body.back || '/admin/research');
});

router.post('/:id/feature', (req, res, next) => {
  const item = getResearch(req.params.id);
  if (!item) return next();
  const featured = !item.featured;
  updateResearch(item.id, { ...item, featured, gallery: item.galleryIds });
  res.flash('success', featured ? 'Shown on the homepage.' : 'Removed from the homepage.');
  res.redirect(req.body.back || '/admin/research');
});

router.post('/:id/move', (req, res, next) => {
  const item = getResearch(req.params.id);
  if (!item) return next();
  reorder('research', item.id, req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/research');
});

router.post('/:id/delete', (req, res, next) => {
  const item = getResearch(req.params.id);
  if (!item) return next();
  deleteBlocksFor('research', item.id);
  deleteResearch(item.id);
  res.flash('success', `Deleted “${item.title}”.`);
  res.redirect('/admin/research');
});

export default router;
