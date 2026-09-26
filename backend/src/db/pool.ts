import pg from 'pg';
import { DATABASE_URL } from '../config';

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

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
