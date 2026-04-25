import type { RedisOptions } from 'ioredis';

/**
 * BullMQ / ioredis connection options from REDIS_URL or localhost defaults.
 */
export function getRedisConnection(): RedisOptions {
  const urlStr = process.env.REDIS_URL;
  if (!urlStr) {
    return { host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT) || 6379 };
  }
  try {
    const u = new URL(urlStr);
    const port = u.port ? parseInt(u.port, 10) : 6379;
    const opts: RedisOptions = {
      host: u.hostname,
      port,
    };
    if (u.password) {
      opts.password = decodeURIComponent(u.password);
    }
    if (u.username && u.username !== 'default') {
      opts.username = decodeURIComponent(u.username);
    }
    if (u.pathname && u.pathname.length > 1) {
      const db = parseInt(u.pathname.slice(1), 10);
      if (!Number.isNaN(db)) {
        opts.db = db;
      }
    }
    return opts;
  } catch {
    return { host: '127.0.0.1', port: 6379 };
  }
}
