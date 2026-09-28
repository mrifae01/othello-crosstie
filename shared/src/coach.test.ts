import { describe, expect, it } from 'vitest';
import type { GameSummary, Move, Player, PlyAnalysis } from './types';
import { buildCoachFacts, compareMobility, groundMoments, mentionedSquares, phaseOf, selectKeyMoments, squareType } from './coach';
import { algToSquare } from './notation';
import { analyzeGame } from './engine/analyze';
import { applyMove, countDiscs, getLegalMoves, initialBoard, nextTurn, opponent, winnerOf } from './engine/rules';

const FAST = { depth: 3, exactEmpties: 8 };

/** A full game that always plays the *last* legal move: sloppy enough to contain real errors. */
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

const plies = [...analyzeGame(lastMoveGame(), FAST)];
const final = plies[plies.length - 1].boardAfter;
const game: GameSummary = {
  gameId: 'g1',
  status: 'finished',
  players: { B: { name: 'ann', accountId: null }, W: { name: 'bo', accountId: null } },
  counts: countDiscs(final),
  winner: winnerOf(final),
  endReason: 'normal',
  analysisStatus: 'done',
  createdAt: '2026-09-28T00:00:00Z',
  finishedAt: '2026-09-28T00:10:00Z',
};

describe('selectKeyMoments', () => {
  const ply = (n: number, player: Player, loss: number, classification: PlyAnalysis['classification']) =>
    ({ ply: n, player, square: 19, loss, classification }) as PlyAnalysis;

  it("takes the player's biggest real errors, returned in ply order", () => {
    const ps = [
      ply(1, 'B', 12, 'blunder'),
      ply(2, 'W', 30, 'blunder'),   // other player
      ply(3, 'B', 1.5, 'good'),     // not an error
      ply(5, 'B', 6, 'mistake'),
      ply(7, 'B', 3, 'inaccuracy'),
      ply(9, 'B', 20, 'blunder'),
    ];
    expect(selectKeyMoments(ps, 'B').map((p) => p.ply)).toEqual([1, 5, 9]);
    expect(selectKeyMoments(ps, 'B', 1).map((p) => p.ply)).toEqual([9]);
  });

  it('is empty for a clean game', () => {
    expect(selectKeyMoments([ply(1, 'B', 0, 'best'), ply(3, 'B', 0, 'forced')], 'B')).toEqual([]);
  });
});

describe('buildCoachFacts', () => {
  for (const player of ['B', 'W'] as const) {
    it(`states everything from ${player}'s side`, () => {
      const f = buildCoachFacts(game, plies, player);
      const expected = selectKeyMoments(plies, player);
      expect(f.keyMoments.map((m) => m.ply)).toEqual(expected.map((p) => p.ply));
      expect(f.coachedPlayer.name).toBe(player === 'B' ? 'ann' : 'bo');
      expect(f.finalDiscs.coachedPlayer).toBe(game.counts[player]);

      for (const m of f.keyMoments) {
        // The played move is worse for the coached player than the best one, by the loss.
        expect(m.evalWithBestMove).toBeGreaterThanOrEqual(m.evalAfterPlayedMove);
        expect(m.evalWithBestMove - m.evalAfterPlayedMove).toBeCloseTo(m.discsLost, 0);
        expect(m.engineTopMoves[0].eval).toBe(m.evalWithBestMove);
        expect(m.board.split('\n')).toHaveLength(9);
      }
      expect(f.keyMomentPattern.count).toBe(f.keyMoments.length);
      expect(Object.values(f.keyMomentPattern.byPhase).reduce((a, b) => a + b, 0)).toBe(f.keyMoments.length);
    });
  }

  it('reports the result from the coached side', () => {
    const b = buildCoachFacts(game, plies, 'B').result;
    const w = buildCoachFacts(game, plies, 'W').result;
    if (game.winner === 'draw') expect([b, w]).toEqual(['drew', 'drew']);
    else expect([b, w].sort()).toEqual(['lost', 'won']);
  });
});

describe('squareType', () => {
  const type = (alg: string) => squareType(algToSquare(alg));

  it('names corners, X-squares, C-squares, edges and inner squares', () => {
    expect(['a1', 'h1', 'a8', 'h8'].map(type)).toEqual(['corner', 'corner', 'corner', 'corner']);
    expect(['b2', 'g2', 'b7', 'g7'].map(type)).toEqual(['x_square', 'x_square', 'x_square', 'x_square']);
    expect(['b1', 'a2', 'g1', 'h2', 'a7', 'b8', 'h7', 'g8'].every((s) => type(s) === 'c_square')).toBe(true);
    expect(['c1', 'f8', 'a4', 'h5'].map(type)).toEqual(['edge', 'edge', 'edge', 'edge']);
    expect(['f7', 'b3', 'd4', 'c2'].map(type)).toEqual(['inner', 'inner', 'inner', 'inner']);
  });

  it('covers the board: 4 corners, 4 X, 8 C, 16 other edge, 32 inner', () => {
    const counts: Record<string, number> = {};
    for (let sq = 0; sq < 64; sq++) counts[squareType(sq)] = (counts[squareType(sq)] ?? 0) + 1;
    expect(counts).toEqual({ corner: 4, x_square: 4, c_square: 8, edge: 16, inner: 32 });
  });
});

describe('compareMobility', () => {
  it('only credits mobility when the best move restricted the opponent by the margin', () => {
    expect(compareMobility(12, 9)).toMatchObject({ explainsLoss: true });
    expect(compareMobility(12, 9).verdict).toMatch(/3 fewer replies/);
    expect(compareMobility(10, 9).explainsLoss).toBe(false);
    // Fewer replies after the played move: the loss is not about mobility (ply 51 of the preview game).
    expect(compareMobility(5, 7)).toMatchObject({ explainsLoss: false });
    expect(compareMobility(5, 7).verdict).toMatch(/does not explain/);
  });
});

describe('phaseOf', () => {
  it('splits by empty squares', () => {
    expect([60, 40, 39, 21, 20, 0].map(phaseOf)).toEqual(['opening', 'opening', 'midgame', 'midgame', 'endgame', 'endgame']);
  });
});

describe('mentionedSquares', () => {
  it('finds algebraic squares as whole words only', () => {
    expect(mentionedSquares('Playing D3 gave up h8, not a9 or bad4.')).toEqual(['d3', 'h8']);
  });
});

describe('groundMoments', () => {
  const facts = buildCoachFacts(game, plies, 'B');
  const [first] = facts.keyMoments;

  it('keeps grounded moments, drops unknown plies, duplicates and invented squares', () => {
    expect(first).toBeDefined();
    const ok = { ply: first.ply, title: 't', explanation: `${first.played} was worse than ${first.engineBest}.`, lesson: 'Mind a1.' };
    const invented = facts.keyMoments.flatMap((m) => [m.played, m.engineBest]).includes('d6') ? 'e6' : 'd6';
    const { moments, dropped } = groundMoments(
      [
        { ...ok, ply: 999 },
        ok,
        { ...ok, title: 'again' },
        ...facts.keyMoments.slice(1).map((m) => ({ ...ok, ply: m.ply, explanation: `Try ${invented} next time.` })),
      ],
      facts,
    );
    // An invented square only gets through if the facts happen to name it for that moment.
    expect(moments.map((m) => m.ply)).toEqual([first.ply]);
    expect(dropped.length).toBe(2 + facts.keyMoments.length - 1);
  });
});
