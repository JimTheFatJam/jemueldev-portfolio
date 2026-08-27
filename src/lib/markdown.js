import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });

const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'a', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub'
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    code: ['class'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    // Content headings start at h2 — h1 belongs to the page itself.
    h1: 'h2',
    a: (tagName, attribs) => {
      const href = safeUrl(attribs.href || '');
      const external = /^https?:\/\//i.test(href);
      return {
        tagName: 'a',
        attribs: {
          href,
          ...(attribs.title ? { title: attribs.title } : {}),
          ...(external ? { rel: 'noopener noreferrer', target: '_blank' } : {})
        }
      };
    }
  }
};

/** Render untrusted markdown to sanitized HTML. */
export function renderMarkdown(text) {
  if (!text) return '';
  return sanitizeHtml(marked.parse(String(text)), SANITIZE_OPTIONS);
}

/** Render markdown without wrapping block elements (for short fields). */
export function renderInlineMarkdown(text) {
  if (!text) return '';
  return sanitizeHtml(marked.parseInline(String(text)), {
    ...SANITIZE_OPTIONS,
    allowedTags: ['strong', 'em', 'code', 'a', 'del', 'br', 'sup', 'sub']
  });
}

/** Strip all markup, e.g. to build a meta description. */
export function toPlainText(text, max = 300) {
  if (!text) return '';
  const stripped = sanitizeHtml(marked.parse(String(text)), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > max ? `${stripped.slice(0, max - 1).trimEnd()}…` : stripped;
}

/**
 * Allow only safe URL shapes. Anything else (javascript:, data:, vbscript:…)
 * collapses to an empty string so templates render no link at all.
 */
export function safeUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) return '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (value.startsWith('#')) return value;
  try {
    const parsed = new URL(value);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return parsed.href;
  } catch {
    /* not an absolute URL */
  }
  return '';
}
