import { Global, Module } from '@nestjs/common';
import { RendererClient } from './renderer.client.js';

@Global()
@Module({
  providers: [RendererClient],
  exports: [RendererClient],
})
export class RendererModule {}
