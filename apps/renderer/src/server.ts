import Fastify, { type FastifyInstance } from 'fastify';
import { type BrowserPool } from './browser-pool.js';
import { renderRequestSchema, RenderError } from './contract.js';
import { renderPdf } from './render.js';
import type { RendererConfig } from './config.js';

export function buildServer(config: RendererConfig, pool: BrowserPool): FastifyInstance {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // PLAN §6 caps markup at 5 MB; the renderer accepts a little more so the
    // api is the component that returns the 413.
    bodyLimit: 8 * 1024 * 1024,
  });

  app.get('/health', async () => ({ status: 'ok', pool: pool.stats() }));

  app.post('/render', async (request, reply) => {
    const parsed = renderRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        code: 'invalid_request',
        message: 'Invalid render request',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    try {
      const result = await pool.withBrowser((browser) => renderPdf(browser, parsed.data, config));

      return reply
        .status(200)
        .header('content-type', 'application/pdf')
        .header('x-render-duration-ms', String(result.durationMs))
        .header('x-blocked-assets', String(result.blockedAssets.length))
        .send(result.pdf);
    } catch (error) {
      if (error instanceof RenderError) {
        // Saturation is the caller's cue to back off, not a permanent failure.
        const status = error.code === 'pool_timeout' ? 503 : 422;

        if (status === 503) reply.header('retry-after', '5');

        return reply.status(status).send({ code: error.code, message: error.message });
      }

      request.log.error({ err: error }, 'unexpected render failure');
      return reply.status(500).send({ code: 'internal_error', message: 'Render failed' });
    }
  });

  return app;
}
