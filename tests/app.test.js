/**
 * End-to-end tests over a real server instance with a throwaway database.
 * Run with: npm test
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const root = mkdtempSync(join(tmpdir(), 'portfolio-test-'));
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

// --- tiny cookie-aware client ---------------------------------------------

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

  /** Read a CSRF token out of any rendered form on the page. */
  async token(path) {
    const { body } = await this.html(path);
    const match = body.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(match, `no CSRF token found on ${path}`);
    return match[1];
  }

  async post(path, fields, options = {}) {
    const body = new URLSearchParams(fields).toString();
    return this.request(path, {
      method: 'POST',
      body,
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

// ---------------------------------------------------------------------------

describe('public site', () => {
  test('homepage renders', async () => {
    const { response, body } = await new Client().html('/');
    assert.equal(response.status, 200);
    assert.match(body, /<h1 class="hero-name">/);
    assert.match(body, /id="projects"/);
  });

  test('project, research and listing pages render', async () => {
    const client = new Client();
    for (const path of ['/projects', '/research', '/projects/example-pm25-prediction', '/research/example-thesis']) {
      const response = await client.get(path);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });

  test('drafts are hidden from anonymous visitors', async () => {
    const client = new Client();
    const response = await client.get('/projects/example-draft-project');
    assert.equal(response.status, 404);

    const { body } = await client.html('/projects');
    assert.doesNotMatch(body, /Example: draft project/);
  });

  test('signed-in admins see drafts marked as drafts', async () => {
    const client = await authed();
    const { response, body } = await client.html('/projects/example-draft-project');
    assert.equal(response.status, 200);
    assert.match(body, /Draft preview/);
  });

  test('unknown pages return 404', async () => {
    const response = await new Client().get('/no-such-page');
    assert.equal(response.status, 404);
  });

  test('sitemap and robots.txt are served', async () => {
    const client = new Client();
    const sitemap = await client.get('/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.match(await sitemap.text(), /<urlset/);

    const robots = await client.get('/robots.txt');
    assert.match(await robots.text(), /Disallow: \/admin/);
  });

  test('sitemap excludes drafts', async () => {
    const response = await new Client().get('/sitemap.xml');
    assert.doesNotMatch(await response.text(), /example-draft-project/);
  });

  test('security headers are set', async () => {
    const response = await new Client().get('/');
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
  });
});

describe('authentication', () => {
  test('/admin redirects anonymous visitors to the login page', async () => {
    const response = await new Client().get('/admin');
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /^\/admin\/login/);
  });

  test('every admin section is protected', async () => {
    const client = new Client();
    const paths = [
      '/admin/projects',
      '/admin/projects/new',
      '/admin/research',
      '/admin/skills',
      '/admin/education',
      '/admin/pages',
      '/admin/media',
      '/admin/media/picker',
      '/admin/settings',
      '/admin/preview',
      '/admin/account'
    ];
    for (const path of paths) {
      const response = await client.get(path);
      assert.equal(response.status, 302, `${path} was reachable`);
      assert.match(response.headers.get('location'), /^\/admin\/login/, path);
    }
  });

  test('admin writes are rejected without a session', async () => {
    const client = new Client();
    const _csrf = await client.token('/admin/login');
    const response = await client.post('/admin/projects', { _csrf, title: 'Injected' });
    assert.equal(response.status, 401);
  });

  test('wrong password is rejected', async () => {
    const client = new Client();
    const response = await client.login('tester', 'wrong-password-here');
    assert.equal(response.status, 401);
    assert.match(await response.text(), /Incorrect username or password/);
  });

  test('unknown user is rejected the same way', async () => {
    const client = new Client();
    const response = await client.login('nobody', PASSWORD);
    assert.equal(response.status, 401);
    assert.match(await response.text(), /Incorrect username or password/);
  });

  test('correct password signs in and reaches the dashboard', async () => {
    const client = await authed();
    const { response, body } = await client.html('/admin');
    assert.equal(response.status, 200);
    assert.match(body, /Dashboard/);
  });

  test('logout ends the session', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin');
    const response = await client.post('/admin/logout', { _csrf });
    assert.equal(response.status, 302);

    const after = await client.get('/admin');
    assert.equal(after.status, 302);
    assert.match(after.headers.get('location'), /^\/admin\/login/);
  });

  test('admin pages are not cached or indexed', async () => {
    const client = await authed();
    const response = await client.get('/admin');
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
  });

  test('a stolen-looking session cookie does not work', async () => {
    const client = new Client();
    client.jar.set('portfolio_session', 'not-a-real-token');
    const response = await client.get('/admin');
    assert.equal(response.status, 302);
  });
});

describe('CSRF protection', () => {
  test('a POST without a token is refused', async () => {
    const client = await authed();
    const response = await client.post('/admin/projects', { title: 'No token' });
    assert.equal(response.status, 403);
  });

  test('a POST with a forged token is refused', async () => {
    const client = await authed();
    const response = await client.post('/admin/projects', { _csrf: 'aaaa.bbbb', title: 'Forged' });
    assert.equal(response.status, 403);
  });
});

describe('project management', () => {
  test('create, edit, publish, reorder and delete a project', async () => {
    const client = await authed();

    let _csrf = await client.token('/admin/projects/new');
    const created = await client.post('/admin/projects', {
      _csrf,
      title: 'Test Project',
      summary: 'A summary',
      description: 'Body text',
      tech: JSON.stringify([{ name: 'Python', icon: 'python' }, { name: 'Rust', icon: 'rust' }]),
      year: '2026',
      github_url: 'https://github.com/example/repo',
      status: 'draft',
      has_detail_page: '1'
    });
    assert.equal(created.status, 302);
    const id = Number(created.headers.get('location').split('/').pop());
    assert.ok(id > 0);

    // Draft: invisible to the public.
    assert.equal((await new Client().get('/projects/test-project')).status, 404);

    // Technologies are de-duplicated.
    const { body: editPage } = await client.html(`/admin/projects/${id}`);
    assert.match(editPage, /data-tech-name="Python"/);
    assert.match(editPage, /data-tech-icon="python"/);
    assert.match(editPage, /data-tech-name="Rust"/);

    // Publish it.
    _csrf = await client.token(`/admin/projects/${id}`);
    await client.post(`/admin/projects/${id}/status`, { _csrf, status: 'published' });
    assert.equal((await new Client().get('/projects/test-project')).status, 200);

    // Feature it, and check it reaches the homepage.
    await client.post(`/admin/projects/${id}/feature`, { _csrf });
    const { body: home } = await new Client().html('/');
    assert.match(home, /Test Project/);

    // Reordering keeps the list stable and moves the row.
    const before = await orderOfProjects(client);
    await client.post(`/admin/projects/${id}/move`, { _csrf, direction: 'up' });
    const afterMove = await orderOfProjects(client);
    assert.equal(before.length, afterMove.length);
    assert.notDeepEqual(before, afterMove);

    // Delete.
    await client.post(`/admin/projects/${id}/delete`, { _csrf });
    assert.equal((await new Client().get('/projects/test-project')).status, 404);
  });

  test('slugs stay unique', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/projects/new');
    const first = await client.post('/admin/projects', { _csrf, title: 'Duplicate Name', status: 'draft' });
    const second = await client.post('/admin/projects', { _csrf, title: 'Duplicate Name', status: 'draft' });
    const firstId = first.headers.get('location').split('/').pop();
    const secondId = second.headers.get('location').split('/').pop();

    const { body } = await client.html(`/admin/projects/${secondId}`);
    assert.match(body, /value="duplicate-name-2"/);

    for (const id of [firstId, secondId]) {
      await client.post(`/admin/projects/${id}/delete`, { _csrf: await client.token(`/admin/projects/${id}`) });
    }
  });

  test('a dangerous URL is dropped rather than rendered', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/projects/new');
    const created = await client.post('/admin/projects', {
      _csrf,
      title: 'Bad Link Project',
      has_detail_page: '1',
      // eslint-disable-next-line no-script-url
      github_url: 'javascript:alert(1)',
      status: 'published'
    });
    const id = created.headers.get('location').split('/').pop();

    const { body } = await new Client().html('/projects/bad-link-project');
    assert.doesNotMatch(body, /javascript:/);

    await client.post(`/admin/projects/${id}/delete`, { _csrf: await client.token(`/admin/projects/${id}`) });
  });

  test('markdown is sanitized before it reaches the page', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/projects/new');
    const created = await client.post('/admin/projects', {
      _csrf,
      title: 'XSS Project',
      has_detail_page: '1',
      description: 'Hello <img src=x onerror="alert(1)"> <script>alert(2)</script> **bold**',
      status: 'published'
    });
    const id = created.headers.get('location').split('/').pop();

    const { body } = await new Client().html('/projects/xss-project');
    assert.doesNotMatch(body, /onerror/);
    assert.doesNotMatch(body, /<script>alert\(2\)<\/script>/);
    assert.match(body, /<strong>bold<\/strong>/);

    await client.post(`/admin/projects/${id}/delete`, { _csrf: await client.token(`/admin/projects/${id}`) });
  });
});

