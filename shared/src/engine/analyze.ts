import type { Board, Move, MoveClass, Player, PlayerAnalysisSummary, PlyAnalysis, Square } from '../types';
import { detectMotifs } from './motifs';
import { applyMove, getLegalMoves, initialBoard } from './rules';
import { search, type SearchOptions, type SearchResult } from './search';

/**
 * Settings used by the backend's AnalysisRunner. Tuned for a full game in well under ~30s
 * (see "Tuned values" in docs/contract-deviations.md).
 */
export const ANALYSIS_SEARCH_OPTIONS: SearchOptions = { depth: 8, exactEmpties: 12, timeBudgetMs: 400 };

/** Upper bounds on `loss` (discs, mover POV) for each class; anything above `mistake` is a blunder. */
export const CLASS_THRESHOLDS = { best: 0.5, good: 2, inaccuracy: 5, mistake: 10 } as const;

export function classify(loss: number): Exclude<MoveClass, 'forced'> {
  if (loss <= CLASS_THRESHOLDS.best) return 'best';
  if (loss <= CLASS_THRESHOLDS.good) return 'good';
  if (loss <= CLASS_THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (loss <= CLASS_THRESHOLDS.mistake) return 'mistake';
  return 'blunder';
}

const round2 = (v: number) => Math.round(v * 100) / 100 || 0; // `|| 0` normalizes -0

/**
 * Grades `player` playing `square` on `board`, given a search of that position (every legal move
 * scored). The single definition of a move's grade: Game Review and Practice both use it.
 * Throws if the move is illegal. `ply` defaults to 0 for callers outside a game record.
 */
export function gradeMove(board: Board, player: Player, square: Square, res: SearchResult, ply = 0): PlyAnalysis {
  const { board: after, flipped } = applyMove(board, player, square); // throws on illegal
  const played = res.scores.find((c) => c.square === square)!;
  const best = res.scores[0];
  const sign = player === 'B' ? 1 : -1;
  const forced = res.scores.length === 1;
  const loss = forced ? 0 : Math.max(0, round2(sign * (best.eval - played.eval)));
  const classification: MoveClass = forced ? 'forced' : classify(loss);

  return {
    ply,
    player,
    square,
    flipped,
    boardBefore: board,
    boardAfter: after,
    evalBefore: round2(best.eval),
    evalAfter: round2(played.eval),
    loss,
    bestSquare: res.best,
    classification,
    isBlunder: classification === 'blunder',
    candidates: res.scores.slice(0, 3).map((c) => ({ square: c.square, eval: round2(c.eval) })),
    motifs: detectMotifs(board, player, square, res.best),
    depth: res.depth,
    exact: res.exact,
  };
}

/** Yields one PlyAnalysis per move, in order. Throws if the move list isn't a legal game. */
export function* analyzeGame(moves: Move[], opts: Partial<SearchOptions> = {}): Generator<PlyAnalysis> {
  let board = initialBoard();
  let prev: PlyAnalysis | null = null;

  for (let i = 0; i < moves.length; i++) {
    const { player, square } = moves[i];
    const ply = i + 1;

    if (square === null) {
      if (getLegalMoves(board, player).length > 0) throw new Error(`Ply ${ply}: ${player} passed with legal moves`);
      // The position is the one the previous ply's evalAfter already scored (the search handles
      // passes), so reuse it: consistent graph and no extra search.
      const v = prev ? prev.evalAfter : 0;
      const pass: PlyAnalysis = {
        ply,
        player,
        square: null,
        flipped: [],
        boardBefore: board,
        boardAfter: board,
        evalBefore: v,
        evalAfter: v,
        loss: 0,
        bestSquare: null,
        classification: 'forced',
        isBlunder: false,
        candidates: [],
        motifs: [],
        depth: prev ? prev.depth : 0,
        exact: prev ? prev.exact : false,
      };
      prev = pass;
      yield pass;
      continue;
    }

    const analysis = gradeMove(board, player, square, search(board, player, opts), ply);
    board = analysis.boardAfter;
    prev = analysis;
    yield analysis;
  }
}

const emptyCounts = (): Record<MoveClass, number> => ({
  best: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
  forced: 0,
});

function summarizePlayer(plies: PlyAnalysis[]): PlayerAnalysisSummary {
  const counts = emptyCounts();
  for (const p of plies) counts[p.classification]++;
  const scored = plies.filter((p) => p.classification !== 'forced');
  if (scored.length === 0) return { accuracy: 100, avgLoss: 0, counts };
  const accuracy = (100 * scored.reduce((s, p) => s + Math.exp(-p.loss / 6), 0)) / scored.length;
  const avgLoss = scored.reduce((s, p) => s + p.loss, 0) / scored.length;
  return { accuracy: Math.round(accuracy * 10) / 10, avgLoss: round2(avgLoss), counts };
}

/** Per-player accuracy, average loss and class counts. `counts.forced` includes passes. */
export function summarize(plies: PlyAnalysis[]): { B: PlayerAnalysisSummary; W: PlayerAnalysisSummary } {
  return {
    B: summarizePlayer(plies.filter((p) => p.player === 'B')),
    W: summarizePlayer(plies.filter((p) => p.player === 'W')),
  };
}
