import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Technology icons, backed by the locally installed `devicon` package.
 *
 * What is stored in the database is only the devicon *name* — "python",
 * "nodejs", "postgresql". That identifier is stable across devicon releases,
 * and keeping the variant out of the data means the whole site can switch
 * between the colour and monochrome look from one setting.
 *
 * SVGs are read from the package at runtime, normalised once and cached, so
 * nothing is fetched from a CDN and no icon assets are duplicated into the repo.
 */

const require = createRequire(import.meta.url);

let manifest = [];
let iconsDir = '';

try {
  const manifestPath = require.resolve('devicon/devicon.json');
  iconsDir = join(dirname(manifestPath), 'icons');
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {
  console.warn('[portfolio] devicon is not installed; skill icons will fall back to a generic mark.');
}

/** Which drawing to use, best first. Wordmarks are last: they are wide. */
const VARIANT_ORDER = {
  color: ['original', 'plain', 'line', 'original-wordmark', 'plain-wordmark', 'line-wordmark'],
  mono: ['plain', 'line', 'original', 'plain-wordmark', 'line-wordmark', 'original-wordmark']
};

export const FALLBACK_ICON = 'generic';

/** A neutral mark for skills with no logo, or whose stored name no longer exists. */
const FALLBACK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="icon-svg">' +
  '<rect x="3" y="3" width="18" height="18" rx="4"></rect>' +
  '<path d="m9.5 9.5-2 2.5 2 2.5"></path><path d="m14.5 9.5 2 2.5-2 2.5"></path></svg>';

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

function buildIndex() {
  const byName = new Map();
  for (const entry of manifest) {
    const variants = entry?.versions?.svg;
    if (!entry?.name || !Array.isArray(variants) || variants.length === 0) continue;

    const altnames = Array.isArray(entry.altnames) ? entry.altnames.filter((v) => typeof v === 'string') : [];
    const tags = Array.isArray(entry.tags) ? entry.tags.filter((v) => typeof v === 'string') : [];

    byName.set(entry.name, {
      name: entry.name,
      label: entry.name,
      altnames,
      tags,
      color: typeof entry.color === 'string' ? entry.color : '',
      variants,
      // Everything searchable, lower-cased once at start-up.
      haystack: [entry.name, ...altnames, ...tags].join(' ').toLowerCase()
    });
  }
  return byName;
}

const INDEX = buildIndex();
export const ICON_COUNT = INDEX.size;

export function iconExists(name) {
  return typeof name === 'string' && INDEX.has(name);
}

export function getIcon(name) {
  return INDEX.get(name) || null;
}

/** Normalise a submitted icon value: a known devicon name, or ''. */
export function normalizeIconName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  if (!name) return '';
  if (name === FALLBACK_ICON) return FALLBACK_ICON;
  return INDEX.has(name) ? name : '';
}

/**
 * Search the catalogue. Exact name first, then prefix, then substring, so
 * typing "java" puts Java above JavaScript and "go" does not bury Go.
 */
export function searchIcons(query, limit = 60) {
  const q = String(query ?? '').trim().toLowerCase();
  const results = [];

  for (const icon of INDEX.values()) {
    let score;
    if (!q) {
      score = 3;
    } else if (icon.name === q || icon.altnames.some((alt) => alt.toLowerCase() === q)) {
      score = 0;
    } else if (icon.name.startsWith(q) || icon.altnames.some((alt) => alt.toLowerCase().startsWith(q))) {
      score = 1;
    } else if (icon.haystack.includes(q)) {
      score = 2;
    } else {
      continue;
    }
    results.push({ icon, score });
  }

  results.sort((a, b) => a.score - b.score || a.icon.name.localeCompare(b.icon.name));
  return results.slice(0, limit).map(({ icon }) => ({
    name: icon.name,
    label: icon.label,
    altnames: icon.altnames,
    color: icon.color
  }));
}

/**
 * Best-effort mapping for icon values written before the picker existed
 * (free text such as "Node.js", "devicon-python-plain" or "C++").
 */
