/**
 * Bootstraps the first account.
 *
 * A fresh deployment has an empty database and no way in: registration
 * exists, but the first person still has to become an owner somehow. This
 * creates one organization and one owner user from the environment, so the
 * deploy pipeline can run it unattended.
 *
 * Idempotent by design — it runs on every deploy. An existing user is left
 * exactly as it is, password included, because a redeploy must never silently
 * reset credentials someone is already using.
 *
 * It lives under `src/` rather than `prisma/` so it is compiled into `dist/`
 * and can run in the production image, which has no TypeScript loader.
 *
 *   SEED_ADMIN_EMAIL=you@example.com \
 *   SEED_ADMIN_PASSWORD='a long passphrase' \
 *   node dist/cli/seed-admin.js
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client.js';
import { PasswordService } from '../auth/password.service.js';

/** Matches RegisterDto, so a seeded password is one the sign-in form accepts. */
const PASSWORD_MIN = 12;

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org'
  );
}

export async function seedAdmin(prisma: PrismaClient): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@pdfly.local').trim().toLowerCase();
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Administrator';
  const orgName = process.env.SEED_ADMIN_ORG?.trim() || 'PDFly';

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    console.log(`admin already exists: ${email} (${existing.id}) — left untouched`);
    return;
  }

  // A generated password is printed once. Better than a default everyone
  // knows, and better than refusing to seed at all on a first deploy.
  const generated = !process.env.SEED_ADMIN_PASSWORD;
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');

  if (password.length < PASSWORD_MIN) {
    throw new Error(
      `SEED_ADMIN_PASSWORD must be at least ${PASSWORD_MIN} characters, to match what the sign-in form accepts`,
    );
  }

  // The same hasher the login path verifies against, rather than a second
  // copy of the argon2 parameters that could drift out of step.
  const passwordHash = await new PasswordService().hash(password);

  // Organization and owner together: a user with no org has nothing to own,
  // and an org with no owner is unreachable.
  const created = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: orgName, slug: await uniqueSlug(tx, slugify(orgName)) },
      select: { id: true, name: true },
    });

    const user = await tx.user.create({
      data: { orgId: org.id, email, passwordHash, name, role: 'owner' },
      select: { id: true, email: true },
    });

    await tx.auditLogEntry.create({
      data: { orgId: org.id, actorId: user.id, action: 'user.seeded', target: user.id },
    });

    return { ...user, orgName: org.name, orgId: org.id };
  });

  console.log(`\ncreated organization "${created.orgName}" (${created.orgId})`);
  console.log(`created owner ${created.email} (${created.id})\n`);

  if (generated) {
    console.log('  Generated password — copy it now, it is not stored anywhere:\n');
    console.log(`    ${password}\n`);
    console.log('  Set SEED_ADMIN_PASSWORD to choose your own next time.\n');
  } else {
    console.log('  Sign in with the password from SEED_ADMIN_PASSWORD.\n');
  }
}

async function uniqueSlug(tx: Pick<PrismaClient, 'organization'>, base: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await tx.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!taken) return candidate;
  }

  return `${base}-${Date.now().toString(36)}`;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

seedAdmin(prisma)
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
