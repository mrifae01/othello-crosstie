import express, { type NextFunction, type Request, type Response } from 'express';
import type {
  AnalysisResult,
  ApiError,
  ErrorCode,
  GameState,
  GameStatus,
  ListGamesResponse,
  SeatResponse,
} from '@othello/shared';
import { listGames, pingDb } from '../db/gamesRepo';
import type { AnalysisRunner } from '../analysis/AnalysisRunner';
import { GameError, toGameSummary, type GameService } from '../game/GameService';

const STATUS_FOR: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  GAME_NOT_FOUND: 404,
  GAME_FULL: 409,
  GAME_NOT_ACTIVE: 409,
  NOT_YOUR_TURN: 409,
  ILLEGAL_MOVE: 400,
  BAD_TOKEN: 403,
  INTERNAL: 500,
};

const GAME_STATUSES: readonly GameStatus[] = ['waiting', 'active', 'finished'];

function sendError(res: Response, code: ErrorCode, message: string): void {
  const body: ApiError = { error: { code, message } };
  res.status(STATUS_FOR[code]).json(body);
}

/** Trimmed display name, 1..24 characters; throws BAD_REQUEST otherwise. */
function parseName(body: unknown): string {
  const raw = (body as { name?: unknown } | null)?.name;
  if (typeof raw !== 'string') throw new GameError('BAD_REQUEST', '`name` must be a string');
  const name = raw.trim();
  const len = [...name].length;
  if (len < 1 || len > 24) throw new GameError('BAD_REQUEST', '`name` must be 1–24 characters after trimming');
  return name;
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (h: Handler) => (req: Request, res: Response, next: NextFunction) => h(req, res).catch(next);

export function apiRouter(games: GameService, analysis: AnalysisRunner): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '10kb' }));

  r.get('/health', wrap(async (_req, res) => {
    res.json({ ok: true, db: await pingDb() });
  }));

  r.post('/games', wrap(async (req, res) => {
    const name = parseName(req.body);
    const { gameId, playerToken } = await games.createGame(name);
    const body: SeatResponse = { gameId, color: 'B', playerToken };
    res.status(201).json(body);
  }));

  r.post('/games/:id/join', wrap(async (req, res) => {
    const name = parseName(req.body);
    const { gameId, playerToken } = await games.joinGame(req.params.id, name);
    const body: SeatResponse = { gameId, color: 'W', playerToken };
    res.json(body);
  }));

  r.get('/games', wrap(async (req, res) => {
    const { status, limit } = req.query;
    if (status !== undefined && !GAME_STATUSES.includes(status as GameStatus)) {
      throw new GameError('BAD_REQUEST', '`status` must be one of waiting, active, finished');
    }
    let n = 20;
    if (limit !== undefined) {
      n = Number(limit);
      if (typeof limit !== 'string' || !Number.isInteger(n) || n < 1) {
        throw new GameError('BAD_REQUEST', '`limit` must be a positive integer');
      }
      n = Math.min(n, 50);
    }
    const rows = await listGames({ status: status as GameStatus | undefined, limit: n });
    const body: ListGamesResponse = { games: rows.map(toGameSummary) };
    res.json(body);
  }));

  r.get('/games/:id', wrap(async (req, res) => {
    const body: GameState = await games.getState(req.params.id);
    res.json(body);
  }));

  r.get('/games/:id/analysis', wrap(async (req, res) => {
    const body: AnalysisResult = await analysis.getAnalysis(req.params.id);
    res.json(body);
  }));

  r.use((_req, res) => sendError(res, 'BAD_REQUEST', 'Unknown API endpoint'));

  // Error mapping: GameError → its code; malformed JSON → BAD_REQUEST; anything else → INTERNAL.
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof GameError) return sendError(res, err.code, err.message);
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.parse.failed' || e?.status === 400) return sendError(res, 'BAD_REQUEST', 'Malformed JSON body');
    if (e?.type === 'entity.too.large') return sendError(res, 'BAD_REQUEST', 'Request body too large');
    console.error('[http] unhandled error:', err);
    sendError(res, 'INTERNAL', 'Internal server error');
  });

  return r;
}
