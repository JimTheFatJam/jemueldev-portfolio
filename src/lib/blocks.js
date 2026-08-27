import { all, get, run, transaction } from '../db/index.js';
import { mediaByIds } from './media.js';
import { renderMarkdown, renderInlineMarkdown, safeUrl } from './markdown.js';
import { str, text, int, mediaId, oneOf } from './validate.js';

export const OWNER_TYPES = ['project', 'research', 'page', 'about'];

/**
 * The block registry is the single source of truth for the content system:
 * the admin editor renders its forms from `fields`, every write goes through
 * `normalize`, and the public views render one partial per type. Adding a new
 * block type means adding an entry here plus a partial — no other changes.
 */
export const BLOCK_TYPES = {
  heading: {
    label: 'Heading',
    hint: 'A section title inside the content.',
    fields: [
      { name: 'text', type: 'text', label: 'Heading text', required: true },
      {
        name: 'level',
        type: 'select',
        label: 'Size',
        options: [
          { value: '2', label: 'Large' },
          { value: '3', label: 'Small' }
        ]
      }
    ],
    normalize: (d) => ({ text: str(d.text, 200), level: oneOf(String(d.level), ['2', '3'], '2') }),
    summary: (d) => d.text
  },

  richtext: {
    label: 'Rich text',
    hint: 'Paragraphs written in Markdown. Supports links, lists, bold and italics.',
    fields: [{ name: 'body', type: 'markdown', label: 'Text', rows: 10, required: true }],
    normalize: (d) => ({ body: text(d.body, 20000) }),
    summary: (d) => String(d.body || '').slice(0, 90)
  },

  image: {
    label: 'Image',
    hint: 'A single image with an optional caption.',
    fields: [
      { name: 'mediaId', type: 'media', label: 'Image', required: true },
      { name: 'caption', type: 'text', label: 'Caption', help: 'Optional. Shown under the image.' },
      {
        name: 'width',
        type: 'select',
        label: 'Width',
        options: [
          { value: 'content', label: 'Content width' },
          { value: 'wide', label: 'Wide' }
        ]
      }
    ],
    normalize: (d) => ({
      mediaId: mediaId(d.mediaId),
      caption: str(d.caption, 300),
      width: oneOf(d.width, ['content', 'wide'], 'content')
    }),
    summary: (d) => d.caption || 'Image'
  },

  gallery: {
    label: 'Image gallery',
    hint: 'A grid of images, for screenshots or figures.',
    fields: [
      { name: 'items', type: 'mediaList', label: 'Images', required: true },
      { name: 'caption', type: 'text', label: 'Caption' },
      {
        name: 'columns',
        type: 'select',
        label: 'Columns',
        options: [
          { value: '2', label: 'Two' },
          { value: '3', label: 'Three' }
        ]
      }
    ],
    normalize: (d) => ({
      items: (Array.isArray(d.items) ? d.items : [])
        .map((value) => mediaId(value))
        .filter(Boolean)
        .slice(0, 24),
      caption: str(d.caption, 300),
      columns: oneOf(String(d.columns), ['2', '3'], '2')
    }),
    summary: (d) => (d.items?.length || 0) + ' image(s)'
  },

  button: {
    label: 'Button / link',
    hint: 'A prominent link, e.g. to a repository or a paper.',
    fields: [
      { name: 'label', type: 'text', label: 'Label', required: true },
      { name: 'url', type: 'url', label: 'URL', required: true },
      {
        name: 'style',
        type: 'select',
        label: 'Style',
        options: [
          { value: 'primary', label: 'Primary' },
          { value: 'secondary', label: 'Secondary' }
        ]
      }
    ],
    normalize: (d) => ({
      label: str(d.label, 80),
      url: safeUrl(d.url),
      style: oneOf(d.style, ['primary', 'secondary'], 'secondary')
    }),
    summary: (d) => d.label
  },

  embed: {
    label: 'Video / embed',
    hint: 'A YouTube or Vimeo link. Other links render as a plain link.',
    fields: [
      { name: 'url', type: 'url', label: 'Video URL', required: true },
      { name: 'title', type: 'text', label: 'Title', help: 'Used as the frame label for screen readers.' }
    ],
    normalize: (d) => ({ url: safeUrl(d.url), title: str(d.title, 160) }),
    summary: (d) => d.title || d.url
  },

  quote: {
    label: 'Quote',
    hint: 'A short pull quote.',
    fields: [
      { name: 'text', type: 'textarea', label: 'Quote', rows: 4, required: true },
      { name: 'attribution', type: 'text', label: 'Attribution' }
    ],
    normalize: (d) => ({ text: text(d.text, 1000), attribution: str(d.attribution, 160) }),
    summary: (d) => String(d.text || '').slice(0, 90)
  },

  divider: {
    label: 'Divider',
    hint: 'A horizontal rule between sections.',
    fields: [],
    normalize: () => ({}),
    summary: () => 'Divider'
  },

  code: {
    label: 'Code block',
    hint: 'A snippet, shown as preformatted text.',
    fields: [
      { name: 'language', type: 'text', label: 'Language', help: 'Optional label, e.g. python.' },
      { name: 'code', type: 'code', label: 'Code', rows: 12, required: true },
      { name: 'caption', type: 'text', label: 'Caption' }
    ],
    normalize: (d) => ({
      language: str(d.language, 24).replace(/[^A-Za-z0-9+#._-]/g, ''),
      code: String(d.code || '').replace(/\r\n/g, '\n').slice(0, 20000),
      caption: str(d.caption, 300)
    }),
    summary: (d) => d.caption || d.language || 'Code'
  },

  projectRef: {
    label: 'Project reference',
    hint: 'A card linking to another project.',
    fields: [{ name: 'projectId', type: 'project', label: 'Project', required: true }],
    normalize: (d) => ({ projectId: int(d.projectId, null) }),
    summary: (d) => 'Project #' + d.projectId
  },

  skillGroup: {
    label: 'Skill group',
    hint: 'Renders one of your skill categories.',
    fields: [{ name: 'categoryId', type: 'skillCategory', label: 'Category', required: true }],
    normalize: (d) => ({ categoryId: int(d.categoryId, null) }),
    summary: (d) => 'Skill category #' + d.categoryId
  }
};

export const BLOCK_TYPE_LIST = Object.entries(BLOCK_TYPES).map(([type, def]) => ({
  type,
  label: def.label,
  hint: def.hint
}));

function parseData(json) {
  try {
    const parsed = JSON.parse(json || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function listBlocks(ownerType, ownerId) {
  return all(
    'SELECT * FROM blocks WHERE owner_type = ? AND owner_id = ? ORDER BY position, id',
    ownerType,
    Number(ownerId)
  )
    .filter((row) => BLOCK_TYPES[row.type])
    .map((row) => ({ id: row.id, type: row.type, position: row.position, data: parseData(row.data) }));
}

export function countBlocks(ownerType, ownerId) {
  return get(
    'SELECT COUNT(*) AS n FROM blocks WHERE owner_type = ? AND owner_id = ?',
    ownerType,
    Number(ownerId)
  ).n;
}

export function addBlock(ownerType, ownerId, type) {
  if (!OWNER_TYPES.includes(ownerType)) throw new Error('Unknown owner type');
  const def = BLOCK_TYPES[type];
  if (!def) throw new Error('Unknown block type');
  const next = get(
    'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM blocks WHERE owner_type = ? AND owner_id = ?',
    ownerType,
    Number(ownerId)
  ).pos;
  const info = run(
    'INSERT INTO blocks (owner_type, owner_id, type, data, position) VALUES (?, ?, ?, ?, ?)',
    ownerType,
    Number(ownerId),
    type,
    JSON.stringify(def.normalize({})),
    next
  );
  return Number(info.lastInsertRowid);
}

export function updateBlock(id, data) {
  const row = get('SELECT * FROM blocks WHERE id = ?', Number(id));
  if (!row) return false;
  const def = BLOCK_TYPES[row.type];
  if (!def) return false;
  run('UPDATE blocks SET data = ? WHERE id = ?', JSON.stringify(def.normalize(data)), row.id);
  return true;
}

export function deleteBlock(id) {
  run('DELETE FROM blocks WHERE id = ?', Number(id));
}

export function deleteBlocksFor(ownerType, ownerId) {
  run('DELETE FROM blocks WHERE owner_type = ? AND owner_id = ?', ownerType, Number(ownerId));
}

/** Swap a block with its neighbour in the given direction. */
export const moveBlock = transaction((id, direction) => {
  const row = get('SELECT * FROM blocks WHERE id = ?', Number(id));
  if (!row) return false;
  const comparator = direction === 'up' ? '<' : '>';
  const order = direction === 'up' ? 'DESC' : 'ASC';
  const neighbour = get(
    `SELECT * FROM blocks
      WHERE owner_type = ? AND owner_id = ? AND (position ${comparator} ? OR (position = ? AND id ${comparator} ?))
      ORDER BY position ${order}, id ${order} LIMIT 1`,
    row.owner_type,
    row.owner_id,
    row.position,
    row.position,
    row.id
  );
  if (!neighbour) return false;
  run('UPDATE blocks SET position = ? WHERE id = ?', neighbour.position, row.id);
  run('UPDATE blocks SET position = ? WHERE id = ?', row.position, neighbour.id);
  if (neighbour.position === row.position) {
    // Positions had collided; renumber the whole list so the swap sticks.
    const rows = all(
      'SELECT id FROM blocks WHERE owner_type = ? AND owner_id = ? ORDER BY position, id',
      row.owner_type,
      row.owner_id
    );
    rows.forEach((item, index) => run('UPDATE blocks SET position = ? WHERE id = ?', index, item.id));
  }
  return true;
});

/** Copy every block from one owner to another (used by "duplicate"). */
export function copyBlocks(fromType, fromId, toType, toId) {
  for (const block of listBlocks(fromType, fromId)) {
    run(
      'INSERT INTO blocks (owner_type, owner_id, type, data, position) VALUES (?, ?, ?, ?, ?)',
      toType,
      Number(toId),
      block.type,
      JSON.stringify(block.data),
      block.position
    );
  }
}

/**
 * Turn raw blocks into render-ready ones: media, referenced projects and skill
 * categories are fetched in batch and markdown is rendered here, so templates
 * stay free of queries and of raw user input.
 */
export function resolveBlocks(blocks) {
  const mediaIds = [];
  const projectIds = [];
  const categoryIds = [];
  for (const block of blocks) {
    if (block.data.mediaId) mediaIds.push(block.data.mediaId);
    if (Array.isArray(block.data.items)) mediaIds.push(...block.data.items);
    if (block.data.projectId) projectIds.push(Number(block.data.projectId));
    if (block.data.categoryId) categoryIds.push(Number(block.data.categoryId));
  }

  const media = mediaByIds(mediaIds);
  const projects = new Map();
  if (projectIds.length) {
    const placeholders = [...new Set(projectIds)].map(() => '?').join(',');
    for (const row of all(
      `SELECT id, slug, title, summary, thumbnail_id, has_detail_page, status
         FROM projects WHERE id IN (${placeholders})`,
      ...new Set(projectIds)
    )) {
      projects.set(row.id, row);
    }
  }
  const categories = new Map();
  if (categoryIds.length) {
    const placeholders = [...new Set(categoryIds)].map(() => '?').join(',');
    for (const row of all(
      `SELECT id, name FROM skill_categories WHERE id IN (${placeholders})`,
      ...new Set(categoryIds)
    )) {
      categories.set(row.id, { ...row, skills: all('SELECT * FROM skills WHERE category_id = ? ORDER BY position, id', row.id) });
    }
  }

  return blocks
    .map((block) => {
      const resolved = { ...block, media: null, items: [], project: null, category: null, html: '' };
      switch (block.type) {
        case 'richtext':
          resolved.html = renderMarkdown(block.data.body);
          break;
        case 'quote':
          resolved.html = renderInlineMarkdown(block.data.text);
          break;
        case 'image':
          resolved.media = media.get(Number(block.data.mediaId)) || null;
          if (!resolved.media) return null;
          break;
        case 'gallery':
          resolved.items = (block.data.items || []).map((id) => media.get(Number(id))).filter(Boolean);
          if (resolved.items.length === 0) return null;
          break;
        case 'button':
          if (!block.data.url || !block.data.label) return null;
          break;
        case 'embed':
          resolved.embed = parseEmbed(block.data.url);
          if (!resolved.embed) return null;
          break;
        case 'projectRef': {
          const project = projects.get(Number(block.data.projectId));
          if (!project || project.status !== 'published') return null;
          resolved.project = { ...project, thumbnail: media.get(project.thumbnail_id) || null };
          if (!resolved.project.thumbnail && project.thumbnail_id) {
            const extra = mediaByIds([project.thumbnail_id]);
            resolved.project.thumbnail = extra.get(project.thumbnail_id) || null;
          }
          break;
        }
        case 'skillGroup':
          resolved.category = categories.get(Number(block.data.categoryId)) || null;
          if (!resolved.category) return null;
          break;
        case 'heading':
          if (!block.data.text) return null;
          break;
        case 'code':
          if (!block.data.code) return null;
          break;
        default:
          break;
      }
      return resolved;
    })
    .filter(Boolean);
}

/** Recognise the two embed providers we allow; everything else is rejected. */
export function parseEmbed(url) {
  const safe = safeUrl(url);
  if (!safe) return null;
  let parsed;
  try {
    parsed = new URL(safe);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).pop();
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return { provider: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/' + id, href: safe };
    }
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1);
    if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return { provider: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/' + id, href: safe };
    }
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = parsed.pathname.split('/').filter(Boolean).pop();
    if (/^\d{5,12}$/.test(id || '')) {
      return { provider: 'Vimeo', src: 'https://player.vimeo.com/video/' + id, href: safe };
    }
  }
  return { provider: 'link', src: null, href: safe };
}
