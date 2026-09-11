import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Integration specs talk to the real Postgres and Redis from docker compose.
 * The apps read the repo-root .env at boot (see AppModule), so the tests load
 * the same file rather than keeping a second copy of the connection strings
 * that could drift. Values already in the environment win, which is how CI
 * points the suite at its service containers.
 */
config({ path: resolve(import.meta.dirname, '../../../.env') });
