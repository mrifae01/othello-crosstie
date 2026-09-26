/**
 * End-to-end smoke test against a running server (`npm start` or `npm run dev -w backend`).
 *   npm run smoke -w backend            # defaults to http://localhost:3001
 *   API_URL=http://host:port npm run smoke -w backend
 */
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  AnalysisResult,
  ApiError,
  ClientToServerEvents,
  GameState,
  ListGamesResponse,
  SeatResponse,
  ServerToClientEvents,
  SubscribeResult,
} from '@othello/shared';

const BASE = process.env.API_URL ?? 'http://localhost:3001';
type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

function connect(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s: ClientSocket = io(BASE, { transports: ['websocket'], reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function emitAck<T extends object>(s: ClientSocket, event: keyof ClientToServerEvents, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 5000);
    (s.emit as (e: string, p: unknown, cb: (r: Ack<T>) => void) => void)(event, payload, (r) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

/** Tracks the newest game:state seen on a socket (respecting the version rule). */
function track(s: ClientSocket) {
  const box: { latest: GameState | null; count: number } = { latest: null, count: 0 };
  s.on('game:state', (st) => {
    box.count++;
    if (!box.latest || st.version >= box.latest.version) box.latest = st;
  });
  return box;
}

async function waitFor(pred: () => boolean, what: string, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function step(msg: string) {
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log(`smoke → ${BASE}`);

  const health = await api<{ ok: boolean; db: boolean }>('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.data, { ok: true, db: true });
  step('GET /api/health → db: true');

  // ---- validation errors ----
  const bad = await api<ApiError>('POST', '/api/games', { name: '   ' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'BAD_REQUEST');
  const missing = await api<ApiError>('GET', '/api/games/00000000-0000-0000-0000-000000000000');
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error.code, 'GAME_NOT_FOUND');
  const junkId = await api<ApiError>('GET', '/api/games/not-a-uuid');
  assert.equal(junkId.status, 404);
  step('400 BAD_REQUEST on blank name; 404 GAME_NOT_FOUND on unknown and malformed ids');

  // ---- create + join ----
  const created = await api<SeatResponse>('POST', '/api/games', { name: 'Alice' });
  assert.equal(created.status, 201);
  assert.equal(created.data.color, 'B');
  const { gameId, playerToken: blackToken } = created.data;

  const waiting = await api<GameState>('GET', `/api/games/${gameId}`);
  assert.equal(waiting.data.status, 'waiting');
  assert.equal(waiting.data.players.W, null);
  assert.equal(waiting.data.turn, null);
  assert.deepEqual(waiting.data.legalMoves, []);
  step(`POST /api/games → 201, game ${gameId} waiting`);

  // Black subscribes before White joins, so it should see the join broadcast.
  const sb = await connect();
  const bBox = track(sb);
  const subB = await emitAck<SubscribeResult>(sb, 'game:subscribe', { gameId, playerToken: blackToken });
  assert.ok(subB.ok);
  assert.equal(subB.you, 'B');

  const joined = await api<SeatResponse>('POST', `/api/games/${gameId}/join`, { name: 'Bob' });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.color, 'W');
  const whiteToken = joined.data.playerToken;
  await waitFor(() => bBox.latest?.status === 'active', 'join broadcast to Black');
  assert.equal(bBox.latest!.turn, 'B');
  assert.deepEqual(bBox.latest!.legalMoves, [19, 26, 37, 44]);
  step('POST /join → 200 W; Black received game:state (active, turn B)');

  const full = await api<ApiError>('POST', `/api/games/${gameId}/join`, { name: 'Carol' });
  assert.equal(full.status, 409);
  assert.equal(full.data.error.code, 'GAME_FULL');
  step('second join → 409 GAME_FULL');

  const sw = await connect();
  const wBox = track(sw);
  const subW = await emitAck<SubscribeResult>(sw, 'game:subscribe', { gameId, playerToken: whiteToken });
  assert.ok(subW.ok);
  assert.equal(subW.you, 'W');

  const spec = await connect();
  const subS = await emitAck<SubscribeResult>(spec, 'game:subscribe', { gameId, playerToken: 'garbage' });
  assert.ok(subS.ok);
  assert.equal(subS.you, null);
  const subMissing = await emitAck<SubscribeResult>(spec, 'game:subscribe', { gameId: '00000000-0000-0000-0000-000000000000' });
  assert.ok(!subMissing.ok && subMissing.error === 'GAME_NOT_FOUND');
  step('game:subscribe → you B / W / null (bad token = spectator); unknown game → GAME_NOT_FOUND');

  // ---- rejected moves ----
  const outOfTurn = await emitAck(sw, 'game:move', { gameId, playerToken: whiteToken, square: 19 });
  assert.ok(!outOfTurn.ok);
  assert.equal(outOfTurn.error, 'NOT_YOUR_TURN');
  const illegal = await emitAck(sb, 'game:move', { gameId, playerToken: blackToken, square: 0 });
  assert.ok(!illegal.ok);
  assert.equal(illegal.error, 'ILLEGAL_MOVE');
  const badTok = await emitAck(spec, 'game:move', { gameId, playerToken: 'garbage', square: 19 });
  assert.ok(!badTok.ok);
  assert.equal(badTok.error, 'BAD_TOKEN');
  const afterRejects = await api<GameState>('GET', `/api/games/${gameId}`);
  assert.equal(afterRejects.data.version, 0);
  step('out-of-turn → NOT_YOUR_TURN, illegal → ILLEGAL_MOVE, bad token → BAD_TOKEN; state unchanged');

  // ---- play to completion with legalMoves[0] ----
  const tokens = { B: blackToken, W: whiteToken };
  const sockets = { B: sb, W: sw };
  let state = afterRejects.data;
  let passes = 0;
  while (state.status === 'active') {
    const mover = state.turn!;
    const square = state.legalMoves[0];
    const r = await emitAck(sockets[mover], 'game:move', { gameId, playerToken: tokens[mover], square });
    assert.ok(r.ok, `move ${mover}@${square} rejected: ${JSON.stringify(r)}`);
    // Persisted before ack, so a GET must already reflect it.
    const next = (await api<GameState>('GET', `/api/games/${gameId}`)).data;
    assert.ok(next.version > state.version);
    passes += next.moves.slice(state.version).filter((m) => m.square === null).length;
    state = next;
  }
  step(`played to completion: ${state.version} plies (${passes} auto-pass${passes === 1 ? '' : 'es'})`);

  assert.equal(state.status, 'finished');
  assert.ok(state.winner !== null, 'winner must be non-null');
  assert.equal(state.endReason, 'normal');
  assert.equal(state.turn, null);
  assert.deepEqual(state.legalMoves, []);
  assert.equal(state.analysisStatus, 'pending');
  assert.ok(state.finishedAt);
  assert.equal(state.moves.length, state.version);
  state.moves.forEach((m, i) => assert.equal(m.ply, i + 1));
  const want = state.counts.B > state.counts.W ? 'B' : state.counts.W > state.counts.B ? 'W' : 'draw';
  assert.equal(state.winner, want);
  step(`finished: winner ${state.winner} (${state.counts.B}–${state.counts.W}), analysisStatus pending`);

  await waitFor(() => bBox.latest?.version === state.version && wBox.latest?.version === state.version, 'final broadcast');
  assert.equal(bBox.latest!.status, 'finished');
  assert.equal(wBox.latest!.status, 'finished');
  step('both seats received the final game:state');

  const refetched = (await api<GameState>('GET', `/api/games/${gameId}`)).data;
  assert.equal(refetched.moves.length, state.version);
  step(`GET /api/games/:id → moves.length === ${state.version} === final version`);

  const lateMove = await emitAck(sb, 'game:move', { gameId, playerToken: blackToken, square: 0 });
  assert.ok(!lateMove.ok && lateMove.error === 'GAME_NOT_ACTIVE');
  step('move after game over → GAME_NOT_ACTIVE');

  const analysis = await api<AnalysisResult>('GET', `/api/games/${gameId}/analysis`);
  assert.equal(analysis.status, 200);
  assert.equal(analysis.data.status, 'pending');
  assert.deepEqual(analysis.data.plies, []);
  assert.equal(analysis.data.summary, null);
  assert.equal(analysis.data.game.gameId, gameId);
  step('GET /analysis → 200 { status: pending, plies: [], summary: null }');

  const list = await api<ListGamesResponse>('GET', '/api/games?status=finished&limit=5');
  assert.equal(list.status, 200);
  assert.ok(list.data.games.some((g) => g.gameId === gameId));
  const badList = await api<ApiError>('GET', '/api/games?limit=abc');
  assert.equal(badList.status, 400);
  step('GET /api/games?status=finished lists the game; bad limit → 400');

  // ---- resign flow on a second game ----
  const g2 = (await api<SeatResponse>('POST', '/api/games', { name: 'Dana' })).data;
  const j2 = (await api<SeatResponse>('POST', `/api/games/${g2.gameId}/join`, { name: 'Eve' })).data;
  const s2 = await connect();
  const box2 = track(s2);
  await emitAck(s2, 'game:subscribe', { gameId: g2.gameId });
  const rz = await emitAck(s2, 'game:resign', { gameId: g2.gameId, playerToken: j2.playerToken });
  assert.ok(rz.ok);
  await waitFor(() => box2.latest?.status === 'finished', 'resign broadcast');
  assert.equal(box2.latest!.winner, 'B');
  assert.equal(box2.latest!.endReason, 'resign');
  assert.equal(box2.latest!.analysisStatus, 'none'); // no moves were played
  const rz2 = await emitAck(s2, 'game:resign', { gameId: g2.gameId, playerToken: g2.playerToken });
  assert.ok(!rz2.ok && rz2.error === 'GAME_NOT_ACTIVE');
  step('resign before any move → winner B, endReason resign, analysisStatus none; re-resign → GAME_NOT_ACTIVE');

  for (const s of [sb, sw, spec, s2]) s.disconnect();
  console.log('\nSMOKE PASSED');
}

main().catch((err) => {
  console.error('\nSMOKE FAILED:', err);
  process.exit(1);
});
