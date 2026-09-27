import type { Account } from '@othello/shared';
import { pool } from './pool';

interface AccountRow {
  id: string;
  username: string;
  created_at: Date;
}

const toAccount = (r: AccountRow): Account => ({ id: r.id, username: r.username, createdAt: r.created_at.toISOString() });

export async function getAccount(id: string): Promise<Account | null> {
  const { rows } = await pool.query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [id]);
  return rows[0] ? toAccount(rows[0]) : null;
}

/** Creates the account or renames it. Returns null if the username is taken (case-insensitively). */
export async function upsertAccount(id: string, username: string): Promise<Account | null> {
  try {
    const { rows } = await pool.query<AccountRow>(
      `INSERT INTO accounts (id, username) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
       RETURNING *`,
      [id, username],
    );
    return toAccount(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return null; // unique_violation on lower(username)
    throw err;
  }
}
