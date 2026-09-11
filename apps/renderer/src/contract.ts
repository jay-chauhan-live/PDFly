import { z } from 'zod';

/**
 * The renderer's entire input contract. Deliberately narrow: HTML in, PDF
 * out, no database and no knowledge of organizations, quotas or storage.
 * Keeping it this small is what makes it swappable for Browserless later
 * (PLAN §13.2).
 */
export const renderRequestSchema = z.object({
  html: z.string().min(1),

  format: z
    .enum(['Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'])
    .optional(),
  width: z.string().optional(),
  height: z.string().optional(),
  landscape: z.boolean().default(false),
  margin: z
    .object({
      top: z.string().optional(),
      right: z.string().optional(),
      bottom: z.string().optional(),
      left: z.string().optional(),
    })
    .optional(),
  printBackground: z.boolean().default(true),
  scale: z.number().min(0.1).max(2).default(1),
  headerTemplate: z.string().optional(),
  footerTemplate: z.string().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).default('load'),
  timeoutMs: z.number().int().min(1000).optional(),

  /**
   * JavaScript is off unless asked for (PLAN §11). Most documents are static
   * markup, and every script that does run is attacker-controlled code.
   */
  javascript: z.boolean().default(false),

  /**
   * Default is "inline and uploaded assets only" (PLAN §11) — safer and
   * faster. When enabled, `assetHostAllowlist` still bounds what may load.
   */
  allowExternalAssets: z.boolean().default(false),
  assetHostAllowlist: z.array(z.string()).default([]),
});

export type RenderRequest = z.infer<typeof renderRequestSchema>;

/** Stable error codes, mirrored by the api's problem+json responses (PLAN §6). */
export type RenderErrorCode = 'render_timeout' | 'invalid_html' | 'asset_blocked' | 'pool_timeout';

export class RenderError extends Error {
  constructor(
    readonly code: RenderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RenderError';
  }
}
