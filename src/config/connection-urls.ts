/**
 * Resolves Postgres + Redis connection settings from either a single URL
 * env var (Render, Heroku, Railway, Fly, etc.) OR discrete host/port/user
 * fields (local docker-compose, .env). URL form wins when present.
 */

export interface PostgresConnection {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
}

export interface RedisConnection {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db: number;
  tls: boolean;
}

function getEnv(key: string, fallback?: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}
function asNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

/**
 * Strict-by-default Postgres resolution.
 *
 * - When `DATABASE_URL` is set, every field is parsed from it. SSL is on by
 *   default (any managed provider requires it) unless DATABASE_SSL=false.
 * - Otherwise we fall back to DATABASE_HOST/PORT/USER/PASSWORD/NAME with
 *   sane local defaults so docker-compose still works.
 */
export function resolvePostgres(): PostgresConnection {
  const url = getEnv('DATABASE_URL');
  if (url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const isLocalhost = host === 'localhost' || host === '127.0.0.1';
      const username = decodeURIComponent(parsed.username || 'postgres');
      const password = decodeURIComponent(parsed.password || '');
      const database = parsed.pathname.replace(/^\//, '') || 'postgres';
      const sslMode = parsed.searchParams.get('sslmode');
      const sslExplicit = getEnv('DATABASE_SSL');
      const ssl =
        sslExplicit !== undefined
          ? asBool(sslExplicit, true)
          : sslMode === 'disable'
            ? false
            : !isLocalhost;
      return {
        host,
        port: parsed.port ? Number(parsed.port) : 5432,
        username,
        password,
        database,
        ssl,
      };
    } catch (err) {
      throw new Error(
        `Invalid DATABASE_URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return {
    host: getEnv('DATABASE_HOST', 'localhost')!,
    port: asNumber(getEnv('DATABASE_PORT'), 5432),
    username: getEnv('DATABASE_USER', 'postgres')!,
    password: getEnv('DATABASE_PASSWORD', 'postgres')!,
    database: getEnv('DATABASE_NAME', 'stack62')!,
    ssl: asBool(getEnv('DATABASE_SSL'), false),
  };
}

/**
 * Redis. Accepts redis:// (plain) and rediss:// (TLS). When REDIS_URL is set
 * everything is parsed from it; tls is on for rediss:// and off for redis://
 * unless REDIS_TLS overrides it.
 */
export function resolveRedis(): RedisConnection {
  const url = getEnv('REDIS_URL');
  if (url) {
    try {
      const parsed = new URL(url);
      const isSecure = parsed.protocol === 'rediss:';
      return {
        host: parsed.hostname || 'localhost',
        port: parsed.port ? Number(parsed.port) : 6379,
        username: parsed.username
          ? decodeURIComponent(parsed.username)
          : undefined,
        password: parsed.password
          ? decodeURIComponent(parsed.password)
          : undefined,
        db: asNumber(parsed.pathname.replace(/^\//, ''), 0),
        tls: asBool(getEnv('REDIS_TLS'), isSecure),
      };
    } catch (err) {
      throw new Error(
        `Invalid REDIS_URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return {
    host: getEnv('REDIS_HOST', 'localhost')!,
    port: asNumber(getEnv('REDIS_PORT'), 6379),
    password: getEnv('REDIS_PASSWORD'),
    db: asNumber(getEnv('REDIS_DB'), 0),
    tls: asBool(getEnv('REDIS_TLS'), false),
  };
}

