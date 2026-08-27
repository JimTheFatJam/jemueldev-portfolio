# Portfolio

A minimal, professional Computer Science portfolio with a private admin CMS.

The public site is deliberately restrained: server-rendered HTML, one small
stylesheet, one ~20-line script. Everything on it — text, images, projects,
skills, research, section visibility — is edited at `/admin`, never in code.

---

## Quick start

```bash
npm install
```

```bash
npm run seed
```

```bash
npm start
```

Then open <http://127.0.0.1:3000>. The first visit to `/admin` asks you to
create your account; after that, `/admin` is the whole CMS.

`npm run seed` fills the site with clearly-labelled placeholder content so you
can see the finished layout immediately. Replace it from the admin — the
dashboard has a checklist.

To start over: `npm run seed -- --force`. That **deletes** all projects,
research, skills, education and content blocks, so once an admin account
exists it refuses to run without `--yes` as well. Back up `data/portfolio.db`
first.

Locked out? `npm run create-admin -- <username> <password>` creates or resets
the account.

## Stack

Chosen to stay small and to keep content separate from presentation.

| Layer | Choice | Why |
| --- | --- | --- |
| Server | Express 5 | Small, familiar, no build step |
| Views | EJS, server-rendered | Fast first paint, good SEO, no client framework |
| Database | SQLite via Node's built-in `node:sqlite` | Zero dependencies, single file, easy to back up |
| Images | sharp | Re-encodes uploads and generates responsive WebP variants |
| Markdown | marked + sanitize-html | Rich text without an HTML injection hole |
| Icons | devicon | Official technology logos, read from the local package |
| Auth | `node:crypto` scrypt + server-side sessions | No dependency, no plaintext passwords |

Eight runtime dependencies in total. No bundler, no CSS framework, no CDN.

> `devicon` installs ~135 MB, but almost all of it is `.eps` sources and
> webfonts that this project never touches. Only `devicon.json` and
> `icons/**/*.svg` (about 9 MB) are read at runtime, so a deploy can safely
> prune the rest.

## Architecture

```
SQLite  →  src/lib/*.js (data layer)  →  routes  →  EJS views
              ↑
           /admin (CMS)
```

```
src/
  app.js              Express app: security headers, CSRF, locals, routing
  db/
    schema.sql        Every table; safe to re-run
    index.js          Connection, helpers, transactions
    migrate.js        One-time row rewrites (forward only)
    seed.js           Placeholder content
  lib/
    auth.js           scrypt hashing, sessions, login throttling
    blocks.js         Content-block registry — the extension point
    content.js        Projects, research, skills, education, pages
    csrf.js           Signed double-submit tokens
    markdown.js       Markdown rendering + sanitisation + URL allowlist
    media.js          Upload validation, resizing, usage tracking
    icons.js          Devicon catalogue, search and SVG normalisation
    settings.js       Global settings, with defaults as the schema
  routes/
    public.js         The whole public site
    admin/            One file per admin section
  views/
    shared/           Partials every theme reuses (images, content blocks)
    admin/            Admin UI
  themes/
    index.js          Theme registry
    classic/          Design 1 — views/ + assets/
    editorial/        Design 2
    grid/             Design 3
    orbit/            Design 4
public/               Static assets and uploads
```

Content lives in the database, not in components — you can redesign the
frontend later without losing anything.

## The content block system

Project pages, research pages and custom pages are built from ordered blocks:
heading, rich text, image, image gallery, button, video embed, quote, divider,
code, project reference and skill group. Blocks are added, edited, reordered and
deleted from the admin.

The public design constrains how each block renders, so the site stays visually
consistent no matter what you add — this is a structured content system, not a
free-form page builder. Raw HTML and scripts are never accepted from the editor.

**Adding a block type** takes two steps and no other changes:

1. Add an entry to `BLOCK_TYPES` in `src/lib/blocks.js` — its label, its form
   fields, and a `normalize()` that sanitises the submitted data.
2. Add `src/views/partials/blocks/<type>.ejs` to render it.

The admin form, the type picker and validation all follow from the registry.

## Skill icons

