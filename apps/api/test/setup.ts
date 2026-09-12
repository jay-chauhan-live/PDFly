import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Integration specs talk to the real Postgres and Redis from docker compose.
 * The apps read the repo-root .env at boot (see AppModule), so the tests load
 * the same file rather than keeping a second copy of the connection strings
 * that could drift. Values already in the environment win, which is how CI
 * points the suite at its service containers.
 *
 * CI has no .env file, so it depends entirely on the environment — and turbo
 * only forwards variables it has been told about. `DATABASE_URL` and
 * `REDIS_URL` are declared on the `test` task in turbo.json for that reason;
 * without them these specs fail with a SASL error that looks nothing like the
 * missing configuration it actually is.
 */
config({ path: resolve(import.meta.dirname, '../../../.env') });
