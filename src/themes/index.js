import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const THEMES_DIR = __dirname;

/**
 * The public theme registry.
 *
 * A theme is purely a presentation layer: templates plus its own CSS/JS. It
 * never touches the database — every page is handed a normalised view model
 * built in src/lib/view-model.js.
 *
 * To add a theme:
 *   1. Create src/themes/<id>/views/ with the page templates listed in VIEWS
 *      below, plus src/themes/<id>/assets/theme.css (and theme.js if needed).
 *   2. Add an entry here.
 * Nothing else changes — no routes, no schema, no admin CRUD. The setting in
 * Admin, Settings, Appearance picks up new entries automatically.
 */
export const THEMES = [
  {
    id: 'classic',
    label: 'Design 1 — Current',
    name: 'Classic',
    description:
      'The original design: a light, centred column with hairline section rules, ' +
      'a restrained blue accent and no animation. Quiet and recruiter-friendly.',
    hasScript: true
  },
  {
    id: 'editorial',
    label: 'Design 2 — Editorial',
    name: 'Editorial',
    description:
      'A dark-first editorial layout: a fixed side rail, large serif headlines, ' +
      'numbered full-width project rows, logo-led skills and restrained scroll reveals.',
    hasScript: true
  },
  {
    id: 'grid',
    label: 'Design 3 — Grid',
    name: 'Grid',
    description:
      'A Swiss/editorial design system on an off-white canvas: hairline rules, a ' +
      '12-column modular grid, oversized display type and a restrained orange accent.',
    hasScript: true
  },
  {
    id: 'orbit',
    label: 'Design 4 — Orbit',
    name: 'Orbit',
    description:
      'The Grid design system with an astronomical entrance: the homepage opens on ' +
      'a hand-steerable 3D orbital map where the sun is home and each planet is a ' +
      'destination, over a star chart that follows you through the whole site.',
    hasScript: true
  },
  {
    id: 'arcade',
    label: 'Design 5 — Arcade',
    name: 'Arcade',
    description:
      'A retro pixel-art universe: hand-drawn planets orbiting a pixel sun as the ' +
      'landing navigation, hard-edged panels and chunky type over a star field, ' +
      'with a night palette by default and a designed day mode.',
    hasScript: true
  }
];

/** Every page template a theme must provide. */
export const VIEWS = [
  'home',
  'projects',
  'project',
  'research-list',
  'research-item',
  'page',
  '404',
  'error'
];

export const DEFAULT_THEME = THEMES[0].id;

const BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function isValidTheme(id) {
  return typeof id === 'string' && BY_ID.has(id);
}

/**
 * A theme counts as installed only once its templates are on disk. A theme can
 * therefore be registered before it is written without taking the site down.
 */
export function isInstalled(id) {
  if (!isValidTheme(id)) return false;
  return VIEWS.every((view) => existsSync(join(THEMES_DIR, id, 'views', `${view}.ejs`)));
}

/** Every theme that can actually render, for the admin theme picker. */
export function installedThemes() {
  return THEMES.filter((theme) => isInstalled(theme.id));
}

/** A registered, installed theme — or the default. Never trusts a raw id. */
export function getTheme(id) {
  const requested = String(id ?? '');
  if (isInstalled(requested)) return BY_ID.get(requested);
  return BY_ID.get(DEFAULT_THEME);
}

/** Template path for res.render(), relative to the themes view root. */
export function viewPath(themeId, view) {
  return `${getTheme(themeId).id}/views/${view}`;
}

/** Public URL prefix for a theme's own assets. */
export function assetBase(themeId) {
  return `/themes/${getTheme(themeId).id}`;
}

export function assetsDir(themeId) {
  return join(THEMES_DIR, getTheme(themeId).id, 'assets');
}
