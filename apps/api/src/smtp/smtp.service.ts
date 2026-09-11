import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { CryptoService } from '../common/crypto.service.js';
import { ProblemError } from '../common/errors/problem.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Env } from '../config/env.schema.js';
import type { CreateSmtpConfigDto, UpdateSmtpConfigDto } from './dto/smtp.dto.js';

/** What a stored password looks like once it leaves the database. */
const MASK = '••••••••';

const SUMMARY_SELECT = {
  id: true,
  name: true,
  host: true,
  port: true,
  secure: true,
  username: true,
  fromEmail: true,
  fromName: true,
  isDefault: true,
  verifiedAt: true,
  createdAt: true,
  // Selected only so the response can say whether one is set — never its value.
  passwordEncrypted: true,
} as const;

export interface SmtpConfigSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  fromEmail: string;
  fromName: string | null;
  isDefault: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  /** A placeholder when a password is stored, null when none is (PLAN §4). */
  password: string | null;
}

@Injectable()
export class SmtpService {
  private readonly logger = new Logger(SmtpService.name);

  /**
   * Transports are cached by config id (PLAN §7). Nodemailer pools
   * connections, and rebuilding one per message means a fresh TCP handshake
   * and TLS negotiation for every email. Invalidated on update and delete, so
   * a changed password takes effect immediately rather than on restart.
   */
  private readonly transports = new Map<string, Transporter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(orgId: string): Promise<SmtpConfigSummary[]> {
    const rows = await this.prisma.smtpConfig.findMany({
      where: { orgId },
      select: SUMMARY_SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map(toSummary);
  }

  async create(orgId: string, dto: CreateSmtpConfigDto): Promise<SmtpConfigSummary> {
    const created = await this.prisma.$transaction(async (tx) => {
      // The partial unique index refuses a second default outright, so the
      // old one is cleared first rather than letting the write fail.
      if (dto.isDefault) {
        await tx.smtpConfig.updateMany({
          where: { orgId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const count = await tx.smtpConfig.count({ where: { orgId } });

      return tx.smtpConfig.create({
        data: {
          orgId,
          name: dto.name.trim(),
          host: dto.host.trim(),
          port: dto.port,
          secure: dto.secure ?? dto.port === 465,
          username: dto.username ?? null,
          passwordEncrypted: dto.password ? this.crypto.encrypt(dto.password) : null,
          fromEmail: dto.fromEmail.trim(),
          fromName: dto.fromName ?? null,
          // The first config an organization adds is its default, whether or
          // not they thought to say so.
          isDefault: dto.isDefault ?? count === 0,
        },
        select: SUMMARY_SELECT,
      });
    });

    this.logger.log(`created SMTP config ${created.id} for org ${orgId}`);

    return toSummary(created);
  }

  async update(orgId: string, id: string, dto: UpdateSmtpConfigDto): Promise<SmtpConfigSummary> {
    await this.require(orgId, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.smtpConfig.updateMany({
          where: { orgId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      return tx.smtpConfig.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.host !== undefined ? { host: dto.host.trim() } : {}),
          ...(dto.port !== undefined ? { port: dto.port } : {}),
          ...(dto.secure !== undefined ? { secure: dto.secure } : {}),
          ...(dto.username !== undefined ? { username: dto.username } : {}),
          // Absent means "leave it alone". A UI that cannot read the password
          // back must be able to save the rest of the form without it.
          ...(dto.password !== undefined
            ? { passwordEncrypted: dto.password ? this.crypto.encrypt(dto.password) : null }
            : {}),
          ...(dto.fromEmail !== undefined ? { fromEmail: dto.fromEmail.trim() } : {}),
          ...(dto.fromName !== undefined ? { fromName: dto.fromName } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          // Any change invalidates the last successful test.
          verifiedAt: null,
        },
        select: SUMMARY_SELECT,
      });
    });

    this.transports.delete(id);

    return toSummary(updated);
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.require(orgId, id);

    await this.prisma.smtpConfig.delete({ where: { id } });
    this.transports.delete(id);

    this.logger.log(`deleted SMTP config ${id}`);
  }

  /**
   * Verifies the transport, and optionally sends a real message.
   *
   * `transporter.verify()` connects and authenticates without delivering
   * anything, which catches the common mistakes — wrong port, wrong password,
   * TLS mismatch — before a customer discovers them through an email that
   * never arrived.
   */
  async test(
    orgId: string,
    id: string,
    to?: string,
  ): Promise<{ verified: boolean; sent: boolean }> {
    const config = await this.require(orgId, id);
    const transport = await this.transportFor(config.id);

    try {
      await transport.verify();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      throw new ProblemError('invalid_request', 400, `SMTP check failed: ${message}`);
    }

    let sent = false;

    if (to) {
      await transport.sendMail({
        from: formatFrom(config.fromName, config.fromEmail),
        to,
        subject: 'PDFly SMTP test',
        text: `This is a test message from PDFly, sent through "${config.name}".`,
      });
      sent = true;
    }

    await this.prisma.smtpConfig.update({ where: { id }, data: { verifiedAt: new Date() } });

    return { verified: true, sent };
  }

  /**
   * The transport an organization's mail should go out on: its default
   * config, or the environment fallback.
   *
   * PLAN §7 is explicit about why the fallback exists — without it a fresh
   * signup cannot verify their own email, because they have no SMTP config
   * yet and no way to get one without signing in.
   */
  async transportForOrg(orgId: string): Promise<{ transport: Transporter; from: string } | null> {
    const config = await this.prisma.smtpConfig.findFirst({
      where: { orgId, isDefault: true },
      select: { id: true, fromEmail: true, fromName: true },
    });

    if (config) {
      return {
        transport: await this.transportFor(config.id),
        from: formatFrom(config.fromName, config.fromEmail),
      };
    }

    return this.systemTransport();
  }

  /** Invalidates every cached transport. For tests and for a config reload. */
  clearCache(): void {
    for (const transport of this.transports.values()) transport.close();
    this.transports.clear();
  }

  private async transportFor(id: string): Promise<Transporter> {
    const cached = this.transports.get(id);
    if (cached) return cached;

    const config = await this.prisma.smtpConfig.findUniqueOrThrow({
      where: { id },
      select: { host: true, port: true, secure: true, username: true, passwordEncrypted: true },
    });

    const transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.username
        ? {
            auth: {
              user: config.username,
              pass: config.passwordEncrypted
                ? this.crypto.decrypt(config.passwordEncrypted)
                : undefined,
            },
          }
        : {}),
      pool: true,
      maxConnections: 3,
    });

    this.transports.set(id, transport);
    return transport;
  }

  private systemTransport(): { transport: Transporter; from: string } | null {
    const host = this.config.get('SMTP_HOST', { infer: true });
    const from = this.config.get('SMTP_FROM', { infer: true });

    if (!host || !from) return null;

    const user = this.config.get('SMTP_USERNAME', { infer: true });
    const password = this.config.get('SMTP_PASSWORD', { infer: true });
    const port = this.config.get('SMTP_PORT', { infer: true });

    const cached = this.transports.get('system');
    if (cached) return { transport: cached, from };

    const transport = createTransport({
      host,
      port,
      secure: port === 465,
      ...(user ? { auth: { user, pass: password } } : {}),
      pool: true,
    });

    this.transports.set('system', transport);

    return { transport, from };
  }

  private async require(orgId: string, id: string) {
    const config = await this.prisma.smtpConfig.findFirst({
      where: { id, orgId },
      select: { id: true, name: true, fromEmail: true, fromName: true },
    });

    if (!config) throw new ProblemError('not_found', 404, 'No such SMTP configuration');

    return config;
  }
}

function toSummary(row: {
  passwordEncrypted: string | null;
  [key: string]: unknown;
}): SmtpConfigSummary {
  const { passwordEncrypted, ...rest } = row;

  // The ciphertext never leaves this function. A masked placeholder tells the
  // UI a password is set without being one.
  return { ...rest, password: passwordEncrypted ? MASK : null } as SmtpConfigSummary;
}

function formatFrom(name: string | null, email: string): string {
  return name ? `"${name.replace(/"/g, '')}" <${email}>` : email;
}
