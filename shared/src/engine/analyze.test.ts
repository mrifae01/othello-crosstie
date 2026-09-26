import { describe, expect, it } from 'vitest';
import type { Board, Move, Player } from '../types';
import { boardFromString } from '../notation';
import { analyzeGame, classify, summarize } from './analyze';
import { detectMotifs } from './motifs';
import { applyMove, getLegalMoves, initialBoard, nextTurn, opponent } from './rules';

const rows = (...r: string[]): Board => boardFromString(r.join(''));
const FAST = { depth: 3, exactEmpties: 8 };

/** The smoke-test game: always legalMoves[0], with server-style auto-passes. */
function firstMoveGame(): Move[] {
  const moves: Move[] = [];
  let b = initialBoard();
  let turn: Player | null = 'B';
  while (turn) {
    const sq = getLegalMoves(b, turn)[0];
    moves.push({ player: turn, square: sq });
    b = applyMove(b, turn, sq).board;
    const next = nextTurn(b, turn);
    if (next === turn) moves.push({ player: opponent(turn), square: null });
    turn = next;
  }
  return moves;
}

describe('classify', () => {
  it('uses the contract thresholds', () => {
    expect([0, 0.5, 0.6, 2, 2.1, 5, 5.1, 10, 10.1].map(classify)).toEqual([
      'best', 'best', 'good', 'good', 'inaccuracy', 'inaccuracy', 'mistake', 'mistake', 'blunder',
    ]);
  });
});

describe('analyzeGame', () => {
  const moves = firstMoveGame();
  const plies = [...analyzeGame(moves, FAST)];

  it('yields one consistent PlyAnalysis per move', () => {
    expect(moves.some((m) => m.square === null)).toBe(true); // the game includes passes
    expect(plies).toHaveLength(moves.length);
    plies.forEach((p, i) => {
      expect(p.ply).toBe(i + 1);
      expect(p.player).toBe(moves[i].player);
      expect(p.square).toBe(moves[i].square);
      expect(p.loss).toBeGreaterThanOrEqual(0);
      expect(p.isBlunder).toBe(p.classification === 'blunder');
      expect(p.candidates.length).toBeLessThanOrEqual(3);
      if (i > 0) expect(p.boardBefore).toEqual(plies[i - 1].boardAfter);
      if (p.square === null) {
        expect(p).toMatchObject({ classification: 'forced', loss: 0, bestSquare: null, flipped: [] });
        expect(p.evalBefore).toBe(plies[i - 1].evalAfter);
      } else {
        expect(p.bestSquare).not.toBeNull();
        expect(p.candidates[0].square).toBe(p.bestSquare);
        expect(p.evalBefore).toBe(p.candidates[0].eval);
      }
    });
    const last = plies.at(-1)!;
    expect(last.exact).toBe(true);
  });

  it('classifies single-option moves as forced with zero loss', () => {
    for (const p of plies) {
      if (p.square !== null && getLegalMoves(p.boardBefore, p.player).length === 1) {
        expect(p).toMatchObject({ classification: 'forced', loss: 0 });
      }
    }
  });

  it('rejects an illegal move list', () => {
    expect(() => [...analyzeGame([{ player: 'B', square: 0 }], FAST)]).toThrow();
  });

  it('summarize follows the accuracy formula', () => {
    const s = summarize(plies);
    for (const who of ['B', 'W'] as const) {
      const mine = plies.filter((p) => p.player === who);
      const scored = mine.filter((p) => p.classification !== 'forced');
      const acc = (100 * scored.reduce((a, p) => a + Math.exp(-p.loss / 6), 0)) / scored.length;
      expect(s[who].accuracy).toBeCloseTo(acc, 1);
      expect(Object.values(s[who].counts).reduce((a, b) => a + b, 0)).toBe(mine.length);
    }
    expect(summarize([])).toEqual({
      B: { accuracy: 100, avgLoss: 0, counts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, forced: 0 } },
      W: { accuracy: 100, avgLoss: 0, counts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, forced: 0 } },
    });
  });
});

describe('detectMotifs', () => {
  // Black can take a1 (via b2) or play elsewhere.
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

  it('took_corner', () => {
    expect(detectMotifs(b, 'B', 0, 0)).toContain('took_corner');
  });

  it('missed_corner', () => {
    expect(detectMotifs(b, 'B', 29, 0)).toContain('missed_corner');
    expect(detectMotifs(b, 'B', 29, 29)).not.toContain('missed_corner');
  });

  // Black plays b2 (9), flipping c2 (10) against d2 (11). White's c3 (18) is untouched,
  // so afterwards White can take a1 through b2.
  const x = initialBoard();
  x[10] = 'W';
  x[11] = 'B';
  x[18] = 'W';

  it('x_square only while the adjacent corner is empty', () => {
    expect(getLegalMoves(x, 'B')).toContain(9);
    expect(detectMotifs(x, 'B', 9, null)).toContain('x_square');
    const withCorner = x.slice();
    withCorner[0] = 'W';
    expect(detectMotifs(withCorner, 'B', 9, null)).not.toContain('x_square');
  });

  it('allowed_corner', () => {
    expect(getLegalMoves(x, 'W')).not.toContain(0);
    expect(getLegalMoves(applyMove(x, 'B', 9).board, 'W')).toContain(0);
    expect(detectMotifs(x, 'B', 9, null)).toContain('allowed_corner');
    expect(detectMotifs(b, 'B', 0, 0)).not.toContain('allowed_corner');
  });

  it('c_square', () => {
    // Black plays b1 (1): flips c2 (10) against d3 (19).
    const c = initialBoard();
    c[10] = 'W';
    c[19] = 'B';
    expect(getLegalMoves(c, 'B')).toContain(1);
    expect(detectMotifs(c, 'B', 1, null)).toContain('c_square');
  });
});
