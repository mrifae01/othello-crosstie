import { describe, expect, it } from 'vitest';
import type { Board, Move, Player } from './types';
import { seededRng } from './engine/bot';
import { countDiscs, getFlips, getLegalMoves, initialBoard, opponent } from './engine/rules';
import { lastPlacedSquare, playMove, positionKey, replay, replayChecked } from './line';

/** Plays seeded random games with playMove, calling `check` on every move. */
function playRandomGames(
  games: number,
  check: (before: Board, player: Player, square: number, line: Move[], r: ReturnType<typeof playMove>) => void,
) {
  for (let seed = 1; seed <= games; seed++) {
    const rand = seededRng(seed);
    let board = initialBoard();
    let turn: Player | null = 'B';
    const line: Move[] = [];
    while (turn) {
      const legal = getLegalMoves(board, turn);
      const square = legal[Math.floor(rand() * legal.length)];
      const r = playMove(board, turn, square);
      check(board, turn, square, line, r);
      line.push(...r.moves);
      board = r.board;
      turn = r.turn;
    }
  }
}

describe('playMove', () => {
  it('adds a pass exactly when the opponent has no reply, and ends the game when neither side can move', () => {
    let passes = 0;
    let endings = 0;
    playRandomGames(200, (before, player, square, _line, r) => {
      const opp = opponent(player);
      expect(r.moves[0]).toEqual({ player, square });
      const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
      expect(sorted(r.flipped)).toEqual(sorted(getFlips(before, player, square)));
      expect(countDiscs(r.board)[player]).toBe(countDiscs(before)[player] + 1 + r.flipped.length);

      const oppCanMove = getLegalMoves(r.board, opp).length > 0;
      const selfCanMove = getLegalMoves(r.board, player).length > 0;
      if (oppCanMove) {
        expect(r.moves).toHaveLength(1);
        expect(r.turn).toBe(opp);
      } else if (selfCanMove) {
        expect(r.moves).toEqual([{ player, square }, { player: opp, square: null }]);
        expect(r.turn).toBe(player);
        passes++;
      } else {
        expect(r.moves).toHaveLength(1);
        expect(r.turn).toBeNull();
        endings++;
      }
    });
    // The sample must actually exercise both special cases.
    expect(passes).toBeGreaterThan(0);
    expect(endings).toBe(200);
  });

  it('builds lines that replay and replayChecked agree on', () => {
    playRandomGames(50, (_before, _player, _square, line, r) => {
      const next = [...line, ...r.moves];
      const pos = replay(next);
      expect(pos.board).toEqual(r.board);
      expect(pos.turn).toBe(r.turn);
      expect(pos.key).toBe(positionKey(next));
      expect(replayChecked(next)).toEqual(pos);
    });
  });
});

describe('lastPlacedSquare', () => {
  it('skips passes and is null for a line with no placed disc', () => {
    expect(lastPlacedSquare([])).toBeNull();
    expect(lastPlacedSquare([{ square: null }])).toBeNull();
    expect(lastPlacedSquare([{ square: 19 }, { square: 18 }, { square: null }])).toBe(18);
  });
});