async function orderOfProjects(client) {
  const { body } = await client.html('/admin/projects');
  return [...body.matchAll(/href="\/admin\/projects\/(\d+)"/g)].map((match) => match[1]);
}

describe('content blocks', () => {
  test('add, edit, move and delete blocks on a project', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/projects/new');
    const created = await client.post('/admin/projects', { _csrf, title: 'Block Project', status: 'published', has_detail_page: '1' });
    const id = created.headers.get('location').split('/').pop();

    _csrf = await client.token(`/admin/projects/${id}`);
    const addHeading = await client.post(`/admin/blocks/project/${id}/add`, { _csrf, type: 'heading' });
    const headingId = Number(addHeading.headers.get('location').split('#block-').pop());
    await client.post(`/admin/blocks/project/${id}/add`, { _csrf, type: 'richtext' });

    await client.post(`/admin/blocks/${headingId}`, { _csrf, text: 'Methodology', level: '2' });

    let { body } = await new Client().html('/projects/block-project');
    assert.match(body, /<h2 class="block-heading">Methodology<\/h2>/);

    // An unknown block type is refused.
    const bogus = await client.post(`/admin/blocks/project/${id}/add`, { _csrf, type: 'evilBlock' });
    assert.equal(bogus.status, 302);
    const { body: adminBody } = await client.html(`/admin/projects/${id}`);
    assert.match(adminBody, /Unknown block type/);

    // Move the heading down, then confirm the order changed.
    await client.post(`/admin/blocks/${headingId}/move`, { _csrf, direction: 'down' });
    ({ body } = await client.html(`/admin/projects/${id}`));
    const order = [...body.matchAll(/id="block-(\d+)"/g)].map((match) => match[1]);
    assert.equal(order[1], String(headingId));

    await client.post(`/admin/blocks/${headingId}/delete`, { _csrf });
    ({ body } = await new Client().html('/projects/block-project'));
    assert.doesNotMatch(body, /Methodology/);

    await client.post(`/admin/projects/${id}/delete`, { _csrf: await client.token(`/admin/projects/${id}`) });
  });

  test('a code block escapes its contents', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/projects/new');
    const created = await client.post('/admin/projects', { _csrf, title: 'Code Project', status: 'published', has_detail_page: '1' });
    const id = created.headers.get('location').split('/').pop();

    _csrf = await client.token(`/admin/projects/${id}`);
    const added = await client.post(`/admin/blocks/project/${id}/add`, { _csrf, type: 'code' });
    const blockId = Number(added.headers.get('location').split('#block-').pop());
    await client.post(`/admin/blocks/${blockId}`, {
      _csrf,
      language: 'python',
      code: '<script>alert(1)</script>',
      caption: ''
    });

    const { body } = await new Client().html('/projects/code-project');
    assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(body, /<script>alert\(1\)<\/script>/);

    await client.post(`/admin/projects/${id}/delete`, { _csrf: await client.token(`/admin/projects/${id}`) });
  });
});

