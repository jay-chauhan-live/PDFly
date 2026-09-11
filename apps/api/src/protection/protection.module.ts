import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service.js';
import { WatermarkService } from './watermark.service.js';

// Global: the health check reports qpdf availability, and the render pipeline
// needs both services.
@Global()
@Module({
  providers: [WatermarkService, EncryptionService],
  exports: [WatermarkService, EncryptionService],
})
export class ProtectionModule {}
