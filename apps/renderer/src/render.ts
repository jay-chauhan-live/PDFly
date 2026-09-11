import type { Browser } from 'playwright';
import { RenderError, type RenderRequest } from './contract.js';
import type { RendererConfig } from './config.js';

/**
 * Schemes Chromium must never be allowed to fetch (PLAN §11).
 *
 * Note that `file://` subresources never reach this router at all: Playwright
 * does not intercept them, and Chromium already refuses to load them from a
 * `setContent` origin (verified — an image that renders from a data: URI does
 * not render from file://). The entry below is defence in depth, not the
 * control that stops it. The controls that genuinely matter for egress — an
 * isolated network, a proxy denying private CIDRs, and a read-only root
 * filesystem — are container-level and land in Phase 7.
 */
const BLOCKED_SCHEMES = ['file:', 'chrome:', 'chrome-extension:', 'devtools:', 'view-source:'];

/** Inline content carries no network risk. */
const INLINE_SCHEMES = ['data:', 'blob:', 'about:'];

function isBlockedScheme(url: string): boolean {
  const lower = url.toLowerCase();
  return BLOCKED_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

function hostAllowed(url: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;

  try {
    const { hostname } = new URL(url);
    return allowlist.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

function resolveTimeout(request: RenderRequest, config: RendererConfig): number {
  const requested = request.timeoutMs ?? config.RENDER_TIMEOUT_MS_DEFAULT;
  return Math.min(requested, config.RENDER_TIMEOUT_MS_MAX);
}

export interface RenderResult {
  pdf: Buffer;
  durationMs: number;
  /** Assets the policy refused, useful for explaining a blank-looking PDF. */
  blockedAssets: string[];
}

export async function renderPdf(
  browser: Browser,
  request: RenderRequest,
  config: RendererConfig,
): Promise<RenderResult> {
  const startedAt = Date.now();
  const timeoutMs = resolveTimeout(request, config);
  const blockedAssets: string[] = [];

  // A fresh context per job: no cookies, storage or cache shared between
  // tenants (PLAN §3.2).
  const context = await browser.newContext({
    javaScriptEnabled: request.javascript,
    // Never inherit a proxy or credentials from the host environment.
    ignoreHTTPSErrors: false,
  });

  try {
    context.setDefaultTimeout(timeoutMs);
    context.setDefaultNavigationTimeout(timeoutMs);

    await context.route('**/*', async (route) => {
      const url = route.request().url();

      if (isBlockedScheme(url)) {
        blockedAssets.push(url);
        await route.abort('blockedbyclient');
        return;
      }

      if (INLINE_SCHEMES.some((scheme) => url.toLowerCase().startsWith(scheme))) {
        await route.continue();
        return;
      }

      const isHttp = url.startsWith('http://') || url.startsWith('https://');

      if (!isHttp) {
        // Unknown or custom scheme — refuse by default.
        blockedAssets.push(url);
        await route.abort('blockedbyclient');
        return;
      }

      if (!request.allowExternalAssets) {
        blockedAssets.push(url);
        await route.abort('blockedbyclient');
        return;
      }

      if (!hostAllowed(url, request.assetHostAllowlist)) {
        blockedAssets.push(url);
        await route.abort('blockedbyclient');
        return;
      }

      await route.continue();
    });

    const page = await context.newPage();

    try {
      await page.setContent(request.html, {
        waitUntil: request.waitUntil,
        timeout: timeoutMs,
      });

      const displayHeaderFooter = Boolean(request.headerTemplate ?? request.footerTemplate);

      const pdf = await page.pdf({
        ...(request.format ? { format: request.format } : {}),
        ...(request.width ? { width: request.width } : {}),
        ...(request.height ? { height: request.height } : {}),
        landscape: request.landscape,
        printBackground: request.printBackground,
        scale: request.scale,
        ...(request.margin ? { margin: request.margin } : {}),
        displayHeaderFooter,
        ...(displayHeaderFooter
          ? {
              headerTemplate: request.headerTemplate ?? '<span></span>',
              footerTemplate: request.footerTemplate ?? '<span></span>',
            }
          : {}),
      });

      return { pdf, durationMs: Date.now() - startedAt, blockedAssets };
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/timeout/i.test(message)) {
      throw new RenderError('render_timeout', `Rendering exceeded ${timeoutMs}ms`);
    }

    throw new RenderError('invalid_html', message);
  } finally {
    await context.close().catch(() => undefined);
  }
}