describe('skills, education and settings', () => {
  test('skill categories and skills can be managed', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/skills');

    await client.post('/admin/skills/categories', { _csrf, name: 'Test Category' });
    let { body } = await client.html('/admin/skills');
    assert.match(body, /Test Category/);
    const categoryId = [...body.matchAll(/action="\/admin\/skills\/categories\/(\d+)"/g)].pop()[1];

    // Several skills in one go.
    await client.post(`/admin/skills/categories/${categoryId}/skills`, { _csrf, name: 'Alpha, Beta, Gamma' });
    ({ body } = await client.html('/admin/skills'));
    assert.match(body, /value="Alpha"/);
    assert.match(body, /value="Gamma"/);

    ({ body } = await new Client().html('/'));
    assert.match(body, /Test Category/);

    await client.post(`/admin/skills/categories/${categoryId}/delete`, { _csrf });
    ({ body } = await client.html('/admin/skills'));
    assert.doesNotMatch(body, /value="Test Category"/);
    // Deleting a category removes its skills too.
    assert.doesNotMatch(body, /value="Alpha"/);
  });

  test('education entries can be added and hidden', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/education/new');
    const created = await client.post('/admin/education', {
      _csrf,
      degree: 'MSc Testing',
      institution: 'Test University',
      date_range: '2026 — 2027',
      visible: '1'
    });
    const id = created.headers.get('location').split('/').pop();

    let { body } = await new Client().html('/');
    assert.match(body, /MSc Testing/);

    await client.post(`/admin/education/${id}`, {
      _csrf: await client.token(`/admin/education/${id}`),
      degree: 'MSc Testing',
      institution: 'Test University'
    });
    ({ body } = await new Client().html('/'));
    assert.doesNotMatch(body, /MSc Testing/, 'hidden entries must not render');

    await client.post(`/admin/education/${id}/delete`, { _csrf: await client.token('/admin/education') });
  });

  test('site settings drive the public page', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/settings');
    await client.post('/admin/settings', {
      _csrf,
      name: 'Ada Lovelace',
      tagline: 'Computer Science Student',
      email: 'ada@example.com',
      github: 'https://github.com/ada',
      // Rejected: not an allowed scheme.
      linkedin: 'javascript:alert(1)',
      extraLinks: 'Scholar | https://scholar.example.com\nBroken line without a url'
    });

    const { body } = await new Client().html('/');
    assert.match(body, /Ada Lovelace/);
    assert.match(body, /ada@example\.com/);
    assert.match(body, /scholar\.example\.com/);
    assert.doesNotMatch(body, /javascript:/);
    assert.doesNotMatch(body, /Broken line without a url/);
  });

  test('hiding a section removes it from the page', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/settings/sections');
    await client.post('/admin/settings/sections', {
      _csrf,
      about: '1',
      projects: '1',
      education: '1',
      research: '1',
      contact: '1',
      titleProjects: 'Selected work',
      titleSkills: 'Skills',
      titleEducation: 'Education',
      titleResearch: 'Research',
      titleContact: 'Contact'
    });

    let { body } = await new Client().html('/');
    assert.doesNotMatch(body, /id="skills"/);

    await client.post('/admin/settings/sections', {
      _csrf: await client.token('/admin/settings/sections'),
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
      titleContact: 'Contact'
    });
    ({ body } = await new Client().html('/'));
    assert.match(body, /id="skills"/);
  });
});

