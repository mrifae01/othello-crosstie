import type { Board, CandidateMove, Player, Square } from '../types';
import { colorOf, countEmpties, discDiff, isLegal, makeMove, toCells, unmakeMove, type Cells, type Color } from './core';
import { evaluateCells } from './eval';

export interface SearchOptions {
  /** Nominal ply depth (default 6). */
  depth: number;
  /** Solve to the end when empties <= this (default 10). */
  exactEmpties: number;
  /** Iterative deepening stops at this; returns the deepest completed depth (depth 1 always completes). */
  timeBudgetMs?: number;
}

export interface SearchResult {
  /** EVERY legal root move, full-window (exact at the searched depth), sorted best-first for `p`. Evals are Black POV. */
  scores: CandidateMove[];
  /** null if p has no legal moves. */
  best: Square | null;
  depth: number;
  exact: boolean;
  nodes: number;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = { depth: 6, exactEmpties: 10 };

/** Static move-ordering weights: corners first, X-squares last. */
// prettier-ignore
const SQUARE_WEIGHT = [
  100, -20, 10,  5,  5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
   10,  -2,  1,  1,  1,  1,  -2,  10,
    5,  -2,  1,  0,  0,  1,  -2,   5,
    5,  -2,  1,  0,  0,  1,  -2,   5,
   10,  -2,  1,  1,  1,  1,  -2,  10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10,  5,  5, 10, -20, 100,
];
const ORDER: number[] = Array.from({ length: 64 }, (_, i) => i).sort((a, b) => SQUARE_WEIGHT[b] - SQUARE_WEIGHT[a]);

const INF = 1000;
const FLIP_STRIDE = 24; // > max flips per move (18)

class Timeout extends Error {}

class Searcher {
  nodes = 0;
  private readonly flips = new Int8Array(FLIP_STRIDE * 80);
  constructor(
    private readonly cells: Cells,
    private readonly deadline: number,
  ) {}

  /** Negamax with alpha-beta. Returns the score from `color`'s POV. Passes don't use depth. */
  negamax(color: Color, depth: number, alpha: number, beta: number, passed: boolean, ply: number): number {
    if ((++this.nodes & 2047) === 0 && Date.now() > this.deadline) throw new Timeout();
    const cells = this.cells;
    if (depth <= 0) return color * evaluateCells(cells);

    const offset = ply * FLIP_STRIDE;
    let best = -INF;
    let moved = false;
    for (let i = 0; i < 64; i++) {
      const sq = ORDER[i];
      if (cells[sq] !== 0) continue;
      const n = makeMove(cells, color, sq, this.flips, offset);
      if (n === 0) continue;
      moved = true;
      const score = -this.negamax(-color as Color, depth - 1, -beta, -alpha, false, ply + 1);
      unmakeMove(cells, color, sq, this.flips, offset, n);
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) break;
        }
      }
    }
    if (moved) return best;
    // No legal move: two passes in a row is terminal, otherwise pass without using depth.
    if (passed) return color * discDiff(cells);
    return -this.negamax(-color as Color, depth, -beta, -alpha, true, ply + 1);
  }

  /** Full-window score (mover POV) for every root move at `depth`. */
  scoreRoot(color: Color, rootMoves: Square[], depth: number): Map<Square, number> {
    const out = new Map<Square, number>();
    for (const sq of rootMoves) {
      const n = makeMove(this.cells, color, sq, this.flips, 0);
      try {
        out.set(sq, -this.negamax(-color as Color, depth - 1, -INF, INF, false, 1));
      } finally {
        unmakeMove(this.cells, color, sq, this.flips, 0, n);
      }
    }
    return out;
  }
}

export function search(b: Board, p: Player, opts: Partial<SearchOptions> = {}): SearchResult {
  const o = { ...DEFAULT_SEARCH_OPTIONS, ...opts };
  const cells = toCells(b);
  const color = colorOf(p);
  let rootMoves = ORDER.filter((sq) => isLegal(cells, color, sq));
  if (rootMoves.length === 0) return { scores: [], best: null, depth: 0, exact: false, nodes: 0 };

  const empties = countEmpties(cells);
  let scores: Map<Square, number>;
  let depth: number;
  let exact = false;
  let nodes = 0;

  if (empties <= o.exactEmpties) {
    // Endgame: search to the end of the game. Small enough that the time budget doesn't apply.
    const s = new Searcher(cells, Infinity);
    scores = s.scoreRoot(color, rootMoves, empties);
    nodes = s.nodes;
    depth = empties;
    exact = true;
  } else {
    const deadline = o.timeBudgetMs === undefined ? Infinity : Date.now() + o.timeBudgetMs;
    const maxDepth = Math.max(1, Math.min(o.depth, empties));
    scores = new Map();
    depth = 0;
    for (let d = 1; d <= maxDepth; d++) {
      const s = new Searcher(cells, d === 1 ? Infinity : deadline);
      try {
        const next = s.scoreRoot(color, rootMoves, d);
        scores = next;
        depth = d;
        // Search the next iteration's root moves best-first (cheaper cutoffs inside each subtree).
        rootMoves = [...rootMoves].sort((a, z) => next.get(z)! - next.get(a)!);
      } catch (err) {
        if (!(err instanceof Timeout)) throw err;
        nodes += s.nodes;
        break;
      } finally {
        cells.set(toCells(b)); // restore after an aborted iteration left moves applied
      }
      nodes += s.nodes;
      if (Date.now() > deadline) break;
    }
  }

  const sorted = [...scores.entries()].sort((a, z) => z[1] - a[1] || SQUARE_WEIGHT[z[0]] - SQUARE_WEIGHT[a[0]]);
  return {
    scores: sorted.map(([square, s]) => ({ square, eval: color * s })),
    best: sorted[0][0],
    depth,
    exact,
    nodes,
  };
}
