import type pg from 'pg';
import {
  boardFromString,
  boardToString,
  initialBoard,
  type AnalysisStatus,
  type Board,
  type CandidateMove,
  type Motif,
  type MoveClass,
  type PlyAnalysis,
  type EndReason,
  type GameStatus,
  type PlayedMove,
  type Player,
  type Winner,
} from '@othello/shared';
import { pool, withTx } from './pool';

/** A game as persisted: the `games` row plus its move list. */
export interface GameRecord {
  id: string;
  status: GameStatus;
  blackName: string;
  whiteName: string | null;
  blackAccountId: string | null;
  whiteAccountId: string | null;
  blackTokenHash: string;
  whiteTokenHash: string | null;
  board: Board;
  turn: Player | null;
  counts: { B: number; W: number };
  winner: Winner | null;
  endReason: EndReason | null;
  analysisStatus: AnalysisStatus;
  createdAt: Date;
  finishedAt: Date | null;
  moves: PlayedMove[];
}

/** A played move plus the board after it (stored as `moves.board_after`). */
export interface MoveInsert extends PlayedMove {
  boardAfter: Board;
}

/** The denormalized snapshot on `games` that must change together with a move insert. */
export interface GameSnapshotUpdate {
  status: GameStatus;
  board: Board;
  turn: Player | null;
  counts: { B: number; W: number };
  winner: Winner | null;
  endReason: EndReason | null;
  analysisStatus: AnalysisStatus;
  finishedAt: Date | null;
}

interface GameRow {
  id: string;
  status: GameStatus;
  black_name: string;
  white_name: string | null;
  black_account_id: string | null;
  white_account_id: string | null;
  black_token_hash: string;
  white_token_hash: string | null;
  board: string;
  turn: Player | null;
  black_count: number;
  white_count: number;
  winner: Winner | null;
  end_reason: EndReason | null;
  analysis_status: AnalysisStatus;
  created_at: Date;
  finished_at: Date | null;
}

interface MoveRow {
  ply: number;
  player: Player;
  square: number | null;
  flipped: number[];
}

function toRecord(row: GameRow, moves: PlayedMove[]): GameRecord {
  return {
    id: row.id,
    status: row.status,
    blackName: row.black_name,
    whiteName: row.white_name,
    blackAccountId: row.black_account_id,
    whiteAccountId: row.white_account_id,
    blackTokenHash: row.black_token_hash,
    whiteTokenHash: row.white_token_hash,
    board: boardFromString(row.board),
    turn: row.turn,
    counts: { B: row.black_count, W: row.white_count },
    winner: row.winner,
    endReason: row.end_reason,
    analysisStatus: row.analysis_status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    moves,
  };
}

function toPlayedMove(r: MoveRow): PlayedMove {
  return { ply: r.ply, player: r.player, square: r.square, flipped: r.flipped ?? [] };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Guard before querying so a malformed id is a clean "not found" rather than a Postgres cast error. */
export function isValidGameId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Who is taking a seat: a display name, plus the account for signed-in players (null for guests). */
export interface SeatHolder {
  name: string;
  accountId: string | null;
}

export async function createGame(input: { black: SeatHolder; blackTokenHash: string; board: Board }): Promise<GameRecord> {
  const { rows } = await pool.query<GameRow>(
    `INSERT INTO games (black_name, black_account_id, black_token_hash, board)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.black.name, input.black.accountId, input.blackTokenHash, boardToString(input.board)],
  );
  return toRecord(rows[0], []);
}

/**
 * Claims the White seat, but only if the game is still waiting with no White.
 * Returns the updated record, or null if the seat couldn't be claimed.
 */
export async function joinGame(id: string, white: SeatHolder, whiteTokenHash: string): Promise<GameRecord | null> {
  const { rows } = await pool.query<GameRow>(
    `UPDATE games
        SET white_name = $2, white_account_id = $3, white_token_hash = $4,
            status = 'active', turn = 'B', started_at = now()
      WHERE id = $1 AND status = 'waiting' AND white_token_hash IS NULL
      RETURNING *`,
    [id, white.name, white.accountId, whiteTokenHash],
  );
  return rows[0] ? toRecord(rows[0], []) : null;
}

export async function loadGame(id: string): Promise<GameRecord | null> {
  if (!isValidGameId(id)) return null;
  const game = await pool.query<GameRow>('SELECT * FROM games WHERE id = $1', [id]);
  if (!game.rows[0]) return null;
  const moves = await pool.query<MoveRow>(
    'SELECT ply, player, square, flipped FROM moves WHERE game_id = $1 ORDER BY ply',
    [id],
  );
  return toRecord(game.rows[0], moves.rows.map(toPlayedMove));
}

/**
 * Game headers only (moves: []), newest finished first, then newest created.
 * `accountId` narrows to games where that account holds either seat.
 */
export async function listGames(opts: { status?: GameStatus; accountId?: string; limit: number }): Promise<GameRecord[]> {
  const { rows } = await pool.query<GameRow>(
    `SELECT * FROM games
      WHERE ($1::text IS NULL OR status = $1)
        AND ($2::uuid IS NULL OR black_account_id = $2 OR white_account_id = $2)
      ORDER BY finished_at DESC NULLS LAST, created_at DESC
      LIMIT $3`,
    [opts.status ?? null, opts.accountId ?? null, opts.limit],
  );
  return rows.map((r) => toRecord(r, []));
}

async function updateSnapshot(client: pg.PoolClient, id: string, s: GameSnapshotUpdate): Promise<void> {
  await client.query(
    `UPDATE games
        SET status = $2, board = $3, turn = $4, black_count = $5, white_count = $6,
            winner = $7, end_reason = $8, analysis_status = $9, finished_at = $10
      WHERE id = $1`,
    [id, s.status, boardToString(s.board), s.turn, s.counts.B, s.counts.W, s.winner, s.endReason, s.analysisStatus, s.finishedAt],
  );
}

/** Inserts one or more moves (a move plus an auto-pass) and updates the game snapshot, atomically. */
export async function recordMoves(id: string, moves: MoveInsert[], snapshot: GameSnapshotUpdate): Promise<void> {
  await withTx(async (client) => {
    for (const m of moves) {
      await client.query(
        `INSERT INTO moves (game_id, ply, player, square, flipped, board_after)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, m.ply, m.player, m.square, m.flipped, boardToString(m.boardAfter)],
      );
    }
    await updateSnapshot(client, id, snapshot);
  });
}

