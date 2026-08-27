import { Router } from 'express';
import { getSettings, saveGroup } from '../../lib/settings.js';
import { listBlocks, BLOCK_TYPE_LIST } from '../../lib/blocks.js';
import { safeUrl } from '../../lib/markdown.js';
import { str, text, bool, mediaId, oneOf } from '../../lib/validate.js';
import { installedThemes, getTheme } from '../../themes/index.js';

const router = Router();

/**
 * Turn a bare URL into a readable label: "https://scholar.google.com/x" becomes
 * "Scholar google". Used when a line carries no explicit label.
 */
function labelFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const name = host.split('.').slice(0, -1).join(' ') || host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'Link';
  }
}

/**
 * Links are edited as one per line: no JavaScript, no repeatable-field widget,
 * and it survives a copy/paste. Both "Label | https://url" and a bare
 * "https://url" are accepted — pasting a URL on its own is the common case, and
 * silently dropping it looked like the field was broken.
 */
function parseLinkLines(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('|');

      if (separator === -1) {
        const url = safeUrl(line);
        return url ? { label: labelFromUrl(url), url } : null;
      }

      const label = line.slice(0, separator).trim().slice(0, 80);
      const url = safeUrl(line.slice(separator + 1).trim());
      if (!url) return null;
      return { label: label || labelFromUrl(url), url };
    })
    .filter(Boolean)
    .slice(0, 12);
}

export function linksToLines(links) {
  return (links || []).map((link) => `${link.label} | ${link.url}`).join('\n');
}

/** Additional email addresses, one per line. */
function parseEmailLines(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((line) => line.trim().slice(0, 160))
    .filter((line) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line))
    .filter((line, index, all) => all.indexOf(line) === index)
    .slice(0, 8);
}

export function emailsToLines(emails) {
  return (emails || []).join('\n');
}

function render(res, view, extra) {
  res.render('admin/settings/' + view, {
    section: 'settings',
    settings: getSettings(),
    linksToLines,
    emailsToLines,
    ...extra
  });
}

router.get('/', (req, res) => {
  render(res, 'site', { pageTitle: 'Site settings', tab: 'site' });
});

router.post('/', (req, res) => {
  saveGroup('site', {
    name: str(req.body.name, 120),
    title: str(req.body.title, 160),
    tagline: str(req.body.tagline, 160),
    description: text(req.body.description, 600),
    metaDescription: str(req.body.metaDescription, 300),
    baseUrl: safeUrl(req.body.baseUrl).replace(/\/$/, ''),
    email: str(req.body.email, 160),
    extraEmails: parseEmailLines(req.body.extraEmails),
    github: safeUrl(req.body.github),
    linkedin: safeUrl(req.body.linkedin),
    resumeUrl: safeUrl(req.body.resumeUrl),
    profileImageId: mediaId(req.body.profileImageId),
    ogImageId: mediaId(req.body.ogImageId),
    faviconId: mediaId(req.body.faviconId),
    extraLinks: parseLinkLines(req.body.extraLinks)
  });
  res.flash('success', 'Site settings saved.');
  res.redirect('/admin/settings');
});

router.get('/hero', (req, res) => {
  render(res, 'hero', { pageTitle: 'Hero', tab: 'hero' });
});

router.post('/hero', (req, res) => {
  saveGroup('hero', {
    identity: str(req.body.identity, 200),
    headline: str(req.body.headline, 120),
    intro: text(req.body.intro, 800),
    ctaLabel: str(req.body.ctaLabel, 40),
    ctaHref: safeUrl(req.body.ctaHref),
    secondaryCtaLabel: str(req.body.secondaryCtaLabel, 40),
    secondaryCtaHref: safeUrl(req.body.secondaryCtaHref)
  });
  res.flash('success', 'Hero saved.');
  res.redirect('/admin/settings/hero');
});

router.get('/about', (req, res) => {
  render(res, 'about', {
    pageTitle: 'About',
    tab: 'about',
    blocks: listBlocks('about', 0),
    blockTypes: BLOCK_TYPE_LIST
  });
});

router.post('/about', (req, res) => {
  saveGroup('about', {
    heading: str(req.body.heading, 80),
    body: text(req.body.body, 8000),
    imageId: mediaId(req.body.imageId),
    secondaryImageId: mediaId(req.body.secondaryImageId),
    links: parseLinkLines(req.body.links)
  });
  res.flash('success', 'About section saved.');
  res.redirect('/admin/settings/about');
});

router.get('/contact', (req, res) => {
  render(res, 'contact', { pageTitle: 'Contact', tab: 'contact' });
});

router.post('/contact', (req, res) => {
  saveGroup('contact', {
    heading: str(req.body.heading, 120),
    body: text(req.body.body, 2000),
    showEmail: bool(req.body.showEmail)
  });
  res.flash('success', 'Contact section saved.');
  res.redirect('/admin/settings/contact');
});

router.get('/sections', (req, res) => {
  render(res, 'sections', { pageTitle: 'Sections', tab: 'sections', themes: installedThemes() });
});

router.post('/sections', (req, res) => {
  saveGroup('sections', {
    about: bool(req.body.about),
    projects: bool(req.body.projects),
    skills: bool(req.body.skills),
    education: bool(req.body.education),
    research: bool(req.body.research),
    contact: bool(req.body.contact)
  });
  saveGroup('sectionTitles', {
    projects: str(req.body.titleProjects, 80),
    skills: str(req.body.titleSkills, 80),
    education: str(req.body.titleEducation, 80),
    research: str(req.body.titleResearch, 80),
    contact: str(req.body.titleContact, 80)
  });
  // getTheme() falls back to the default for anything unknown or not installed.
  saveGroup('appearance', {
    skillIconStyle: oneOf(req.body.skillIconStyle, ['color', 'mono'], 'color'),
    publicTheme: getTheme(req.body.publicTheme).id
  });
  res.flash('success', 'Appearance and section visibility saved.');
  res.redirect('/admin/settings/sections');
});

export default router;
