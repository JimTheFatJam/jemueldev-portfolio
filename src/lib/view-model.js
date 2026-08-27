import { getSettings } from './settings.js';
import {
  listProjects,
  listResearch,
  listSkillCategories,
  listEducation,
  listPages
} from './content.js';
import { listBlocks, resolveBlocks } from './blocks.js';
import { mediaByIds } from './media.js';
import { safeUrl, toPlainText } from './markdown.js';

/**
 * Builds the normalised view model every public theme renders from.
 *
 * This is the contract between the content system and the presentation layer:
 * themes read these objects and never query the database themselves, so a new
 * design needs no changes to storage, routing or the admin.
 *
 * Shape handed to a theme:
 *   site        name, tagline, description, email, github, linkedin, resume, extraLinks
 *   seo         title, description, canonical, ogImage, favicon, twitterCard
 *   nav         items[{label, href, current}], resume
 *   sections    which homepage sections are switched on
 *   sectionTitles / appearance
 *   hero, about, contact
 *   projects, research, skills, education   (already filtered for visibility)
 *   blocks      resolved content blocks for the current page
 *   isDraft, user, currentPath
 */

/** Signed-in admins see drafts; everyone else sees published content only. */
export const canSeeDrafts = (req) => Boolean(req.user);

function absoluteUrl(req, path, baseUrl) {
  const base = (baseUrl || '').replace(/\/$/, '');
  if (!base) return '';
  return base + (path || '/');
}

function buildNav(req, settings, pages) {
  const onHome = req.path === '/';
  const anchor = (id) => (onHome ? `#${id}` : `/#${id}`);
  const items = [{ label: 'Home', href: '/', current: onHome }];

  if (settings.sections.about) items.push({ label: 'About', href: anchor('about'), current: false });
  if (settings.sections.projects) {
    items.push({ label: 'Projects', href: '/projects', current: req.path.startsWith('/projects') });
  }
  if (settings.sections.research) {
    items.push({ label: 'Research', href: '/research', current: req.path.startsWith('/research') });
  }
  for (const page of pages) {
    items.push({ label: page.title, href: page.href, current: req.path === page.href });
  }
  if (settings.sections.contact) items.push({ label: 'Contact', href: anchor('contact'), current: false });

  return items;
}

/** Everything that is the same on every public page. */
export function baseModel(req, options = {}) {
  const settings = getSettings();
  const site = settings.site;
  const navPages = listPages({ status: 'published' }).filter((page) => page.showInNav);

  const mediaIds = [site.faviconId, site.ogImageId].filter(Boolean);
  const media = mediaIds.length ? mediaByIds(mediaIds) : new Map();

  const favicon = site.faviconId ? media.get(Number(site.faviconId)) : null;
  const shareImage = options.ogImage || (site.ogImageId ? media.get(Number(site.ogImageId)) : null);

  const title = options.pageTitle
    ? `${options.pageTitle} — ${site.name || 'Portfolio'}`
    : site.title || (site.tagline ? `${site.name} — ${site.tagline}` : site.name || 'Portfolio');

  const description = options.metaDescription || site.metaDescription || site.description || '';
  const canonicalPath = options.canonicalPath || req.path;

  return {
    currentPath: req.path,
    user: req.user || null,
    isDraft: Boolean(options.isDraft),

    site: {
      ...site,
      github: safeUrl(site.github),
      linkedin: safeUrl(site.linkedin),
      resumeUrl: safeUrl(site.resumeUrl),
      extraLinks: (site.extraLinks || [])
        .map((link) => ({ label: link.label, url: safeUrl(link.url) }))
        .filter((link) => link.url)
    },

    seo: {
      title,
      description,
      canonical: absoluteUrl(req, canonicalPath, site.baseUrl),
      ogImage: shareImage || null,
      ogImageUrl: shareImage ? absoluteUrl(req, shareImage.url, site.baseUrl) || shareImage.url : '',
      favicon: favicon || null,
      faviconUrl: favicon ? favicon.url : '/favicon.svg',
      twitterCard: shareImage ? 'summary_large_image' : 'summary'
    },

    nav: {
      items: buildNav(req, settings, navPages),
      resume: safeUrl(site.resumeUrl) ? { label: 'Resume', href: safeUrl(site.resumeUrl) } : null
    },

    sections: settings.sections,
    sectionTitles: settings.sectionTitles,
    appearance: settings.appearance,
    hero: settings.hero,
    about: settings.about,
    contact: settings.contact,

    // Page-level defaults; individual pages replace these.
    blocks: [],
    projects: [],
    research: [],
    skills: [],
    education: []
  };
}

function blocksFor(ownerType, ownerId) {
  return resolveBlocks(listBlocks(ownerType, ownerId));
}

export function homeModel(req) {
  const model = baseModel(req);
  const drafts = canSeeDrafts(req);
  const { sections, about, site } = model;

  const imageIds = [about.imageId, about.secondaryImageId, site.profileImageId].filter(Boolean);
  const media = imageIds.length ? mediaByIds(imageIds) : new Map();

  return {
    ...model,
    aboutImage:
      media.get(Number(about.imageId)) || media.get(Number(site.profileImageId)) || null,
    aboutSecondaryImage: media.get(Number(about.secondaryImageId)) || null,
    aboutBlocks: sections.about ? blocksFor('about', 0) : [],

    projects: sections.projects
      ? listProjects({ status: drafts ? null : 'published', featured: true })
      : [],
    skills: sections.skills ? listSkillCategories({ onlyVisible: true }) : [],
    education: sections.education ? listEducation({ onlyVisible: true }) : [],
    research: sections.research
      ? listResearch({ status: drafts ? null : 'published', featured: true })
      : []
  };
}

export function projectsModel(req) {
  return {
    ...baseModel(req, {
      pageTitle: 'Projects',
      metaDescription: 'Software, machine learning and research projects.'
    }),
    projects: listProjects({ status: canSeeDrafts(req) ? null : 'published' })
  };
}

export function projectModel(req, project) {
  return {
    ...baseModel(req, {
      pageTitle: project.title,
      metaDescription:
        project.meta_description || project.summary || toPlainText(project.description, 200),
      canonicalPath: project.href,
      ogImage: project.thumbnail,
      isDraft: !project.isPublished
    }),
    project,
    blocks: blocksFor('project', project.id)
  };
}

export function researchListModel(req) {
  return {
    ...baseModel(req, {
      pageTitle: 'Research',
      metaDescription: 'Research projects and academic work.'
    }),
    research: listResearch({ status: canSeeDrafts(req) ? null : 'published' })
  };
}

export function researchItemModel(req, item) {
  return {
    ...baseModel(req, {
      pageTitle: item.title,
      metaDescription: item.meta_description || toPlainText(item.abstract, 200),
      canonicalPath: item.href,
      ogImage: item.thumbnail,
      isDraft: !item.isPublished
    }),
    item,
    blocks: blocksFor('research', item.id)
  };
}

export function pageModel(req, page) {
  return {
    ...baseModel(req, {
      pageTitle: page.title,
      metaDescription: page.meta_description,
      canonicalPath: page.href,
      isDraft: page.status !== 'published'
    }),
    page,
    blocks: blocksFor('page', page.id)
  };
}

/** 404 and error pages still need a full chrome model. */
export function messageModel(req, { pageTitle, status = 404, message = '' }) {
  return { ...baseModel(req, { pageTitle }), status, message };
}
