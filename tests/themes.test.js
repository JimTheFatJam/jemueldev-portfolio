/**
 * Theme-system tests: the selector, and the Editorial theme rendering every
 * public route and content type. Runs against its own throwaway database.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'portfolio-themes-'));
process.env.DATA_DIR = join(root, 'data');
process.env.UPLOAD_DIR = join(root, 'uploads');
process.env.SESSION_SECRET = 'test-secret-value-that-is-long-enough-1234567890';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/lib/auth.js');
const { seed } = await import('../src/db/seed.js');

const PASSWORD = 'test-password-1234';
createUser('tester', PASSWORD);
await seed({ quiet: true });

const app = createApp();
let server;
let base;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  app.locals.close?.();
  rmSync(root, { recursive: true, force: true });
});

class Client {
  constructor() {
    this.jar = new Map();
  }

  cookieHeader() {
    return [...this.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  store(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(raw)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async request(path, options = {}) {
    const response = await fetch(base + path, {
      redirect: 'manual',
      ...options,
      headers: { cookie: this.cookieHeader(), ...(options.headers || {}) }
    });
    this.store(response);
    return response;
  }

  async get(path, options) {
    return this.request(path, { method: 'GET', ...options });
  }

  async html(path) {
    const response = await this.get(path);
    return { response, body: await response.text() };
  }

  async token(path) {
    const { body } = await this.html(path);
    const match = body.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(match, `no CSRF token found on ${path}`);
    return match[1];
  }

  async post(path, fields, options = {}) {
    return this.request(path, {
      method: 'POST',
      body: new URLSearchParams(fields).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(options.headers || {}) },
      ...options
    });
  }

  async login(username = 'tester', password = PASSWORD) {
    const _csrf = await this.token('/admin/login');
    return this.post('/admin/login', { _csrf, username, password, next: '/admin' });
  }
}

async function authed() {
  const client = new Client();
  const response = await client.login();
  assert.equal(response.status, 302);
  return client;
}

/** The Sections form posts every appearance field together. */
const SECTION_FIELDS = {
  about: '1',
  projects: '1',
  skills: '1',
  education: '1',
  research: '1',
  contact: '1',
  titleProjects: 'Selected work',
  titleSkills: 'Skills',
  titleEducation: 'Education',
  titleResearch: 'Research',
  titleContact: 'Contact',
  skillIconStyle: 'color'
};

/** Switch the public theme through the real admin form. */
async function setTheme(client, publicTheme) {
  const response = await client.post('/admin/settings/sections', {
    _csrf: await client.token('/admin/settings/sections'),
    ...SECTION_FIELDS,
    publicTheme
  });
  assert.equal(response.status, 302);
}