describe('media', () => {
  async function upload(client, { name, buffer, type }) {
    const form = new FormData();
    form.append('_csrf', await client.token('/admin/media'));
    form.append('files', new Blob([buffer], { type }), name);
    return client.request('/admin/media/upload', {
      method: 'POST',
      body: form,
      headers: { accept: 'application/json' }
    });
  }

  test('uploads an image, generates variants and can delete it', async () => {
    const client = await authed();
    const png = await sharp({
      create: { width: 1600, height: 1000, channels: 3, background: '#334455' }
    })
      .png()
      .toBuffer();

    const response = await upload(client, { name: 'photo.png', buffer: png, type: 'image/png' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.errors.length, 0);
    const media = result.media[0];
    assert.ok(media.id);
    assert.equal(media.width, 1600);
    assert.ok(media.variants.length >= 3, 'responsive variants are generated');

    // The stored file and its variants exist on disk.
    assert.ok(existsSync(join(process.env.UPLOAD_DIR, media.filename)));
    for (const variant of media.variants) {
      assert.ok(existsSync(join(process.env.UPLOAD_DIR, variant.file)));
    }

    // It is served.
    assert.equal((await client.get('/uploads/' + media.filename)).status, 200);

    // Unused media deletes cleanly, files included.
    const deleted = await client.post(`/admin/media/${media.id}/delete`, {
      _csrf: await client.token('/admin/media')
    });
    assert.equal(deleted.status, 302);
    assert.equal(existsSync(join(process.env.UPLOAD_DIR, media.filename)), false);
  });

  test('media in use is protected from accidental deletion', async () => {
    const client = await authed();
    const { body } = await client.html('/admin/media');
    const inUseId = [...body.matchAll(/action="\/admin\/media\/(\d+)\/delete"/g)][0][1];

    const response = await client.post(`/admin/media/${inUseId}/delete`, {
      _csrf: await client.token('/admin/media')
    });
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /highlight=/);

    const { body: after } = await client.html('/admin/media');
    assert.match(after, /still used in/);
  });

  test('a disguised executable is rejected', async () => {
    const client = await authed();
    const response = await upload(client, {
      name: 'evil.png',
      buffer: Buffer.from('MZ\x90\x00 this is not an image'),
      type: 'image/png'
    });
    const result = await response.json();
    assert.equal(result.media.length, 0);
    assert.match(result.errors[0], /could not be read as an image/);
  });

  test('an SVG is refused even when declared as an image', async () => {
    const client = await authed();
    const response = await upload(client, {
      name: 'evil.svg',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      type: 'image/svg+xml'
    });
    assert.equal(response.status, 400);
  });

  test('uploads cannot escape the upload directory', async () => {
    const client = await authed();
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();

    const response = await upload(client, {
      name: '../../escaped.png',
      buffer: png,
      type: 'image/png'
    });
    const result = await response.json();
    const media = result.media[0];
    assert.doesNotMatch(media.filename, /[\\/]/);
    assert.doesNotMatch(media.filename, /\.\./);
    assert.ok(existsSync(join(process.env.UPLOAD_DIR, media.filename)));

    await client.post(`/admin/media/${media.id}/delete`, { _csrf: await client.token('/admin/media') });
  });

  test('traversal attempts on the uploads route do not read outside it', async () => {
    const client = new Client();
    for (const path of ['/uploads/../../package.json', '/uploads/%2e%2e/%2e%2e/package.json']) {
      const response = await client.get(path);
      assert.notEqual(response.status, 200, path);
    }
  });

  test('multipart uploads still require a CSRF token', async () => {
    const client = await authed();
    const form = new FormData();
    form.append('files', new Blob([Buffer.from('x')], { type: 'image/png' }), 'x.png');
    const response = await client.request('/admin/media/upload', { method: 'POST', body: form });
    assert.equal(response.status, 403);
  });
});

