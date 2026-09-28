/**
 * The real GameClient: REST over fetch (design-contract §3.1) plus one Socket.IO
 * connection (§3.2). Locally URLs are relative: Vite proxies /api and /socket.io to
 * the API, so this works unchanged through an ngrok tunnel on 5173. Deployed, the
 * web app and API live on different domains and VITE_API_URL points at the API.
 */
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  Account,
  AnalysisResult,
  ApiError,
  CoachDebrief,
  CoachDebriefResponse,
  ClientToServerEvents,
  ErrorCode,
  GameState,
  ListGamesResponse,
  ListTournamentsResponse,
  MeResponse,
  SeatResponse,
  ServerToClientEvents,
  SubscribeResult,
  TournamentDetail,
} from '@othello/shared';
import { GameClientError, type GameClient, type GameEventHandlers, type GameSubscription } from './GameClient';

const ACK_TIMEOUT_MS = 8000;

/** API origin, e.g. https://api.example.com. Empty = same origin (local dev). */
const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ---------- REST ----------

/** Current Supabase access token, or undefined for a guest. Supplied by the composition root. */
export type AccessTokenProvider = () => Promise<string | undefined>;

async function request<T>(
  getAccessToken: AccessTokenProvider,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GameClientError('INTERNAL', "Can't reach the server. Is the API running?");
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    // Every non-2xx body should be an ApiError; anything else (e.g. a proxy 502 page) becomes INTERNAL.
    if (err?.code) throw new GameClientError(err.code, err.message);
    throw new GameClientError('INTERNAL', `Server error (${res.status})`);
  }
  return data as T;
}

// ---------- Socket ----------

interface Entry {
  gameId: string;
  playerToken: string | undefined;
  handlers: GameEventHandlers;
  /** Set once the first subscribe ack succeeded; only these are re-subscribed on reconnect. */
  live: boolean;
}

function ackError(r: { error: ErrorCode; message: string }): GameClientError {
  return new GameClientError(r.error, r.message);
}

async function emitWithAck<T extends object>(send: () => Promise<Ack<T>>): Promise<{ ok: true } & T> {
  let r: Ack<T>;
  try {
    r = await send();
  } catch {
    // socket.io rejects on ack timeout (e.g. disconnected mid-emit).
    throw new GameClientError('INTERNAL', 'The server did not respond. Check your connection and try again.');
  }
  if (!r.ok) throw ackError(r);
  return r;
}

