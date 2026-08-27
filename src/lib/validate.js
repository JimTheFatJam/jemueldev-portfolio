/** Small input-coercion helpers used by every admin route. */

export function str(value, max = 500) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

export function text(value, max = 20000) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\r\n/g, '\n').slice(0, max).trim();
}

export function bool(value) {
  return value === true || value === 'true' || value === 'on' || value === '1' || value === 1;
}

export function int(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Media id or null (empty select => null). */
export function mediaId(value) {
  const n = int(value, null);
  return n && n > 0 ? n : null;
}

export function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function slugify(value, fallback = 'item') {
  const slug = String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

/** Comma-separated input -> deduped string array (used for technologies). */
export function csvList(value, max = 40) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.slice(0, 60))
    )
  ].slice(0, max);
}

/** Parse a JSON array field submitted by the admin UI, with a shape guard. */
export function jsonArray(value, mapItem, max = 50) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(mapItem).filter(Boolean).slice(0, max);
}

/** Ensure a slug is unique within a table, appending -2, -3, … as needed. */
export function uniqueSlug(get, table, slug, ignoreId = null) {
  let candidate = slug;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = ignoreId
      ? get(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`, candidate, ignoreId)
      : get(`SELECT id FROM ${table} WHERE slug = ?`, candidate);
    if (!row) return candidate;
    candidate = `${slug}-${n++}`;
  }
}