Skills carry an optional technology logo from [Devicon](https://devicon.dev/)
(578 logos: languages, frameworks, databases, clouds, tools). In the admin you
search a picker that shows each logo next to its name and select one with a
single click — there is no field to type an icon name, a class or an SVG into.

What is stored is only the Devicon **name** (`python`, `nodejs`, `postgresql`).
That identifier is stable across Devicon releases, and keeping the drawing
variant out of the data means one setting can restyle every logo at once:

* **Settings → Sections → Skill logos** switches the whole site between full
  colour and monochrome. Monochrome repaints the logos in `currentColor`, so
  they follow the text colour in both light and dark mode.
* Rendering picks the best variant Devicon offers for the chosen style —
  `original` for colour, `plain`/`line` for monochrome — preferring whichever
  stays small enough to inline.

Logos are read from the local package, normalised once and cached, then inlined
as SVG. Nothing is fetched from a CDN, no icon files are duplicated into the
repo, and normalisation strips inline styles so the strict
`style-src 'self'` policy still holds.

Skills with no logo render as plain text; a stored name that no longer resolves
falls back to a neutral generic mark, and the picker offers that mark and a
"No icon" option explicitly. Values written before the picker existed are
mapped onto Devicon names by a one-time migration (`Node.js` → `nodejs`,
`C++` → `cplusplus`, `postgres` → `postgresql`); anything unrecognised is
cleared so it can be picked again.

## Public themes

The public site has four interchangeable designs, picked in
**Admin → Settings → Sections → Public website design**:

* **Classic** — light, centred column, hairline rules, blue accent
* **Editorial** — dark-first, fixed side rail, serif display type, amber accent
* **Grid** — off-white Swiss/editorial system, 12-column modular grid, orange accent
* **Orbit** — the Grid system plus a steerable 3D orbital map (zoom, orbit, inertia) and a persistent star chart

A theme is presentation only. It never touches the database: routes hand every
page the same locals, and shared partials under `src/views/shared/` render
images and content blocks so themes never reimplement them.

**Adding a theme** takes two steps:

1. Create `src/themes/<id>/views/` with the eight page templates listed in
   `VIEWS` (home, projects, project, research-list, research-item, page, 404,
   error) plus `assets/theme.css`.
2. Add an entry to `THEMES` in `src/themes/index.js`.

The selector picks it up automatically. A theme registered before its templates
exist is skipped rather than breaking the site.

## Credits

The planets, Saturn's rings and the sun in the Orbit theme are drawn from
**Solar System Scope** texture maps by INOVE, licensed **CC BY 4.0** — the pack
states: "Distributed under Attribution 4.0 International license: You may use,
adapt, and share these textures for any purpose, even commercially."

* Source: <https://www.solarsystemscope.com/textures/>
* Licence: <https://creativecommons.org/licenses/by/4.0/>

The shipped files are derivatives, 118 KB in total:

* `planet-*.webp` — each equirectangular map re-projected as a sphere seen head
  on, reduced to 256px.
* `sun.webp` — the same projection, at 384px because the sun is drawn larger.
* `saturn-rings.webp` — the pack ships the rings as a 2048x125 radial strip;
  this is that strip swept around a circle into an annulus, so the real
  structure including the Cassini division survives.

Nothing else in the theme comes from a third party.

The credit also appears on the site itself, in the Colophon at the foot of every
Orbit page, with the source and the licence both linked.

## Security

* Passwords are stored only as salted scrypt hashes; a plaintext password is
  never written anywhere.
* Sessions are server-side rows keyed by a SHA-256 hash of the cookie token, so
  the database never holds a usable token. Cookies are `HttpOnly`, `SameSite=Lax`,
  and `Secure` in production.
* Every `/admin` route and every admin write is gated server-side. There is no
  client-side-only protection and no hard-coded password anywhere.
* All state-changing requests require a signed CSRF token, file uploads included.
* Failed logins are throttled per IP, persisted so a restart cannot clear a lockout.
* User content is rendered through a strict HTML allowlist. URLs are limited to
  `http`, `https`, `mailto` and `tel` — `javascript:` collapses to nothing.
* Uploads are validated by decoding them, not by trusting the declared type.
  SVG is rejected because it can carry script. Filenames are generated
  server-side, so path traversal is not possible. Images are re-encoded, which
  strips EXIF and any embedded payload.
* A strict Content-Security-Policy is set; the only permitted third-party frames
  are YouTube and Vimeo embeds.
* Admin pages send `no-store` and `noindex`, and `/admin` is disallowed in
  `robots.txt`.

Set `SESSION_SECRET` in production — see `.env.example`. Without it, a secret is
generated once and stored in the database.

## Tests

```bash
npm test
```

110 end-to-end tests run against a real server with a throwaway database:
public pages, drafts, auth (including wrong passwords, logout and unauthorised
access), CSRF, CRUD, ordering, uploads and deletion, XSS and path-traversal
attempts, section visibility, the icon picker, all four public themes and the preview.

## Deploying

Any host that runs a long-lived Node process and gives you a writable disk —
a small VPS, Fly.io, Render, Railway. Serverless platforms will not work,
because SQLite and uploads both need persistent local storage.

```bash
NODE_ENV=production SESSION_SECRET=... PORT=3000 npm start
```

Put it behind a TLS-terminating reverse proxy, set `COOKIE_SECURE=true` and
`TRUST_PROXY=true`, and back up `data/portfolio.db` and `public/uploads/`
together — that pair is your entire site.

## Extending later

The schema and block registry already support blog posts, publications,
certifications and awards as new content types or as custom pages. Version 1
deliberately ships only what the portfolio needs.
