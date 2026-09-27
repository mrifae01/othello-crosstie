/**
 * Mock fixtures. Every board is produced by replaying a real, legal transcript
 * through the shared engine, so positions are always consistent.
 */
import type { AnalysisResult, EndReason, GameState, GameStatus, Player, Winner } from '@othello/shared';
import { countDiscs, getLegalMoves, initialBoard, winnerOf } from '@othello/shared';
import { replay } from './replay';
import { buildAnalysis, summarize, type LossPlan } from './mockAnalysis';

export interface MockGameRecord {
  state: GameState;
  tokens: Partial<Record<Player, string>>;
  /** Stored result once analysis is done. */
  analysis: AnalysisResult | null;
}

export const FIXTURE_IDS = {
  waiting: 'demo-waiting',
  active: 'demo-active',
  finished: 'demo-finished',
  analyzed: 'demo-analyzed',
  resignedEarly: 'demo-resigned-early',
  failed: 'demo-failed',
} as const;

export const FIXTURE_LABELS: Record<string, string> = {
  [FIXTURE_IDS.waiting]: 'Waiting for opponent',
  [FIXTURE_IDS.active]: 'Active game',
  [FIXTURE_IDS.finished]: 'Finished, analysis runs on open',
  [FIXTURE_IDS.analyzed]: 'Finished + full review',
  [FIXTURE_IDS.resignedEarly]: 'Resigned, no moves',
  [FIXTURE_IDS.failed]: 'Analysis failed',
};

/** Full game, 63 plies: forced move at 42, pass at 44, White's X-square blunder g7 at 38. Black wins 35–29. */
const ANALYZED_GAME =
  'c4c5e6c3b4a3c2c1b3f5c6a4f6d7f7f4g4h3d3e2d6c7e3f2f3f8c8e8g6h7h6h5d2e1g5e7d8g7h8g8d1b8a8h4g3a5a6f1g1b5b6b1a1h2g2a2b2a7b7h1';
/** Full game, early pass at ply 11. White wins 47–17. */
const FINISHED_GAME =
  'c4c3e6b4a4a5c2f4g4a3d2e2c1b2e1a1a2c5b5a6b3d1a7a8b6f3f2d3e3e7f7c6f1h4h5g3e8g5h3b1c7d8f5f8c8d6g8h6f6g6h7h2h1b8d7h8b7g7g2g1';
/** Used for the active game (first 14 placements) and the failed-analysis game. */
const OTHER_GAME =
  'c4e3f5b4c3e6f4g4a5a4a3c2c5c6d2e2c1b2e1a1a2g5h5f2a6b6d3h4c7d7d1b5b3h6f1f3e8c8f6g6d8f8d6a7e7g3f7g1h3g8h7b1b7a8b8g7h8h2h1g2';

/** Authored coaching story for the analyzed game: a Black mistake hands White the lead, then White blunders into h8. */
const ANALYZED_LOSSES: Record<number, number> = {
  7: 1.4,
  12: 3.2, // White inaccuracy
  19: 1.1,
  25: 7.5, // Black mistake
  28: 0.8,
  31: 2.6, // Black inaccuracy
  38: 16, // White blunder: g7 X-square, Black takes h8 next
  47: 1.8,
  53: 3, // exact endgame inaccuracy
};
const analyzedPlan: LossPlan = ({ ply }) => ANALYZED_LOSSES[ply] ?? [0, 0.3, 0, 0.6, 0, 0.2, 1.2, 0, 0.4, 0][ply % 10];

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

interface FixtureSpec {
  id: string;
  black: string;
  white: string | null;
  transcript: string;
  maxPlaced?: number;
  status: GameStatus;
  endReason?: EndReason;
  /** For resignations: who resigned. */
  resigned?: Player;
  createdMinAgo: number;
  finishedMinAgo?: number;
}

