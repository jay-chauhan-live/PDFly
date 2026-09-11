// Prisma 7 CLI configuration. The connection URL lives here rather than in
// schema.prisma; at runtime the client gets it from the pg driver adapter
// (see src/prisma/prisma.service.ts).
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// The repo-root .env is the single source of truth in development, so api and
// web cannot drift apart. A package-local .env (CI, container images) still
// wins, because dotenv never overwrites what is already in process.env.
loadEnv();
loadEnv({ path: resolve(import.meta.dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
