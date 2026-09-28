import { describe, expect, it } from 'vitest';
import type { Board, Player } from '../types';
import { BOT_LEVELS, chooseBotMove, pickBotMove, seededRng, type BotLevel } from './bot';
import { applyMove, getLegalMoves, initialBoard, nextTurn } from './rules';
import { search } from './search';

const LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

/** Plays seeded random legal moves until `empties` squares remain (or the game ends). */
function randomPosition(seed: number, empties: number): { board: Board; toMove: Player | null } {
  const rand = seededRng(seed);
  let b = initialBoard();
  let turn: Player | null = 'B';
  while (turn && b.filter((c) => c === null).length > empties) {
    const legal = getLegalMoves(b, turn);
    b = applyMove(b, turn, legal[Math.floor(rand() * legal.length)]).board;
    turn = nextTurn(b, turn);
  }
  return { board: b, toMove: turn };
}

describe('chooseBotMove', () => {
  it('always returns a legal move', () => {
    for (const level of ['easy', 'medium'] as const) {
      for (let s = 1; s <= 12; s++) {
        const { board, toMove } = randomPosition(s, 20 + s * 2);
        if (!toMove) continue;
        const sq = chooseBotMove(board, toMove, level, seededRng(s));
        expect(getLegalMoves(board, toMove)).toContain(sq);
      }
    }
    // Hard runs the full analysis search, so check it on a few positions only.
    for (const s of [1, 2]) {
      const { board, toMove } = randomPosition(s, 10);
      if (toMove) expect(getLegalMoves(board, toMove)).toContain(chooseBotMove(board, toMove, 'hard', seededRng(s)));
    }
  });

  it('returns null when the player has no legal move', () => {
    const full: Board = Array(64).fill('B');
    for (const level of LEVELS) expect(chooseBotMove(full, 'W', level, Math.random)).toBeNull();
  });

  it('Hard always plays the engine best move', () => {
    for (let s = 1; s <= 12; s++) {
      const { board, toMove } = randomPosition(s, 36);
      if (!toMove) continue;
      const res = search(board, toMove, { depth: 4, exactEmpties: 0 });
      for (let r = 0; r < 5; r++) expect(pickBotMove(res, toMove, 'hard', seededRng(r))).toBe(res.best);
    }
    // Endgame: exact, so independent of the time budget.
    const { board, toMove } = randomPosition(3, 10);
    expect(chooseBotMove(board, toMove!, 'hard', seededRng(1))).toBe(search(board, toMove!, BOT_LEVELS.hard.search).best);
  });

  it('Easy never exceeds its loss limit or its pool', () => {
    for (let s = 1; s <= 20; s++) {
      const { board, toMove } = randomPosition(s, 30);
      if (!toMove) continue;
      const res = search(board, toMove, BOT_LEVELS.easy.search);
      const sign = toMove === 'B' ? 1 : -1;
      const top = res.scores.slice(0, BOT_LEVELS.easy.pool).map((c) => c.square);
      for (let r = 0; r < 10; r++) {
        const sq = pickBotMove(res, toMove, 'easy', seededRng(s * 100 + r));
        const c = res.scores.find((x) => x.square === sq)!;
        expect(sign * (res.scores[0].eval - c.eval)).toBeLessThanOrEqual(BOT_LEVELS.easy.maxLoss);
        expect(top).toContain(sq);
      }
    }
  });

  it('Easy actually varies its play', () => {
    const b = initialBoard();
    const picks = new Set(Array.from({ length: 30 }, (_, r) => chooseBotMove(b, 'B', 'easy', seededRng(r))));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('the same seed gives the same move', () => {
    for (const level of ['easy', 'medium'] as const) {
      for (let s = 1; s <= 8; s++) {
        const { board, toMove } = randomPosition(s, 34);
        if (!toMove) continue;
        expect(chooseBotMove(board, toMove, level, seededRng(42))).toBe(chooseBotMove(board, toMove, level, seededRng(42)));
      }
    }
  });
});
