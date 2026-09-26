import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  applyMove,
  countDiscs,
  getFlips,
  getLegalMoves,
  initialBoard,
  nextTurn,
  opponent,
  winnerOf,
  type AnalysisResult,
  type ErrorCode,
  type GameState,
  type GameSummary,
  type Player,
} from '@othello/shared';
import * as repo from '../db/gamesRepo';
import type { GameRecord, GameSnapshotUpdate, MoveInsert } from '../db/gamesRepo';

/** A domain error that maps directly onto an `ErrorCode` for REST and socket acks. */
export class GameError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function sameHash(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function toGameSummary(g: GameRecord): GameSummary {
  return {
    gameId: g.id,
    status: g.status,
    players: { B: { name: g.blackName }, W: g.whiteName === null ? null : { name: g.whiteName } },
    counts: { ...g.counts },
    winner: g.winner,
    endReason: g.endReason,
    analysisStatus: g.analysisStatus,
    createdAt: g.createdAt.toISOString(),
    finishedAt: g.finishedAt ? g.finishedAt.toISOString() : null,
  };
}

export function toGameState(g: GameRecord): GameState {
  const turn = g.status === 'active' ? g.turn : null;
  return {
    ...toGameSummary(g),
    board: g.board.slice(),
    turn,
    legalMoves: turn ? getLegalMoves(g.board, turn) : [],
    moves: g.moves.map((m) => ({ ...m, flipped: m.flipped.slice() })),
    version: g.moves.length,
  };
}

function snapshotOf(g: GameRecord): GameSnapshotUpdate {
  return {
    status: g.status,
    board: g.board,
    turn: g.turn,
    counts: g.counts,
    winner: g.winner,
    endReason: g.endReason,
    analysisStatus: g.analysisStatus,
    finishedAt: g.finishedAt,
  };
}

type StateListener = (state: GameState) => void;

/**
 * Owns live games: an in-memory cache backed by Postgres, and a per-game promise-chain
 * mutex so validate → persist → mutate cache → broadcast runs one operation at a time per game.
 * All rule decisions are delegated to @othello/shared.
 */
export class GameService {
  private readonly games = new Map<string, GameRecord>();
  private readonly loading = new Map<string, Promise<GameRecord | null>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<StateListener>();

  /** Subscribe to every state change (the socket layer broadcasts these to rooms). */
  onState(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(g: GameRecord): void {
    const state = toGameState(g);
    for (const l of this.listeners) l(state);
  }

  private withLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(gameId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this.locks.set(gameId, tail);
    // Drop the chain once idle so the map doesn't grow forever.
    void tail.then(() => {
      if (this.locks.get(gameId) === tail) this.locks.delete(gameId);
    });
    return run;
  }

  /** Cache hit, or load from Postgres (deduplicating concurrent loads). */
  private async load(gameId: string): Promise<GameRecord | null> {
    const cached = this.games.get(gameId);
    if (cached) return cached;
    if (!repo.isValidGameId(gameId)) return null;
    let pending = this.loading.get(gameId);
    if (!pending) {
      pending = repo.loadGame(gameId).then((g) => {
        // A concurrent create/join may have populated the cache first; prefer that.
        const existing = this.games.get(gameId);
        if (existing) return existing;
        if (g) this.games.set(gameId, g);
        return g;
      });
      this.loading.set(gameId, pending);
      void pending.finally(() => this.loading.delete(gameId)).catch(() => {});
    }
    return pending;
  }

  private async mustLoad(gameId: string): Promise<GameRecord> {
    const g = await this.load(gameId);
    if (!g) throw new GameError('GAME_NOT_FOUND', 'Game not found');
    return g;
  }

  private seatFor(g: GameRecord, token: unknown): Player | null {
    if (typeof token !== 'string' || token.length === 0) return null;
    const h = hashToken(token);
    if (sameHash(h, g.blackTokenHash)) return 'B';
    if (g.whiteTokenHash && sameHash(h, g.whiteTokenHash)) return 'W';
    return null;
  }

  async getState(gameId: string): Promise<GameState> {
    return toGameState(await this.mustLoad(gameId));
  }

  /** For spectators/players subscribing: current state plus the seat the token maps to (null if none). */
  async subscribe(gameId: string, token: unknown): Promise<{ state: GameState; you: Player | null }> {
    const g = await this.mustLoad(gameId);
    return { state: toGameState(g), you: this.seatFor(g, token) };
  }

  async createGame(blackName: string): Promise<{ gameId: string; playerToken: string }> {
    const playerToken = newToken();
    const g = await repo.createGame({ blackName, blackTokenHash: hashToken(playerToken), board: initialBoard() });
    this.games.set(g.id, g);
    return { gameId: g.id, playerToken };
  }

  async joinGame(gameId: string, whiteName: string): Promise<{ gameId: string; playerToken: string }> {
    return this.withLock(gameId, async () => {
      const g = await this.mustLoad(gameId);
      if (g.status !== 'waiting' || g.whiteTokenHash !== null) {
        throw new GameError('GAME_FULL', 'This game already has two players');
      }
      const playerToken = newToken();
      const updated = await repo.joinGame(gameId, whiteName, hashToken(playerToken));
      if (!updated) throw new GameError('GAME_FULL', 'This game already has two players');
      Object.assign(g, {
        status: updated.status,
        whiteName: updated.whiteName,
        whiteTokenHash: updated.whiteTokenHash,
        turn: updated.turn,
      });
      this.emit(g);
      return { gameId, playerToken };
    });
  }

  /**
   * Validates and applies a move (plus any automatic pass), persists it, then calls
   * `afterPersist` (the socket ack) before broadcasting — all under the game's lock.
   */
  async move(gameId: string, token: unknown, square: number, afterPersist?: () => void): Promise<GameState> {
    return this.withLock(gameId, async () => {
      const g = await this.mustLoad(gameId);
      if (g.status !== 'active' || !g.turn) throw new GameError('GAME_NOT_ACTIVE', 'Game is not active');
      const seat = this.seatFor(g, token);
      if (!seat) throw new GameError('BAD_TOKEN', 'Token does not match a seat in this game');
      if (seat !== g.turn) throw new GameError('NOT_YOUR_TURN', 'It is not your turn');
      if (getFlips(g.board, seat, square).length === 0) {
        throw new GameError('ILLEGAL_MOVE', 'That square is not a legal move');
      }

      const { board, flipped } = applyMove(g.board, seat, square);
      const inserts: MoveInsert[] = [{ ply: g.moves.length + 1, player: seat, square, flipped, boardAfter: board }];
      const next = nextTurn(board, seat);
      if (next === seat) {
        inserts.push({ ply: g.moves.length + 2, player: opponent(seat), square: null, flipped: [], boardAfter: board });
      }
      const over = next === null;
      const snapshot: GameSnapshotUpdate = {
        status: over ? 'finished' : 'active',
        board,
        turn: next,
        counts: countDiscs(board),
        winner: over ? winnerOf(board) : null,
        endReason: over ? 'normal' : null,
        analysisStatus: over ? 'pending' : g.analysisStatus,
        finishedAt: over ? new Date() : null,
      };

      try {
        await repo.recordMoves(gameId, inserts, snapshot);
      } catch (err) {
        console.error(`[game ${gameId}] persist failed:`, (err as Error).message);
        throw new GameError('INTERNAL', 'Failed to save the move');
      }

      // Persisted: now (and only now) mutate the cache.
      Object.assign(g, snapshot);
      g.moves.push(...inserts.map(({ boardAfter: _b, ...m }) => m));
      afterPersist?.();
      this.emit(g);
      return toGameState(g);
    });
  }

  async resign(gameId: string, token: unknown, afterPersist?: () => void): Promise<GameState> {
    return this.withLock(gameId, async () => {
      const g = await this.mustLoad(gameId);
      if (g.status !== 'active') throw new GameError('GAME_NOT_ACTIVE', 'Game is not active');
      const seat = this.seatFor(g, token);
      if (!seat) throw new GameError('BAD_TOKEN', 'Token does not match a seat in this game');

      const snapshot: GameSnapshotUpdate = {
        ...snapshotOf(g),
        status: 'finished',
        turn: null,
        winner: opponent(seat),
        endReason: 'resign',
        analysisStatus: g.moves.length > 0 ? 'pending' : 'none',
        finishedAt: new Date(),
      };
      try {
        await repo.updateGame(gameId, snapshot);
      } catch (err) {
        console.error(`[game ${gameId}] resign persist failed:`, (err as Error).message);
        throw new GameError('INTERNAL', 'Failed to save the resignation');
      }
      Object.assign(g, snapshot);
      afterPersist?.();
      this.emit(g);
      return toGameState(g);
    });
  }

  /** Part 1: analysis is not run yet, so this reflects DB status with no plies. */
  async getAnalysis(gameId: string): Promise<AnalysisResult> {
    const g = await this.mustLoad(gameId);
    return {
      game: toGameSummary(g),
      status: g.analysisStatus,
      progress: null,
      plies: [],
      summary: null,
    };
  }
}