describe('preview', () => {
  test('the preview page only targets public paths', async () => {
    const client = await authed();
    const { body } = await client.html('/admin/preview?path=/admin/settings');
    assert.match(body, /src="\/"/, 'admin paths fall back to the homepage');

    const { body: ok } = await client.html('/admin/preview?path=/projects');
    assert.match(ok, /src="\/projects"/);
  });
});

describe('pages', () => {
  test('a custom page can be created, published and shown in the nav', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/pages/new');
    const created = await client.post('/admin/pages', {
      _csrf,
      title: 'Technical Notes',
      status: 'draft',
      show_in_nav: '1'
    });
    const id = created.headers.get('location').split('/').pop();

    // Draft: hidden, and not in the navigation.
    assert.equal((await new Client().get('/technical-notes')).status, 404);
    const { body: anonHome } = await new Client().html('/');
    assert.doesNotMatch(anonHome, /Technical Notes/);

    _csrf = await client.token(`/admin/pages/${id}`);
    const added = await client.post(`/admin/blocks/page/${id}/add`, { _csrf, type: 'richtext' });
    const blockId = Number(added.headers.get('location').split('#block-').pop());
    await client.post(`/admin/blocks/${blockId}`, { _csrf, body: 'Notes on **compilers**.' });

    await client.post(`/admin/pages/${id}`, {
      _csrf,
      title: 'Technical Notes',
      slug: 'technical-notes',
      status: 'published',
      show_in_nav: '1'
    });

    const { response, body } = await new Client().html('/technical-notes');
    assert.equal(response.status, 200);
    assert.match(body, /<strong>compilers<\/strong>/);

    const { body: home } = await new Client().html('/');
    assert.match(home, /href="\/technical-notes"/);

    await client.post(`/admin/pages/${id}/delete`, { _csrf: await client.token('/admin/pages') });
    assert.equal((await new Client().get('/technical-notes')).status, 404);
  });

  test('a page cannot take over a built-in route', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/pages/new');
    const created = await client.post('/admin/pages', { _csrf, title: 'Projects', slug: 'projects', status: 'published' });
    const id = created.headers.get('location').split('/').pop();

    const { body } = await client.html(`/admin/pages/${id}`);
    assert.match(body, /value="projects-page"/);

    // The real projects listing still wins.
    const { body: listing } = await new Client().html('/projects');
    assert.match(listing, /Things I have designed, built and shipped/);

    await client.post(`/admin/pages/${id}/delete`, { _csrf: await client.token('/admin/pages') });
  });
});

