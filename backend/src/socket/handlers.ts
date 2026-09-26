import type { Server, Socket } from 'socket.io';
import type { Ack, ClientToServerEvents, ErrorCode, ServerToClientEvents, SubscribeResult } from '@othello/shared';
import { GameError, type GameService } from '../game/GameService';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export const roomFor = (gameId: string) => `game:${gameId}`;

function errAck(err: unknown): { ok: false; error: ErrorCode; message: string } {
  if (err instanceof GameError) return { ok: false, error: err.code, message: err.message };
  console.error('[socket] unhandled error:', err);
  return { ok: false, error: 'INTERNAL', message: 'Internal server error' };
}

const badRequest = (message: string) => ({ ok: false as const, error: 'BAD_REQUEST' as const, message });
const isObj = (p: unknown): p is Record<string, unknown> => typeof p === 'object' && p !== null;

/** Wraps a missing/non-function ack so a misbehaving client can't crash the handler. */
function safeAck<T extends object>(ack: unknown): (r: Ack<T>) => void {
  return typeof ack === 'function' ? (ack as (r: Ack<T>) => void) : () => {};
}

export function registerSocketHandlers(io: IO, games: GameService): void {
  // Every state change (join via REST, move, resign) goes to the game's room.
  games.onState((state) => io.to(roomFor(state.gameId)).emit('game:state', state));

  io.on('connection', (socket: ClientSocket) => {
    socket.on('game:subscribe', async (p, rawAck) => {
      const ack = safeAck<SubscribeResult>(rawAck);
      if (!isObj(p) || typeof p.gameId !== 'string') return ack(badRequest('`gameId` is required'));
      try {
        const { state, you } = await games.subscribe(p.gameId, p.playerToken);
        await socket.join(roomFor(p.gameId));
        ack({ ok: true, state, you });
      } catch (err) {
        ack(errAck(err));
      }
    });

    socket.on('game:move', async (p, rawAck) => {
      const ack = safeAck(rawAck);
      if (!isObj(p) || typeof p.gameId !== 'string') return ack(badRequest('`gameId` is required'));
      if (typeof p.square !== 'number' || !Number.isInteger(p.square) || p.square < 0 || p.square > 63) {
        return ack(badRequest('`square` must be an integer 0..63'));
      }
      try {
        await games.move(p.gameId, p.playerToken, p.square, () => ack({ ok: true }));
      } catch (err) {
        ack(errAck(err));
      }
    });

    socket.on('game:resign', async (p, rawAck) => {
      const ack = safeAck(rawAck);
      if (!isObj(p) || typeof p.gameId !== 'string') return ack(badRequest('`gameId` is required'));
      try {
        await games.resign(p.gameId, p.playerToken, () => ack({ ok: true }));
      } catch (err) {
        ack(errAck(err));
      }
    });
  });
}
