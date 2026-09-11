/**
 * Development seed. Creates the organization that the Phase 1 static API key
 * resolves to (see src/auth/dev-key.guard.ts). Phase 2 replaces this with
 * real registration.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadEnv();
loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: 'development' },
    update: {},
    create: { name: 'Development', slug: 'development', plan: 'free' },
  });

  console.log(`development organization ready: ${org.id}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
