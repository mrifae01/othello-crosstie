import { describe, expect, it } from 'vitest';
import type { Board, Player } from '../types';
import { boardFromString } from '../notation';
import { applyMove, countDiscs, getLegalMoves, initialBoard, nextTurn, opponent } from './rules';
import { evaluate } from './eval';
import { search } from './search';
import { colorOf, makeMove, toCells } from './core';

const rows = (...r: string[]): Board => boardFromString(r.join(''));

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** Plays random legal moves from the start until `empties` squares remain (or the game ends). */
function randomPosition(seed: number, empties: number): { board: Board; toMove: Player | null } {
  const rand = rng(seed);
  let b = initialBoard();
  let turn: Player | null = 'B';
  while (turn && b.filter((c) => c === null).length > empties) {
    const legal = getLegalMoves(b, turn);
    b = applyMove(b, turn, legal[Math.floor(rand() * legal.length)]).board;
    turn = nextTurn(b, turn);
  }
  return { board: b, toMove: turn };
}

/** Plain minimax over rules.ts, no pruning: final Black-minus-White disc diff under perfect play. */
function bruteForce(b: Board, p: Player): number {
  const legal = getLegalMoves(b, p);
  if (legal.length === 0) {
    if (getLegalMoves(b, opponent(p)).length === 0) {
      const c = countDiscs(b);
      return c.B - c.W;
    }
    return bruteForce(b, opponent(p));
  }
  const vals = legal.map((sq) => bruteForce(applyMove(b, p, sq).board, opponent(p)));
  return p === 'B' ? Math.max(...vals) : Math.min(...vals);
}

describe('evaluate', () => {
  it('is symmetric at the start and within [-64, 64]', () => {
    expect(evaluate(initialBoard())).toBeCloseTo(0);
    for (let s = 1; s <= 30; s++) {
      const { board } = randomPosition(s, 30);
      const v = evaluate(board);
      expect(v).toBeGreaterThanOrEqual(-64);
      expect(v).toBeLessThanOrEqual(64);
    }
  });

  it('returns the exact disc differential on terminal boards', () => {
    expect(evaluate(boardFromString('B'.repeat(40) + 'W'.repeat(24)))).toBe(16);
    expect(evaluate(boardFromString('B'.repeat(62) + '..'))).toBe(62);
  });

  it('values holding a corner', () => {
    const b = initialBoard();
    b[0] = 'B';
    expect(evaluate(b)).toBeGreaterThan(4);
  });
});

describe('core move generator agrees with rules.ts', () => {
  it('on random positions', () => {
    for (let s = 1; s <= 40; s++) {
      const { board, toMove } = randomPosition(s, 10 + (s % 40));
      if (!toMove) continue;
      for (const sq of getLegalMoves(board, toMove)) {
        const cells = toCells(board);
        const n = makeMove(cells, colorOf(toMove), sq, new Int8Array(32), 0);
        const expected = toCells(applyMove(board, toMove, sq).board);
        expect(n).toBe(applyMove(board, toMove, sq).flipped.length);
        expect(Array.from(cells)).toEqual(Array.from(expected));
      }
    }
  });
});

describe('search', () => {
  it('returns every legal root move, sorted best-first for the mover', () => {
    const r = search(initialBoard(), 'B', { depth: 3 });
    expect(r.scores.map((c) => c.square).sort((a, b) => a - b)).toEqual([19, 26, 37, 44]);
    expect(r.best).toBe(r.scores[0].square);
    for (let i = 1; i < r.scores.length; i++) expect(r.scores[i - 1].eval).toBeGreaterThanOrEqual(r.scores[i].eval);

    const w = search(applyMove(initialBoard(), 'B', 19).board, 'W', { depth: 3 });
    for (let i = 1; i < w.scores.length; i++) expect(w.scores[i - 1].eval).toBeLessThanOrEqual(w.scores[i].eval);
  });

  it('returns best: null when the mover has no legal moves', () => {
    const r = search(boardFromString('B'.repeat(62) + '..'), 'W');
    expect(r).toMatchObject({ scores: [], best: null });
  });

  it('takes an obvious free corner', () => {
    // Black to move; a1 (0) is available by flipping b2 along the diagonal.
    const b = rows(
      '........',
      '.W......',
      '..B.....',
      '...BW...',
      '...WB...',
      '........',
      '........',
      '........',
    );
    expect(getLegalMoves(b, 'B')).toContain(0);
    expect(search(b, 'B', { depth: 4, exactEmpties: 0 }).best).toBe(0);

    // Same position rotated 180° with colours swapped: White should take h8 (63).
    const w: Board = b.slice().reverse().map((c) => (c === 'B' ? 'W' : c === 'W' ? 'B' : null));
    expect(getLegalMoves(w, 'W')).toContain(63);
    expect(search(w, 'W', { depth: 4, exactEmpties: 0 }).best).toBe(63);
  });

  it('exact solve with <= 4 empties matches brute force, for every root move', () => {
    let checked = 0;
    for (let s = 1; checked < 60 && s < 500; s++) {
      const { board, toMove } = randomPosition(s, 1 + (s % 4));
      if (!toMove) continue;
      const r = search(board, toMove, { exactEmpties: 10 });
      expect(r.exact).toBe(true);
      for (const cand of r.scores) {
        const after = applyMove(board, toMove, cand.square).board;
        expect(cand.eval).toBe(bruteForce(after, opponent(toMove)));
      }
      expect(r.scores[0].eval).toBe(bruteForce(board, toMove));
      checked++;
    }
    expect(checked).toBe(60);
  });

  it('is colour/rotation symmetric', () => {
    const { board, toMove } = randomPosition(11, 34);
    const mirror = board.slice().reverse().map((c) => (c === 'B' ? 'W' : c === 'W' ? 'B' : null));
    const a = search(board, toMove!, { depth: 4, exactEmpties: 0 });
    const m = search(mirror, opponent(toMove!), { depth: 4, exactEmpties: 0 });
    const mScores = new Map(m.scores.map((c) => [63 - c.square, -c.eval]));
    for (const c of a.scores) expect(mScores.get(c.square)).toBeCloseTo(c.eval, 6);
    expect(evaluate(mirror)).toBeCloseTo(-evaluate(board), 6);
  });

  it('handles passes inside the tree (exact solve through a forced pass)', () => {
    // White to move; after most replies Black must pass. Brute force is the oracle.
    const b = rows(
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWB',
      'WWWWWW..',
      'WWWWWW..',
    );
    const r = search(b, 'W');
    expect(r.exact).toBe(true);
    expect(r.scores[0].eval).toBe(bruteForce(b, 'W'));
  });

  it('respects the time budget via iterative deepening', () => {
    const { board, toMove } = randomPosition(7, 40);
    const t0 = Date.now();
    const r = search(board, toMove!, { depth: 30, exactEmpties: 0, timeBudgetMs: 50 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.depth).toBeGreaterThanOrEqual(1);
    expect(r.depth).toBeLessThan(30);
    expect(r.exact).toBe(false);
  });
});
