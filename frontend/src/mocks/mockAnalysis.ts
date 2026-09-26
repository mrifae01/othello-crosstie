/**
 * Fake engine analysis for mock games. It isn't a search: it takes a per-ply "loss"
 * plan (authored for fixtures, a square-weight heuristic for games played in mock
 * mode) and shapes a believable, internally consistent PlyAnalysis[] around it.
 * The real numbers come from the backend's analyzeGame().
 */
import type {
  Board,
  CandidateMove,
  Motif,
  MoveClass,
  PlayedMove,
  Player,
  PlayerAnalysisSummary,
  PlyAnalysis,
  Square,
} from '@othello/shared';
import { applyMove, getLegalMoves, opponent } from '@othello/shared';
import { boardsBefore } from './replay';

/** Classic positional weights; corners high, X-squares low. */
const WEIGHTS = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];

const CORNERS = [0, 7, 56, 63];
/** X-square → adjacent corner. */
const X_SQUARES: Record<number, number> = { 9: 0, 14: 7, 49: 56, 54: 63 };
/** C-square → adjacent corner. */
const C_SQUARES: Record<number, number> = { 1: 0, 8: 0, 6: 7, 15: 7, 48: 56, 57: 56, 55: 63, 62: 63 };

export interface LossContext {
  ply: number;
  player: Player;
  board: Board;
  legal: Square[];
  played: Square;
}
export type LossPlan = (ctx: LossContext) => number;

/** Loss implied by the square-weight table: roughly 15 discs for an X-square when a corner was available. */
export const heuristicLoss: LossPlan = ({ legal, played }) => {
  const best = Math.max(...legal.map((s) => WEIGHTS[s]));
  return Math.max(0, (best - WEIGHTS[played]) / 10);
};

export function classify(loss: number): MoveClass {
  if (loss <= 0.5) return 'best';
  if (loss <= 2) return 'good';
  if (loss <= 5) return 'inaccuracy';
  if (loss <= 10) return 'mistake';
  return 'blunder';
}

