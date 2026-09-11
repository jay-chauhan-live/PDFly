import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProblemError, type ProblemCode } from '../common/errors/problem.js';
import type { Env } from '../config/env.schema.js';

export interface RendererRequest {
  html: string;
  format?: string;
  width?: string;
  height?: string;
  landscape?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  printBackground?: boolean;
  scale?: number;
  headerTemplate?: string;
  footerTemplate?: string;
  waitUntil?: string;
  timeoutMs?: number;
  javascript?: boolean;
  allowExternalAssets?: boolean;
  assetHostAllowlist?: string[];
}

export interface RendererResponse {
  pdf: Buffer;
  renderDurationMs: number;
  blockedAssets: number;
}

/** Maps the renderer's error codes onto the api's problem codes (PLAN §6). */
const CODE_MAP: Record<string, { code: ProblemCode; status: number }> = {
  render_timeout: { code: 'render_timeout', status: 504 },
  invalid_html: { code: 'invalid_html', status: 422 },
  asset_blocked: { code: 'asset_blocked', status: 422 },
  pool_timeout: { code: 'renderer_unavailable', status: 503 },
  invalid_request: { code: 'invalid_request', status: 400 },
};

/**
 * The api's only route to Chromium. Narrow on purpose: swapping the
 * self-hosted pool for Browserless (PLAN §13.2) should mean reimplementing
 * this class and nothing else.
 */
@Injectable()
export class RendererClient {
  private readonly logger = new Logger(RendererClient.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('RENDERER_URL', { infer: true });
  }

  async render(request: RendererRequest): Promise<RendererResponse> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
    } catch (error) {
      this.logger.error({ err: error }, 'renderer unreachable');
      throw new ProblemError('renderer_unavailable', 503, 'The rendering service is unavailable');
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
      };
      const mapped = CODE_MAP[body.code ?? ''] ?? {
        code: 'internal_error' as ProblemCode,
        status: 500,
      };

      throw new ProblemError(mapped.code, mapped.status, body.message ?? 'Rendering failed');
    }

    const pdf = Buffer.from(await response.arrayBuffer());

    return {
      pdf,
      renderDurationMs: Number(response.headers.get('x-render-duration-ms') ?? 0),
      blockedAssets: Number(response.headers.get('x-blocked-assets') ?? 0),
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