/** Snapshot-only update with no new moves (resign). */
export async function updateGame(id: string, snapshot: GameSnapshotUpdate): Promise<void> {
  await withTx((client) => updateSnapshot(client, id, snapshot));
}

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// ---------- analysis ----------

export async function setAnalysisStatus(id: string, status: AnalysisStatus, error: string | null = null): Promise<void> {
  await pool.query(
    `UPDATE games
        SET analysis_status = $2,
            analysis_error = $3,
            analyzed_at = CASE WHEN $2 = 'done' THEN now() ELSE analyzed_at END
      WHERE id = $1`,
    [id, status, error],
  );
}

export async function writePlyAnalysis(id: string, p: PlyAnalysis): Promise<void> {
  await pool.query(
    `UPDATE moves
        SET eval_before = $3, eval_after = $4, loss = $5, best_square = $6, classification = $7,
            candidates = $8, motifs = $9, search_depth = $10, is_exact = $11
      WHERE game_id = $1 AND ply = $2`,
    [id, p.ply, p.evalBefore, p.evalAfter, p.loss, p.bestSquare, p.classification,
     JSON.stringify(p.candidates), p.motifs, p.depth, p.exact],
  );
}

interface AnalyzedMoveRow extends MoveRow {
  board_after: string;
  eval_before: number | null;
  eval_after: number | null;
  loss: number | null;
  best_square: number | null;
  classification: MoveClass | null;
  is_blunder: boolean | null;
  candidates: CandidateMove[] | null;
  motifs: Motif[];
  search_depth: number | null;
  is_exact: boolean | null;
}

/** `real` columns come back as float4-rounded doubles; trim them back to 2 decimals. */
const r2 = (v: number | null) => (v === null ? 0 : Math.round(v * 100) / 100 || 0);

/** Every ply with its stored analysis. Returns null if any ply hasn't been analyzed. */
export async function loadPlyAnalyses(id: string): Promise<PlyAnalysis[] | null> {
  const { rows } = await pool.query<AnalyzedMoveRow>(
    `SELECT ply, player, square, flipped, board_after, eval_before, eval_after, loss, best_square,
            classification, is_blunder, candidates, motifs, search_depth, is_exact
       FROM moves WHERE game_id = $1 ORDER BY ply`,
    [id],
  );
  if (rows.some((r) => r.classification === null)) return null;
  let before = initialBoard();
  return rows.map((r) => {
    const after = boardFromString(r.board_after);
    const p: PlyAnalysis = {
      ply: r.ply,
      player: r.player,
      square: r.square,
      flipped: r.flipped ?? [],
      boardBefore: before,
      boardAfter: after,
      evalBefore: r2(r.eval_before),
      evalAfter: r2(r.eval_after),
      loss: r2(r.loss),
      bestSquare: r.best_square,
      classification: r.classification!,
      isBlunder: r.is_blunder === true,
      candidates: (r.candidates ?? []).map((c) => ({ square: c.square, eval: r2(c.eval) })),
      motifs: r.motifs ?? [],
      depth: r.search_depth ?? 0,
      exact: r.is_exact === true,
    };
    before = after;
    return p;
  });
}

/** Games whose analysis should be (re)started on boot, oldest finish first. */
export async function listGamesNeedingAnalysis(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM games WHERE analysis_status IN ('pending', 'running') ORDER BY finished_at ASC NULLS LAST`,
  );
  return rows.map((r) => r.id);
}
