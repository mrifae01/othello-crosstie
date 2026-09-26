import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, withTx } from './pool';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');
/** Arbitrary constant so concurrent runners (npm start + server boot) don't race. */
const LOCK_KEY = 7_415_263;

/** Applies every not-yet-applied `migrations/*.sql` file in name order, each in its own transaction. */
export async function runMigrations(log: (msg: string) => void = console.log): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await withTx(async (tx) => {
        await tx.query(sql);
        await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      });
      log(`[migrate] applied ${file}`);
    }
    log(`[migrate] up to date (${files.length} migration${files.length === 1 ? '' : 's'})`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

// CLI: `npm run migrate -w backend`
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMigrations()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error('[migrate] failed:', err.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