const clamp = (v: number) => Math.max(-64, Math.min(64, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function buildAnalysis(
  moves: PlayedMove[],
  lossFor: LossPlan,
  /** Final B−W disc difference when the game ended normally; anchors the exact endgame. */
  finalDiff: number | null,
): PlyAnalysis[] {
  const boards = boardsBefore(moves);
  const n = moves.length;

  const legal = moves.map((m, i) => (m.square === null ? [] : getLegalMoves(boards[i], m.player)));
  const empties = boards.slice(0, n).map((b) => b.filter((c) => c === null).length);
  const exact = empties.map((e) => e <= 10);
  const sign = moves.map((m) => (m.player === 'B' ? 1 : -1));

  const loss = moves.map((m, i) => {
    if (m.square === null || legal[i].length <= 1) return 0;
    const l = Math.max(0, lossFor({ ply: m.ply, player: m.player, board: boards[i], legal: legal[i], played: m.square }));
    return exact[i] ? Math.round(l) : round1(l);
  });

  // --- Eval path (Black POV). evalAfter = evalBefore − sign·loss.
  const before = new Array<number>(n).fill(0);
  const after = new Array<number>(n).fill(0);
  const firstExact = finalDiff === null ? -1 : exact.indexOf(true);

  // Exact endgame: walk backwards from the true final result, integers, no drift.
  if (firstExact >= 0) {
    let next = finalDiff!;
    for (let i = n - 1; i >= firstExact; i--) {
      after[i] = next;
      before[i] = next + sign[i] * loss[i];
      next = before[i];
    }
  }

  // Heuristic midgame: walk forward from 0 with a little horizon wiggle, then spread
  // whatever gap remains to the exact region evenly so the curve meets it.
  const end = firstExact >= 0 ? firstExact : n;
  const drift = Array.from({ length: end }, (_, i) => 0.6 * Math.sin(i * 1.7) + 0.3 * Math.sin(i * 0.45));
  let v = 0;
  for (let i = 0; i < end; i++) {
    before[i] = v;
    after[i] = v - sign[i] * loss[i];
    v = after[i] + drift[i];
  }
  if (firstExact > 0) {
    const gap = before[firstExact] - after[firstExact - 1];
    for (let i = 1; i < firstExact; i++) {
      const shift = (gap * i) / firstExact;
      before[i] += shift;
      after[i] += shift;
    }
  }

  return moves.map((m, i): PlyAnalysis => {
    const b = boards[i];
    const round = exact[i] ? Math.round : round1;
    const evalBefore = clamp(round(before[i]));
    const evalAfter = clamp(round(after[i]));
    const isPass = m.square === null;
    const forced = isPass || legal[i].length === 1;

    let bestSquare: Square | null = m.square;
    if (!forced && loss[i] > 0) {
      const alternatives = legal[i].filter((s) => s !== m.square).sort((a, c) => WEIGHTS[c] - WEIGHTS[a]);
      bestSquare = alternatives[0] ?? m.square;
    }

    const candidates: CandidateMove[] = [];
    if (!isPass) {
      candidates.push({ square: bestSquare!, eval: evalBefore });
      if (m.square !== bestSquare) candidates.push({ square: m.square!, eval: evalAfter });
      const third = legal[i]
        .filter((s) => s !== bestSquare && s !== m.square)
        .sort((a, c) => WEIGHTS[c] - WEIGHTS[a])[0];
      if (third !== undefined) {
        candidates.push({ square: third, eval: clamp(round(evalBefore - sign[i] * (Math.max(loss[i], 1) + 2.5))) });
      }
      candidates.sort((x, y) => sign[i] * (y.eval - x.eval));
    }

    const classification: MoveClass = forced ? 'forced' : classify(loss[i]);
    return {
      ply: m.ply,
      player: m.player,
      square: m.square,
      flipped: m.flipped,
      boardBefore: b,
      boardAfter: boards[i + 1],
      evalBefore: isPass ? evalAfter : evalBefore,
      evalAfter,
      loss: loss[i],
      bestSquare: isPass ? null : bestSquare,
      classification,
      isBlunder: classification === 'blunder',
      candidates: candidates.slice(0, 3),
      motifs: isPass ? [] : motifs(b, m.player, m.square!, bestSquare),
      depth: exact[i] ? empties[i] : 6,
      exact: exact[i],
    };
  });
}

function motifs(before: Board, p: Player, sq: Square, best: Square | null): Motif[] {
  const out: Motif[] = [];
  if (CORNERS.includes(sq)) out.push('took_corner');
  if (best !== null && best !== sq && CORNERS.includes(best)) out.push('missed_corner');
  const them = opponent(p);
  const cornersBefore = new Set(getLegalMoves(before, them).filter((s) => CORNERS.includes(s)));
  const after = applyMove(before, p, sq).board;
  if (getLegalMoves(after, them).some((s) => CORNERS.includes(s) && !cornersBefore.has(s))) out.push('allowed_corner');
  if (X_SQUARES[sq] !== undefined && before[X_SQUARES[sq]] === null) out.push('x_square');
  if (C_SQUARES[sq] !== undefined && before[C_SQUARES[sq]] === null) out.push('c_square');
  return out;
}

/** Same formula as the contract's summarize() (§2 PlayerAnalysisSummary). */
export function summarize(plies: PlyAnalysis[]): { B: PlayerAnalysisSummary; W: PlayerAnalysisSummary } {
  const one = (p: Player): PlayerAnalysisSummary => {
    const mine = plies.filter((x) => x.player === p);
    const counts: Record<MoveClass, number> = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, forced: 0 };
    for (const x of mine) counts[x.classification]++;
    const scored = mine.filter((x) => x.classification !== 'forced');
    if (scored.length === 0) return { accuracy: 100, avgLoss: 0, counts };
    const accuracy = (100 * scored.reduce((a, x) => a + Math.exp(-x.loss / 6), 0)) / scored.length;
    const avgLoss = scored.reduce((a, x) => a + x.loss, 0) / scored.length;
    return { accuracy: round1(accuracy), avgLoss: round1(avgLoss), counts };
  };
  return { B: one('B'), W: one('W') };
}
