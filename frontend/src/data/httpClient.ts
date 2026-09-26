/**
 * The real GameClient: REST over fetch (design-contract §3.1) plus one Socket.IO
 * connection (§3.2). All URLs are relative; Vite proxies /api and /socket.io to
 * the API, so this works unchanged through an ngrok tunnel on 5173.
 */
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  AnalysisResult,
  ApiError,
  ClientToServerEvents,
  ErrorCode,
  GameState,
  ListGamesResponse,
  SeatResponse,
  ServerToClientEvents,
  SubscribeResult,
} from '@othello/shared';
import { GameClientError, type GameClient, type GameEventHandlers, type GameSubscription } from './GameClient';

const ACK_TIMEOUT_MS = 8000;

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ---------- REST ----------

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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

export function createHttpClient(): GameClient {
  const entries = new Set<Entry>();
  let socket: TypedSocket | null = null;

  /** One connection per tab, created on first use. */
  function getSocket(): TypedSocket {
    if (socket) return socket;
    const s: TypedSocket = io({ path: '/socket.io' });

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
    createGame: (name) => request<SeatResponse>('POST', '/games', { name }),
    joinGame: (gameId, name) => request<SeatResponse>('POST', `/games/${encodeURIComponent(gameId)}/join`, { name }),
    getGame: (gameId) => request<GameState>('GET', `/games/${encodeURIComponent(gameId)}`),
    listFinishedGames: async (limit = 20) =>
      (await request<ListGamesResponse>('GET', `/games?status=finished&limit=${limit}`)).games,
    getAnalysis: (gameId) => request<AnalysisResult>('GET', `/games/${encodeURIComponent(gameId)}/analysis`),

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
