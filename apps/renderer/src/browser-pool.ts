import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Browser, type BrowserServer } from 'playwright';
import { RenderError } from './contract.js';
import type { RendererConfig } from './config.js';

const execFileAsync = promisify(execFile);

/**
 * Chromium launch flags. Note what is absent: `--no-sandbox`. PLAN §11 is
 * explicit that the container must be given the privileges Chromium's own
 * sandbox needs rather than disabling it, since this process renders
 * attacker-controlled markup.
 */
const LAUNCH_ARGS = [
  // Chromium's default /dev/shm is often too small in containers, and the
  // crash it causes looks like a random hang.
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--mute-audio',
];

interface Slot {
  server: BrowserServer;
  browser: Browser;
  jobCount: number;
  /** Set while a job holds this slot. */
  busy: boolean;
}

/** Resident set size of a process, in bytes. Returns null if it cannot be read. */
async function rssBytes(pid: number | undefined): Promise<number | null> {
  if (pid === undefined) return null;

  try {
    // `ps` reports RSS in kilobytes on both Linux and macOS.
    const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
    const kb = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

/**
 * A fixed-size pool of Chromium processes.
 *
 * One browser *context* per job, not one browser — launching a browser per
 * job is far too slow (PLAN §3.2). Each process is retired once it has done
 * enough jobs or grown past the RSS ceiling, because Chromium leaks steadily
 * under repeated PDF rendering.
 */
export class BrowserPool {
  private readonly slots: Slot[] = [];
  private readonly waiters: Array<(slot: Slot) => void> = [];
  private draining = false;

  constructor(private readonly config: RendererConfig) {}

  async start(): Promise<void> {
    for (let i = 0; i < this.config.POOL_SIZE; i += 1) {
      this.slots.push({ ...(await this.launch()), jobCount: 0, busy: false });
    }
  }

  /**
   * Launched as a server rather than in-process so the pool keeps a handle on
   * the actual OS process. As of Playwright 1.63 `Browser` no longer exposes
   * `process()`, and without a pid the RSS ceiling in PLAN §10 cannot be
   * enforced.
   */
  private async launch(): Promise<{ server: BrowserServer; browser: Browser }> {
    const server = await chromium.launchServer({ args: LAUNCH_ARGS });
    const browser = await chromium.connect(server.wsEndpoint());
    return { server, browser };
  }

  /**
   * Runs `fn` against a fresh context on a pooled browser. Saturation waits
   * rather than failing (PLAN §10) up to POOL_ACQUIRE_TIMEOUT_MS.
   */
  async withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
    const slot = await this.acquire();

    try {
      return await fn(slot.browser);
    } finally {
      slot.jobCount += 1;
      await this.release(slot);
    }
  }

  private acquire(): Promise<Slot> {
    const free = this.slots.find((s) => !s.busy);

    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }

    return new Promise<Slot>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(
          new RenderError(
            'pool_timeout',
            `No renderer capacity within ${this.config.POOL_ACQUIRE_TIMEOUT_MS}ms`,
          ),
        );
      }, this.config.POOL_ACQUIRE_TIMEOUT_MS);

      const waiter = (slot: Slot): void => {
        clearTimeout(timer);
        resolve(slot);
      };

      this.waiters.push(waiter);
    });
  }

  private async release(slot: Slot): Promise<void> {
    if (await this.shouldRecycle(slot)) {
      await this.recycle(slot);
    }

    if (this.draining) {
      slot.busy = false;
      return;
    }

    const next = this.waiters.shift();

    if (next) {
      // Stays busy; ownership passes straight to the waiting job.
      next(slot);
      return;
    }

    slot.busy = false;
  }

  private async shouldRecycle(slot: Slot): Promise<boolean> {
    if (slot.jobCount >= this.config.POOL_MAX_JOBS_PER_BROWSER) return true;
    if (!slot.browser.isConnected()) return true;

    const rss = await rssBytes(slot.server.process().pid);
    return rss !== null && rss >= this.config.POOL_MAX_RSS_BYTES;
  }

  private async recycle(slot: Slot): Promise<void> {
    const previous = { server: slot.server, browser: slot.browser };
    const replacement = await this.launch();

    slot.server = replacement.server;
    slot.browser = replacement.browser;
    slot.jobCount = 0;

    await previous.browser.close().catch(() => undefined);
    await previous.server.close().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.draining = true;

    await Promise.all(
      this.slots.map(async (slot) => {
        await slot.browser.close().catch(() => undefined);
        await slot.server.close().catch(() => undefined);
      }),
    );

    this.slots.length = 0;
  }

  stats(): { size: number; busy: number; waiting: number } {
    return {
      size: this.slots.length,
      busy: this.slots.filter((s) => s.busy).length,
      waiting: this.waiters.length,
    };
  }
}
