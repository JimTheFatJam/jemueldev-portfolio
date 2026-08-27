/**
 * Create the admin account, or reset its password, from the command line.
 * Useful if you are locked out — the browser flow at /admin/setup covers the
 * normal first run.
 *
 *   npm run create-admin -- <username> <password>
 */
import '../src/lib/env.js';
import { db } from '../src/db/index.js';
import { countUsers, createUser, findUserByUsername, updatePassword, destroyAllSessions } from '../src/lib/auth.js';

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: npm run create-admin -- <username> <password>');
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
  console.error('Username must be 3–40 characters: letters, numbers, dot, dash or underscore.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(1);
}

const existing = findUserByUsername(username);
if (existing) {
  updatePassword(existing.id, password);
  destroyAllSessions(existing.id);
  console.log(`Password updated for "${username}". All existing sessions were signed out.`);
} else if (countUsers() > 0) {
  console.error('An admin account already exists. Pass its username to reset that password instead.');
  process.exit(1);
} else {
  createUser(username, password);
  console.log(`Created admin account "${username}".`);
}

db.close();
