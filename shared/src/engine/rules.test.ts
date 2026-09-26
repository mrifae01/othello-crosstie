import { describe, expect, it } from 'vitest';
import type { Board } from '../types';
import { boardFromString, squareToAlg, algToSquare, boardToString } from '../notation';
import {
  applyMove,
  countDiscs,
  getFlips,
  getLegalMoves,
  initialBoard,
  nextTurn,
  opponent,
  winnerOf,
} from './rules';

/** Build a board from 8 rows of 8 chars ('.', 'B', 'W'), row 0 (rank 1) first. */
const rows = (...r: string[]): Board => boardFromString(r.join(''));

describe('notation', () => {
  it('round-trips squares', () => {
    expect(squareToAlg(19)).toBe('d3');
    expect(algToSquare('d3')).toBe(19);
    for (let sq = 0; sq < 64; sq++) expect(algToSquare(squareToAlg(sq))).toBe(sq);
  });
  it('round-trips boards', () => {
    const s = boardToString(initialBoard());
    expect(s).toHaveLength(64);
    expect(boardFromString(s)).toEqual(initialBoard());
  });
});

describe('rules', () => {
  it('initial board has the four centre discs', () => {
    const b = initialBoard();
    expect([b[27], b[28], b[35], b[36]]).toEqual(['W', 'B', 'B', 'W']);
    expect(countDiscs(b)).toEqual({ B: 2, W: 2 });
  });

  it("Black's initial legal moves are exactly d3, c4, f5, e6", () => {
    expect(getLegalMoves(initialBoard(), 'B')).toEqual([19, 26, 37, 44]);
  });

  it('applyMove(initial, B, d3) flips d4 only, and is pure', () => {
    const b = initialBoard();
    const { board, flipped } = applyMove(b, 'B', 19);
    expect(flipped).toEqual([27]);
    expect(board[19]).toBe('B');
    expect(board[27]).toBe('B');
    expect(countDiscs(board)).toEqual({ B: 4, W: 1 });
    expect(b).toEqual(initialBoard());
  });

  it('applyMove throws on an illegal move', () => {
    expect(() => applyMove(initialBoard(), 'B', 0)).toThrow();
    expect(() => applyMove(initialBoard(), 'B', 27)).toThrow(); // occupied
    expect(getFlips(initialBoard(), 'B', 64)).toEqual([]);
  });

  it('flips along several directions at once', () => {
    const b = rows(
      'B.B.B...',
      '.WWW....',
      'BW.WB...',
      '.WWW....',
      'B.B.B...',
      '........',
      '........',
      '........',
    );
    const { flipped } = applyMove(b, 'B', 18); // c3, surrounded on all 8 sides
    expect(flipped).toEqual([9, 10, 11, 17, 19, 25, 26, 27]);
  });

  it('a forced-pass position produces a pass from nextTurn', () => {
    // After W plays, B has no legal move but W still does -> W moves again.
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
    expect(getLegalMoves(b, 'B')).toEqual([]);
    expect(getLegalMoves(b, 'W').length).toBeGreaterThan(0);
    expect(nextTurn(b, 'W')).toBe('W');
  });

  it('nextTurn hands the move to the opponent when they can move', () => {
    const { board } = applyMove(initialBoard(), 'B', 19);
    expect(nextTurn(board, 'B')).toBe('W');
  });

  it('a full board is terminal', () => {
    const b = boardFromString('B'.repeat(40) + 'W'.repeat(24));
    expect(getLegalMoves(b, 'B')).toEqual([]);
    expect(getLegalMoves(b, 'W')).toEqual([]);
    expect(nextTurn(b, 'B')).toBeNull();
    expect(nextTurn(b, 'W')).toBeNull();
    expect(winnerOf(b)).toBe('B');
  });

  it('a board with empties but no moves for either side is terminal', () => {
    const b = boardFromString('B'.repeat(62) + '..');
    expect(nextTurn(b, 'B')).toBeNull();
  });

  it('winnerOf handles draws and White wins', () => {
    expect(winnerOf(boardFromString('B'.repeat(32) + 'W'.repeat(32)))).toBe('draw');
    expect(winnerOf(boardFromString('B'.repeat(10) + 'W'.repeat(54)))).toBe('W');
  });

  it('opponent flips colour', () => {
    expect(opponent('B')).toBe('W');
    expect(opponent('W')).toBe('B');
  });

  it('random playouts always end, keep disc counts consistent, and never break the rules', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let g = 0; g < 50; g++) {
      let b = initialBoard();
      let turn: 'B' | 'W' | null = 'B';
      let plies = 0;
      while (turn) {
        const legal = getLegalMoves(b, turn);
        expect(legal.length).toBeGreaterThan(0);
        const sq = legal[Math.floor(rand() * legal.length)];
        const before = countDiscs(b);
        const { board, flipped } = applyMove(b, turn, sq);
        const after = countDiscs(board);
        expect(after[turn]).toBe(before[turn] + flipped.length + 1);
        expect(after[opponent(turn)]).toBe(before[opponent(turn)] - flipped.length);
        b = board;
        turn = nextTurn(b, turn);
        expect(++plies).toBeLessThanOrEqual(60);
      }
    }
  });
});