describe('duplicating and account management', () => {
  test('duplicating a project copies its blocks as a draft', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/projects/new');
    const created = await client.post('/admin/projects', {
      _csrf,
      title: 'Original Project',
      status: 'published',
      featured: '1',
      has_detail_page: '1'
    });
    const id = created.headers.get('location').split('/').pop();

    _csrf = await client.token(`/admin/projects/${id}`);
    const added = await client.post(`/admin/blocks/project/${id}/add`, { _csrf, type: 'heading' });
    const blockId = Number(added.headers.get('location').split('#block-').pop());
    await client.post(`/admin/blocks/${blockId}`, { _csrf, text: 'Copied heading', level: '2' });

    const duplicated = await client.post(`/admin/projects/${id}/duplicate`, { _csrf });
    const copyId = duplicated.headers.get('location').split('/').pop();
    assert.notEqual(copyId, id);

    const { body } = await client.html(`/admin/projects/${copyId}`);
    assert.match(body, /Original Project \(copy\)/);
    assert.match(body, /value="Copied heading"/);
    // A copy always starts as an unfeatured draft.
    assert.match(body, /<option value="draft" selected>/);
    assert.doesNotMatch(body, /name="featured" value="1" checked/);

    for (const target of [id, copyId]) {
      await client.post(`/admin/projects/${target}/delete`, { _csrf: await client.token(`/admin/projects/${target}`) });
    }
  });

  test('setup is closed once an account exists', async () => {
    const client = new Client();
    const response = await client.get('/admin/setup');
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /\/admin\/login/);

    const attempt = await client.post('/admin/setup', {
      _csrf: await client.token('/admin/login'),
      username: 'intruder',
      password: 'a-very-long-password',
      confirm: 'a-very-long-password'
    });
    assert.equal(attempt.status, 302);
    assert.equal((await new Client().login('intruder', 'a-very-long-password')).status, 401);
  });

  test('changing the password requires the current one and signs everyone out', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/account');

    const wrong = await client.post('/admin/account/password', {
      _csrf,
      current: 'not-my-password',
      password: 'another-long-password',
      confirm: 'another-long-password'
    });
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /current password is not correct/);

    const mismatch = await client.post('/admin/account/password', {
      _csrf: await client.token('/admin/account'),
      current: PASSWORD,
      password: 'another-long-password',
      confirm: 'different-long-password'
    });
    assert.equal(mismatch.status, 400);

    const tooShort = await client.post('/admin/account/password', {
      _csrf: await client.token('/admin/account'),
      current: PASSWORD,
      password: 'short',
      confirm: 'short'
    });
    assert.equal(tooShort.status, 400);

    // A successful change ends the current session and the old password stops working.
    const newPassword = 'a-brand-new-password';
    const changed = await client.post('/admin/account/password', {
      _csrf: await client.token('/admin/account'),
      current: PASSWORD,
      password: newPassword,
      confirm: newPassword
    });
    assert.equal(changed.status, 302);
    assert.equal((await client.get('/admin')).status, 302);
    assert.equal((await new Client().login('tester', PASSWORD)).status, 401);
    assert.equal((await new Client().login('tester', newPassword)).status, 302);

    // Put it back so the rest of the suite is unaffected.
    const restored = await authedWith(newPassword);
    await restored.post('/admin/account/password', {
      _csrf: await restored.token('/admin/account'),
      current: newPassword,
      password: PASSWORD,
      confirm: PASSWORD
    });
  });
});

