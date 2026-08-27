/**
 * Adds placeholder content so the site is complete the first time you open it.
 *
 *   npm run seed              add placeholder content if the site is empty
 *   npm run seed -- --force   wipe existing content and reseed
 */
import '../src/lib/env.js';
import { db, get } from '../src/db/index.js';
import { seed, hasContent } from '../src/db/seed.js';

const force = process.argv.includes('--force');
const confirmed = process.argv.includes('--yes');

// --force deletes projects, research, skills and education. Once the site is
// in real use, make that take a second, deliberate flag.
if (force && !confirmed && get('SELECT COUNT(*) AS n FROM users').n > 0) {
  console.error('Refusing to reseed: this site already has an admin account.');
  console.error('--force DELETES all projects, research, skills, education and content blocks.');
  console.error('Back up data/portfolio.db first, then re-run with:  npm run seed -- --force --yes');
  process.exit(1);
}

if (hasContent() && !force) {
  console.log('Content already exists. Run "npm run seed -- --force" to replace it.');
} else {
  await seed({ force });
  console.log('Seeded placeholder content.');
  console.log('Start the server with "npm start", then open /admin to replace it.');
}

db.close();
