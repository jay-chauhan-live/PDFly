import { BrowserPool } from './browser-pool.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new BrowserPool(config);

  await pool.start();

  const app = buildServer(config, pool);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await pool.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.RENDERER_PORT, host: config.RENDERER_HOST });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
