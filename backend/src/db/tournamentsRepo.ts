import type pg from 'pg';
import type {
  Player,
  TournamentDetail,
  TournamentEntrant,
  TournamentMatch,
  TournamentStatus,
  TournamentSummary,
  Winner,
} from '@othello/shared';
import { pool } from './pool';

/** The pool, or a client inside a transaction (TournamentService owns the transactions). */
type Db = Pick<pg.Pool, 'query'> | pg.PoolClient;

interface SummaryRow {
  id: string;
  name: string;
  status: TournamentStatus;
  organizer_id: string;
  organizer_name: string;
  max_players: number;
  rounds: number;
  winner_id: string | null;
  winner_name: string | null;
  entrant_count: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const SUMMARY_SQL = `
  SELECT t.*, o.username AS organizer_name, w.username AS winner_name,
         (SELECT count(*)::int FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrant_count
    FROM tournaments t
    JOIN accounts o ON o.id = t.organizer_id
    LEFT JOIN accounts w ON w.id = t.winner_id`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const player = (id: string | null, name: string | null) => (id && name ? { accountId: id, username: name } : null);

function toSummary(r: SummaryRow): TournamentSummary {
  return {
    tournamentId: r.id,
    name: r.name,
    status: r.status,
    organizer: { accountId: r.organizer_id, username: r.organizer_name },
    maxPlayers: r.max_players,
    entrantCount: r.entrant_count,
    winner: player(r.winner_id, r.winner_name),
    createdAt: r.created_at.toISOString(),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
  };
}

export async function insertTournament(name: string, organizerId: string, maxPlayers: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO tournaments (name, organizer_id, max_players) VALUES ($1, $2, $3) RETURNING id',
    [name, organizerId, maxPlayers],
  );
  return rows[0].id;
}

/** Newest first. */
export async function listTournaments(opts: { status?: TournamentStatus; limit: number }): Promise<TournamentSummary[]> {
  const { rows } = await pool.query<SummaryRow>(
    `${SUMMARY_SQL} WHERE ($1::text IS NULL OR t.status = $1) ORDER BY t.created_at DESC LIMIT $2`,
    [opts.status ?? null, opts.limit],
  );
  return rows.map(toSummary);
}

export async function loadTournament(id: string): Promise<TournamentDetail | null> {
  const t = await pool.query<SummaryRow>(`${SUMMARY_SQL} WHERE t.id = $1`, [id]);
  if (!t.rows[0]) return null;

  const entries = await pool.query<{ account_id: string; username: string; seed: number | null }>(
    `SELECT e.account_id, a.username, e.seed
       FROM tournament_entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.tournament_id = $1
      ORDER BY e.seed NULLS LAST, e.joined_at`,
    [id],
  );
  const entrants: TournamentEntrant[] = entries.rows.map((r) => ({ accountId: r.account_id, username: r.username, seed: r.seed }));
  const names = new Map(entrants.map((e) => [e.accountId, e.username]));
  const who = (accountId: string | null) => player(accountId, accountId ? names.get(accountId) ?? null : null);

  const matches = await pool.query<MatchRow>(
    'SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY round, slot',
    [id],
  );
  return {
    ...toSummary(t.rows[0]),
    entrants,
    rounds: t.rows[0].rounds,
    matches: matches.rows.map(
      (m): TournamentMatch => ({
        round: m.round,
        slot: m.slot,
        status: m.winner_id ? 'decided' : m.game_id ? 'playing' : 'pending',
        black: who(m.black_id),
        white: who(m.white_id),
        gameId: m.game_id,
        winner: who(m.winner_id),
      }),
    ),
  };
}

// ---------- transactional primitives (pass the transaction's client) ----------

export interface LockedTournament {
  id: string;
  status: TournamentStatus;
  organizer_id: string;
  max_players: number;
  rounds: number;
}

/** Row-locks the tournament: every write to a tournament serializes on this. */
export async function lockTournament(c: pg.PoolClient, id: string): Promise<LockedTournament | null> {
  const { rows } = await c.query<LockedTournament>(
    'SELECT id, status, organizer_id, max_players, rounds FROM tournaments WHERE id = $1 FOR UPDATE',
    [id],
  );
  return rows[0] ?? null;
}

