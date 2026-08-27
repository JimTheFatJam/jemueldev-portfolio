import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import { all, get, run, now, UPLOAD_DIR } from '../db/index.js';
import { slugify } from './validate.js';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB

/** Only these are ever written to disk. SVG is excluded: it can carry script. */
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
  ['image/gif', '.gif']
]);
const DOC_TYPES = new Map([['application/pdf', '.pdf']]);

export const ACCEPTED_MIME = [...IMAGE_TYPES.keys(), ...DOC_TYPES.keys()];

const VARIANT_WIDTHS = [480, 960, 1440];

/** True when a buffer starts with the PDF magic number. */
function isPdf(buffer) {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Validate an uploaded buffer by decoding it (not by trusting the client's
 * declared content type), write it plus responsive WebP variants, and record it.
 */
export async function storeUpload({ buffer, originalName, mimetype, alt = '' }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw badRequest('Empty file.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('File is larger than 12 MB.');

  const rawName = originalName || 'file';
  const safeBase = slugify(basename(rawName, extname(rawName)), 'file').slice(0, 48);
  const unique = randomBytes(6).toString('hex');

  if (DOC_TYPES.has(mimetype)) {
    if (!isPdf(buffer)) throw badRequest('That file is not a valid PDF.');
    const filename = safeBase + '-' + unique + '.pdf';
    await writeFile(join(UPLOAD_DIR, filename), buffer);
    return insertMedia({
      filename,
      originalName: rawName,
      mime: 'application/pdf',
      size: buffer.length,
      width: null,
      height: null,
      alt,
      variants: []
    });
  }

  if (!IMAGE_TYPES.has(mimetype)) {
    throw badRequest('Unsupported file type. Upload a JPEG, PNG, WebP, AVIF, GIF or PDF.');
  }

  let meta;
  try {
    meta = await sharp(buffer, { animated: mimetype === 'image/gif' }).metadata();
  } catch {
    throw badRequest('That file could not be read as an image.');
  }
  if (!meta.width || !meta.height) throw badRequest('That file could not be read as an image.');

  // The decoded format is the source of truth, not the declared mimetype.
  const detected = 'image/' + meta.format;
  if (!IMAGE_TYPES.has(detected)) throw badRequest('Unsupported image format.');

  const ext = IMAGE_TYPES.get(detected);
  const filename = safeBase + '-' + unique + ext;

  // Re-encode (drops EXIF and any embedded payload) and cap the stored original.
  let mainBuffer = buffer;
  if (detected !== 'image/gif') {
    mainBuffer = await sharp(buffer)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    meta = await sharp(mainBuffer).metadata();
  }
  await writeFile(join(UPLOAD_DIR, filename), mainBuffer);

  const variants = [];
  if (detected !== 'image/gif') {
    for (const width of VARIANT_WIDTHS) {
      if (meta.width <= width) continue;
      const file = safeBase + '-' + unique + '-' + width + '.webp';
      const out = await sharp(mainBuffer)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      await writeFile(join(UPLOAD_DIR, file), out);
      variants.push({ w: width, file, size: out.length });
    }
    variants.push({ w: meta.width, file: filename, size: mainBuffer.length });
    variants.sort((a, b) => a.w - b.w);
  }

  return insertMedia({
    filename,
    originalName: rawName,
    mime: detected,
    size: mainBuffer.length,
    width: meta.width,
    height: meta.height,
    alt,
    variants
  });
}

function insertMedia({ filename, originalName, mime, size, width, height, alt, variants }) {
  const info = run(
    `INSERT INTO media (filename, original_name, mime, size, width, height, alt, variants, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    filename,
    String(originalName).slice(0, 200),
    mime,
    size,
    width,
    height,
    String(alt || '').slice(0, 300),
    JSON.stringify(variants),
    now()
  );
  return getMedia(Number(info.lastInsertRowid));
}

function hydrate(row) {
  if (!row) return null;
  let variants = [];
  try {
    variants = JSON.parse(row.variants || '[]');
  } catch {
    variants = [];
  }
  return {
    ...row,
    variants,
    url: '/uploads/' + row.filename,
    isImage: row.mime.startsWith('image/')
  };
}

export function getMedia(id) {
  if (!id) return null;
  return hydrate(get('SELECT * FROM media WHERE id = ?', id));
}

export function listMedia({ limit = 500, offset = 0, search = '' } = {}) {
  const rows = search
    ? all(
        `SELECT * FROM media WHERE original_name LIKE ? OR filename LIKE ?
         ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        '%' + search + '%',
        '%' + search + '%',
        limit,
        offset
      )
    : all('SELECT * FROM media ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', limit, offset);
  return rows.map(hydrate);
}

/** Fetch several media rows at once, keyed by id (avoids N+1 lookups in views). */
export function mediaByIds(ids) {
  const unique = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const rows = all('SELECT * FROM media WHERE id IN (' + placeholders + ')', ...unique);
  return new Map(rows.map((row) => [row.id, hydrate(row)]));
}

function parseIds(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

/** Where a media item is referenced, so the admin never deletes a live image. */
export function findMediaUsage(id) {
  const usage = [];
  const numericId = Number(id);

  for (const row of all('SELECT title FROM projects WHERE thumbnail_id = ?', numericId)) {
    usage.push({ label: 'Project thumbnail', title: row.title });
  }
  for (const row of all('SELECT title FROM research WHERE thumbnail_id = ?', numericId)) {
    usage.push({ label: 'Research thumbnail', title: row.title });
  }
  for (const row of all('SELECT degree FROM education WHERE logo_id = ?', numericId)) {
    usage.push({ label: 'Education logo', title: row.degree });
  }
  for (const row of all('SELECT title, gallery FROM projects')) {
    if (parseIds(row.gallery).includes(numericId)) usage.push({ label: 'Project gallery', title: row.title });
  }
  for (const row of all('SELECT title, gallery FROM research')) {
    if (parseIds(row.gallery).includes(numericId)) usage.push({ label: 'Research gallery', title: row.title });
  }
  for (const row of all('SELECT owner_type, owner_id, data FROM blocks')) {
    try {
      const data = JSON.parse(row.data);
      const ids = [data.mediaId, ...(Array.isArray(data.items) ? data.items : [])].map(Number);
      if (ids.includes(numericId)) {
        usage.push({ label: 'Content block', title: row.owner_type + ' #' + row.owner_id });
      }
    } catch {
      /* ignore malformed block */
    }
  }
  const settingsKeys = 'profileImageId|ogImageId|faviconId|imageId|secondaryImageId';
  const settingsPattern = new RegExp('"(' + settingsKeys + ')":\\s*' + numericId + '\\b');
  for (const row of all('SELECT key, value FROM settings')) {
    if (settingsPattern.test(row.value)) usage.push({ label: 'Site settings', title: row.key });
  }
  return usage;
}

/** Delete a media row plus every file it owns. */
export async function deleteMedia(id) {
  const media = getMedia(id);
  if (!media) return false;
  const files = [media.filename, ...media.variants.map((v) => v.file)];
  await Promise.all(
    [...new Set(files)].map(async (file) => {
      // Names are generated server-side, but never trust one from the DB blindly.
      if (!file || file.includes('/') || file.includes('\\') || file.includes('..')) return;
      try {
        await unlink(join(UPLOAD_DIR, file));
      } catch {
        /* already gone */
      }
    })
  );
  run('DELETE FROM media WHERE id = ?', id);
  return true;
}

export function updateMediaAlt(id, alt) {
  run('UPDATE media SET alt = ? WHERE id = ?', String(alt || '').slice(0, 300), id);
}

/** srcset string built from an image's generated variants. */
export function srcset(media) {
  if (!media || !media.variants || media.variants.length === 0) return '';
  return media.variants.map((v) => '/uploads/' + v.file + ' ' + v.w + 'w').join(', ');
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}