export function createHttpClient(getAccessToken: AccessTokenProvider = async () => undefined): GameClient {
  const call = <T,>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
    request<T>(getAccessToken, method, path, body);
  const entries = new Set<Entry>();
  let socket: TypedSocket | null = null;

  /** One connection per tab, created on first use. */
  function getSocket(): TypedSocket {
    if (socket) return socket;
    const opts = { path: '/socket.io' };
    const s: TypedSocket = API_URL ? io(API_URL, opts) : io(opts);

    // A reconnect is a fresh server-side socket in no rooms: re-join every game we
    // are watching and hand the fresh state to its handlers.
    s.on('connect', () => {
      for (const e of entries) {
        if (!e.live) continue;
        s.timeout(ACK_TIMEOUT_MS)
          .emitWithAck('game:subscribe', { gameId: e.gameId, playerToken: e.playerToken })
          .then((r) => {
            if (r.ok && entries.has(e)) e.handlers.onState(r.state);
          })
          .catch(() => {
            /* next reconnect will retry */
          });
      }
    });

    s.on('game:state', (state) => {
      for (const e of entries) if (e.gameId === state.gameId) e.handlers.onState(state);
    });
    s.on('analysis:progress', (p) => {
      for (const e of entries) if (e.gameId === p.gameId) e.handlers.onAnalysisProgress(p);
    });
    s.on('analysis:ready', (p) => {
      for (const e of entries) if (e.gameId === p.gameId) e.handlers.onAnalysisReady(p);
    });

    socket = s;
    return s;
  }

  return {
    createGame: (name) => call<SeatResponse>('POST', '/games', { name }),
    joinGame: (gameId, name) => call<SeatResponse>('POST', `/games/${encodeURIComponent(gameId)}/join`, { name }),
    getGame: (gameId) => call<GameState>('GET', `/games/${encodeURIComponent(gameId)}`),
    listFinishedGames: async (limit = 20) =>
      (await call<ListGamesResponse>('GET', `/games?status=finished&limit=${limit}`)).games,
    getAnalysis: (gameId) => call<AnalysisResult>('GET', `/games/${encodeURIComponent(gameId)}/analysis`),
    getCoachDebrief: (gameId, player) =>
      call<CoachDebriefResponse>('GET', `/games/${encodeURIComponent(gameId)}/coach?player=${player}`),
    requestCoachDebrief: (gameId, player) =>
      call<CoachDebrief>('POST', `/games/${encodeURIComponent(gameId)}/coach`, { player }),

    getMe: async (): Promise<Account | null> => (await call<MeResponse>('GET', '/me')).account,
    claimUsername: async (username) => (await call<MeResponse>('PUT', '/me', { username })).account!,
    listMyGames: async (limit = 20) => (await call<ListGamesResponse>('GET', `/me/games?limit=${limit}`)).games,

    listTournaments: async (status, limit = 30) =>
      (await call<ListTournamentsResponse>('GET', `/tournaments?limit=${limit}${status ? `&status=${status}` : ''}`)).tournaments,
    getTournament: (id) => call<TournamentDetail>('GET', `/tournaments/${encodeURIComponent(id)}`),
    createTournament: (name, maxPlayers) => call<TournamentDetail>('POST', '/tournaments', { name, maxPlayers }),
    joinTournament: (id) => call<TournamentDetail>('POST', `/tournaments/${encodeURIComponent(id)}/join`),
    leaveTournament: (id) => call<TournamentDetail>('POST', `/tournaments/${encodeURIComponent(id)}/leave`),
    startTournament: (id) => call<TournamentDetail>('POST', `/tournaments/${encodeURIComponent(id)}/start`),
    cancelTournament: (id) => call<TournamentDetail>('POST', `/tournaments/${encodeURIComponent(id)}/cancel`),
    forfeitMatch: (id, round, slot, loser) =>
      call<TournamentDetail>('POST', `/tournaments/${encodeURIComponent(id)}/matches/${round}/${slot}/forfeit`, { loser }),
    claimSeat: (gameId) => call<SeatResponse>('POST', `/games/${encodeURIComponent(gameId)}/seat`),

    async subscribe(gameId, playerToken, handlers): Promise<GameSubscription> {
      const s = getSocket();
      const entry: Entry = { gameId, playerToken, handlers, live: false };
      entries.add(entry);
      try {
        // Emits made before the first connect are buffered by socket.io and sent on connect.
        const r = await emitWithAck<SubscribeResult>(() =>
          s.timeout(ACK_TIMEOUT_MS).emitWithAck('game:subscribe', { gameId, playerToken }),
        );
        entry.live = true;
        return {
          you: r.you,
          state: r.state,
          // There is no server-side unsubscribe event: the socket stays in the room and
          // events for games nobody is watching are simply dropped here.
          unsubscribe: () => entries.delete(entry),
        };
      } catch (e) {
        entries.delete(entry);
        throw e;
      }
    },

    async move(gameId, playerToken, square) {
      const s = getSocket();
      await emitWithAck(() => s.timeout(ACK_TIMEOUT_MS).emitWithAck('game:move', { gameId, playerToken, square }));
    },

    async resign(gameId, playerToken) {
      const s = getSocket();
      await emitWithAck(() => s.timeout(ACK_TIMEOUT_MS).emitWithAck('game:resign', { gameId, playerToken }));
    },
  };
}
