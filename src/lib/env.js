/**
 * Loads .env into process.env if the file exists, quietly.
 *
 * This must be imported before anything that reads process.env — ES module
 * imports are evaluated in order, so it goes first in every entry point.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    console.warn('[portfolio] Could not read .env:', err.message);
  }
}
