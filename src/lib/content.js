import { all, get, run, now, transaction } from '../db/index.js';
import { mediaByIds } from './media.js';

/**
 * Data access for every content type. Both the public site and the admin read
 * through here, so JSON columns are parsed and media joined in exactly one place.
 */

const ORDERABLE = new Set(['projects', 'research', 'education', 'skill_categories', 'skills', 'pages']);

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * A project's technologies are stored as [{name, icon}], where `icon` is a
 * devicon name or ''. Plain strings written before the picker existed are still
 * accepted and read as an entry with no logo, so no row can become unreadable.
 */
export function normalizeTech(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return { name: entry.trim(), icon: '' };
      if (entry && typeof entry === 'object') {
        return { name: String(entry.name || '').trim(), icon: String(entry.icon || '').trim() };
      }
      return null;
    })
    .filter((entry) => entry && entry.name)
    .slice(0, 40);
}

/** Research keywords: a plain, deduped list of short labels. */
export function normalizeKeywords(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? '').trim().slice(0, 60))
    .filter((entry, index, all) => entry && all.indexOf(entry) === index)
    .slice(0, 24);
}

/** Move a row one step within its list. Scoped for skills (per category). */
export const reorder = transaction((table, id, direction, scope = null) => {
  if (!ORDERABLE.has(table)) throw new Error('Table is not orderable: ' + table);
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, Number(id));
  if (!row) return false;

  const scopeSql = scope ? ` AND ${scope.column} = ?` : '';
  const scopeArgs = scope ? [row[scope.column]] : [];
  const comparator = direction === 'up' ? '<' : '>';
  const order = direction === 'up' ? 'DESC' : 'ASC';

  const neighbour = get(
    `SELECT * FROM ${table}
      WHERE (position ${comparator} ? OR (position = ? AND id ${comparator} ?))${scopeSql}
      ORDER BY position ${order}, id ${order} LIMIT 1`,
    row.position,
    row.position,
    row.id,
    ...scopeArgs
  );
  if (!neighbour) return false;

  run(`UPDATE ${table} SET position = ? WHERE id = ?`, neighbour.position, row.id);
  run(`UPDATE ${table} SET position = ? WHERE id = ?`, row.position, neighbour.id);

  if (neighbour.position === row.position) {
    const rows = all(
      `SELECT id FROM ${table} WHERE 1 = 1${scopeSql} ORDER BY position, id`,
      ...scopeArgs
    );
    rows.forEach((item, index) => run(`UPDATE ${table} SET position = ? WHERE id = ?`, index, item.id));
  }
  return true;
});

