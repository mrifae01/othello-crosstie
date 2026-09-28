/**
 * In-memory GameClient that stands in for the server: same validation order, same
 * auto-pass and game-over semantics (design-contract §3), simulated latency and a
 * simulated analysis run. State lives in this tab only.
 */
import type { AnalysisResult, GameState, Player, SeatResponse, Square } from '@othello/shared';
import {
  ANALYSIS_SEARCH_OPTIONS,
  countDiscs,
  getLegalMoves,
  gradeMove,
  initialBoard,
  opponent,
  replayChecked,
  search,
  squareToAlg,
  winnerOf,
} from '@othello/shared';
import { GameClientError, type GameClient, type GameEventHandlers, type GameSubscription } from './GameClient';
import { analysisFor, buildFixtures, FIXTURE_IDS, FIXTURE_LABELS, summaryOf, type MockGameRecord } from '../mocks/fixtures';
import { heuristicLoss } from '../mocks/mockAnalysis';
import { playMove } from '../mocks/replay';

const REST_MS = 150;
const ACK_MS = 60;
const ANALYSIS_QUEUE_MS = 1200;
const ANALYSIS_PLY_MS = 70;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => structuredClone(v);
const randomToken = () => crypto.randomUUID().replace(/-/g, '');

/** Mock-only extras for the dev toolbar. Not part of GameClient; pages never see them. */
export interface MockClient extends GameClient {
  readonly isMock: true;
  /** Seat tokens the mock knows for a game, so one tab can play both sides. */
  devSeats(gameId: string): Partial<Record<Player, string>> | null;
  fixtures: { id: string; label: string }[];
}

