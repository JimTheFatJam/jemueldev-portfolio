-- Portfolio CMS schema. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- sha256(token), never the token itself
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id  INTEGER PRIMARY KEY,
  ip  TEXT NOT NULL,
  at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                    -- JSON
);

CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY,
  filename      TEXT NOT NULL UNIQUE,    -- stored file name inside uploads dir
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  alt           TEXT NOT NULL DEFAULT '',
  variants      TEXT NOT NULL DEFAULT '[]', -- JSON [{w,file,size}]
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id               INTEGER PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',   -- markdown
  tech             TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  thumbnail_id     INTEGER REFERENCES media(id) ON DELETE SET NULL,
  gallery          TEXT NOT NULL DEFAULT '[]', -- JSON media id[]
  year             TEXT NOT NULL DEFAULT '',
  github_url       TEXT NOT NULL DEFAULT '',
  demo_url         TEXT NOT NULL DEFAULT '',
  featured         INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'draft',
  has_detail_page  INTEGER NOT NULL DEFAULT 1,
  meta_description TEXT NOT NULL DEFAULT '',
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_order ON projects(position, id);

CREATE TABLE IF NOT EXISTS skill_categories (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  visible  INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS skills (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES skill_categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category_id, position);

CREATE TABLE IF NOT EXISTS education (
  id          INTEGER PRIMARY KEY,
  degree      TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  date_range  TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',   -- markdown
  logo_id     INTEGER REFERENCES media(id) ON DELETE SET NULL,
  visible     INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS research (
  id               INTEGER PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  abstract         TEXT NOT NULL DEFAULT '',   -- markdown
  authors          TEXT NOT NULL DEFAULT '',
  institution      TEXT NOT NULL DEFAULT '',
  date             TEXT NOT NULL DEFAULT '',
  work_status      TEXT NOT NULL DEFAULT '',   -- e.g. "In progress"
  paper_url        TEXT NOT NULL DEFAULT '',
  github_url       TEXT NOT NULL DEFAULT '',
  links            TEXT NOT NULL DEFAULT '[]', -- JSON [{label,url}]
  keywords         TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  thumbnail_id     INTEGER REFERENCES media(id) ON DELETE SET NULL,
  gallery          TEXT NOT NULL DEFAULT '[]',
  featured         INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'draft',
  has_detail_page  INTEGER NOT NULL DEFAULT 1,
  meta_description TEXT NOT NULL DEFAULT '',
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id               INTEGER PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  meta_description TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft',
  show_in_nav      INTEGER NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- Structured content blocks, attached to any owner type.
CREATE TABLE IF NOT EXISTS blocks (
  id         INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL,              -- project | research | page | about
  owner_id   INTEGER NOT NULL,
  type       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}', -- JSON
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_blocks_owner ON blocks(owner_type, owner_id, position);
