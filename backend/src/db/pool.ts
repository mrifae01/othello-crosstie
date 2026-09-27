import { readFileSync } from 'node:fs';
import pg from 'pg';
import { DATABASE_CA_CERT, DATABASE_URL } from '../config';

/**
 * TLS for hosted Postgres (Supabase). With a CA the server certificate is fully verified.
 * `DATABASE_CA_CERT` is the PEM itself (literal `\n`s allowed, for single-line env vars) or a path to it.
 * Local Docker Postgres: unset, plain connection.
 */
function sslConfig(): pg.PoolConfig['ssl'] {
  if (!DATABASE_CA_CERT) return undefined;
  const ca = DATABASE_CA_CERT.includes('-----BEGIN')
    ? DATABASE_CA_CERT.replace(/\\n/g, '\n')
    : readFileSync(DATABASE_CA_CERT, 'utf8');
  return { ca, rejectUnauthorized: true };
}

/** SSL params in the URL override the `ssl` option in pg, so drop them when we configure TLS ourselves. */
function connectionString(ssl: pg.PoolConfig['ssl']): string {
  if (!ssl) return DATABASE_URL;
  const url = new URL(DATABASE_URL);
  for (const p of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(p);
  return url.toString();
}

const ssl = sslConfig();
export const pool = new pg.Pool({ connectionString: connectionString(ssl), ssl, max: 10 });

// An idle client erroring (e.g. Postgres restarted) must not crash the process.
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

/** Run `fn` inside a transaction; rolls back on any throw. */
export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