describe('theme selection', () => {
  test('the admin offers both installed themes', async () => {
    const client = await authed();
    const { body } = await client.html('/admin/settings/sections');
    assert.match(body, /name="publicTheme" value="classic"/);
    assert.match(body, /name="publicTheme" value="editorial"/);
    assert.match(body, /name="publicTheme" value="grid"/);
    assert.match(body, /Public website design/i);
  });

  test('choosing a theme changes the public site and nothing else', async () => {
    const client = await authed();

    await setTheme(client, 'classic');
    let { body } = await new Client().html('/');
    assert.match(body, /\/themes\/classic\/theme\.css/);
    assert.doesNotMatch(body, /\/themes\/editorial\//);

    await setTheme(client, 'editorial');
    ({ body } = await new Client().html('/'));
    assert.match(body, /\/themes\/editorial\/theme\.css/);
    assert.doesNotMatch(body, /\/themes\/classic\//);

    // The admin keeps its own stylesheet regardless of the public theme.
    const { body: adminBody } = await client.html('/admin/settings/sections');
    assert.match(adminBody, /\/css\/admin\.css/);
    assert.doesNotMatch(adminBody, /\/themes\/editorial\/theme\.css/);

    await setTheme(client, 'classic');
  });

  test('an unknown theme value falls back to the default', async () => {
    const client = await authed();
    await client.post('/admin/settings/sections', {
      _csrf: await client.token('/admin/settings/sections'),
      ...SECTION_FIELDS,
      publicTheme: '../../etc/passwd'
    });

    const { response, body } = await new Client().html('/');
    assert.equal(response.status, 200);
    assert.match(body, /\/themes\/classic\/theme\.css/);
  });

  test('switching themes does not touch content', async () => {
    const client = await authed();
    const counts = async () => {
      const { body } = await client.html('/admin');
      return body.match(/<span class="stat-value">(\d+)<\/span>/g).join(',');
    };

    await setTheme(client, 'classic');
    const before = await counts();
    await setTheme(client, 'editorial');
    const after = await counts();
    assert.equal(before, after);

    await setTheme(client, 'classic');
  });
});

describe('editorial theme', () => {
  before(async () => {
    const client = await authed();
    await setTheme(client, 'editorial');
  });

  after(async () => {
    const client = await authed();
    await setTheme(client, 'classic');
  });

  test('every public route renders', async () => {
    const client = new Client();
    for (const path of [
      '/',
      '/projects',
      '/research',
      '/projects/example-pm25-prediction',
      '/research/example-thesis'
    ]) {
      const response = await client.get(path);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });

  test('sitemap and robots stay theme-independent', async () => {
    const client = new Client();
    const sitemap = await client.get('/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.match(await sitemap.text(), /<urlset/);

    const robots = await client.get('/robots.txt');
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /Disallow: \/admin/);
  });

  test('the homepage carries its own structure, not the classic one', async () => {
    const { body } = await new Client().html('/');
    assert.match(body, /ed-hero-name/);
    assert.match(body, /ed-project/);
    assert.match(body, /ed-rail/);
    assert.doesNotMatch(body, /class="site-header"/);
    assert.doesNotMatch(body, /class="project-card"/);
  });

  test('SEO tags survive the theme swap', async () => {
    const { body } = await new Client().html('/projects/example-pm25-prediction');
    assert.match(body, /<title>Example: PM2\.5 prediction pipeline —/);
    assert.match(body, /<meta name="description"/);
    assert.match(body, /<meta property="og:title"/);
    assert.match(body, /<meta name="twitter:card"/);
    assert.match(body, /rel="icon"/);
  });

  test('content blocks render and stay escaped', async () => {
    const { body } = await new Client().html('/projects/example-pm25-prediction');
    assert.match(body, /class="blocks"/);
    assert.match(body, /class="block-heading"/);
    assert.match(body, /class="block-code"/);
    assert.match(body, /class="block-image/);
    assert.match(body, /class="block-project-ref"/);
    assert.doesNotMatch(body, /<script>alert/);
  });

  test('images keep their responsive attributes', async () => {
    const { body } = await new Client().html('/');
    const img = body.match(/<img[^>]*ed-project-img[^>]*>/);
    assert.ok(img, 'project image not found');
    assert.match(img[0], /srcset="/);
    assert.match(img[0], /sizes="/);
    assert.match(img[0], /loading="lazy"/);
    assert.match(img[0], /alt="/);
  });

  test('Devicon skill logos render inline', async () => {
    const { body } = await new Client().html('/');
    const section = body.match(/<section class="ed-section" id="skills">[\s\S]*?<\/section>/);
    assert.ok(section, 'skills section not found');
    assert.match(section[0], /<svg[^>]*class="icon-svg"/);
    assert.match(section[0], /ed-skill-name/);
  });

  test('galleries render on detail pages', async () => {
    const { body } = await new Client().html('/projects/example-pm25-prediction');
    assert.match(body, /class="gallery-grid"/);
    assert.match(body, /class="gallery-img"/);
  });

  test('drafts stay hidden from visitors and flagged for admins', async () => {
    assert.equal((await new Client().get('/projects/example-draft-project')).status, 404);

    const client = await authed();
    const { response, body } = await client.html('/projects/example-draft-project');
    assert.equal(response.status, 200);
    assert.match(body, /ed-draft/);
    assert.match(body, /Draft preview/);
  });

  test('custom pages render through the theme', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/pages/new');
    const created = await client.post('/admin/pages', {
      _csrf,
      title: 'Theme Notes',
      status: 'published',
      show_in_nav: '1'
    });
    const id = created.headers.get('location').split('/').pop();

    _csrf = await client.token(`/admin/pages/${id}`);
    const added = await client.post(`/admin/blocks/page/${id}/add`, { _csrf, type: 'richtext' });
    const blockId = Number(added.headers.get('location').split('#block-').pop());
    await client.post(`/admin/blocks/${blockId}`, { _csrf, body: 'Rendered by **editorial**.' });

    const { response, body } = await new Client().html('/theme-notes');
    assert.equal(response.status, 200);
    assert.match(body, /ed-detail-title/);
    assert.match(body, /<strong>editorial<\/strong>/);
    assert.match(body, /href="\/theme-notes"/);

    await client.post(`/admin/pages/${id}/delete`, { _csrf: await client.token('/admin/pages') });
  });

  test('the 404 page uses the theme', async () => {
    const { response, body } = await new Client().html('/definitely-not-here');
    assert.equal(response.status, 404);
    assert.match(body, /ed-message/);
    assert.match(body, /\/themes\/editorial\/theme\.css/);
  });

  test('no inline styles, so the strict CSP still holds', async () => {
    const client = new Client();
    for (const path of ['/', '/projects/example-pm25-prediction', '/research/example-thesis']) {
      const { body } = await client.html(path);
      const markup = body.replace(/<svg[\s\S]*?<\/svg>/g, '');
      assert.doesNotMatch(markup, /\sstyle="/, `${path} contains an inline style`);
      assert.doesNotMatch(markup, /<style/, `${path} contains a style element`);
    }
  });

  test('reveal animations are opt-in and reduced-motion aware', async () => {
    const client = new Client();
    const css = await (await client.get('/themes/editorial/theme.css')).text();
    assert.match(css, /\.ed-js \[data-reveal\]/);
    assert.match(css, /prefers-reduced-motion: reduce/);

    const js = await (await client.get('/themes/editorial/theme.js')).text();
    assert.match(js, /ed-js/);
    assert.match(js, /prefers-reduced-motion/);
  });

  test('theme templates are never served as static files', async () => {
    const client = new Client();
    for (const path of [
      '/themes/editorial/views/home.ejs',
      '/themes/classic/views/home.ejs',
      '/themes/editorial/../index.js'
    ]) {
      const response = await client.get(path);
      assert.notEqual(response.status, 200, `${path} was served`);
    }
  });

  test('the classic theme is untouched by any of this', async () => {
    const client = await authed();
    await setTheme(client, 'classic');

    const { body } = await new Client().html('/');
    assert.match(body, /class="site-header"/);
    assert.match(body, /class="project-card"/);
    assert.match(body, /\/themes\/classic\/theme\.css/);
    assert.doesNotMatch(body, /ed-hero-name/);

    await setTheme(client, 'editorial');
  });
});

describe('layout containment', () => {
  test('editorial wide blocks are contained, not negatively offset', async () => {
    const css = await (await new Client().get('/themes/editorial/theme.css')).text();
    // The original bug: a negative margin pushed wide blocks under the rail
    // and past the page margin. Wide blocks must fill the column instead.
    assert.doesNotMatch(css, /\.is-wide\s*\{[^}]*margin-inline:\s*-/);
    assert.match(css, /\.blocks\s*>\s*\.is-wide/);
  });

  test('both themes let long words and URLs wrap', async () => {
    const client = new Client();
    for (const theme of ['classic', 'editorial']) {
      const css = await (await client.get(`/themes/${theme}/theme.css`)).text();
      assert.match(css, /overflow-wrap:\s*anywhere/, `${theme} lacks wrapping rules`);
      assert.match(css, /min-width:\s*0/, `${theme} lacks flex/grid shrink rules`);
    }
  });

  test('both themes keep preformatted content in its own scroller', async () => {
    const client = new Client();
    for (const theme of ['classic', 'editorial']) {
      const css = await (await client.get(`/themes/${theme}/theme.css`)).text();
      assert.match(css, /overflow-x:\s*auto/, `${theme} lacks a code scroller`);
    }
  });
});

describe('grid theme', () => {
  before(async () => {
    const client = await authed();
    await setTheme(client, 'grid');
  });

  after(async () => {
    const client = await authed();
    await setTheme(client, 'classic');
  });

  test('every public route renders', async () => {
    const client = new Client();
    for (const path of [
      '/',
      '/projects',
      '/research',
      '/projects/example-pm25-prediction',
      '/research/example-thesis'
    ]) {
      const response = await client.get(path);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });

  test('it renders its own structure, not another theme', async () => {
    const { body } = await new Client().html('/');
    assert.match(body, /\/themes\/grid\/theme\.css/);
    assert.match(body, /gd-display/);
    assert.match(body, /gd-bento/);
    assert.match(body, /gd-panel/);
    assert.doesNotMatch(body, /class="site-header"/);
    assert.doesNotMatch(body, /ed-hero-name/);
  });

  test('the featured project gets its own panel', async () => {
    const { body } = await new Client().html('/');
    assert.match(body, /gd-featured/);
    assert.match(body, /Featured/);
  });

  test('SEO tags survive the theme swap', async () => {
    const { body } = await new Client().html('/projects/example-pm25-prediction');
    assert.match(body, /<title>Example: PM2\.5 prediction pipeline —/);
    assert.match(body, /<meta name="description"/);
    assert.match(body, /<meta property="og:title"/);
    assert.match(body, /rel="icon"/);
  });

  test('content blocks render and stay escaped', async () => {
    const { body } = await new Client().html('/projects/example-pm25-prediction');
    assert.match(body, /class="blocks"/);
    assert.match(body, /class="block-heading"/);
    assert.match(body, /class="block-code"/);
    assert.match(body, /class="block-image/);
    assert.match(body, /class="block-project-ref"/);
    assert.doesNotMatch(body, /<script>alert/);
  });

  test('Devicon skill logos render inline', async () => {
    const { body } = await new Client().html('/');
    const section = body.match(/<section class="gd-section" id="skills">[\s\S]*?<\/section>/);
    assert.ok(section, 'toolkit section not found');
    assert.match(section[0], /<svg[^>]*class="icon-svg"/);
    assert.match(section[0], /gd-tool-name/);
  });

  test('drafts stay hidden from visitors and flagged for admins', async () => {
    assert.equal((await new Client().get('/projects/example-draft-project')).status, 404);

    const client = await authed();
    const { response, body } = await client.html('/projects/example-draft-project');
    assert.equal(response.status, 200);
    assert.match(body, /gd-draft/);
  });

  test('custom pages render through the theme', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/pages/new');
    const created = await client.post('/admin/pages', {
      _csrf,
      title: 'Grid Notes',
      status: 'published',
      show_in_nav: '1'
    });
    const id = created.headers.get('location').split('/').pop();

    _csrf = await client.token(`/admin/pages/${id}`);
    const added = await client.post(`/admin/blocks/page/${id}/add`, { _csrf, type: 'richtext' });
    const blockId = Number(added.headers.get('location').split('#block-').pop());
    await client.post(`/admin/blocks/${blockId}`, { _csrf, body: 'Rendered by **grid**.' });

    const { response, body } = await new Client().html('/grid-notes');
    assert.equal(response.status, 200);
    assert.match(body, /gd-detail-title/);
    assert.match(body, /<strong>grid<\/strong>/);

    await client.post(`/admin/pages/${id}/delete`, { _csrf: await client.token('/admin/pages') });
  });

  test('the 404 page uses the theme', async () => {
    const { response, body } = await new Client().html('/definitely-not-here');
    assert.equal(response.status, 404);
    assert.match(body, /gd-message/);
    assert.match(body, /\/themes\/grid\/theme\.css/);
  });

  test('no inline styles, so the strict CSP still holds', async () => {
    const client = new Client();
    for (const path of ['/', '/projects/example-pm25-prediction', '/research/example-thesis']) {
      const { body } = await client.html(path);
      const markup = body.replace(/<svg[\s\S]*?<\/svg>/g, '');
      assert.doesNotMatch(markup, /\sstyle="/, `${path} contains an inline style`);
      assert.doesNotMatch(markup, /<style/, `${path} contains a style element`);
    }
  });

  test('layout containment rules are in place', async () => {
    const css = await (await new Client().get('/themes/grid/theme.css')).text();
    // Wide blocks fill the column rather than breaking out of it.
    assert.doesNotMatch(css, /\.is-wide\s*\{[^}]*margin-inline:\s*-/);
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.match(css, /min-width:\s*0/);
    assert.match(css, /overflow-x:\s*auto/);
    assert.match(css, /prefers-reduced-motion: reduce/);
  });

  test('reveals are opt-in and cannot strand content', async () => {
    const client = new Client();
    const css = await (await client.get('/themes/grid/theme.css')).text();
    assert.match(css, /\.gd-js \[data-reveal\]/);
    const js = await (await client.get('/themes/grid/theme.js')).text();
    assert.match(js, /gd-js/);
    assert.match(js, /prefers-reduced-motion/);
  });

  test('the other two themes are untouched by this one', async () => {
    const client = await authed();

    await setTheme(client, 'classic');
    let { body } = await new Client().html('/');
    assert.match(body, /class="site-header"/);
    assert.doesNotMatch(body, /gd-display/);

    await setTheme(client, 'editorial');
    ({ body } = await new Client().html('/'));
    assert.match(body, /ed-hero-name/);
    assert.doesNotMatch(body, /gd-display/);

    await setTheme(client, 'grid');
  });
});

describe('research keywords', () => {
  after(async () => {
    const client = await authed();
    await setTheme(client, 'classic');
  });

  test('keywords save, survive an edit, and dedupe', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/research/1');
    const { body: form } = await client.html('/admin/research/1');
    const existing = form.match(/name="keywords" value="([^"]*)"/);
    assert.ok(existing, 'keywords field missing from the research form');

    const save = await client.post('/admin/research/1', {
      _csrf,
      title: 'Example: undergraduate thesis',
      slug: 'example-thesis',
      abstract: 'Placeholder abstract stays put.',
      status: 'published',
      has_detail_page: '1',
      keywords: JSON.stringify(['PM2.5', 'Air Quality', 'PM2.5', '  ', 'Transfer Learning'])
    });
    assert.equal(save.status, 302);

    const { body: reread } = await client.html('/admin/research/1');
    const saved = JSON.parse(reread.match(/name="keywords" value="([^"]*)"/)[1].replace(/&#34;/g, '"'));
    assert.deepEqual(saved, ['PM2.5', 'Air Quality', 'Transfer Learning']);
  });

  test('every theme shows the keywords without disturbing the abstract', async () => {
    const client = await authed();
    for (const theme of ['classic', 'editorial', 'grid']) {
      await setTheme(client, theme);
      const { response, body } = await new Client().html('/research/example-thesis');
      assert.equal(response.status, 200, theme);
      assert.match(body, /Keywords/, `${theme} has no keywords heading`);
      assert.match(body, /PM2\.5/, `${theme} does not show a keyword`);
      assert.match(body, /Transfer Learning/, theme);
      assert.match(body, /Placeholder abstract stays put/, `${theme} lost the abstract`);
    }
  });

  test('a research entry with no keywords renders nothing extra', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/research/1');
    await client.post('/admin/research/1', {
      _csrf,
      title: 'Example: undergraduate thesis',
      slug: 'example-thesis',
      abstract: 'Placeholder abstract stays put.',
      status: 'published',
      has_detail_page: '1',
      keywords: '[]'
    });

    const { body } = await new Client().html('/research/example-thesis');
    assert.doesNotMatch(body, /ed-keywords|gd-keywords|detail-keywords/);
    assert.match(body, /Placeholder abstract stays put/);
  });

  test('technology logos sit apart from their labels in designs 2 and 3', async () => {
    const client = new Client();
    // The conditional class must be emitted raw, not HTML-escaped.
    for (const theme of ['editorial', 'grid']) {
      const css = await (await client.get(`/themes/${theme}/theme.css`)).text();
      assert.match(css, /li\.has-icon \{[^}]*gap: 0\.55rem/, `${theme} gap not increased`);
    }
    const admin = await authed();
    await setTheme(admin, 'editorial');
    const { body } = await new Client().html('/projects/example-pm25-prediction');
    assert.match(body, /<li class="has-icon">/);
    assert.doesNotMatch(body, /&#34;has-icon&#34;/);
  });
});

describe('grid typography', () => {
  before(async () => {
    const client = await authed();
    await setTheme(client, 'grid');
  });

  after(async () => {
    const client = await authed();
    await setTheme(client, 'classic');
  });

  test('section numbers can never be broken across lines', async () => {
    const css = await (await new Client().get('/themes/grid/theme.css')).text();
    // The `05` beside a long category name used to split into `0` and `5`.
    const rule = css.match(/\.gd \.gd-label-num,[\s\S]*?\}/);
    assert.ok(rule, 'number-label containment rule missing');
    assert.match(rule[0], /white-space: nowrap/);
    assert.match(rule[0], /overflow-wrap: normal/);
    assert.match(rule[0], /gd-toolkit-num/);
    assert.match(rule[0], /flex: none/);
  });

  test('display headings use the display stack at an editorial weight', async () => {
    const css = await (await new Client().get('/themes/grid/theme.css')).text();
    assert.match(css, /--gd-display:/);

    for (const selector of ['gd-display', 'gd-page-title', 'gd-detail-title', 'gd-contact-heading']) {
      const rule = css.match(new RegExp('\.' + selector + ' \{[^}]*\}'));
      assert.ok(rule, `${selector} rule missing`);
      assert.match(rule[0], /font-family: var\(--gd-display\)/, `${selector} not on the display stack`);
      // The heavy 800 weight was what read as advertising type.
      assert.doesNotMatch(rule[0], /font-weight: (700|800|900)/, `${selector} is still heavy`);
    }
  });

  test('small UI text is larger but still below body size', async () => {
    const css = await (await new Client().get('/themes/grid/theme.css')).text();

    // The old 10px tier is gone; everything moved up one step.
    assert.doesNotMatch(css, /font-size: 0\.625rem/);
    assert.match(css, /font-size: 0\.75rem/);

    // The small-UI tiers are 0.6875 / 0.75 / 0.8125rem. Anything at 0.875rem or
    // above is secondary body copy (a byline, a card description) and is not
    // part of this change.
    const sizes = [...css.matchAll(/font-size: (\d*\.?\d+)rem;/g)].map((m) => parseFloat(m[1]));
    assert.ok(sizes.length > 20, 'expected many sized rules');

    const smallUi = sizes.filter((size) => size <= 0.8125);
    assert.ok(smallUi.length > 15, 'small UI tiers missing');
    assert.equal(Math.min(...smallUi), 0.6875, 'smallest tier should now be 0.6875rem');
    assert.equal(Math.max(...smallUi), 0.8125, 'largest small tier should be 0.8125rem');
    // Still clearly below body text at 1rem and card summaries at 0.9375rem.
    assert.ok(0.8125 < 0.9375);
  });

  test('the other two themes keep their own typography', async () => {
    const client = new Client();
    for (const theme of ['classic', 'editorial']) {
      const css = await (await client.get(`/themes/${theme}/theme.css`)).text();
      assert.doesNotMatch(css, /--gd-display/, `${theme} picked up a grid token`);
      assert.doesNotMatch(css, /Segoe UI Variable Display/, `${theme} picked up the grid display face`);
    }
  });
});

describe('grid animations', () => {
  test('the hero reveal is scoped to the homepage and cannot strand the text', async () => {
    const client = new Client();
    const js = await (await client.get('/themes/grid/theme.js')).text();

    // Only the homepage heading is selected, so detail pages never type.
    assert.match(js, /\.gd-home \.gd-display/);
    // The starting opacity is removed again on a timer, so a stalled or
    // suppressed animation can never leave the name invisible.
    assert.match(js, /classList\.remove\('gd-typing'\)/);
    assert.match(js, /reduced\.matches/);

    const css = await (await client.get('/themes/grid/theme.css')).text();
    assert.match(css, /\.gd-typing \.gd-char/);
    assert.match(css, /@keyframes gd-char-in/);
    assert.match(css, /gd-caret-blink/);
  });

  test('the grid entrance is homepage-only and needs no JavaScript', async () => {
    const css = await (await new Client().get('/themes/grid/theme.css')).text();
    assert.match(css, /body\.gd-home::before \{[^}]*animation: gd-grid-in[^}]*both/);
    assert.match(css, /@keyframes gd-grid-in/);
    // Behind everything, inert to the pointer, and out of the scroll box.
    const base = css.match(/body\.gd::before \{[^}]*\}/)[0];
    assert.match(base, /position: fixed/);
    assert.match(base, /z-index: -1/);
    assert.match(base, /pointer-events: none/);
  });

  test('the pointer nudge is capped, mouse-only and self-resetting', async () => {
    const js = await (await new Client().get('/themes/grid/theme.js')).text();
    assert.match(js, /pointerType !== 'mouse'/);
    assert.match(js, /hover: hover\) and \(pointer: fine/);
    assert.match(js, /var limit = 3;/);
    assert.match(js, /releaseMagnet/);
    // Throttled to one write per frame rather than one per event.
    assert.match(js, /requestAnimationFrame\(applyMagnet\)/);
  });

  test('reduced motion switches all three effects off', async () => {
    const css = await (await new Client().get('/themes/grid/theme.css')).text();
    const blocks = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) || [];
    const combined = blocks.join('\n');
    assert.ok(blocks.length > 0, 'no reduced-motion block');
    assert.match(combined, /body\.gd-home::before \{ animation: none/);
    assert.match(combined, /\.gd-typing \.gd-char \{ opacity: 1; animation: none/);
    assert.match(combined, /\.gd-display-caret\.is-blinking \{ animation: none/);
    assert.match(combined, /\.gd-btn \{ transform: none !important/);
  });

  test('none of it leaks into the other two themes', async () => {
    const client = new Client();
    for (const theme of ['classic', 'editorial']) {
      const css = await (await client.get(`/themes/${theme}/theme.css`)).text();
      assert.doesNotMatch(css, /gd-grid-in|gd-char-in|gd-caret-blink/, `${theme} picked up a grid animation`);
      const js = await (await client.get(`/themes/${theme}/theme.js`)).text();
      assert.doesNotMatch(js, /gd-typing|releaseMagnet/, `${theme} picked up grid behaviour`);
    }
  });
});

describe('orbit theme', () => {
  before(async () => {
    const client = await authed();
    await setTheme(client, 'orbit');
  });

  after(async () => {
    const client = await authed();
    await setTheme(client, 'classic');
  });

  test('it is offered in the admin alongside the others', async () => {
    const client = await authed();
    const { body } = await client.html('/admin/settings/sections');
    for (const theme of ['classic', 'editorial', 'grid', 'orbit']) {
      assert.match(body, new RegExp('name="publicTheme" value="' + theme + '"'), theme);
    }
  });

  test('every public route renders', async () => {
    const client = new Client();
    for (const path of [
      '/',
      '/projects',
      '/research',
      '/projects/example-pm25-prediction',
      '/research/example-thesis'
    ]) {
      const response = await client.get(path);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });

  test('the orbital map is real navigation, not decoration', async () => {
    const { body } = await new Client().html('/');
    assert.match(body, /class="ob-launch"/);
    assert.match(body, /ob-sun/);
    assert.match(body, /data-camera/);
    assert.match(body, /ob-billboard/);

    // The sun is home: a real link back to the homepage, carrying no lettering
    // of its own. "Home" is there for the mobile list and the accessible name.
    assert.match(body, /<a class="ob-sun" href="\/" aria-label="Home">/);
    assert.doesNotMatch(body, /You are here/i);
    assert.doesNotMatch(body, /ob-sun-note|ob-sun-initials|ob-sun-label/);

    // One planet per main section, numbered and coded in order.
    for (const [slot, code] of [[1,'ABT'],[2,'WRK'],[3,'TLK'],[4,'RSH'],[5,'EDU'],[6,'CTC']]) {
      assert.match(body, new RegExp(`0${slot} / ${code}`), `slot ${slot} (${code})`);
    }
    assert.equal((body.match(/class="ob-planet"/g) || []).length, 6, 'expected six planets');

    // Every body is an anchor with a genuine destination, so the map works
    // with no JavaScript and by keyboard alone.
    const bodies = [...body.matchAll(/<a class="ob-body[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(bodies.length >= 4, 'expected several destinations');
    assert.ok(bodies.includes('/projects'), 'no Work destination');
    assert.ok(bodies.includes('/research'), 'no Research destination');
    assert.ok(bodies.includes('#about'), 'no About destination');
    assert.ok(bodies.includes('#contact'), 'no Contact destination');
    for (const href of bodies) assert.doesNotMatch(href, /^javascript:/i);
  });

  test('the map is homepage-only and the ordinary nav is always present', async () => {
    const client = new Client();
    const { body: home } = await client.html('/');
    assert.match(home, /class="ob-nav"/);

    for (const path of ['/projects', '/research', '/projects/example-pm25-prediction']) {
      const { body } = await client.html(path);
      assert.doesNotMatch(body, /ob-launch/, `${path} should not carry the map`);
      assert.match(body, /class="ob-nav"/, `${path} lost its navigation`);
    }
  });

  test('the portfolio content follows the map on the homepage', async () => {
    const { body } = await new Client().html('/');
    assert.match(body, /id="ob-content"/);
    assert.match(body, /id="projects"/);
    assert.match(body, /id="skills"/);
    assert.match(body, /id="contact"/);
    assert.match(body, /ob-featured/);
  });

  test('CMS content blocks and Devicon logos render', async () => {
    const { body } = await new Client().html('/projects/example-pm25-prediction');
    assert.match(body, /class="blocks"/);
    assert.match(body, /class="block-heading"/);
    assert.match(body, /class="block-code"/);
    assert.match(body, /class="block-image/);
    assert.match(body, /<svg[^>]*class="icon-svg"/);
    assert.doesNotMatch(body, /<script>alert/);
  });

  test('SEO, sitemap and robots are unaffected by the theme', async () => {
    const client = new Client();
    const { body } = await client.html('/projects/example-pm25-prediction');
    assert.match(body, /<title>Example: PM2\.5 prediction pipeline —/);
    assert.match(body, /<meta property="og:title"/);

    assert.match(await (await client.get('/sitemap.xml')).text(), /<urlset/);
    assert.match(await (await client.get('/robots.txt')).text(), /Disallow: \/admin/);
  });

  test('drafts stay private and are flagged for the admin', async () => {
    assert.equal((await new Client().get('/projects/example-draft-project')).status, 404);
    const client = await authed();
    const { body } = await client.html('/projects/example-draft-project');
    assert.match(body, /ob-draft/);
  });

  test('no inline styles, so the strict CSP still holds', async () => {
    const client = new Client();
    for (const path of ['/', '/projects/example-pm25-prediction', '/research/example-thesis']) {
      const { body } = await client.html(path);
      const markup = body.replace(/<svg[\s\S]*?<\/svg>/g, '');
      assert.doesNotMatch(markup, /\sstyle="/, `${path} contains an inline style`);
      assert.doesNotMatch(markup, /<style/, `${path} contains a style element`);
    }
  });

  test('layout containment and reduced motion are in place', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();
    assert.doesNotMatch(css, /\.is-wide \{[^}]*margin-inline: -/);
    assert.match(css, /overflow-wrap: anywhere/);
    assert.match(css, /min-width: 0/);
    assert.match(css, /overflow-x: auto/);

    const reduced = (css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) || []).join('\n');
    assert.ok(reduced, 'no reduced-motion block');
    assert.match(reduced, /\.ob-arm, \.ob-billboard \{ animation: none/);
    assert.match(reduced, /\.ob-typing \.ob-char \{ opacity: 1; animation: none/);
    assert.match(reduced, /\.ob-launch-caret\.is-blinking \{ animation: none/);
  });

  test('reveals cannot strand the portfolio below the map', async () => {
    const js = await (await new Client().get('/themes/orbit/theme.js')).text();
    assert.match(js, /setTimeout\(revealAll, 10000\)/);
    assert.match(js, /pointerType !== 'mouse'/);
    assert.match(js, /releaseCamera/);
  });


  test('the hero carries the profile and the published counts', async () => {
    const { body } = await new Client().html('/');
    assert.match(body, /class="ob-launch-profile"/);
    assert.match(body, /class="ob-index"/);
    assert.match(body, /<dt>Projects<\/dt><dd>\d\d<\/dd>/);
    assert.match(body, /<dt>Technologies<\/dt><dd>\d\d<\/dd>/);

    // The typing reveal needs per-line spans and the caret; it must exist on
    // the homepage only, never on a project or research page.
    assert.match(body, /class="ob-launch-line"/);
    assert.match(body, /class="ob-launch-caret"/);
    for (const path of ['/projects/example-pm25-prediction', '/research/example-thesis']) {
      const page = await new Client().html(path);
      assert.doesNotMatch(page.body, /ob-launch-caret/, `${path} carries the hero reveal`);
    }
  });

  test('the six bodies are the six planets, textured and sized in order', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();
    const order = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'];
    const sizes = [];

    for (let slot = 1; slot <= 6; slot += 1) {
      const rule = css.match(
        new RegExp(`\\.ob-body--${slot} \\.ob-planet \\{ width: ([\\d.]+)rem; height: ([\\d.]+)rem; --ob-planet-fill: url\\("planet-([a-z]+)\\.webp"\\); \\}`)
      );
      assert.ok(rule, `slot ${slot} is not a textured planet`);
      assert.equal(rule[3], order[slot - 1], `slot ${slot} is the wrong planet`);
      assert.equal(rule[1], rule[2], `slot ${slot} is not round`);
      sizes.push(Number(rule[1]));
    }

    // Every map is served, and small enough not to hold the map up.
    let total = 0;
    for (const name of order) {
      const response = await new Client().get(`/themes/orbit/planet-${name}.webp`);
      assert.equal(response.status, 200, `${name} texture is missing`);
      assert.equal(response.headers.get('content-type'), 'image/webp');
      const bytes = (await response.arrayBuffer()).byteLength;
      assert.ok(bytes < 40 * 1024, `${name} is ${Math.round(bytes / 1024)}KB — too heavy for a 20px body`);
      total += bytes;
    }
    assert.ok(total < 120 * 1024, `${Math.round(total / 1024)}KB of textures is more than this needs`);

    // The disc has to be sized to the element, not left at the file's own 256px.
    assert.match(css, /\.ob-planet \{[\s\S]*?background-size: cover;/);

    // Sizes loosely follow the real bodies: Mercury smallest, Venus and Earth a
    // matched pair above it, Mars between, the gas giants clearly largest with
    // Saturn just under Jupiter — and the whole set still in the former range.
    const [mercury, venus, earth, mars, jupiter, saturn] = sizes;
    assert.equal(mercury, Math.min(...sizes), 'Mercury should be the smallest');
    assert.ok(Math.abs(venus - earth) < 0.05, 'Venus and Earth should be a pair');
    assert.ok(venus > mercury && mars > mercury, 'Mercury should sit below the other rocky bodies');
    assert.ok(mars < venus && mars < earth, 'Mars should be under Venus and Earth');
    assert.equal(jupiter, Math.max(...sizes), 'Jupiter should be the largest');
    assert.ok(jupiter / earth > 1.5, 'Jupiter should be significantly larger');
    assert.ok(saturn < jupiter && saturn / jupiter > 0.9, 'Saturn should be just under Jupiter');
    assert.ok(Math.min(...sizes) >= 0.95 && Math.max(...sizes) <= 2, 'the set has left its former range');

    // Orbits are explicitly not part of this: the progression must be untouched.
    assert.match(css, /--ob-orbit-base: 0\.36;/);
    assert.match(css, /--ob-orbit-step: 0\.132;/);

    // CC BY 4.0 wants the credit kept with the work.
    assert.match(css, /Solar System Scope[\s\S]{0,60}CC BY 4\.0/);
  });

  test("Saturn's rings are decoration and never widen the target", async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    const rings = await new Client().get('/themes/orbit/saturn-rings.webp');
    assert.equal(rings.status, 200, 'the ring map is missing');
    assert.equal(rings.headers.get('content-type'), 'image/webp');
    assert.ok((await rings.arrayBuffer()).byteLength < 60 * 1024, 'the ring map is too heavy');

    // They hang off the orb, which takes no pointer events — that is the whole
    // reason the hit area can stay the disc while the rings reach past it.
    assert.match(css, /\.ob-body--6 \.ob-orb::before,\s*\n\.ob-body--6 \.ob-orb::after \{[\s\S]*?pointer-events: none;/);
    assert.match(css, /\.ob-orb \{ pointer-events: none; \}|\.ob-orb \{ pointer-events: none/);

    // Two halves, so the far side goes behind the planet and the near side
    // crosses it. One layer alone reads as a sticker.
    assert.match(css, /\.ob-body--6 \.ob-orb::before \{ z-index: -1; clip-path: inset\(0 0 50% 0\); \}/);
    assert.match(css, /\.ob-body--6 \.ob-orb::after \{ z-index: 1; clip-path: inset\(50% 0 0 0\); \}/);
    // The ring plane is Saturn's equatorial plane. The disc is projected with
    // the pole straight up, so its bands land as horizontal chords — which
    // means the rings must be flattened and NOT rotated, or the two planes
    // disagree and the near half crosses the planet on a slant.
    const ringRule = css.match(
      /\.ob-body--6 \.ob-orb::before,\s*\n\.ob-body--6 \.ob-orb::after \{([\s\S]*?)\n\}/
    );
    assert.ok(ringRule, 'no ring rule found');
    assert.match(ringRule[1], /transform: scaleY\(0\.34\);/);
    assert.doesNotMatch(ringRule[1], /rotate\s*\(/, 'a tipped ring plane no longer matches the bands');

    // The ring span is derived from Saturn's own size, and that value has to
    // stay in step with the width the disc is actually drawn at.
    const saturn = css.match(/\.ob-body--6 \{ --ob-saturn: ([\d.]+)rem; \}/);
    const disc = css.match(/\.ob-body--6 \.ob-planet \{ width: ([\d.]+)rem;/);
    assert.ok(saturn && disc, 'Saturn has no size to build the rings from');
    assert.equal(saturn[1], disc[1], 'the ring span has drifted from the disc');
    assert.match(css, /width: calc\(var\(--ob-saturn\) \* 2\.3\);/);

    // The hit area itself must not have been touched.
    assert.match(css, /\.ob-planet,\s*\n\.ob-body-tag,\s*\n\.ob-sun \{ pointer-events: auto; \}/);
  });

  test('the flat list keeps its text clear of Saturn without moving a planet', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();
    const mobile = css.match(/@media \(max-width: 48rem\) \{([\s\S]*?)\n\}\n\n\/\* ---/);
    assert.ok(mobile, 'no flat-list block found');
    const block = mobile[1];

    // One value, shared by the sun row and the planet rows, so the whole list
    // shifts together and stays true to a single column.
    const gap = block.match(/--ob-list-gap: clamp\(([\d.]+)rem,[^)]*\);/);
    assert.ok(gap, 'the list gap is not declared');
    assert.match(block, /\.ob-body \{[\s\S]*?column-gap: var\(--ob-list-gap\);/);
    assert.match(block, /gap: var\(--ob-list-gap\);\n\s*text-align: left;/);

    // It has to actually clear the rings. The disc column is 2rem with the
    // planet centred in it, and the rings reach 1.15x Saturn's width from that
    // centre — so the gap must exceed what sticks out past the column.
    const saturn = Number(css.match(/--ob-saturn: ([\d.]+)rem/)[1]);
    const column = 2;
    const overhang = (column / 2 + saturn * 1.15) - column;
    assert.ok(
      Number(gap[1]) > overhang,
      `a gap of ${gap[1]}rem does not clear ${overhang.toFixed(3)}rem of ring`
    );

    // The planets themselves must not have been touched to achieve it.
    assert.match(block, /grid-template-columns: 2rem minmax\(0, 1fr\);/);
    assert.match(block, /\.ob-orb \{ height: auto; justify-self: center;/);
  });

  test('the sun wears the same pack, and still behaves like the sun', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    const sun = await new Client().get('/themes/orbit/sun.webp');
    assert.equal(sun.status, 200, 'the sun map is missing');
    assert.equal(sun.headers.get('content-type'), 'image/webp');

    // Texture underneath, lit wash on top, so both palettes still light it.
    assert.match(css, /--ob-sun-fill:\s*\n\s*radial-gradient\([\s\S]*?\),\s*\n\s*url\("sun\.webp"\);/);
    assert.match(css, /\.ob-sun-core \{[\s\S]*?background-size: cover;/);

    // Everything it already did, it must still do.
    assert.match(css, /\.ob-sun-core \{[\s\S]*?animation: ob-sun-in/);
    assert.match(css, /box-shadow: 0 0 0 1px var\(--ob-sun-ring\), 0 0 46px 10px var\(--ob-sun-glow\)/);
    const { body } = await new Client().html('/');
    assert.match(body, /<a class="ob-sun" href="\/" aria-label="Home">/);

    // Both night blocks carry the sun, and still say exactly the same thing.
    const blocks = [...css.matchAll(/(?:\[data-ob-theme="dark"\]|:root:not\(\[data-ob-theme="light"\]\)) \{\n([\s\S]*?)\n\s*\}/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim());
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0], blocks[1], 'the dark palettes have drifted apart');
    assert.ok(blocks[0].includes('sun.webp'), 'the night sun lost its texture');
  });

  test('gallery pictures open in a lightbox, and still open in a tab without script', async () => {
    const js = await (await new Client().get('/themes/orbit/theme.js')).text();
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    // The viewer is built by script and hung off the gallery links by
    // delegation, so the shared template is untouched and Designs 1–3 keep
    // their own behaviour. The markup must therefore still be the plain link.
    const { body } = await new Client().html('/projects/example-pm25-prediction');
    assert.match(body, /<a class="gallery-item" href="\/uploads\/[^"]+" target="_blank" rel="noopener noreferrer">/);
    assert.doesNotMatch(body, /ob-lightbox/, 'the viewer must not be server-rendered');

    // A proper dialog: modal, labelled, the rest of the page made inert.
    assert.match(js, /role: 'dialog'/);
    assert.match(js, /'aria-modal': 'true'/);
    assert.match(js, /setAttribute\('inert', ''\)/);
    assert.match(js, /removeAttribute\('inert'\)/);

    // Keyboard: Escape closes, arrows step, Tab stays inside.
    assert.match(js, /event\.key === 'Escape'/);
    assert.match(js, /event\.key === 'ArrowLeft'/);
    assert.match(js, /event\.key === 'ArrowRight'/);
    assert.match(js, /event\.key === 'Tab'/);

    // Focus goes in on open and back to the link on close.
    assert.match(js, /closeBtn\.focus\(\)/);
    assert.match(js, /trigger\.focus\(\)/);

    // A modified click is the browser's, not ours; a plain one is intercepted.
    assert.match(js, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey\) return;/);

    // Scroll is locked without a sideways shift, and always unlocked again.
    assert.match(js, /root\.style\.overflow = 'hidden'/);
    assert.match(js, /root\.style\.paddingRight = gutter \+ 'px'/);
    assert.match(js, /var unlockScroll = function/);

    // Captions come from what the gallery already provides: the picture's own
    // alt, then the gallery's caption under it.
    assert.match(js, /caption\.appendChild\(document\.createTextNode\(item\.alt\)\)/);
    assert.match(js, /sub\.textContent = galleryCaption/);

    // The picture is bounded by the viewport itself, both ways, so any aspect
    // ratio fits without cropping and without depending on a parent's height.
    assert.match(css, /\.ob-lightbox-img \{[\s\S]*?max-width: calc\(100vw - 2 \* var\(--ob-lb-gutter\) - 2 \* var\(--ob-lb-side\)\);/);
    assert.match(css, /max-height: calc\(100dvh - var\(--ob-lb-top\) - var\(--ob-lb-bottom\) - 3rem\);/);
    // Above the sticky header.
    const lightboxZ = Number((css.match(/\.ob-lightbox \{[\s\S]*?z-index: (\d+);/) || [])[1]);
    const headerZ = Number((css.match(/\.ob-header \{[\s\S]*?z-index: (\d+);/) || [])[1]);
    assert.ok(lightboxZ > headerZ, `lightbox z ${lightboxZ} must exceed header z ${headerZ}`);

    // Side arrows only where there is room for them; a bottom bar below that.
    assert.match(css, /--ob-lb-side: 3\.4rem;/);
    assert.match(css, /@media \(max-width: 48rem\) \{\n  \.ob-lightbox \{[^}]*--ob-lb-side: 0px; \}/);

    // Both palettes carry a scrim, and the night lists still agree.
    const blocks = [...css.matchAll(/(?:\[data-ob-theme="dark"\]|:root:not\(\[data-ob-theme="light"\]\)) \{\n([\s\S]*?)\n\s*\}/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim());
    assert.equal(blocks[0], blocks[1], 'the dark palettes have drifted apart');
    assert.ok(blocks[0].includes('--ob-scrim:'), 'the night palette has no scrim');
    assert.match(css, /--ob-scrim: rgba\(242, 242, 239, 0\.94\);/);

    // Reduced motion: no fade, no settle.
    assert.match(css, /\.ob-lightbox, \.ob-lightbox-img \{ transition: none !important; transform: none !important; \}/);
  });

  test('the colophon carries the texture credit the licence asks for', async () => {
    const { body } = await new Client().html('/');

    // Beside the existing name and copyright, not replacing them.
    assert.match(body, /class="ob-footer-name"/);
    assert.match(body, /class="ob-footer-meta"/);
    assert.match(body, /class="ob-footer-credit"/);

    const credit = body.match(/<p class="ob-footer-credit">([\s\S]*?)<\/p>/);
    assert.ok(credit, 'no credit line in the colophon');
    const line = credit[1];

    // The source and the licence are both linked, and both leave safely.
    assert.match(line, /href="https:\/\/www\.solarsystemscope\.com\/textures\/"[^>]*>Solar System Scope</);
    assert.match(line, /href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"[^>]*>CC BY 4\.0</);
    for (const anchor of line.match(/<a [^>]*>/g) || []) {
      assert.match(anchor, /rel="noopener noreferrer"/, 'external credit link is missing rel');
      assert.match(anchor, /target="_blank"/);
    }

    // It rides in the footer on every page, not just the homepage.
    const inner = await new Client().html('/projects');
    assert.match(inner.body, /class="ob-footer-credit"/);

    // Quiet, and in the colophon's own mono face.
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();
    assert.match(css, /\.ob-footer-credit \{[\s\S]*?font-family: var\(--ob-mono\);/);
    assert.match(css, /\.ob-footer-credit \{[\s\S]*?color: var\(--ob-faint\);/);
  });

  test('orienting the map never cuts it off at the bottom', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    // Clipping is only needed sideways. Tilting toward face-on swings the near
    // planets below the section, and `hidden` used to cut them there.
    assert.match(css, /@supports \(overflow: clip\) \{\s*\n\s*\.ob-launch \{\s*\n\s*overflow-x: clip;\s*\n\s*overflow-y: visible;/);
    // The floor for browsers without clip stays as it was.
    assert.match(css, /\.ob-launch \{[\s\S]*?overflow: hidden;\n\}/);
    // A clip margin applies to every side, so the outer ring would widen the
    // scrollable area — it must not come back.
    assert.doesNotMatch(css, /overflow-clip-margin/);
  });

  test('inner planets orbit faster, and a drag carries that difference', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    const periods = [];
    const rates = [];
    for (let slot = 1; slot <= 6; slot += 1) {
      const arm = css.match(new RegExp(`\\.ob-arm--${slot} \\{ --ob-n: \\d; --ob-rate: ([\\d.]+); animation-duration: (\\d+)s;`));
      assert.ok(arm, `slot ${slot} has no rate and period`);
      rates.push(Number(arm[1]));
      periods.push(Number(arm[2]));

      // The label only stays upright while the billboard shares the arm's clock.
      const billboard = css.match(new RegExp(`\\.ob-arm--${slot} \\.ob-billboard \\{ animation-duration: (\\d+)s;`));
      assert.ok(billboard, `slot ${slot} billboard has no period`);
      assert.equal(Number(billboard[1]), periods[slot - 1], `slot ${slot} billboard is out of step`);
    }

    // Closer in is quicker round, all the way out.
    for (let i = 1; i < periods.length; i += 1) {
      assert.ok(periods[i] > periods[i - 1], `orbit ${i + 1} is not slower than ${i}`);
    }

    // Loosely Keplerian: period rises faster than radius, but nowhere near the
    // real a^1.5, which at these radii would leave the inner body racing.
    const radii = periods.map((unused, i) => 0.36 + 0.132 * i);
    const exponents = periods.slice(1).map((t, i) =>
      Math.log(t / periods[i]) / Math.log(radii[i + 1] / radii[i]));
    for (const e of exponents) {
      assert.ok(e > 1 && e < 1.35, `exponent ${e.toFixed(2)} is outside a moderate range`);
    }
    // Still calm, and still close together.
    assert.ok(periods[0] >= 90, 'the innermost orbit has become too quick');
    assert.ok(periods[5] / periods[0] < 4, 'the spread between orbits is too wide');

    // Each rate is that orbit's speed relative to the middle of the system, so
    // the middle keeps the pace it had and the drag keeps its feel.
    assert.ok(rates[0] > rates[5], 'rates do not fall outward');
    assert.ok(rates[2] > 1 && rates[3] < 1, 'the middle pair should straddle the reference');

    // A drag hands each body its own share of the spin rather than shunting the
    // whole plane round as one piece.
    assert.match(css, /--ob-drift: calc\(var\(--ob-spin\) \* \(var\(--ob-rate, 1\) - 1\)\);/);
    assert.match(
      css,
      /transform: rotateZ\(var\(--ob-drift\)\)\s*\n\s*translateX\(var\(--ob-ring\)\)\s*\n\s*rotateZ\(calc\(-1 \* var\(--ob-spin\) - var\(--ob-drift\)\)\);/
    );

    // The zoom solver reads the orbit off that transform, which now carries a
    // rotation too — so it has to take the magnitude, not just the x component.
    const js = await (await new Client().get('/themes/orbit/theme.js')).text();
    assert.match(js, /Math\.hypot\(matrix\.m41, matrix\.m42\)/);
  });

  test('orbits step outward by one fixed increment', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    // One shared formula, so ring n is always base + step x n. Slot numbers
    // are the only per-orbit value, and the path and the planet share them.
    assert.match(
      css,
      /\.ob-path, \.ob-anchor \{\s*--ob-ring: calc\(var\(--ob-r\) \* \(var\(--ob-orbit-base\) \+ var\(--ob-orbit-step\) \* var\(--ob-n, 0\)\)\)/
    );
    for (let slot = 1; slot <= 6; slot += 1) {
      const n = slot - 1;
      assert.match(css, new RegExp(`\\.ob-path--${slot} \\{ --ob-n: ${n};`), `path ${slot}`);
      assert.match(css, new RegExp(`\\.ob-arm--${slot} \\{ --ob-n: ${n};`), `arm ${slot}`);
    }

    // Hover must light the planet up, never move it, and never pause the orbit.
    assert.doesNotMatch(css, /\.ob-body:hover, \.ob-body:focus-visible \{ transform/);
    assert.doesNotMatch(css, /\.ob-scene:hover/);
    assert.match(css, /\.ob-scene:focus-within \.ob-arm/);
  });

  test('camera controls are opt-in and cannot break the composition', async () => {
    const js = await (await new Client().get('/themes/orbit/theme.js')).text();

    // Primary button drags. Nothing may claim the context menu any more.
    assert.match(js, /event\.button !== 0/);
    assert.doesNotMatch(js, /contextmenu/);

    // A press that travels is a drag, and the click it would produce is
    // swallowed — that is what keeps planet navigation working.
    assert.match(js, /DRAG_SLOP/);
    assert.match(js, /suppressClick/);
    // Never preventDefault on pointerdown: the link needs its own click. The
    // handler is brace-matched out of the source so this reads all of it and
    // only it — it registers listeners of its own, so a naive slice stops short.
    const downAt = js.indexOf("scene.addEventListener('pointerdown'");
    assert.ok(downAt > 0, 'no pointerdown listener on the scene');
    const open = js.indexOf('{', downAt);
    let depth = 0;
    let close = open;
    for (; close < js.length; close += 1) {
      if (js[close] === '{') depth += 1;
      else if (js[close] === '}' && (depth -= 1) === 0) break;
    }
    const downHandler = js.slice(open, close);
    assert.ok(downHandler.includes('is-grabbing'), 'did not capture the handler body');
    // The call, not the word — the handler explains itself in a comment.
    assert.doesNotMatch(downHandler, /preventDefault\s*\(/, 'pointerdown must not cancel the click');
    // The native link drag does have to go, though.
    assert.match(js, /'dragstart'[\s\S]{0,200}?preventDefault/);

    assert.match(js, /passive: false/);
    assert.match(js, /MIN_TILT/);
    assert.match(js, /MAX_ZOOM/);
    assert.match(js, /spinVelocity \*= 0\.955/);

    // The resting zoom is shared with the stylesheet, so they cannot drift.
    assert.match(js, /var REST_ZOOM = 360;/);
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();
    assert.match(css, /--ob-zoom: 360px;/);

    // Starting angles are re-rolled per visit, but only the angle.
    assert.match(js, /animationDelay = delay/);
  });

  test('the night palette is a designed alternate, not an inversion', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    // Chosen when asked for, and by default when the system asks and the
    // visitor has not — but an explicit "light" always wins.
    assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*\n\s*:root:not\(\[data-ob-theme="light"\]\) \{/);
    assert.match(css, /:root\[data-ob-theme="dark"\] \{/);
    assert.match(css, /color-scheme: dark;/);
    assert.match(css, /color-scheme: light;/);

    // The two dark lists must stay identical, or one route drifts from the
    // other and only some visitors see the palette that was designed.
    const blocks = [...css.matchAll(/(?:\[data-ob-theme="dark"\]|:root:not\(\[data-ob-theme="light"\]\)) \{\n([\s\S]*?)\n\s*\}/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim());
    assert.equal(blocks.length, 2, 'expected exactly two dark declaration lists');
    assert.equal(blocks[0], blocks[1], 'the dark palettes have drifted apart');

    // It is a real palette, not filter: invert() over the light one.
    assert.doesNotMatch(css, /filter:\s*invert/);
    // Every colour it touches has to be a token, or half the map stays light.
    for (const token of [
      '--ob-plate', '--ob-panel-glass', '--ob-header-bg', '--ob-halo',
      '--ob-orbit-line', '--ob-star', '--ob-sun-fill', '--ob-planet-shade'
    ]) {
      assert.ok(blocks[0].includes(token + ':'), `${token} missing from the night palette`);
    }
  });

  test('the palette is chosen before the first paint and remembered', async () => {
    const boot = await new Client().get('/themes/orbit/theme-boot.js');
    assert.equal(boot.status, 200);
    const bootJs = await boot.text();
    assert.match(bootJs, /localStorage\.getItem\('ob-theme'\)/);
    assert.match(bootJs, /prefers-color-scheme: dark/);
    assert.match(bootJs, /setAttribute\('data-ob-theme'/);

    const { body } = await new Client().html('/');
    // Blocking, and ahead of the deferred main script, so the palette is on the
    // document before anything is drawn.
    assert.match(body, /<script src="\/themes\/orbit\/theme-boot\.js"><\/script>/);
    assert.ok(
      body.indexOf('theme-boot.js') < body.indexOf('theme.js" defer'),
      'the boot script must come first'
    );

    // One control, rendered in both places it needs to live.
    assert.equal((body.match(/data-theme-toggle/g) || []).length, 2);
    assert.match(body, /class="ob-header-tools"/);
    assert.match(body, /class="ob-launch-theme"/);

    // Inner pages keep the header copy only.
    const inner = await new Client().html('/projects');
    assert.equal((inner.body.match(/data-theme-toggle/g) || []).length, 1);
    assert.doesNotMatch(inner.body, /ob-launch-theme/);

    const css = await (await new Client().get('/themes/orbit/theme.css')).text();
    // Never a dead button: hidden until script has confirmed it can act, and
    // only ever one of the two copies is live at a time.
    assert.match(css, /\.ob-theme \{\n  display: none;/);
    assert.match(css, /\.ob-theme-ready \.ob-theme \{ display: inline-flex; \}/);

    // Exactly one glyph per mode: sun in the dark, moon in the light. The
    // sizing rule must not also set display — it out-specified the icon rules
    // and quietly put both glyphs in the button in light mode.
    assert.doesNotMatch(css, /\.ob-theme svg \{[^}]*display:/);
    assert.match(css, /\.ob-theme \.ob-theme-moon \{ display: block; \}/);
    assert.match(css, /\.ob-theme \.ob-theme-sun \{ display: none; \}/);
    assert.match(css, /:root\[data-ob-theme="dark"\] \.ob-theme \.ob-theme-moon \{ display: none; \}/);
    assert.match(css, /:root\[data-ob-theme="dark"\] \.ob-theme \.ob-theme-sun \{ display: block; \}/);
    assert.match(css, /body\.is-over-map \.ob-header-tools \.ob-theme \{ display: none; \}/);

    const js = await (await new Client().get('/themes/orbit/theme.js')).text();
    assert.match(js, /localStorage\.setItem\('ob-theme'/);
    assert.match(js, /ob-theme-ready/);
  });

  test('the map keeps orbiting after a drag, and the wheel follows the cursor', async () => {
    const js = await (await new Client().get('/themes/orbit/theme.js')).text();
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    // Wheel handling is answered from where the pointer is, not from what the
    // event happened to bubble through — a label can orbit far outside the
    // frame, and the page must never be left unable to scroll.
    assert.match(js, /var overMap = function/);
    assert.match(js, /if \(!overMap\(event\)\) return;/);
    assert.match(js, /window\.addEventListener\('wheel'/);
    assert.doesNotMatch(js, /scene\.addEventListener\('wheel'/);

    // Pressing a planet focuses it; :focus-within must not then hold the whole
    // system still until the next click somewhere else.
    assert.match(css, /\.ob-scene\.is-managed:focus-within \.ob-arm,[\s\S]{0,120}?animation-play-state: running;/);
    assert.match(css, /\.ob-scene\.is-managed\.is-holding \.ob-arm,[\s\S]{0,120}?animation-play-state: paused;/);
    assert.match(js, /scene\.classList\.add\('is-managed'\)/);
    assert.match(js, /is-holding/);
    // Keyboard focus still holds it, which is the point of the rule.
    assert.match(js, /byKeyboard/);

    // A release must always let go, wherever it happens.
    assert.match(js, /window\.addEventListener\('mouseup', endDrag\)/);
    assert.match(js, /window\.removeEventListener\('mouseup', endDrag\)/);
  });

  test('the entrance hands over to the resting state without a step', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    // The orb keeps an identity transform at rest, so the animation's last
    // frame and the resting style are the same value and the element never
    // changes rendering mode underneath the visitor.
    assert.match(css, /\.ob-orb \{[\s\S]*?transform: scale\(1\);/);
    assert.match(css, /@keyframes ob-orb-in \{\n  from \{ opacity: 0; transform: scale\(0\.3\); \}\n  to \{ opacity: 1; transform: scale\(1\); \}/);
    assert.doesNotMatch(css, /@keyframes ob-orb-in \{[\s\S]*?to \{[^}]*transform: none/);
  });

  test('the name types with a hand rhythm, not a metronome', async () => {
    const js = await (await new Client().get('/themes/orbit/theme.js')).text();
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    // Each key gets its own moment rather than an even multiple of an index.
    assert.match(js, /--ob-char-delay/);
    assert.match(css, /animation-delay: var\(--ob-char-delay, 0ms\);/);
    assert.doesNotMatch(css, /--ob-char-step/);
    assert.doesNotMatch(js, /--ob-char-i/);

    // Varied intervals, a beat before a new word, and the occasional stumble.
    assert.match(js, /Math\.random\(\)/);
    assert.match(js, /if \(position === 0 && lineIndex > 0\) elapsed \+=/);

    // Slower than the old flat 26ms per character.
    const pace = js.match(/var pace = Math\.max\((\d+), Math\.min\((\d+)/);
    assert.ok(pace, 'no pace calculation found');
    assert.ok(Number(pace[1]) > 26, `floor of ${pace[1]}ms is not slower than before`);
  });

  test('the closest zoom is solved from the outermost planet, per viewport', async () => {
    const js = await (await new Client().get('/themes/orbit/theme.js')).text();

    // Solved rather than pinned to one compromise constant, and re-solved when
    // the window changes size.
    assert.match(js, /var solveZoom = function/);
    assert.match(js, /var measureMaxZoom = function/);
    assert.match(js, /MAX_ZOOM = measureMaxZoom\(\)/);
    assert.match(js, /addEventListener\('resize', remeasureZoom\)/);
    // A narrower window must pull an already-zoomed view back to the new limit.
    assert.match(js, /if \(zoom > MAX_ZOOM\)/);

    // The boundary is the outermost planet's own orbit, so it reads the last
    // arm rather than the decorative ring, which is meant to run past the frame.
    assert.match(js, /arms\[arms\.length - 1\]/);
    assert.doesNotMatch(js, /ob-path--outer/);

    const css = await (await new Client().get('/themes/orbit/theme.css')).text();
    // The solver projects about the perspective origin, so it has to sit on the
    // camera's own transform origin or every prediction is off.
    assert.match(css, /perspective-origin: 50% 50%;/);
  });

  test('the landing instruction is above the fold whatever is written above it', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    // The hero gives way on short viewports rather than pushing the hint down.
    assert.match(css, /padding-top: clamp\(1\.75rem, 5vh, 4rem\);/);
    assert.match(css, /font-size: clamp\(2rem, min\(5\.5vw, 8\.5vh\), 4rem\);/);
    assert.match(css, /\.ob-launch-hint \{\s*\n\s*margin-top: clamp\(/);
    // The row gap only separates the intro from the cue, so it stays small.
    assert.match(css, /row-gap: clamp\(/);

    // The one thing above the hint that can grow without bound is CMS text, so
    // it is capped and scrolls instead of displacing the hint.
    assert.match(css, /\.ob-launch-lead \{[\s\S]{0,200}?max-height: min\(12em, 20vh\);[\s\S]{0,80}?overflow-y: auto;/);
  });

  test('only the visible bodies take clicks, and they sit above the orbits', async () => {
    const css = await (await new Client().get('/themes/orbit/theme.css')).text();

    // Every wrapper is a box lying in the tilted plane; leaving them hit-active
    // means the half of each disc behind that plane stops being clickable.
    assert.match(css, /\.ob-camera,\s*\n\.ob-orbits,\s*\n\.ob-bodies,[\s\S]*?pointer-events: none;/);
    assert.match(css, /\.ob-planet,\s*\n\.ob-body-tag,\s*\n\.ob-sun \{ pointer-events: auto; \}/);
    assert.match(css, /\.ob-planet \{[\s\S]*?cursor: pointer;/);
    assert.match(css, /\.ob-sun \{[\s\S]*?cursor: pointer;/);
    assert.match(css, /\.ob-scene \{ cursor: grab;/);

    // Flat, so the ring system sorts as one layer behind every planet.
    assert.match(css, /\.ob-orbits \{[\s\S]*?transform-style: flat;/);

    // The planets join the entrance the rings and the sun already had.
    assert.match(css, /@keyframes ob-orb-in/);
    assert.match(css, /animation: ob-orb-in [^;]+ backwards;/);
    // No forwards fill: the resting state must be the plain, visible one.
    assert.doesNotMatch(css, /animation: ob-orb-in [^;]+ forwards;/);

    // The header is held transparent over the map so it cannot flash.
    assert.match(css, /body\.ob-home \.ob-header \{ animation: ob-header-hold/);
    assert.match(css, /@keyframes ob-header-hold/);
  });

  test('the other three themes are untouched', async () => {
    const client = await authed();
    for (const theme of ['classic', 'editorial', 'grid']) {
      await setTheme(client, theme);
      const { response, body } = await new Client().html('/');
      assert.equal(response.status, 200, theme);
      assert.doesNotMatch(body, /ob-launch|ob-body|ob-sun/, `${theme} picked up orbit markup`);
      assert.match(body, new RegExp('/themes/' + theme + '/theme\.css'), theme);
    }
    await setTheme(client, 'orbit');
  });
});

/* --------------------------------------------------------------------------
   Arcade (design 5)
   --------------------------------------------------------------------------
   The star chart is the landing navigation, so most of these tests are about
   it staying navigable: six real destinations, two ways in, and animation
   that nothing can interrupt. The last group is deliberately adversarial —
   it asserts the absence of the mechanisms behind the usability problems the
   orbit theme went through, so reintroducing one of them fails here.

/* --------------------------------------------------------------------------
   Arcade (design 5)
   --------------------------------------------------------------------------
   Arcade is a fork of Orbit, not a reimplementation of it: the solar system
   is Design 4's, and only the surrounding interface is new. So the tests
   come in two halves.

   The first half is a fidelity check against Orbit, and it is the important
   one. It reads both stylesheets and both scripts and asserts that
   everything describing the solar system — geometry tokens, orbital radii,
   revolution rates, the camera, the drag and the zoom — is character for
   character what Design 4 has. If someone "improves" the orbital code in
   this theme, these fail.

   The second half covers the 8-bit treatment that was actually added.
   -------------------------------------------------------------------------- */
describe('arcade theme', () => {
  before(async () => {
    const client = await authed();
    await setTheme(client, 'arcade');
  });

  after(async () => {
    const client = await authed();
    await setTheme(client, 'classic');
  });

  /** Both themes' assets, with the prefix difference normalised away. */
  async function bothAssets(file) {
    const client = new Client();
    const arcade = await (await client.get('/themes/arcade/' + file)).text();
    const orbit = await (await client.get('/themes/orbit/' + file)).text();
    return { arcade, orbit: orbit.replace(/ob-/g, 'ar-') };
  }

  test('it is offered in the admin alongside the others', async () => {
    const client = await authed();
    const { body } = await client.html('/admin/settings/sections');
    for (const theme of ['classic', 'editorial', 'grid', 'orbit', 'arcade']) {
      assert.match(body, new RegExp('name="publicTheme" value="' + theme + '"'), theme);
    }
    assert.match(body, /value="arcade"[^>]*\schecked/);
  });

  test('every public route renders', async () => {
    const client = new Client();
    for (const path of [
      '/',
      '/projects',
      '/research',
      '/projects/example-pm25-prediction',
      '/research/example-thesis'
    ]) {
      const response = await client.get(path);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
    assert.equal((await client.get('/definitely-not-a-page')).status, 404);
  });

  /* --- fidelity to Design 4 --------------------------------------------- */

  test('the script is Design 4\'s, bar the one deliberate difference', async () => {
    const { arcade, orbit } = await bothAssets('theme.js');

    // The camera, the drag, the wheel zoom, the inertia, the lightbox and the
    // reveals are all in here. The only edit this theme is allowed to make is
    // flipping which palette an undecided visitor gets, because Arcade is a
    // night theme and Orbit is a day one.
    const normalise = (s) => s
      .replace(/systemDark/g, 'SYSTEM')
      .replace(/systemLight/g, 'SYSTEM')
      .replace(/\? 'dark' : 'light'/g, 'RESOLVE')
      .replace(/\? 'light' : 'dark'/g, 'RESOLVE')
      .replace(/\(prefers-color-scheme: dark\)/g, 'SCHEME')
      .replace(/\(prefers-color-scheme: light\)/g, 'SCHEME');

    assert.equal(normalise(arcade), normalise(orbit),
      'the forked script has drifted from Design 4 beyond the palette default');

    // And the pieces that must be there, named explicitly so a wholesale
    // rewrite that happened to normalise the same way would still fail.
    for (const marker of [
      'var solveZoom = function',
      'var measureMaxZoom = function',
      "window.addEventListener('wheel'",
      "scene.addEventListener('pointerdown'",
      'var REST_TILT = 62;',
      'var REST_ZOOM = 360;',
      'MIN_ZOOM = -160',
      'var DRAG_SLOP = 6;',
      'ar-lightbox'
    ]) {
      assert.ok(arcade.includes(marker), 'missing from the fork: ' + marker);
    }
  });

  test('every number describing the solar system matches Design 4', async () => {
    const { arcade, orbit } = await bothAssets('theme.css');

    const grab = (css, re) => {
      const found = [...css.matchAll(re)].map((m) => m.slice(1).join('|'));
      assert.ok(found.length, 'nothing matched ' + re);
      return found;
    };

    // Camera and orbital geometry tokens.
    const tokens = /--ar-(tilt|tilt-back|r|sun-size|orb): ([^;]+);/g;
    assert.deepEqual(grab(arcade, tokens), grab(orbit, tokens));

    // Per-ring radius fraction and revolution rate, and the periods and
    // phases that set where each planet sits and how fast it goes round.
    const arms = /\.ar-arm--(\d) \{ --ar-n: (\d); --ar-rate: ([\d.]+); animation-duration: (\d+)s; animation-delay: (-?\d+)s; \}/g;
    const arcadeArms = grab(arcade, arms);
    assert.equal(arcadeArms.length, 6);
    assert.deepEqual(arcadeArms, grab(orbit, arms));

    // The billboards that keep the labels upright must stay on the same
    // clock as their arm, or a label drifts away from its planet.
    const bill = /\.ar-arm--(\d) \.ar-billboard \{ animation-duration: (\d+)s; animation-delay: (-?\d+)s; \}/g;
    assert.deepEqual(grab(arcade, bill), grab(orbit, bill));

    // The orbit rings themselves.
    const paths = /\.ar-path--(\d|outer) \{([^}]*)\}/g;
    assert.deepEqual(grab(arcade, paths), grab(orbit, paths));

    // And the keyframes that drive the whole thing.
    for (const name of ['ar-arm', 'ar-billboard', 'ar-sun-in', 'ar-path-in', 'ar-orb-in']) {
      const re = new RegExp('@keyframes ' + name + ' \\{[\\s\\S]*?\\n\\}', 'g');
      assert.deepEqual(grab(arcade, re), grab(orbit, re), name);
    }
  });

  test('the solar system is composed exactly as Design 4 composes it', async () => {
    const client = new Client();
    const arcade = (await client.html('/')).body;

    assert.match(arcade, /class="ar-launch"/);
    assert.match(arcade, /class="ar-scene"[^>]*data-scene/);
    assert.match(arcade, /class="ar-camera"/);
    assert.match(arcade, /class="ar-orbits"/);
    assert.match(arcade, /class="ar-bodies"/);

    // Six planets on six arms, one sun, and the decorative outer ring.
    assert.equal((arcade.match(/class="ar-planet"/g) || []).length, 6);
    assert.equal((arcade.match(/class="ar-arm ar-arm--\d"/g) || []).length, 6);
    assert.match(arcade, /<a class="ar-sun" href="\/" aria-label="Home">/);
    assert.match(arcade, /ar-path--outer/);

    // Design 4's own planet artwork, which the stylesheet wires to each body,
    // at Design 4's own sizes. Both halves matter: swapping the art would
    // change the files, and "tidying" the proportions would change the sizes.
    const sheet = await (await client.get('/themes/arcade/theme.css')).text();
    const orbitSheet = (await (await client.get('/themes/orbit/theme.css')).text()).replace(/ob-/g, 'ar-');
    const bodies = /\.ar-body--(\d) \.ar-planet \{ width: ([\d.]+rem); height: ([\d.]+rem); --ar-planet-fill: url\("([a-z-]+\.webp)"\); \}/g;
    const arcadeBodies = [...sheet.matchAll(bodies)].map((m) => m.slice(1).join(' '));
    assert.equal(arcadeBodies.length, 6, 'expected six planets wired up');
    assert.deepEqual(arcadeBodies, [...orbitSheet.matchAll(bodies)].map((m) => m.slice(1).join(' ')));

    // The sun and Saturn's rings are their own layers, as in Design 4.
    assert.match(sheet, /--ar-sun-fill:[\s\S]*?url\("sun\.webp"\)/);
    assert.match(sheet, /url\("saturn-rings\.webp"\)/);
    // The rings are a pair of pseudo-elements on Saturn's own orb, flattened
    // into the planet's plane. Their whole rule, flattening included, has to
    // be Design 4's or the rings stop sitting on the planet correctly.
    const ringRule = (css) => {
      const at = css.indexOf('saturn-rings.webp');
      assert.ok(at > -1, 'Saturn has lost its ring layer');
      return css.slice(css.lastIndexOf('.ar-body--6 .ar-orb::before', at),
                       css.indexOf('}', css.indexOf('scaleY', at)));
    };
    assert.equal(ringRule(sheet), ringRule(orbitSheet),
      "Saturn's rings have moved from where Design 4 put them");
    assert.match(ringRule(sheet), /transform: scaleY\(0\.34\);/);

    // The labels and their codes, in Design 4's order.
    for (const [slot, code] of [[1,'ABT'],[2,'WRK'],[3,'TLK'],[4,'RSH'],[5,'EDU'],[6,'CTC']]) {
      assert.match(arcade, new RegExp(`0${slot} / ${code}`), `slot ${slot}`);
    }

    // The map is navigation, and it works without script.
    const hrefs = [...arcade.matchAll(/<a class="ar-body[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.includes('/projects') && hrefs.includes('/research'));
    assert.ok(hrefs.includes('#about') && hrefs.includes('#contact'));
    for (const href of hrefs) assert.doesNotMatch(href, /^javascript:/i);
  });

  test('the map is not boxed in: no frame, no panel, no grid around it', async () => {
    const css = await (await new Client().get('/themes/arcade/theme.css')).text();
    const scene = (css.match(/\n\.ar-scene \{[\s\S]*?\n\}/) || [''])[0];
    assert.ok(scene, 'no .ar-scene rule');
    // A border, a panel fill or a clip on the scene would turn the landing
    // into a dashboard card, which is the thing this must never become.
    assert.doesNotMatch(scene, /border(?!-radius)[^;]*:\s*(?!none)/);
    assert.doesNotMatch(scene, /background(-color)?:\s*var\(--ar-panel/);
    assert.doesNotMatch(scene, /overflow:\s*(hidden|clip)/);
    assert.doesNotMatch(scene, /box-shadow:\s*(?!none)/);

    // The grid belongs to the page, behind everything.
    assert.match(css, /body\.ar::before \{[\s\S]*?position: fixed;[\s\S]*?linear-gradient\(to right, var\(--ar-grid\)/);
  });

  /* --- the 8-bit treatment ---------------------------------------------- */

  test('real pixel faces are served from this origin, not a font CDN', async () => {
    const client = new Client();
    const css = await (await client.get('/themes/arcade/theme.css')).text();

    // font-src is 'self', so a CDN link would simply be blocked.
    assert.doesNotMatch(css, /fonts\.googleapis\.com|fonts\.gstatic\.com|@import/);
    assert.match(css, /@font-face \{[\s\S]*?font-family: "Press Start 2P";/);
    assert.match(css, /@font-face \{[\s\S]*?font-family: "VT323";/);
    assert.match(css, /--ar-pixel: "Press Start 2P"/);

    // The files are really there and really woff2.
    for (const f of ['press-start-2p-latin.woff2', 'press-start-2p-latin-ext.woff2',
                     'vt323-latin.woff2', 'vt323-latin-ext.woff2']) {
      const res = await client.get('/themes/arcade/fonts/' + f);
      assert.equal(res.status, 200, f);
      const head = Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString('latin1');
      assert.equal(head, 'wOF2', f + ' is not woff2');
    }
    // Redistributing them obliges us to ship the licence.
    const licence = await client.get('/themes/arcade/fonts/OFL.txt');
    assert.equal(licence.status, 200);
    assert.match(await licence.text(), /SIL OPEN FONT LICENSE/);

    // Headings take the pixel face; body copy takes the readable one.
    assert.match(css, /\.ar :where\(h1, h2, h3, h4\) \{[\s\S]*?font-family: var\(--ar-pixel\);/);
    assert.match(css, /body\.ar \{[\s\S]*?font-family: var\(--ar-sans\);/);
    assert.match(css, /--ar-sans: "VT323"/);
  });

  test('controls are sprites: hard outline, two bevels, and a pressed state', async () => {
    const css = await (await new Client().get('/themes/arcade/theme.css')).text();
    const btn = (css.match(/\n\.ar-btn \{[\s\S]*?\n\}/) || [''])[0];
    assert.ok(btn, 'no .ar-btn rule');

    assert.match(btn, /border: var\(--ar-px\) solid var\(--ar-line\);/);
    // A light bevel top-left, a dark one bottom-right, and a hard drop.
    assert.match(btn, /inset var\(--ar-px\) var\(--ar-px\) 0 0 var\(--ar-btn-hi\)/);
    assert.match(btn, /inset calc\(-1 \* var\(--ar-px\)\) calc\(-1 \* var\(--ar-px\)\) 0 0 var\(--ar-btn-lo\)/);
    assert.match(btn, /var\(--ar-px\) var\(--ar-px\) 0 0 var\(--ar-line\)/);
    // Nothing eases: a sprite changes frame.
    assert.match(btn, /transition: none;/);

    // Pressing moves the button into its own shadow.
    assert.match(css, /\.ar-btn:active \{[\s\S]*?transform: translate\(var\(--ar-px\), var\(--ar-px\)\);/);
    // Each variant carries the same construction rather than going flat.
    for (const variant of ['accent', 'quiet']) {
      assert.match(css, new RegExp('\\.ar-btn-' + variant + ' \\{[\\s\\S]*?inset var\\(--ar-px\\)'), variant);
    }
    // Nothing anywhere is rounded.
    assert.match(css, /--ar-radius: 0px;/);
  });

  test('the night palette is the reference\'s, and the day palette is neutral', async () => {
    const css = await (await new Client().get('/themes/arcade/theme.css')).text();
    const night = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: light)'));
    const dayAt = css.indexOf(':root[data-ar-theme="light"] {');
    // The block ends after its last token; slicing to there keeps this
    // from running on into the rules that follow it.
    const day = css.slice(dayAt, css.indexOf('}', css.indexOf('--ar-planet-halo', dayAt)));

    // Day is declared twice — once for the system preference and once for an
    // explicit choice — and the two must stay identical, or a visitor gets a
    // different theme depending on how they arrived at it. Comparing the
    // token lists catches a value edited in only one of them.
    const mediaDay = css.slice(css.indexOf('@media (prefers-color-scheme: light)'), dayAt);
    const tokensOf = (block) => [...block.matchAll(/(--ar-[a-z-]+):\s*([^;]+);/g)]
      .map((m) => m[1] + ': ' + m[2].trim().replace(/\s+/g, ' '));
    assert.ok(tokensOf(mediaDay).length > 20, 'the system-preference day block looks empty');
    assert.deepEqual(tokensOf(mediaDay), tokensOf(day),
      'the two day palettes have drifted apart');

    // Night is the native mode here, which is the opposite of Design 4.
    assert.match(night, /color-scheme: dark;/);
    assert.match(night, /--ar-canvas: #0f0f23;/);
    assert.match(night, /--ar-panel: #1d1d45;/);
    assert.match(night, /--ar-accent: #f8b800;/);
    assert.match(night, /--ar-cyan: #00e8d8;/);
    // Outlines are black in both palettes — that is the 8-bit identity.
    assert.match(night, /--ar-line: #000000;/);
    assert.match(day, /--ar-line: #000000;/);

    const token = (block, name) => {
      const m = block.match(new RegExp('--ar-' + name + ': (#[0-9a-f]{6});'));
      assert.ok(m, 'no --ar-' + name);
      const c = [1, 3, 5].map((i) => parseInt(m[1].slice(i, i + 2), 16));
      return { hex: m[1], r: c[0], g: c[1], b: c[2] };
    };

    // Day is a warm neutral, and specifically not the purple that was asked
    // against: on a neutral, green sits between red and blue; on a lavender
    // it drops below both.
    for (const name of ['canvas', 'panel', 'panel-alt']) {
      const c = token(day, name);
      assert.ok(c.r + c.g + c.b > 660, 'day --ar-' + name + ' is too dark');
      assert.ok(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 16,
        'day --ar-' + name + ' (' + c.hex + ') is tinted');
      assert.ok(c.g >= (c.r + c.b) / 2 - 3,
        'day --ar-' + name + ' (' + c.hex + ') is purple, not neutral');
    }
    const ink = token(day, 'ink');
    assert.ok(ink.r + ink.g + ink.b < 180 && ink.b > ink.r, 'day ink should be a dark navy');
  });

  test('the palette default is flipped, and the toggle still persists', async () => {
    const client = new Client();
    const boot = await (await client.get('/themes/arcade/theme-boot.js')).text();
    // Night unless the system explicitly asks for light — the reverse of
    // Design 4, and the one thing the fork deliberately changes.
    assert.match(boot, /\(prefers-color-scheme: light\)[\s\S]*?\? 'light'\s*:\s*'dark'/);
    assert.match(boot, /getItem\('ar-theme'\)/);
    assert.match(boot, /setAttribute\('data-ar-theme'/);

    const js = await (await client.get('/themes/arcade/theme.js')).text();
    assert.match(js, /setItem\('ar-theme', next\)/);
    assert.match(js, /aria-pressed|aria-label/);

    // The boot script runs blocking in the head, so there is no flash.
    const { body } = await client.html('/');
    const head = body.slice(0, body.indexOf('</head>'));
    assert.match(head, /<script src="\/themes\/arcade\/theme-boot\.js"><\/script>/);
    assert.doesNotMatch(head, /theme-boot\.js"[^>]*(defer|async)/);
  });

  /* --- the portfolio itself ---------------------------------------------- */

  test('it reads the database rather than carrying its own copy', async () => {
    const { body } = await new Client().html('/');
    assert.match(body, /Your Name/);
    assert.match(body, /Placeholder introduction/);
    assert.match(body, /id="ar-content"/);
    for (const id of ['about', 'projects', 'skills', 'contact']) {
      assert.match(body, new RegExp('id="' + id + '"'), id);
    }
  });

  test('CMS blocks, media, galleries and Devicon logos render', async () => {
    const { body } = await new Client().html('/projects/example-pm25-prediction');
    assert.match(body, /class="blocks"/);
    assert.match(body, /class="block-heading"/);
    assert.match(body, /class="block-code"/);
    assert.match(body, /class="block-image/);
    assert.match(body, /<svg[^>]*class="icon-svg"/);
    assert.match(body, /class="gallery-grid"/);
    assert.match(body, /srcset="[^"]*-480\.webp 480w[^"]*-960\.webp 960w/);
    assert.doesNotMatch(body, /<script>alert/);
  });

  test('the gallery lightbox came across with the fork', async () => {
    const client = new Client();
    const js = await (await client.get('/themes/arcade/theme.js')).text();
    const css = await (await client.get('/themes/arcade/theme.css')).text();
    assert.match(js, /role: 'dialog'/);
    assert.match(js, /'aria-modal': 'true'/);
    assert.match(js, /setAttribute\('inert', ''\)/);
    assert.match(js, /ar-lightbox/);
    assert.match(css, /\.ar-lightbox \{/);
    // The gallery opens in place rather than in a new tab.
    const { body } = await client.html('/projects/example-pm25-prediction');
    assert.match(body, /class="gallery-item"/);
  });

  test('SEO, sitemap and robots are unaffected by the theme', async () => {
    const client = new Client();
    const { body } = await client.html('/projects/example-pm25-prediction');
    assert.match(body, /<title>Example: PM2\.5 prediction pipeline —/);
    assert.match(body, /<meta property="og:title"/);
    assert.match(await (await client.get('/sitemap.xml')).text(), /<urlset/);
    assert.match(await (await client.get('/robots.txt')).text(), /Disallow: \/admin/);
  });

  test('drafts stay private and are flagged for the admin', async () => {
    const visitor = new Client();
    assert.equal((await visitor.get('/projects/example-draft-project')).status, 404);
    for (const path of ['/', '/projects']) {
      assert.doesNotMatch((await visitor.html(path)).body, /draft project/i, path);
    }
    const client = await authed();
    const { response, body } = await client.html('/projects/example-draft-project');
    assert.equal(response.status, 200);
    assert.match(body, /ar-draft/);
    assert.match((await client.html('/projects')).body, /draft project/i);
  });

  test('custom pages render through the theme', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/pages/new');
    const created = await client.post('/admin/pages', {
      _csrf, title: 'Arcade Colophon', status: 'published', show_in_nav: '1'
    });
    const id = created.headers.get('location').split('/').pop();

    _csrf = await client.token(`/admin/pages/${id}`);
    const added = await client.post(`/admin/blocks/page/${id}/add`, { _csrf, type: 'richtext' });
    const blockId = Number(added.headers.get('location').split('#block-').pop());
    await client.post(`/admin/blocks/${blockId}`, { _csrf, body: 'Typeset in **pixels**.' });

    const { response, body } = await new Client().html('/arcade-colophon');
    assert.equal(response.status, 200);
    assert.match(body, /Arcade Colophon/);
    assert.match(body, /<strong>pixels<\/strong>/);
    assert.match(body, /themes\/arcade\/theme\.css/);

    await client.post(`/admin/pages/${id}/delete`, { _csrf: await client.token('/admin/pages') });
  });

  test('no inline styles or scripts, so the strict CSP still holds', async () => {
    const client = new Client();
    for (const path of ['/', '/projects', '/projects/example-pm25-prediction', '/nope']) {
      const { body } = await client.html(path);
      const markup = body.replace(/<svg[\s\S]*?<\/svg>/g, '');
      assert.doesNotMatch(markup, /\sstyle="/, `${path} contains an inline style`);
      assert.doesNotMatch(markup, /<style/, `${path} contains a style element`);
      assert.doesNotMatch(markup, /<script(?![^>]*\ssrc=)/, `${path} contains an inline script`);
    }
  });

  test('theme templates are never served as static files', async () => {
    const client = new Client();
    for (const path of ['/themes/arcade/views/home.ejs', '/themes/arcade/home.ejs']) {
      assert.notEqual((await client.get(path)).status, 200, `${path} was served`);
    }
    for (const path of ['/themes/arcade/theme.css', '/themes/arcade/theme.js',
                        '/themes/arcade/theme-boot.js', '/themes/arcade/sun.webp']) {
      assert.equal((await client.get(path)).status, 200, path);
    }
  });

  test('the other four themes are untouched by this one', async () => {
    const client = await authed();
    for (const theme of ['classic', 'editorial', 'grid']) {
      await setTheme(client, theme);
      const { response, body } = await new Client().html('/');
      assert.equal(response.status, 200, theme);
      assert.doesNotMatch(body, /ar-launch|ar-scene|ar-camera/, `${theme} picked up arcade markup`);
      assert.match(body, new RegExp('/themes/' + theme + '/theme\\.css'), theme);
    }
    // Orbit shares the structure but must still be served its own assets.
    await setTheme(client, 'orbit');
    const orbit = (await new Client().html('/')).body;
    assert.match(orbit, /\/themes\/orbit\/theme\.css/);
    assert.doesNotMatch(orbit, /\/themes\/arcade\//);
    assert.match(orbit, /class="ob-launch"/);
    assert.doesNotMatch(orbit, /class="ar-launch"/);

    await setTheme(client, 'arcade');
  });
});
