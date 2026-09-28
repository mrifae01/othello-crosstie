import { describe, expect, it } from 'vitest';
import type { Move, Player } from './types';
import { buildMoveFacts, strayMoveSquares } from './coach';
import { analyzeGame } from './engine/analyze';
import { applyMove, getLegalMoves, initialBoard, nextTurn, opponent } from './engine/rules';
import { squareToAlg } from './notation';

const FAST = { depth: 3, exactEmpties: 8 };

/** A full game that always plays the last legal move, like coach.test.ts: has best moves and real errors. */
function lastMoveGame(): Move[] {
  const moves: Move[] = [];
  let b = initialBoard();
  let turn: Player | null = 'B';
  while (turn) {
    const legal = getLegalMoves(b, turn);
    const sq = legal[legal.length - 1];
    moves.push({ player: turn, square: sq });
    b = applyMove(b, turn, sq).board;
    const next = nextTurn(b, turn);
    if (next === turn) moves.push({ player: opponent(turn), square: null });
    turn = next;
  }
  return moves;
}

const plies = [...analyzeGame(lastMoveGame(), FAST)].filter((p) => p.square !== null);

describe('buildMoveFacts', () => {
  it('compares a missed best move against the engine best', () => {
    const p = plies.find((x) => x.loss > 2 && x.bestSquare !== x.square)!;
    const f = buildMoveFacts(p);
    expect(f.playedWasBest).toBe(false);
    expect(f.coachedColor).toBe(p.player === 'B' ? 'Black' : 'White');
    expect(f.comparison).toMatchObject({ against: 'engine best', move: squareToAlg(p.bestSquare!), discsDifference: f.discsLost });
    expect(f.comparison!.opponentRepliesAfterPlayed).toBe(getLegalMoves(p.boardAfter, opponent(p.player)).length);
  });

  it('compares a best move against the next-best move', () => {
    const p = plies.find((x) => x.square === x.bestSquare && x.classification === 'best' && x.candidates.length > 1)!;
    const f = buildMoveFacts(p);
    expect(f.playedWasBest).toBe(true);
    expect(f.comparison!.against).toBe('next best');
    expect(f.comparison!.move).not.toBe(f.played);
    expect(f.comparison!.move).toBe(squareToAlg(p.candidates[1].square));
    expect(f.comparison!.discsDifference).toBeGreaterThanOrEqual(0);
    const replies = (sq: number) => getLegalMoves(applyMove(p.boardBefore, p.player, sq).board, opponent(p.player)).length;
    expect(f.comparison!.opponentRepliesAfterOther).toBe(replies(p.candidates[1].square));
    expect(f.comparison!.mobilityExplains).toBe(replies(p.candidates[1].square) - replies(p.square!) >= 2);
  });

  it('has no comparison for a forced move, and refuses a pass', () => {
    const forced = plies.find((x) => x.classification === 'forced');
    if (forced) expect(buildMoveFacts(forced).comparison).toBeNull();
    const pass = [...analyzeGame(lastMoveGame(), FAST)].find((x) => x.square === null)!;
    expect(() => buildMoveFacts(pass)).toThrow();
  });

  it('states evals from the mover side', () => {
    const p = plies.find((x) => x.player === 'W' && x.loss > 0)!;
    const f = buildMoveFacts(p);
    expect(f.evalWithBestMove).toBeCloseTo(-p.evalBefore, 1);
    expect(f.evalAfterPlayedMove).toBeCloseTo(-p.evalAfter, 1);
  });
});

describe('strayMoveSquares', () => {
  const p = plies.find((x) => x.loss > 2 && x.bestSquare !== x.square)!;
  const f = buildMoveFacts(p);

  it('accepts squares from the facts and the corner regions', () => {
    const e = { title: `Why ${f.played}`, explanation: `${f.engineBest} was better; a1 and b2 matter.`, lesson: 'Keep corners.' };
    expect(strayMoveSquares(e, f)).toEqual([]);
  });

  it('flags a square the facts never mention', () => {
    const allowed = new Set([f.played, f.engineBest, ...f.engineTopMoves.map((c) => c.move), ...f.cornersOpenedForOpponent]);
    const invented = ['d3', 'c4', 'f5', 'e6', 'c5', 'f4'].find((s) => !allowed.has(s))!;
    const e = { title: 't', explanation: `Then ${invented} follows.`, lesson: 'l' };
    expect(strayMoveSquares(e, f)).toEqual([invented]);
  });
});
