import { Global, Module } from '@nestjs/common';
import { SmtpController } from './smtp.controller.js';
import { MailerService } from './mailer.service.js';
import { SmtpService } from './smtp.service.js';

// Global so the mailer can reach it from anywhere that needs to send.
@Global()
@Module({
  controllers: [SmtpController],
  providers: [SmtpService, MailerService],
  exports: [SmtpService, MailerService],
})
export class SmtpModule {}