function buildState(spec: FixtureSpec): GameState {
  const r = replay(spec.transcript, spec.maxPlaced);
  const board = spec.status === 'waiting' ? initialBoard() : r.board;
  const finished = spec.status === 'finished';
  let winner: Winner | null = null;
  if (finished) winner = spec.resigned ? (spec.resigned === 'B' ? 'W' : 'B') : winnerOf(board);
  const turn = spec.status === 'active' ? r.turn : null;
  return {
    gameId: spec.id,
    status: spec.status,
    players: {
      B: { name: spec.black, accountId: null },
      W: spec.white ? { name: spec.white, accountId: null } : null,
    },
    counts: countDiscs(board),
    winner,
    endReason: finished ? (spec.endReason ?? 'normal') : null,
    analysisStatus: 'none',
    createdAt: minutesAgo(spec.createdMinAgo),
    finishedAt: finished ? minutesAgo(spec.finishedMinAgo ?? 0) : null,
    board,
    turn,
    legalMoves: turn ? getLegalMoves(board, turn) : [],
    moves: spec.status === 'waiting' ? [] : r.moves,
    version: spec.status === 'waiting' ? 0 : r.moves.length,
  };
}

function record(state: GameState): MockGameRecord {
  const tokens: Partial<Record<Player, string>> = { B: `mock-token-${state.gameId}-B` };
  if (state.players.W) tokens.W = `mock-token-${state.gameId}-W`;
  return { state, tokens, analysis: null };
}

export function analysisFor(state: GameState, plan: LossPlan): AnalysisResult {
  const finalDiff = state.endReason === 'normal' ? state.counts.B - state.counts.W : null;
  const plies = buildAnalysis(state.moves, plan, finalDiff);
  return { game: summaryOf(state), status: 'done', progress: null, plies, summary: summarize(plies) };
}

export function summaryOf(s: GameState): AnalysisResult['game'] {
  const { gameId, status, players, counts, winner, endReason, analysisStatus, createdAt, finishedAt } = s;
  return { gameId, status, players, counts, winner, endReason, analysisStatus, createdAt, finishedAt };
}

export function buildFixtures(): MockGameRecord[] {
  const waiting = record(
    buildState({ id: FIXTURE_IDS.waiting, black: 'Ada', white: null, transcript: '', status: 'waiting', createdMinAgo: 2 }),
  );

  const active = record(
    buildState({
      id: FIXTURE_IDS.active,
      black: 'Ada',
      white: 'Grace',
      transcript: OTHER_GAME,
      maxPlaced: 14,
      status: 'active',
      createdMinAgo: 9,
    }),
  );

  const finished = record(
    buildState({
      id: FIXTURE_IDS.finished,
      black: 'Linus',
      white: 'Margaret',
      transcript: FINISHED_GAME,
      status: 'finished',
      createdMinAgo: 40,
      finishedMinAgo: 1,
    }),
  );
  // Analysis is queued; the mock starts it the first time someone subscribes.
  finished.state.analysisStatus = 'pending';

  const analyzedState = buildState({
    id: FIXTURE_IDS.analyzed,
    black: 'Katherine',
    white: 'Alan',
    transcript: ANALYZED_GAME,
    status: 'finished',
    createdMinAgo: 90,
    finishedMinAgo: 55,
  });
  analyzedState.analysisStatus = 'done';
  const analyzed = record(analyzedState);
  analyzed.analysis = analysisFor(analyzedState, analyzedPlan);

  const resignedEarly = record(
    buildState({
      id: FIXTURE_IDS.resignedEarly,
      black: 'Barbara',
      white: 'Dennis',
      transcript: '',
      maxPlaced: 0,
      status: 'finished',
      endReason: 'resign',
      resigned: 'B',
      createdMinAgo: 200,
      finishedMinAgo: 199,
    }),
  );

  const failed = record(
    buildState({
      id: FIXTURE_IDS.failed,
      black: 'Edsger',
      white: 'Frances',
      transcript: OTHER_GAME,
      status: 'finished',
      createdMinAgo: 300,
      finishedMinAgo: 260,
    }),
  );
  failed.state.analysisStatus = 'failed';

  return [waiting, active, finished, analyzed, resignedEarly, failed];
}
