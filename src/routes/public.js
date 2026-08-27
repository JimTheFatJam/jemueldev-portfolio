import { Router } from 'express';
import {
  listProjects,
  getProjectBySlug,
  listResearch,
  getResearchBySlug,
  listSkillCategories,
  listEducation,
  listPages,
  getPageBySlug
} from '../lib/content.js';
import { listBlocks, resolveBlocks } from '../lib/blocks.js';
import { getSettings } from '../lib/settings.js';
import { mediaByIds } from '../lib/media.js';
import { toPlainText } from '../lib/markdown.js';

const router = Router();

/** Signed-in admins can see drafts; everybody else only sees published items. */
const canSeeDrafts = (req) => Boolean(req.user);

function blocksFor(ownerType, ownerId) {
  return resolveBlocks(listBlocks(ownerType, ownerId));
}

router.get('/', (req, res) => {
  const settings = getSettings();
  const sections = settings.sections;
  const drafts = canSeeDrafts(req);

  const projects = listProjects({ status: drafts ? null : 'published', featured: true }).filter(
    (project) => project.isPublished || drafts
  );
  const research = listResearch({ status: drafts ? null : 'published', featured: true }).filter(
    (item) => item.isPublished || drafts
  );

  const imageIds = [settings.about.imageId, settings.about.secondaryImageId, settings.site.profileImageId];
  const media = mediaByIds(imageIds);

  res.renderPublic('home', {
    pageTitle: null, // home uses the site title as-is
    metaDescription: settings.site.metaDescription || settings.site.description,
    sections,
    hero: settings.hero,
    about: settings.about,
    aboutImage: media.get(Number(settings.about.imageId)) || media.get(Number(settings.site.profileImageId)) || null,
    aboutSecondaryImage: media.get(Number(settings.about.secondaryImageId)) || null,
    aboutBlocks: sections.about ? blocksFor('about', 0) : [],
    projects,
    skillCategories: sections.skills ? listSkillCategories({ onlyVisible: true }) : [],
    education: sections.education ? listEducation({ onlyVisible: true }) : [],
    research,
    bodyClass: 'home'
  });
});

router.get('/projects', (req, res) => {
  const drafts = canSeeDrafts(req);
  const projects = listProjects({ status: drafts ? null : 'published' });
  res.renderPublic('projects', {
    pageTitle: 'Projects',
    metaDescription: 'Software, machine learning and research projects.',
    projects
  });
});

router.get('/projects/:slug', (req, res, next) => {
  const project = getProjectBySlug(req.params.slug);
  if (!project) return next();
  if (!project.isPublished && !canSeeDrafts(req)) return next();
  if (!project.hasDetailPage && !canSeeDrafts(req)) return next();

  res.renderPublic('project', {
    pageTitle: project.title,
    metaDescription: project.meta_description || project.summary || toPlainText(project.description, 200),
    canonicalPath: project.href,
    ogImage: project.thumbnail,
    project,
    blocks: blocksFor('project', project.id),
    isDraft: !project.isPublished
  });
});

router.get('/research', (req, res) => {
  const drafts = canSeeDrafts(req);
  res.renderPublic('research-list', {
    pageTitle: 'Research',
    metaDescription: 'Research projects and academic work.',
    items: listResearch({ status: drafts ? null : 'published' })
  });
});

router.get('/research/:slug', (req, res, next) => {
  const item = getResearchBySlug(req.params.slug);
  if (!item) return next();
  if (!item.isPublished && !canSeeDrafts(req)) return next();
  if (!item.hasDetailPage && !canSeeDrafts(req)) return next();

  res.renderPublic('research-item', {
    pageTitle: item.title,
    metaDescription: item.meta_description || toPlainText(item.abstract, 200),
    canonicalPath: item.href,
    ogImage: item.thumbnail,
    item,
    blocks: blocksFor('research', item.id),
    isDraft: !item.isPublished
  });
});

router.get('/robots.txt', (req, res) => {
  const { site } = getSettings();
  const lines = ['User-agent: *', 'Disallow: /admin', ''];
  if (site.baseUrl) lines.push(`Sitemap: ${site.baseUrl.replace(/\/$/, '')}/sitemap.xml`, '');
  res.type('text/plain').send(lines.join('\n'));
});

router.get('/sitemap.xml', (req, res) => {
  const { site } = getSettings();
  const base = (site.baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const urls = [
    { loc: '/', priority: '1.0' },
    { loc: '/projects', priority: '0.8' },
    { loc: '/research', priority: '0.8' }
  ];
  for (const project of listProjects({ status: 'published' })) {
    if (project.hasDetailPage) urls.push({ loc: project.href, lastmod: project.updated_at, priority: '0.7' });
  }
  for (const item of listResearch({ status: 'published' })) {
    if (item.hasDetailPage) urls.push({ loc: item.href, lastmod: item.updated_at, priority: '0.7' });
  }
  for (const page of listPages({ status: 'published' })) {
    urls.push({ loc: page.href, lastmod: page.updated_at, priority: '0.5' });
  }

  const body = urls
    .map((url) => {
      const lastmod = url.lastmod ? `<lastmod>${String(url.lastmod).slice(0, 10)}</lastmod>` : '';
      return `  <url><loc>${escapeXml(base + url.loc)}</loc>${lastmod}<priority>${url.priority}</priority></url>`;
    })
    .join('\n');

  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

// Custom CMS pages live at the root, so this must stay the last route.
router.get('/:slug', (req, res, next) => {
  const page = getPageBySlug(req.params.slug);
  if (!page) return next();
  if (page.status !== 'published' && !canSeeDrafts(req)) return next();

  res.renderPublic('page', {
    pageTitle: page.title,
    metaDescription: page.meta_description,
    canonicalPath: page.href,
    page,
    blocks: blocksFor('page', page.id),
    isDraft: page.status !== 'published'
  });
});

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default router;
