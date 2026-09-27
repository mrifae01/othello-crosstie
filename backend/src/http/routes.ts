import express, { type NextFunction, type Request, type Response } from 'express';
import type {
  AnalysisResult,
  ApiError,
  ErrorCode,
  GameState,
  GameStatus,
  ListGamesResponse,
  ForfeitRequest,
  ListTournamentsResponse,
  MeResponse,
  SeatResponse,
  TournamentDetail,
  TournamentStatus,
} from '@othello/shared';
import { MAX_TOURNAMENT_PLAYERS, MIN_TOURNAMENT_PLAYERS, type Account } from '@othello/shared';
import { listGames, pingDb, type SeatHolder } from '../db/gamesRepo';
import { getAccount, upsertAccount } from '../db/accountsRepo';
import { authEnabled, verifyAccessToken, type AuthUser } from '../auth/verifyToken';
import type { AnalysisRunner } from '../analysis/AnalysisRunner';
import { GameError, toGameSummary, type GameService } from '../game/GameService';
import type { TournamentService } from '../tournament/TournamentService';

const STATUS_FOR: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  GAME_NOT_FOUND: 404,
  GAME_FULL: 409,
  GAME_NOT_ACTIVE: 409,
  NOT_YOUR_TURN: 409,
  ILLEGAL_MOVE: 400,
  BAD_TOKEN: 403,
  UNAUTHORIZED: 401,
  USERNAME_TAKEN: 409,
  FORBIDDEN: 403,
  TOURNAMENT_NOT_FOUND: 404,
  TOURNAMENT_FULL: 409,
  TOURNAMENT_NOT_OPEN: 409,
  INTERNAL: 500,
};

const GAME_STATUSES: readonly GameStatus[] = ['waiting', 'active', 'finished'];
const TOURNAMENT_STATUSES: readonly TournamentStatus[] = ['registering', 'active', 'finished', 'cancelled'];

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

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

function parseUsername(body: unknown): string {
  const raw = (body as { username?: unknown } | null)?.username;
  const username = typeof raw === 'string' ? raw.trim() : '';
  if (!USERNAME_RE.test(username)) {
    throw new GameError('BAD_REQUEST', '`username` must be 3–20 letters, digits or underscores');
  }
  return username;
}

function parseLimit(limit: unknown, fallback = 20): number {
  if (limit === undefined) return fallback;
  const n = Number(limit);
  if (typeof limit !== 'string' || !Number.isInteger(n) || n < 1) {
    throw new GameError('BAD_REQUEST', '`limit` must be a positive integer');
  }
  return Math.min(n, 50);
}

/**
 * The caller behind `Authorization: Bearer <supabase access token>`, or null with no header.
 * A header that is present but fails verification is an error, never a silent downgrade to guest.
 */
async function optionalUser(req: Request): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header) return null;
  if (!authEnabled) throw new GameError('UNAUTHORIZED', 'Accounts are not enabled on this server');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = token ? await verifyAccessToken(token) : null;
  if (!user) throw new GameError('UNAUTHORIZED', 'Invalid or expired session; sign in again');
  return user;
}

async function requireUser(req: Request): Promise<AuthUser> {
  const user = await optionalUser(req);
  if (!user) throw new GameError('UNAUTHORIZED', 'Sign in required');
  return user;
}

/**
 * Who takes the seat. Signed-in players with a claimed username sit as that account, and the
 * body's `name` is ignored so no one can pose as a registered user. Everyone else is a guest.
 */
async function seatHolderFor(req: Request): Promise<SeatHolder> {
  const user = await optionalUser(req);
  const account = user && (await getAccount(user.userId));
  if (account) return { name: account.username, accountId: account.id };
  return { name: parseName(req.body), accountId: null };
}

/** Signed in with a claimed username: required for everything tournament-side. */
async function requireAccount(req: Request): Promise<Account> {
  const user = await requireUser(req);
  const account = await getAccount(user.userId);
  if (!account) throw new GameError('UNAUTHORIZED', 'Pick a username first');
  return account;
}

function parseTournamentName(body: unknown): string {
  const raw = (body as { name?: unknown } | null)?.name;
  const name = typeof raw === 'string' ? raw.trim() : '';
  const len = [...name].length;
  if (len < 1 || len > 40) throw new GameError('BAD_REQUEST', '`name` must be 1–40 characters after trimming');
  return name;
}

function parseMaxPlayers(body: unknown): number {
  const raw = (body as { maxPlayers?: unknown } | null)?.maxPlayers;
  if (raw === undefined) return MAX_TOURNAMENT_PLAYERS;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < MIN_TOURNAMENT_PLAYERS || raw > MAX_TOURNAMENT_PLAYERS) {
    throw new GameError('BAD_REQUEST', `\`maxPlayers\` must be an integer ${MIN_TOURNAMENT_PLAYERS}–${MAX_TOURNAMENT_PLAYERS}`);
  }
  return raw;
}

