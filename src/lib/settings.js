import { all, get, run } from '../db/index.js';

/**
 * All editable global settings live here as JSON documents keyed by group.
 * Defaults double as the schema: the admin forms and the public views only
 * ever read keys that exist below, so a missing/partial row is always safe.
 */
export const DEFAULTS = {
  site: {
    name: 'Your Name',
    title: '',                 // <title> override; falls back to name — tagline
    tagline: 'Computer Science Student',
    description: '',
    metaDescription: '',
    baseUrl: '',               // e.g. https://example.com (used for canonical/OG)
    email: '',
    // Additional addresses. The single `email` above stays the primary one, so
    // everything written before this existed keeps working unchanged.
    extraEmails: [],
    github: '',
    linkedin: '',
    resumeUrl: '',
    profileImageId: null,
    ogImageId: null,
    faviconId: null,
    extraLinks: []             // [{label, url}]
  },
  hero: {
    identity: 'Computer Science Student • Machine Learning • Software Development',
    headline: '',              // falls back to site.name
    intro: '',
    ctaLabel: 'View projects',
    ctaHref: '#projects',
    secondaryCtaLabel: 'Get in touch',
    secondaryCtaHref: '#contact'
  },
  about: {
    heading: 'About',
    body: '',
    imageId: null,
    secondaryImageId: null,
    links: []
  },
  appearance: {
    // Which public theme renders the site. Themes live in src/themes/.
    publicTheme: 'classic',
    // How technology logos render in the skills section: full colour, or
    // repainted in the surrounding text colour.
    skillIconStyle: 'color'
  },
  sectionTitles: {
    projects: 'Selected work',
    skills: 'Skills',
    education: 'Education',
    research: 'Research',
    contact: 'Contact'
  },
  contact: {
    heading: "Let's connect.",
    body: '',
    showEmail: true
  },
  sections: {
    about: true,
    projects: true,
    skills: true,
    education: true,
    research: true,
    contact: true
  }
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeDefaults(defaults, stored) {
  if (!isPlainObject(stored)) return structuredClone(defaults);
  const out = structuredClone(defaults);
  for (const key of Object.keys(defaults)) {
    if (!(key in stored)) continue;
    const value = stored[key];
    out[key] = isPlainObject(defaults[key]) ? mergeDefaults(defaults[key], value) : value;
  }
  return out;
}

/** Read one settings group, merged over its defaults. */
export function getGroup(group) {
  const row = get('SELECT value FROM settings WHERE key = ?', group);
  let parsed = null;
  if (row) {
    try {
      parsed = JSON.parse(row.value);
    } catch {
      parsed = null;
    }
  }
  return mergeDefaults(DEFAULTS[group] ?? {}, parsed);
}

/** Read every settings group at once (one query). */
export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const stored = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      /* ignore malformed row, fall back to defaults */
    }
  }
  const out = {};
  for (const group of Object.keys(DEFAULTS)) {
    out[group] = mergeDefaults(DEFAULTS[group], stored[group]);
  }

  // Derived, read-only: the primary address followed by any extras, deduped.
  // Themes render `site.emails`; `site.email` stays the single primary address.
  // It is not part of DEFAULTS, so saveGroup() never writes it back.
  out.site.emails = [out.site.email, ...(out.site.extraEmails || [])]
    .map((address) => String(address || '').trim())
    .filter((address, index, all) => address && all.indexOf(address) === index);

  return out;
}

/** Merge a partial patch into a settings group. */
export function saveGroup(group, patch) {
  if (!(group in DEFAULTS)) throw new Error(`Unknown settings group: ${group}`);
  const merged = mergeDefaults(DEFAULTS[group], { ...getGroup(group), ...patch });
  run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    group,
    JSON.stringify(merged)
  );
  return merged;
}