export function createMockClient(): MockClient {
  const games = new Map<string, MockGameRecord>(buildFixtures().map((g) => [g.state.gameId, g]));
  const listeners = new Map<string, Set<GameEventHandlers>>();
  const progress = new Map<string, { done: number; total: number }>();

  function mustGet(gameId: string): MockGameRecord {
    const g = games.get(gameId);
    if (!g) throw new GameClientError('GAME_NOT_FOUND', `No game ${gameId}`);
    return g;
  }

  function validName(name: string): string {
    const n = name.trim();
    if (n.length < 1 || n.length > 24) throw new GameClientError('BAD_REQUEST', 'Name must be 1–24 characters');
    return n;
  }

  function seatOf(g: MockGameRecord, token: string | undefined): Player | null {
    if (!token) return null;
    if (g.tokens.B === token) return 'B';
    if (g.tokens.W === token) return 'W';
    return null;
  }

  /** Deliver to every subscriber of the game, asynchronously, like a socket would. */
  function emit(gameId: string, fn: (h: GameEventHandlers) => void) {
    const hs = listeners.get(gameId);
    if (!hs) return;
    setTimeout(() => hs.forEach((h) => fn(h)), 0);
  }
  const broadcast = (g: MockGameRecord) => {
    const snapshot = clone(g.state);
    emit(g.state.gameId, (h) => h.onState(clone(snapshot)));
  };

  function finish(g: MockGameRecord, winner: GameState['winner'], endReason: 'normal' | 'resign') {
    const s = g.state;
    s.status = 'finished';
    s.winner = winner;
    s.endReason = endReason;
    s.turn = null;
    s.legalMoves = [];
    s.finishedAt = new Date().toISOString();
    s.analysisStatus = s.moves.length > 0 ? 'pending' : 'none';
  }

  const running = new Set<string>();
  /** pending → running (progress per ply) → done, re-broadcasting state on each transition. */
  async function runAnalysis(g: MockGameRecord) {
    const id = g.state.gameId;
    if (running.has(id) || g.state.analysisStatus !== 'pending') return;
    running.add(id);
    await wait(ANALYSIS_QUEUE_MS);
    g.state.analysisStatus = 'running';
    const total = g.state.moves.length;
    progress.set(id, { done: 0, total });
    broadcast(g);
    for (let done = 1; done <= total; done++) {
      await wait(ANALYSIS_PLY_MS);
      progress.set(id, { done, total });
      emit(id, (h) => h.onAnalysisProgress({ gameId: id, done, total }));
    }
    g.state.analysisStatus = 'done';
    g.analysis = analysisFor(g.state, heuristicLoss);
    progress.delete(id);
    running.delete(id);
    broadcast(g);
    emit(id, (h) => h.onAnalysisReady({ gameId: id, status: 'done' }));
  }

  const client: MockClient = {
    isMock: true,
    fixtures: Object.values(FIXTURE_IDS).map((id) => ({ id, label: FIXTURE_LABELS[id] })),

    devSeats(gameId) {
      const g = games.get(gameId);
      return g ? { ...g.tokens } : null;
    },

    async createGame(name): Promise<SeatResponse> {
      await wait(REST_MS);
      const n = validName(name);
      const gameId = crypto.randomUUID();
      const token = randomToken();
      const board = initialBoard();
      games.set(gameId, {
        tokens: { B: token },
        analysis: null,
        state: {
          gameId,
          status: 'waiting',
          players: { B: { name: n, accountId: null }, W: null },
          counts: countDiscs(board),
          winner: null,
          endReason: null,
          analysisStatus: 'none',
          createdAt: new Date().toISOString(),
          finishedAt: null,
          board,
          turn: null,
          legalMoves: [],
          moves: [],
          version: 0,
        },
      });
      return { gameId, color: 'B', playerToken: token };
    },

    async joinGame(gameId, name): Promise<SeatResponse> {
      await wait(REST_MS);
      const n = validName(name);
      const g = mustGet(gameId);
      if (g.state.status !== 'waiting' || g.state.players.W) throw new GameClientError('GAME_FULL', 'Game is full');
      const token = randomToken();
      g.tokens.W = token;
      g.state.players.W = { name: n, accountId: null };
      g.state.status = 'active';
      g.state.turn = 'B';
      g.state.legalMoves = getLegalMoves(g.state.board, 'B');
      broadcast(g);
      return { gameId, color: 'W', playerToken: token };
    },

    async getGame(gameId) {
      await wait(REST_MS);
      return clone(mustGet(gameId).state);
    },

    async listFinishedGames(limit = 20) {
      await wait(REST_MS);
      return [...games.values()]
        .map((g) => g.state)
        .filter((s) => s.status === 'finished')
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
        .slice(0, Math.min(limit, 50))
        .map((s) => clone(summaryOf(s)));
    },

    async getAnalysis(gameId): Promise<AnalysisResult> {
      await wait(REST_MS);
      const g = mustGet(gameId);
      if (g.state.analysisStatus === 'done' && g.analysis) return clone({ ...g.analysis, game: summaryOf(g.state) });
      return clone({
        game: summaryOf(g.state),
        status: g.state.analysisStatus,
        progress: g.state.analysisStatus === 'running' ? (progress.get(gameId) ?? null) : null,
        plies: [],
        summary: null,
      });
    },

    async subscribe(gameId, playerToken, handlers): Promise<GameSubscription> {
      await wait(ACK_MS);
      const g = mustGet(gameId);
      let set = listeners.get(gameId);
      if (!set) listeners.set(gameId, (set = new Set()));
      // Wrap so the same handlers object can be subscribed twice and unsubscribed independently.
      const entry: GameEventHandlers = { ...handlers };
      set.add(entry);
      // The "finished, analysis pending" fixture starts its run once someone is watching.
      void runAnalysis(g);
      return {
        you: seatOf(g, playerToken),
        state: clone(g.state),
        unsubscribe: () => listeners.get(gameId)?.delete(entry),
      };
    },

    async move(gameId, playerToken, square: Square) {
      await wait(ACK_MS);
      // Validation order from §3.2.
      const g = mustGet(gameId);
      const s = g.state;
      if (s.status !== 'active') throw new GameClientError('GAME_NOT_ACTIVE', 'Game is not active');
      const seat = seatOf(g, playerToken);
      if (!seat) throw new GameClientError('BAD_TOKEN', 'Unknown player token');
      if (seat !== s.turn) throw new GameClientError('NOT_YOUR_TURN', 'Not your turn');
      if (!s.legalMoves.includes(square)) throw new GameClientError('ILLEGAL_MOVE', 'Illegal move');

      const r = playMove(s.board, s.moves, seat, square);
      s.board = r.board;
      s.moves = r.moves;
      s.version = r.moves.length;
      s.counts = countDiscs(r.board);
      if (r.turn) {
        s.turn = r.turn;
        s.legalMoves = getLegalMoves(r.board, r.turn);
      } else {
        finish(g, winnerOf(r.board), 'normal');
      }
      // Ack first, then broadcast (the sender included).
      broadcast(g);
      if (!r.turn) void runAnalysis(g);
    },

    async resign(gameId, playerToken) {
      await wait(ACK_MS);
      const g = mustGet(gameId);
      if (g.state.status !== 'active') throw new GameClientError('GAME_NOT_ACTIVE', 'Game is not active');
      const seat = seatOf(g, playerToken);
      if (!seat) throw new GameClientError('BAD_TOKEN', 'Unknown player token');
      finish(g, opponent(seat), 'resign');
      broadcast(g);
      void runAnalysis(g);
    },

    // No AI in mock mode: reviews show the template coach, as on a server without an API key.
    async getCoachDebrief() {
      return { enabled: false, debrief: null };
    },
    async requestCoachDebrief() {
      throw new GameClientError('COACH_UNAVAILABLE', 'The AI coach is not available in mock mode');
    },
    // Practice's Explain why works in mock mode so the flow can be tried: a real engine grade
    // (as the server computes it) with canned text that says it isn't Claude.
    async getCoachStatus() {
      return { enabled: true };
    },
    async explainMove({ moves, ply }) {
      await wait(900);
      const line = moves.slice(0, ply);
      const move = line[ply - 1];
      if (!move || move.square === null) throw new GameClientError('BAD_REQUEST', 'A pass has nothing to explain');
      let before;
      try {
        replayChecked(line);
        before = replayChecked(line.slice(0, -1)).board;
      } catch (e) {
        throw new GameClientError('ILLEGAL_MOVE', (e as Error).message);
      }
      const grade = gradeMove(before, move.player, move.square, search(before, move.player, ANALYSIS_SEARCH_OPTIONS), ply);
      const played = squareToAlg(move.square);
      return {
        grade,
        explanation: {
          ply,
          title: `Mock coach: ${played}`,
          explanation: `In mock mode there's no Claude, so this canned text stands in for the AI coach's explanation of ${played} (${grade.classification}).`,
          lesson: 'Run against the real API with ANTHROPIC_API_KEY set to see a real explanation.',
        },
        model: 'mock',
      };
    },

    // Mock mode is guest-only (main.tsx never enables auth with it), so these are unreachable.
    async getMe() {
      return null;
    },
    async claimUsername() {
      throw new GameClientError('UNAUTHORIZED', 'Accounts are not available in mock mode');
    },
    async listMyGames() {
      return [];
    },
    // Tournaments need accounts, so mock mode shows an empty list and refuses writes.
    async listTournaments() {
      return [];
    },
    async getTournament() {
      throw new GameClientError('TOURNAMENT_NOT_FOUND', 'Tournaments are not available in mock mode');
    },
    async createTournament() {
      throw new GameClientError('UNAUTHORIZED', 'Accounts are not available in mock mode');
    },
    async joinTournament() {
      throw new GameClientError('UNAUTHORIZED', 'Accounts are not available in mock mode');
    },
    async leaveTournament() {
      throw new GameClientError('UNAUTHORIZED', 'Accounts are not available in mock mode');
    },
    async startTournament() {
      throw new GameClientError('UNAUTHORIZED', 'Accounts are not available in mock mode');
    },
    async cancelTournament() {
      throw new GameClientError('UNAUTHORIZED', 'Accounts are not available in mock mode');
    },
    async forfeitMatch() {
      throw new GameClientError('UNAUTHORIZED', 'Accounts are not available in mock mode');
    },
    async claimSeat() {
      throw new GameClientError('UNAUTHORIZED', 'Accounts are not available in mock mode');
    },
  };

  return client;
}