/** Entrants in join order. */
export async function listEntrants(c: Db, id: string): Promise<{ accountId: string; username: string }[]> {
  const { rows } = await c.query<{ account_id: string; username: string }>(
    `SELECT e.account_id, a.username
       FROM tournament_entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.tournament_id = $1 ORDER BY e.joined_at`,
    [id],
  );
  return rows.map((r) => ({ accountId: r.account_id, username: r.username }));
}

export async function insertEntry(c: Db, id: string, accountId: string): Promise<void> {
  await c.query(
    'INSERT INTO tournament_entries (tournament_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [id, accountId],
  );
}

export async function deleteEntry(c: Db, id: string, accountId: string): Promise<void> {
  await c.query('DELETE FROM tournament_entries WHERE tournament_id = $1 AND account_id = $2', [id, accountId]);
}

export async function setSeed(c: Db, id: string, accountId: string, seed: number): Promise<void> {
  await c.query('UPDATE tournament_entries SET seed = $3 WHERE tournament_id = $1 AND account_id = $2', [id, accountId, seed]);
}

export async function markStarted(c: Db, id: string, rounds: number): Promise<void> {
  await c.query(`UPDATE tournaments SET status = 'active', rounds = $2, started_at = now() WHERE id = $1`, [id, rounds]);
}

export async function markFinished(c: Db, id: string, winnerId: string): Promise<void> {
  await c.query(`UPDATE tournaments SET status = 'finished', winner_id = $2, finished_at = now() WHERE id = $1`, [id, winnerId]);
}

export interface MatchRow {
  tournament_id: string;
  round: number;
  slot: number;
  black_id: string | null;
  white_id: string | null;
  game_id: string | null;
  winner_id: string | null;
}

export async function insertMatch(
  c: Db,
  m: { tournamentId: string; round: number; slot: number; blackId: string | null; whiteId: string | null },
): Promise<void> {
  await c.query(
    'INSERT INTO tournament_matches (tournament_id, round, slot, black_id, white_id) VALUES ($1, $2, $3, $4, $5)',
    [m.tournamentId, m.round, m.slot, m.blackId, m.whiteId],
  );
}

export async function getMatch(c: Db, id: string, round: number, slot: number): Promise<MatchRow | null> {
  const { rows } = await c.query<MatchRow>(
    'SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = $2 AND slot = $3',
    [id, round, slot],
  );
  return rows[0] ?? null;
}

export async function matchForGame(c: Db, gameId: string): Promise<MatchRow | null> {
  const { rows } = await c.query<MatchRow>('SELECT * FROM tournament_matches WHERE game_id = $1', [gameId]);
  return rows[0] ?? null;
}

/** Puts a player in one seat of a match; returns the match after the update. */
export async function setMatchSeat(c: Db, id: string, round: number, slot: number, seat: Player, accountId: string): Promise<MatchRow> {
  const column = seat === 'B' ? 'black_id' : 'white_id';
  const { rows } = await c.query<MatchRow>(
    `UPDATE tournament_matches SET ${column} = $4
      WHERE tournament_id = $1 AND round = $2 AND slot = $3 RETURNING *`,
    [id, round, slot, accountId],
  );
  return rows[0];
}

export async function setMatchGame(c: Db, id: string, round: number, slot: number, gameId: string): Promise<void> {
  await c.query(
    'UPDATE tournament_matches SET game_id = $4 WHERE tournament_id = $1 AND round = $2 AND slot = $3',
    [id, round, slot, gameId],
  );
}

export async function setMatchWinner(c: Db, id: string, round: number, slot: number, winnerId: string): Promise<void> {
  await c.query(
    'UPDATE tournament_matches SET winner_id = $4 WHERE tournament_id = $1 AND round = $2 AND slot = $3',
    [id, round, slot, winnerId],
  );
}

export async function usernameOf(c: Db, accountId: string): Promise<string> {
  const { rows } = await c.query<{ username: string }>('SELECT username FROM accounts WHERE id = $1', [accountId]);
  return rows[0].username;
}

/** Finished tournament games whose result never reached the bracket (e.g. the server died in between). */
export async function listUnrecordedResults(): Promise<{ gameId: string; winner: Winner }[]> {
  const { rows } = await pool.query<{ game_id: string; winner: Winner }>(
    `SELECT m.game_id, g.winner
       FROM tournament_matches m JOIN games g ON g.id = m.game_id
      WHERE m.winner_id IS NULL AND g.status = 'finished' AND g.winner IS NOT NULL`,
  );
  return rows.map((r) => ({ gameId: r.game_id, winner: r.winner }));
}