function parseMatchRef(params: Record<string, string>): { round: number; slot: number } {
  const round = Number(params.round);
  const slot = Number(params.slot);
  if (!Number.isInteger(round) || round < 1 || !Number.isInteger(slot) || slot < 0) {
    throw new GameError('BAD_REQUEST', 'Bad match reference');
  }
  return { round, slot };
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (h: Handler) => (req: Request, res: Response, next: NextFunction) => h(req, res).catch(next);

export function apiRouter(games: GameService, analysis: AnalysisRunner, tournaments: TournamentService): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '10kb' }));

  r.get('/health', wrap(async (_req, res) => {
    res.json({ ok: true, db: await pingDb() });
  }));

  r.post('/games', wrap(async (req, res) => {
    const { gameId, playerToken } = await games.createGame(await seatHolderFor(req));
    const body: SeatResponse = { gameId, color: 'B', playerToken };
    res.status(201).json(body);
  }));

  r.post('/games/:id/join', wrap(async (req, res) => {
    const { gameId, playerToken } = await games.joinGame(req.params.id, await seatHolderFor(req));
    const body: SeatResponse = { gameId, color: 'W', playerToken };
    res.json(body);
  }));

  r.get('/games', wrap(async (req, res) => {
    const { status, limit } = req.query;
    if (status !== undefined && !GAME_STATUSES.includes(status as GameStatus)) {
      throw new GameError('BAD_REQUEST', '`status` must be one of waiting, active, finished');
    }
    const rows = await listGames({ status: status as GameStatus | undefined, limit: parseLimit(limit) });
    const body: ListGamesResponse = { games: rows.map(toGameSummary) };
    res.json(body);
  }));

  /** Seat token for the caller's account in a game it was seated in by account (tournament games). */
  r.post('/games/:id/seat', wrap(async (req, res) => {
    const account = await requireAccount(req);
    const body: SeatResponse = await games.claimSeat(req.params.id, account.id);
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

  // ---------- accounts ----------

  r.get('/me', wrap(async (req, res) => {
    const user = await requireUser(req);
    const body: MeResponse = { account: await getAccount(user.userId) };
    res.json(body);
  }));

  r.put('/me', wrap(async (req, res) => {
    const user = await requireUser(req);
    const account = await upsertAccount(user.userId, parseUsername(req.body));
    if (!account) throw new GameError('USERNAME_TAKEN', 'That username is taken');
    const body: MeResponse = { account };
    res.json(body);
  }));

  /** The caller's finished games, newest first: the seed of cross-game coaching. */
  r.get('/me/games', wrap(async (req, res) => {
    const user = await requireUser(req);
    const rows = await listGames({ status: 'finished', accountId: user.userId, limit: parseLimit(req.query.limit) });
    const body: ListGamesResponse = { games: rows.map(toGameSummary) };
    res.json(body);
  }));

  // ---------- tournaments (reads public, writes need an account) ----------

  r.get('/tournaments', wrap(async (req, res) => {
    const { status, limit } = req.query;
    if (status !== undefined && !TOURNAMENT_STATUSES.includes(status as TournamentStatus)) {
      throw new GameError('BAD_REQUEST', '`status` must be one of registering, active, finished, cancelled');
    }
    const list = await tournaments.list({ status: status as TournamentStatus | undefined, limit: parseLimit(limit) });
    const body: ListTournamentsResponse = { tournaments: list };
    res.json(body);
  }));

  r.post('/tournaments', wrap(async (req, res) => {
    const account = await requireAccount(req);
    const body: TournamentDetail = await tournaments.create(account, parseTournamentName(req.body), parseMaxPlayers(req.body));
    res.status(201).json(body);
  }));

  r.get('/tournaments/:id', wrap(async (req, res) => {
    const body: TournamentDetail = await tournaments.get(req.params.id);
    res.json(body);
  }));

  r.post('/tournaments/:id/join', wrap(async (req, res) => {
    const body: TournamentDetail = await tournaments.join(req.params.id, await requireAccount(req));
    res.json(body);
  }));

  r.post('/tournaments/:id/leave', wrap(async (req, res) => {
    const body: TournamentDetail = await tournaments.leave(req.params.id, await requireAccount(req));
    res.json(body);
  }));

  r.post('/tournaments/:id/start', wrap(async (req, res) => {
    const body: TournamentDetail = await tournaments.start(req.params.id, await requireAccount(req));
    res.json(body);
  }));

  r.post('/tournaments/:id/cancel', wrap(async (req, res) => {
    const body: TournamentDetail = await tournaments.cancel(req.params.id, await requireAccount(req));
    res.json(body);
  }));

  r.post('/tournaments/:id/matches/:round/:slot/forfeit', wrap(async (req, res) => {
    const account = await requireAccount(req);
    const { round, slot } = parseMatchRef(req.params);
    const loser = (req.body as Partial<ForfeitRequest> | null)?.loser;
    if (loser !== 'B' && loser !== 'W') throw new GameError('BAD_REQUEST', "`loser` must be 'B' or 'W'");
    const body: TournamentDetail = await tournaments.forfeit(req.params.id, account, round, slot, loser);
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