export function nextPosition(table, scope = null) {
  const sql = scope
    ? `SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM ${table} WHERE ${scope.column} = ?`
    : `SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM ${table}`;
  return scope ? get(sql, scope.value).pos : get(sql).pos;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function hydrateProject(row, media) {
  if (!row) return null;
  return {
    ...row,
    tech: normalizeTech(parseJson(row.tech, [])),
    galleryIds: parseJson(row.gallery, []),
    featured: !!row.featured,
    hasDetailPage: !!row.has_detail_page,
    isPublished: row.status === 'published',
    thumbnail: media ? media.get(row.thumbnail_id) || null : null,
    gallery: media ? parseJson(row.gallery, []).map((id) => media.get(Number(id))).filter(Boolean) : [],
    href: '/projects/' + row.slug
  };
}

export function listProjects({ status = null, featured = null, limit = null } = {}) {
  const where = [];
  const args = [];
  if (status) {
    where.push('status = ?');
    args.push(status);
  }
  if (featured !== null) {
    where.push('featured = ?');
    args.push(featured ? 1 : 0);
  }
  const sql =
    'SELECT * FROM projects' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY position, id' +
    (limit ? ' LIMIT ' + Number(limit) : '');
  const rows = all(sql, ...args);
  const media = mediaByIds(rows.flatMap((row) => [row.thumbnail_id, ...parseJson(row.gallery, [])]));
  return rows.map((row) => hydrateProject(row, media));
}

export function getProject(id) {
  const row = get('SELECT * FROM projects WHERE id = ?', Number(id));
  if (!row) return null;
  return hydrateProject(row, mediaByIds([row.thumbnail_id, ...parseJson(row.gallery, [])]));
}

export function getProjectBySlug(slug) {
  const row = get('SELECT * FROM projects WHERE slug = ?', String(slug));
  if (!row) return null;
  return hydrateProject(row, mediaByIds([row.thumbnail_id, ...parseJson(row.gallery, [])]));
}

export function createProject(data) {
  const timestamp = now();
  const info = run(
    `INSERT INTO projects
      (slug, title, summary, description, tech, thumbnail_id, gallery, year, github_url, demo_url,
       featured, status, has_detail_page, meta_description, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    data.slug,
    data.title,
    data.summary,
    data.description,
    JSON.stringify(data.tech),
    data.thumbnail_id,
    JSON.stringify(data.gallery),
    data.year,
    data.github_url,
    data.demo_url,
    data.featured ? 1 : 0,
    data.status,
    data.has_detail_page ? 1 : 0,
    data.meta_description,
    nextPosition('projects'),
    timestamp,
    timestamp
  );
  return Number(info.lastInsertRowid);
}

export function updateProject(id, data) {
  run(
    `UPDATE projects SET slug = ?, title = ?, summary = ?, description = ?, tech = ?, thumbnail_id = ?,
       gallery = ?, year = ?, github_url = ?, demo_url = ?, featured = ?, status = ?, has_detail_page = ?,
       meta_description = ?, updated_at = ?
     WHERE id = ?`,
    data.slug,
    data.title,
    data.summary,
    data.description,
    JSON.stringify(data.tech),
    data.thumbnail_id,
    JSON.stringify(data.gallery),
    data.year,
    data.github_url,
    data.demo_url,
    data.featured ? 1 : 0,
    data.status,
    data.has_detail_page ? 1 : 0,
    data.meta_description,
    now(),
    Number(id)
  );
}

export function deleteProject(id) {
  run('DELETE FROM projects WHERE id = ?', Number(id));
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export function listSkillCategories({ onlyVisible = false } = {}) {
  const rows = onlyVisible
    ? all('SELECT * FROM skill_categories WHERE visible = 1 ORDER BY position, id')
    : all('SELECT * FROM skill_categories ORDER BY position, id');
  if (rows.length === 0) return [];
  const skills = all('SELECT * FROM skills ORDER BY position, id');
  return rows.map((row) => ({
    ...row,
    visible: !!row.visible,
    skills: skills.filter((skill) => skill.category_id === row.id)
  }));
}

export function getSkillCategory(id) {
  const row = get('SELECT * FROM skill_categories WHERE id = ?', Number(id));
  if (!row) return null;
  return {
    ...row,
    visible: !!row.visible,
    skills: all('SELECT * FROM skills WHERE category_id = ? ORDER BY position, id', row.id)
  };
}

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------

export function listEducation({ onlyVisible = false } = {}) {
  const rows = onlyVisible
    ? all('SELECT * FROM education WHERE visible = 1 ORDER BY position, id')
    : all('SELECT * FROM education ORDER BY position, id');
  const media = mediaByIds(rows.map((row) => row.logo_id));
  return rows.map((row) => ({ ...row, visible: !!row.visible, logo: media.get(row.logo_id) || null }));
}

export function getEducation(id) {
  const row = get('SELECT * FROM education WHERE id = ?', Number(id));
  if (!row) return null;
  return { ...row, visible: !!row.visible, logo: mediaByIds([row.logo_id]).get(row.logo_id) || null };
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

function hydrateResearch(row, media) {
  if (!row) return null;
  return {
    ...row,
    links: parseJson(row.links, []),
    keywords: normalizeKeywords(parseJson(row.keywords, [])),
    galleryIds: parseJson(row.gallery, []),
    featured: !!row.featured,
    hasDetailPage: !!row.has_detail_page,
    isPublished: row.status === 'published',
    thumbnail: media ? media.get(row.thumbnail_id) || null : null,
    gallery: media ? parseJson(row.gallery, []).map((id) => media.get(Number(id))).filter(Boolean) : [],
    href: '/research/' + row.slug
  };
}

export function listResearch({ status = null, featured = null } = {}) {
  const where = [];
  const args = [];
  if (status) {
    where.push('status = ?');
    args.push(status);
  }
  if (featured !== null) {
    where.push('featured = ?');
    args.push(featured ? 1 : 0);
  }
  const rows = all(
    'SELECT * FROM research' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY position, id',
    ...args
  );
  const media = mediaByIds(rows.flatMap((row) => [row.thumbnail_id, ...parseJson(row.gallery, [])]));
  return rows.map((row) => hydrateResearch(row, media));
}

export function getResearch(id) {
  const row = get('SELECT * FROM research WHERE id = ?', Number(id));
  if (!row) return null;
  return hydrateResearch(row, mediaByIds([row.thumbnail_id, ...parseJson(row.gallery, [])]));
}

export function getResearchBySlug(slug) {
  const row = get('SELECT * FROM research WHERE slug = ?', String(slug));
  if (!row) return null;
  return hydrateResearch(row, mediaByIds([row.thumbnail_id, ...parseJson(row.gallery, [])]));
}

export function createResearch(data) {
  const timestamp = now();
  const info = run(
    `INSERT INTO research
      (slug, title, abstract, authors, institution, date, work_status, paper_url, github_url, links, keywords,
       thumbnail_id, gallery, featured, status, has_detail_page, meta_description, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    data.slug,
    data.title,
    data.abstract,
    data.authors,
    data.institution,
    data.date,
    data.work_status,
    data.paper_url,
    data.github_url,
    JSON.stringify(data.links),
    JSON.stringify(normalizeKeywords(data.keywords)),
    data.thumbnail_id,
    JSON.stringify(data.gallery),
    data.featured ? 1 : 0,
    data.status,
    data.has_detail_page ? 1 : 0,
    data.meta_description,
    nextPosition('research'),
    timestamp,
    timestamp
  );
  return Number(info.lastInsertRowid);
}

export function updateResearch(id, data) {
  run(
    `UPDATE research SET slug = ?, title = ?, abstract = ?, authors = ?, institution = ?, date = ?,
       work_status = ?, paper_url = ?, github_url = ?, links = ?, keywords = ?, thumbnail_id = ?, gallery = ?,
       featured = ?, status = ?, has_detail_page = ?, meta_description = ?, updated_at = ?
     WHERE id = ?`,
    data.slug,
    data.title,
    data.abstract,
    data.authors,
    data.institution,
    data.date,
    data.work_status,
    data.paper_url,
    data.github_url,
    JSON.stringify(data.links),
    JSON.stringify(normalizeKeywords(data.keywords)),
    data.thumbnail_id,
    JSON.stringify(data.gallery),
    data.featured ? 1 : 0,
    data.status,
    data.has_detail_page ? 1 : 0,
    data.meta_description,
    now(),
    Number(id)
  );
}

export function deleteResearch(id) {
  run('DELETE FROM research WHERE id = ?', Number(id));
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function listPages({ status = null } = {}) {
  const rows = status
    ? all('SELECT * FROM pages WHERE status = ? ORDER BY position, id', status)
    : all('SELECT * FROM pages ORDER BY position, id');
  return rows.map((row) => ({ ...row, showInNav: !!row.show_in_nav, href: '/' + row.slug }));
}

export function getPage(id) {
  const row = get('SELECT * FROM pages WHERE id = ?', Number(id));
  return row ? { ...row, showInNav: !!row.show_in_nav, href: '/' + row.slug } : null;
}

export function getPageBySlug(slug) {
  const row = get('SELECT * FROM pages WHERE slug = ?', String(slug));
  return row ? { ...row, showInNav: !!row.show_in_nav, href: '/' + row.slug } : null;
}

export function deletePage(id) {
  run('DELETE FROM pages WHERE id = ?', Number(id));
}

/** Counts for the admin dashboard, in a single pass per table. */
export function contentCounts() {
  return {
    projects: get('SELECT COUNT(*) AS n FROM projects').n,
    projectsPublished: get("SELECT COUNT(*) AS n FROM projects WHERE status = 'published'").n,
    projectsFeatured: get("SELECT COUNT(*) AS n FROM projects WHERE status = 'published' AND featured = 1").n,
    research: get('SELECT COUNT(*) AS n FROM research').n,
    researchPublished: get("SELECT COUNT(*) AS n FROM research WHERE status = 'published'").n,
    education: get('SELECT COUNT(*) AS n FROM education').n,
    skills: get('SELECT COUNT(*) AS n FROM skills').n,
    skillCategories: get('SELECT COUNT(*) AS n FROM skill_categories').n,
    media: get('SELECT COUNT(*) AS n FROM media').n,
    pages: get('SELECT COUNT(*) AS n FROM pages').n
  };
}
