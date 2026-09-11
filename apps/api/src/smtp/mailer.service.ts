import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { SmtpService } from './smtp.service.js';
import type { Env } from '../config/env.schema.js';

export interface Message {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends on behalf of an organization, through whichever transport that
 * organization has (PLAN §7).
 *
 * Every send is best-effort. Mail is a notification about something that
 * already happened; a broken SMTP host must not turn a completed render into
 * a failed one, or a successful registration into a 500.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly webUrl: string;

  constructor(
    private readonly smtp: SmtpService,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('WEB_URL', { infer: true });
  }

  async send(orgId: string, message: Message): Promise<boolean> {
    try {
      const transport = await this.smtp.transportForOrg(orgId);

      if (!transport) {
        this.logger.warn(
          `no SMTP configuration for org ${orgId} and no system fallback; dropped "${message.subject}"`,
        );
        return false;
      }

      await transport.transport.sendMail({ from: transport.from, ...message });

      this.logger.log(`sent "${message.subject}" for org ${orgId}`);
      return true;
    } catch (error) {
      this.logger.error({ err: error }, `could not send "${message.subject}" for org ${orgId}`);
      return false;
    }
  }

  /**
   * Tells an organization's owners that a render failed (PLAN §7).
   *
   * Addressed to owners and admins rather than to whoever triggered it: an
   * API token has no person behind it, and a failing integration is exactly
   * the case where nobody is watching.
   */
  async renderFailed(
    orgId: string,
    document: {
      id: string;
      title: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    },
  ): Promise<void> {
    const recipients = await this.prisma.user.findMany({
      where: { orgId, role: { in: ['owner', 'admin'] } },
      select: { email: true },
    });

    if (recipients.length === 0) return;

    const name = document.title ?? document.id;
    const link = `${this.webUrl}/documents/${document.id}`;

    await this.send(orgId, {
      to: recipients.map((user) => user.email).join(', '),
      subject: `Render failed: ${name}`,
      text: [
        `A render failed in PDFly.`,
        ``,
        `Document: ${name}`,
        `Error:    ${document.errorCode ?? 'unknown'}`,
        `Detail:   ${document.errorMessage ?? 'none'}`,
        ``,
        link,
      ].join('\n'),
    });
  }
}