export function resolveLegacyIcon(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (INDEX.has(raw)) return raw;

  const stripped = raw
    .replace(/^devicon[-\s]*/, '')
    .replace(/[-\s](original|plain|line)(-wordmark)?(-colou?red)?$/, '')
    .replace(/[^a-z0-9+#]/g, '');

  const spellings = {
    'c++': 'cplusplus',
    cpp: 'cplusplus',
    'c#': 'csharp',
    cs: 'csharp',
    js: 'javascript',
    ts: 'typescript',
    node: 'nodejs',
    golang: 'go',
    postgres: 'postgresql',
    aws: 'amazonwebservices',
    gcp: 'googlecloud',
    k8s: 'kubernetes',
    vscode: 'vscode',
    scikitlearn: 'scikitlearn'
  };
  const mapped = spellings[raw] || spellings[stripped];
  if (mapped && INDEX.has(mapped)) return mapped;
  if (INDEX.has(stripped)) return stripped;

  for (const icon of INDEX.values()) {
    if (icon.altnames.some((alt) => alt.toLowerCase().replace(/[^a-z0-9+#]/g, '') === stripped)) {
      return icon.name;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// SVG normalisation
// ---------------------------------------------------------------------------

/**
 * Style properties we keep when flattening a `style="…"` attribute into real
 * SVG attributes. Inline styles are dropped entirely so the site can keep a
 * strict `style-src 'self'` Content-Security-Policy.
 */
const KEEP_STYLE_PROPS = new Set([
  'fill', 'fill-rule', 'fill-opacity', 'clip-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'stop-color', 'stop-opacity', 'color', 'paint-order', 'mask-type'
]);

const DROP_ELEMENTS = /<\s*(script|style|foreignObject|image|iframe|a|animate|animateTransform|animateMotion|set)\b[\s\S]*?(<\/\s*\1\s*>|\/>)/gi;

function flattenStyleAttributes(svg) {
  return svg.replace(/\sstyle="([^"]*)"/gi, (_match, declarations) => {
    const attributes = [];
    for (const declaration of declarations.split(';')) {
      const separator = declaration.indexOf(':');
      if (separator < 0) continue;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim();
      if (!KEEP_STYLE_PROPS.has(property)) continue;
      if (!value || /[<>"]/.test(value) || /url\s*\(\s*['"]?\s*(?!#)/i.test(value)) continue;
      attributes.push(`${property}="${value}"`);
    }
    return attributes.length ? ' ' + attributes.join(' ') : '';
  });
}

/**
 * Prefix every id so two inlined icons on the same page cannot clash over
 * gradient or clip-path references.
 */
function scopeIds(svg, prefix) {
  const ids = new Set();
  for (const match of svg.matchAll(/\sid="([^"]+)"/g)) ids.add(match[1]);
  if (ids.size === 0) return svg;

  let out = svg;
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scoped = `${prefix}${id}`;
    out = out
      .replace(new RegExp(`\\sid="${escaped}"`, 'g'), ` id="${scoped}"`)
      .replace(new RegExp(`url\\(\\s*#${escaped}\\s*\\)`, 'g'), `url(#${scoped})`)
      .replace(new RegExp(`((?:xlink:)?href)="#${escaped}"`, 'g'), `$1="#${scoped}"`);
  }
  return out;
}

/** Repaint an icon in the surrounding text colour. */
function toMonochrome(svg) {
  return svg
    .replace(/\sfill="(?!none")[^"]*"/gi, ' fill="currentColor"')
    .replace(/\sstroke="(?!none")[^"]*"/gi, ' stroke="currentColor"')
    .replace(/\sstop-color="[^"]*"/gi, ' stop-color="currentColor"');
}

const cache = new Map();

function loadSvg(name, variant) {
  try {
    return readFileSync(join(iconsDir, name, `${name}-${variant}.svg`), 'utf8');
  } catch {
    return null;
  }
}

/**
 * A handful of devicon drawings are enormous (Tux in full colour is ~190 KB of
 * gradients). Icons are inlined into the page, so prefer the first variant that
 * stays small, and fall back to the smallest one available.
 */
const MAX_INLINE_BYTES = 16 * 1024;

function buildVariant(icon, style) {
  const order = (VARIANT_ORDER[style] || VARIANT_ORDER.color).filter((variant) =>
    icon.variants.includes(variant)
  );
  const candidates = order.length ? order : icon.variants;
  const mono = style === 'mono';

  let smallest = null;
  for (const variant of candidates) {
    const raw = loadSvg(icon.name, variant);
    if (!raw) continue;
    const markup = normalize(raw, icon.name, variant, mono);
    if (markup.length <= MAX_INLINE_BYTES) return markup;
    if (!smallest || markup.length < smallest.length) smallest = markup;
  }
  return smallest;
}

/**
 * Inline SVG markup for a stored icon name, ready to drop into a template.
 * Unknown or empty names return the generic fallback mark.
 */
export function renderIcon(name, { style = 'color' } = {}) {
  const mono = style === 'mono';
  const key = `${name}|${mono ? 'mono' : 'color'}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const icon = INDEX.get(String(name ?? ''));
  const markup = (icon && buildVariant(icon, mono ? 'mono' : 'color')) || FALLBACK_SVG;

  cache.set(key, markup);
  return markup;
}

function normalize(raw, name, variant, mono) {
  let svg = raw
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(DROP_ELEMENTS, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '')
    .replace(/\sclass="[^"]*"/gi, '')
    .trim();

  svg = flattenStyleAttributes(svg);
  svg = scopeIds(svg, `di-${name}-${variant}-`);
  if (mono) svg = toMonochrome(svg);

  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) return FALLBACK_SVG;

  const viewBox = open[0].match(/viewBox="([^"]*)"/i);
  const attributes = [
    'xmlns="http://www.w3.org/2000/svg"',
    /xlink:href/i.test(svg) ? 'xmlns:xlink="http://www.w3.org/1999/xlink"' : '',
    viewBox ? `viewBox="${viewBox[1]}"` : 'viewBox="0 0 128 128"',
    mono ? 'fill="currentColor"' : '',
    'aria-hidden="true"',
    'focusable="false"',
    'class="icon-svg"'
  ]
    .filter(Boolean)
    .join(' ');

  return svg.replace(/<svg\b[^>]*>/i, `<svg ${attributes}>`);
}
