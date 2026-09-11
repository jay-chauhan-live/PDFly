/**
 * Development seed.
 *
 * Creates a `development` organization and mints one API token for it, which
 * is printed once and never recoverable — exactly like a token minted from
 * the dashboard, because it is the same code path. Re-running the seed mints
 * a fresh token and revokes the previous one, so the printout is always the
 * credential that actually works.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { mintToken } from '../src/tokens/token.format.js';
import { ALL_SCOPES } from '../src/tokens/scopes.js';

loadEnv();
loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SEED_TOKEN_NAME = 'Development seed';

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: 'development' },
    update: {},
    create: { name: 'Development', slug: 'development', plan: 'free' },
  });

  await prisma.apiToken.updateMany({
    where: { orgId: org.id, name: SEED_TOKEN_NAME, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const minted = mintToken();

  await prisma.apiToken.create({
    data: {
      orgId: org.id,
      name: SEED_TOKEN_NAME,
      prefix: minted.prefix,
      tokenHash: minted.hash,
      scopes: ALL_SCOPES,
    },
  });

  console.log(`development organization ready: ${org.id}`);
  console.log('\nAPI token (shown once — copy it now):\n');
  console.log(`  ${minted.token}\n`);
  console.log('Use it as:  Authorization: Bearer <token>');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
