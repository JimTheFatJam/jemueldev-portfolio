import { all, get, run } from './index.js';
import { resolveLegacyIcon } from '../lib/icons.js';

/**
 * Small forward-only migrations for changes that schema.sql cannot express,
 * because they rewrite existing rows. Each runs at most once; the list of
 * applied ids lives in the settings table.
 */
/** True when a table already has a column — schema.sql only creates tables. */
function hasColumn(table, column) {
  return all(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

const MIGRATIONS = [
  {
    id: 'research-keywords',
    describe: 'Add the research keywords column to databases created before it',
    run() {
      // Fresh databases already have it from schema.sql; this is for existing ones.
      if (hasColumn('research', 'keywords')) return;
      run("ALTER TABLE research ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]'");
      console.log('[portfolio] Added keywords to research. Existing entries keep an empty list.');
    }
  },
  {
    id: 'project-tech-logos',
    describe: 'Give each project technology a devicon logo where one matches',
    run() {
      const rows = all('SELECT id, tech FROM projects');
      let matched = 0;
      let converted = 0;

      for (const row of rows) {
        let parsed;
        try {
          parsed = JSON.parse(row.tech || '[]');
        } catch {
          continue;
        }
        if (!Array.isArray(parsed) || parsed.length === 0) continue;
        // Already migrated rows hold objects, not strings.
        if (!parsed.some((entry) => typeof entry === 'string')) continue;

        const upgraded = parsed.map((entry) => {
          if (typeof entry !== 'string') return entry;
          const icon = resolveLegacyIcon(entry);
          if (icon) matched += 1;
          return { name: entry.trim(), icon };
        });

        run('UPDATE projects SET tech = ? WHERE id = ?', JSON.stringify(upgraded), row.id);
        converted += 1;
      }

      if (converted) {
        console.log(
          `[portfolio] Project technologies upgraded: ${converted} project(s), ` +
            `${matched} matched a devicon logo automatically. Pick the rest in Admin → Projects.`
        );
      }
    }
  },
  {
    id: 'skill-icons-devicon',
    describe: 'Map free-text skill icons onto devicon names',
    run() {
      const rows = all("SELECT id, icon FROM skills WHERE icon != ''");
      let mapped = 0;
      let cleared = 0;
      for (const row of rows) {
        const resolved = resolveLegacyIcon(row.icon);
        if (resolved === row.icon) continue;
        run('UPDATE skills SET icon = ? WHERE id = ?', resolved, row.id);
        if (resolved) mapped += 1;
        else cleared += 1;
      }
      if (mapped || cleared) {
        console.log(
          `[portfolio] Skill icons migrated: ${mapped} matched a devicon logo, ` +
            `${cleared} could not be matched and were cleared (pick them again in Admin, Skills).`
        );
      }
    }
  }
];

function applied() {
  const row = get("SELECT value FROM settings WHERE key = '_migrations'");
  if (!row) return new Set();
  try {
    const parsed = JSON.parse(row.value);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function runMigrations() {
  const done = applied();
  let changed = false;

  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    migration.run();
    done.add(migration.id);
    changed = true;
  }

  if (changed) {
    run(
      `INSERT INTO settings (key, value) VALUES ('_migrations', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify([...done])
    );
  }
}
