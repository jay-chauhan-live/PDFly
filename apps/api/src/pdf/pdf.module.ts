import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { PdfController } from './pdf.controller.js';
import { RenderPipeline } from './render.pipeline.js';

@Module({
  // A replayed render answers from the document the first attempt produced.
  imports: [DocumentsModule],
  controllers: [PdfController],
  providers: [RenderPipeline],
  exports: [RenderPipeline],
})
export class PdfModule {}