async function authedWith(password) {
  const client = new Client();
  const response = await client.login('tester', password);
  assert.equal(response.status, 302);
  return client;
}

/** The single .skill-chip <li> containing a given skill name. */
function chipFor(html, name) {
  const chips = html.match(/<li class="skill-chip[^"]*">(?:(?!<\/li>)[\s\S])*<\/li>/g) || [];
  return chips.find((chip) => chip.includes('>' + name + '<')) || null;
}

describe('skill icons', () => {
  test('the picker is protected and searchable', async () => {
    assert.equal((await new Client().get('/admin/icons/picker')).status, 302);

    const client = await authed();
    const { response, body } = await client.html('/admin/icons/picker?q=python');
    assert.equal(response.status, 200);
    assert.match(body, /data-icon-name="python"/);
    // Results carry the real logo, not a name to look up later.
    assert.match(body, /<svg[^>]*class="icon-svg"/);
    // And the always-available escape hatches.
    assert.match(body, /data-icon-name="generic"/);
    assert.match(body, /data-icon-name=""/);
  });

  test('search ranks an exact name above partial matches', async () => {
    const client = await authed();
    const { body } = await client.html('/admin/icons/picker?q=java');
    const order = [...body.matchAll(/data-icon-name="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(order[0], 'java');
    assert.ok(order.includes('javascript'));
  });

  test('an unknown search term reports no matches rather than erroring', async () => {
    const client = await authed();
    const { response, body } = await client.html('/admin/icons/picker?q=zzzznotathing');
    assert.equal(response.status, 200);
    assert.match(body, /No logo matches/);
  });

  test('a picked icon is stored and rendered on the public page', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/skills');

    await client.post('/admin/skills/categories', { _csrf, name: 'Icon Category' });
    let { body } = await client.html('/admin/skills');
    const categoryId = [...body.matchAll(/action="\/admin\/skills\/categories\/(\d+)"/g)].pop()[1];

    await client.post(`/admin/skills/categories/${categoryId}/skills`, {
      _csrf,
      name: 'Flutter',
      icon: 'flutter'
    });

    // The admin shows the chosen logo on the trigger button.
    ({ body } = await client.html('/admin/skills'));
    assert.match(body, /data-icon-input" value="flutter"|value="flutter" data-icon-input/);

    // The public page inlines the actual SVG next to the name.
    const { body: home } = await new Client().html('/');
    const chip = chipFor(home, 'Flutter');
    assert.ok(chip, 'skill chip with icon not found');
    assert.match(chip, /class="skill-chip has-icon"/);
    assert.match(chip, /<svg[^>]*class="icon-svg"/);
    assert.doesNotMatch(chip, /<script|<style|\sstyle=|\son[a-z]+=/i);

    await client.post(`/admin/skills/categories/${categoryId}/delete`, { _csrf });
  });

  test('an arbitrary icon value is rejected, not stored', async () => {
    const client = await authed();
    let _csrf = await client.token('/admin/skills');

    await client.post('/admin/skills/categories', { _csrf, name: 'Reject Category' });
    let { body } = await client.html('/admin/skills');
    const categoryId = [...body.matchAll(/action="\/admin\/skills\/categories\/(\d+)"/g)].pop()[1];

    await client.post(`/admin/skills/categories/${categoryId}/skills`, {
      _csrf,
      name: 'Sneaky',
      icon: '<svg onload="alert(1)"></svg>'
    });

    ({ body } = await client.html('/admin/skills'));
    assert.doesNotMatch(body, /onload/);

    const { body: home } = await new Client().html('/');
    const chip = chipFor(home, 'Sneaky');
    assert.ok(chip, 'skill chip not found');
    // Nothing was stored, so the chip carries no icon at all.
    assert.doesNotMatch(chip, /has-icon/);
    assert.doesNotMatch(chip, /<svg/);

    await client.post(`/admin/skills/categories/${categoryId}/delete`, { _csrf });
  });

  test('an icon that no longer resolves degrades to the generic mark', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/skills');

    await client.post('/admin/skills/categories', { _csrf, name: 'Fallback Category' });
    let { body } = await client.html('/admin/skills');
    const categoryId = [...body.matchAll(/action="\/admin\/skills\/categories\/(\d+)"/g)].pop()[1];
    await client.post(`/admin/skills/categories/${categoryId}/skills`, { _csrf, name: 'Legacy', icon: 'generic' });

    const { body: home } = await new Client().html('/');
    const chip = chipFor(home, 'Legacy');
    assert.ok(chip, 'fallback chip not found');
    assert.match(chip, /class="skill-chip has-icon"/);
    assert.match(chip, /<svg/);

    await client.post(`/admin/skills/categories/${categoryId}/delete`, { _csrf });
  });

  test('switching to monochrome repaints the logos in the text colour', async () => {
    const client = await authed();
    const sectionFields = {
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
      titleContact: 'Contact'
    };

    await client.post('/admin/settings/sections', {
      _csrf: await client.token('/admin/settings/sections'),
      ...sectionFields,
      skillIconStyle: 'mono'
    });

    let { body } = await new Client().html('/');
    let section = body.match(/<section class="section" id="skills">[\s\S]*?<\/section>/)[0];
    assert.match(section, /currentColor/);
    assert.doesNotMatch(section, /fill="#/);

    await client.post('/admin/settings/sections', {
      _csrf: await client.token('/admin/settings/sections'),
      ...sectionFields,
      skillIconStyle: 'color'
    });

    ({ body } = await new Client().html('/'));
    section = body.match(/<section class="section" id="skills">[\s\S]*?<\/section>/)[0];
    assert.match(section, /fill="#|<svg/);
  });

  test('reordering and categories still work with icons attached', async () => {
    const client = await authed();
    const _csrf = await client.token('/admin/skills');

    await client.post('/admin/skills/categories', { _csrf, name: 'Order Category' });
    let { body } = await client.html('/admin/skills');
    const categoryId = [...body.matchAll(/action="\/admin\/skills\/categories\/(\d+)"/g)].pop()[1];

    await client.post(`/admin/skills/categories/${categoryId}/skills`, { _csrf, name: 'First', icon: 'python' });
    await client.post(`/admin/skills/categories/${categoryId}/skills`, { _csrf, name: 'Second', icon: 'docker' });

    ({ body } = await client.html('/admin/skills'));
    const ids = [...body.matchAll(/action="\/admin\/skills\/skills\/(\d+)"\s+class/g)].map((m) => m[1]);
    const secondId = ids[ids.length - 1];

    await client.post(`/admin/skills/skills/${secondId}/move`, { _csrf, direction: 'up' });

    const { body: home } = await new Client().html('/');
    const group = home.match(/Order Category[\s\S]*?<\/dd>/)[0];
    assert.ok(group.indexOf('Second') < group.indexOf('First'), 'reorder did not take effect');
    // The icon survived the move.
    assert.match(group, /<svg/);

    await client.post(`/admin/skills/categories/${categoryId}/delete`, { _csrf });
  });
});
