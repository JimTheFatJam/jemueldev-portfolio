import { Router } from 'express';
import { all, get } from '../../db/index.js';
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  reorder,
  normalizeTech
} from '../../lib/content.js';
import { listBlocks, deleteBlocksFor, copyBlocks, BLOCK_TYPE_LIST } from '../../lib/blocks.js';
import { safeUrl } from '../../lib/markdown.js';
import { str, text, bool, jsonArray, mediaId, oneOf, slugify, uniqueSlug } from '../../lib/validate.js';
import { normalizeIconName } from '../../lib/icons.js';

const router = Router();

/** Every technology already used, so the editor can offer autocomplete. */
function knownTechnologies() {
  const byName = new Map();
  for (const row of all('SELECT tech FROM projects')) {
    let parsed;
    try {
      parsed = JSON.parse(row.tech || '[]');
    } catch {
      continue;
    }
    for (const entry of normalizeTech(parsed)) {
      // First sighting wins, but a later entry with a logo fills in a blank one.
      const existing = byName.get(entry.name);
      if (!existing) byName.set(entry.name, entry);
      else if (!existing.icon && entry.icon) byName.set(entry.name, entry);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseForm(body, id = null) {
  const title = str(body.title, 160) || 'Untitled project';
  const slugSource = str(body.slug, 100) || title;
  return {
    title,
    slug: uniqueSlug(get, 'projects', slugify(slugSource, 'project'), id),
    summary: str(body.summary, 300),
    description: text(body.description, 20000),
    // [{name, icon}] from the picker widget; the icon must name a real logo.
    tech: jsonArray(
      body.tech,
      (entry) => {
        const name = str(entry && entry.name, 60);
        return name ? { name, icon: normalizeIconName(entry && entry.icon) } : null;
      },
      40
    ),
    thumbnail_id: mediaId(body.thumbnail_id),
    gallery: jsonArray(body.gallery, (value) => mediaId(value), 40),
    year: str(body.year, 40),
    github_url: safeUrl(body.github_url),
    demo_url: safeUrl(body.demo_url),
    featured: bool(body.featured),
    status: oneOf(body.status, ['draft', 'published'], 'draft'),
    has_detail_page: bool(body.has_detail_page),
    meta_description: str(body.meta_description, 300)
  };
}

router.get('/', (req, res) => {
  res.render('admin/projects/list', {
    pageTitle: 'Projects',
    section: 'projects',
    projects: listProjects()
  });
});

router.get('/new', (req, res) => {
  res.render('admin/projects/form', {
    pageTitle: 'New project',
    section: 'projects',
    project: {
      id: null,
      title: '',
      slug: '',
      summary: '',
      description: '',
      tech: [],
      thumbnail: null,
      thumbnail_id: null,
      gallery: [],
      galleryIds: [],
      year: String(new Date().getFullYear()),
      github_url: '',
      demo_url: '',
      featured: false,
      status: 'draft',
      hasDetailPage: true,
      meta_description: ''
    },
    blocks: [],
    blockTypes: BLOCK_TYPE_LIST,
    knownTech: knownTechnologies(),
    isNew: true
  });
});

router.post('/', (req, res) => {
  const id = createProject(parseForm(req.body));
  res.flash('success', 'Project created. Add content blocks below, then publish when ready.');
  res.redirect('/admin/projects/' + id);
});

router.get('/:id', (req, res, next) => {
  const project = getProject(req.params.id);
  if (!project) return next();
  res.render('admin/projects/form', {
    pageTitle: project.title,
    section: 'projects',
    project,
    blocks: listBlocks('project', project.id),
    blockTypes: BLOCK_TYPE_LIST,
    knownTech: knownTechnologies(),
    isNew: false
  });
});

router.post('/:id', (req, res, next) => {
  const project = getProject(req.params.id);
  if (!project) return next();
  updateProject(project.id, parseForm(req.body, project.id));
  res.flash('success', 'Project saved.');
  res.redirect('/admin/projects/' + project.id);
});

router.post('/:id/status', (req, res, next) => {
  const project = getProject(req.params.id);
  if (!project) return next();
  const status = oneOf(req.body.status, ['draft', 'published'], 'draft');
  updateProject(project.id, { ...project, status, thumbnail_id: project.thumbnail_id, gallery: project.galleryIds });
  res.flash('success', status === 'published' ? 'Project published.' : 'Project moved back to draft.');
  res.redirect(req.body.back || '/admin/projects');
});

router.post('/:id/feature', (req, res, next) => {
  const project = getProject(req.params.id);
  if (!project) return next();
  const featured = !project.featured;
  updateProject(project.id, { ...project, featured, thumbnail_id: project.thumbnail_id, gallery: project.galleryIds });
  res.flash('success', featured ? 'Project featured on the homepage.' : 'Project removed from the homepage.');
  res.redirect(req.body.back || '/admin/projects');
});

router.post('/:id/move', (req, res, next) => {
  const project = getProject(req.params.id);
  if (!project) return next();
  reorder('projects', project.id, req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/projects');
});

router.post('/:id/duplicate', (req, res, next) => {
  const project = getProject(req.params.id);
  if (!project) return next();
  const copyId = createProject({
    ...project,
    title: project.title + ' (copy)',
    slug: uniqueSlug(get, 'projects', slugify(project.slug + '-copy', 'project')),
    status: 'draft',
    featured: false,
    thumbnail_id: project.thumbnail_id,
    gallery: project.galleryIds,
    has_detail_page: project.hasDetailPage
  });
  copyBlocks('project', project.id, 'project', copyId);
  res.flash('success', 'Project duplicated as a draft.');
  res.redirect('/admin/projects/' + copyId);
});

router.post('/:id/delete', (req, res, next) => {
  const project = getProject(req.params.id);
  if (!project) return next();
  deleteBlocksFor('project', project.id);
  deleteProject(project.id);
  res.flash('success', `Deleted “${project.title}”.`);
  res.redirect('/admin/projects');
});

export default router;
