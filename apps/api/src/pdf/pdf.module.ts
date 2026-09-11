import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller.js';
import { RenderPipeline } from './render.pipeline.js';

@Module({
  controllers: [PdfController],
  providers: [RenderPipeline],
  exports: [RenderPipeline],
})
export class PdfModule {}
