import type { Board, CoachMoment, GameSummary, Motif, MoveClass, Player, PlyAnalysis, Square } from './types';
import { squareToAlg } from './notation';
import { CLASS_THRESHOLDS, summarize } from './engine/analyze';
import { CORNERS } from './engine/eval';
import { applyMove, getFlips, getLegalMoves, opponent } from './engine/rules';

// Everything the AI coach is told comes from here: engine numbers, restated from the coached
// player's point of view, plus a few board facts (mobility, corners) that explain *why* a move
// lost. The model never has to calculate anything, and which moves it discusses is decided here.

export const MAX_KEY_MOMENTS = 3;

export type GamePhase = 'opening' | 'midgame' | 'endgame';

/** By empty squares: the opening is roughly the first 20 plies, the endgame the last 20. */
export function phaseOf(empties: number): GamePhase {
  if (empties >= 40) return 'opening';
  if (empties > 20) return 'midgame';
  return 'endgame';
}

/**
 * The plies where `player` lost the most: inaccuracies or worse, the `max` biggest losses,
 * returned in ply order. [] for a game without a real error.
 */
export function selectKeyMoments(plies: PlyAnalysis[], player: Player, max = MAX_KEY_MOMENTS): PlyAnalysis[] {
  return plies
    .filter((p) => p.player === player && p.square !== null && p.classification !== 'forced' && p.loss > CLASS_THRESHOLDS.good)
    .sort((a, z) => z.loss - a.loss || a.ply - z.ply)
    .slice(0, max)
    .sort((a, z) => a.ply - z.ply);
}

/**
 * Where a square sits, by geometry alone. Models misjudge this from a diagram (calling f7 an
 * edge), so the facts state it. X/C-squares are only dangerous while their corner is empty;
 * the motifs say when that was the case.
 */
export type SquareType = 'corner' | 'x_square' | 'c_square' | 'edge' | 'inner';

export function squareType(sq: Square): SquareType {
  for (const k of CORNERS) {
    if (sq === k.corner) return 'corner';
    if (sq === k.x) return 'x_square';
    if ((k.c as readonly number[]).includes(sq)) return 'c_square';
  }
  const row = Math.floor(sq / 8);
  const col = sq % 8;
  return row === 0 || row === 7 || col === 0 || col === 7 ? 'edge' : 'inner';
}

/** A difference in the opponent's replies smaller than this isn't worth a coaching point. */
export const MOBILITY_MARGIN = 2;

export interface MobilityFacts {
  opponentRepliesAfterPlayed: number;
  opponentRepliesAfterBest: number;
  /** True when the best move would have left the opponent at least MOBILITY_MARGIN fewer replies. */
  explainsLoss: boolean;
  /** The comparison in words, so the model never has to work out which number is better. */
  verdict: string;
}

export function compareMobility(afterPlayed: number, afterBest: number): MobilityFacts {
  const diff = afterPlayed - afterBest;
  const verdict =
    diff >= MOBILITY_MARGIN
      ? `The best move would have left your opponent ${diff} fewer replies (${afterBest} instead of ${afterPlayed}): mobility is part of why your move lost.`
      : diff <= -MOBILITY_MARGIN
        ? `Your move actually left your opponent fewer replies (${afterPlayed}) than the best move would have (${afterBest}): mobility does not explain this loss.`
        : `Both moves left your opponent about the same number of replies (${afterPlayed} vs ${afterBest}): mobility does not explain this loss.`;
  return { opponentRepliesAfterPlayed: afterPlayed, opponentRepliesAfterBest: afterBest, explainsLoss: diff >= MOBILITY_MARGIN, verdict };
}

export interface MomentFacts {
  ply: number;
  phase: GamePhase;
  emptySquares: number;
  played: string;
  playedSquareType: SquareType;
  engineBest: string;
  engineBestSquareType: SquareType;
  classification: MoveClass;
  discsLost: number;
  /** Evals from the coached player's side (+ = they are ahead), in discs. */
  evalWithBestMove: number;
  evalAfterPlayedMove: number;
  /** The engine's top moves, best first, evals from the coached player's side. */
  engineTopMoves: { move: string; squareType: SquareType; eval: number }[];
  motifs: Motif[];
  mobility: MobilityFacts;
  /** Corners the opponent could take after the played move but not before it. */
  cornersOpenedForOpponent: string[];
  /** The engine searched to the end of the game: the evals are the exact final margin with perfect play. */
  solvedExactly: boolean;
  /** The position before the move: rank 1 on top, files a–h left to right; B = Black, W = White, . = empty. */
  board: string;
}

export interface GameFacts {
  coachedPlayer: { name: string; color: 'Black' | 'White' };
  opponent: { name: string; color: 'Black' | 'White' };
  result: 'won' | 'lost' | 'drew' | 'no result';
  endReason: GameSummary['endReason'];
  finalDiscs: { coachedPlayer: number; opponent: number };
  accuracy: number;
  averageDiscsLostPerMove: number;
  moveCounts: Record<MoveClass, number>;
  /** Motifs across ALL of the coached player's moves, not just the key moments. */
  wholeGameMotifCounts: Partial<Record<Motif, number>>;
  /** The coached player's eval (their side) every 10 plies and at the end: the shape of the game. */
  evalTimeline: { ply: number; eval: number }[];
  keyMoments: MomentFacts[];
  /** What the key moments have in common, counted here: the basis for the takeaway. */
  keyMomentPattern: KeyMomentPattern;
}

export interface KeyMomentPattern {
  count: number;
  byPhase: Record<GamePhase, number>;
  openedACornerForOpponent: number;
  playedAnXSquare: number;
  playedACSquare: number;
  missedACorner: number;
  mobilityExplainsLoss: number;
  solvedExactly: number;
}

function patternOf(moments: MomentFacts[]): KeyMomentPattern {
  const count = (f: (m: MomentFacts) => boolean) => moments.filter(f).length;
  return {
    count: moments.length,
    byPhase: {
      opening: count((m) => m.phase === 'opening'),
      midgame: count((m) => m.phase === 'midgame'),
      endgame: count((m) => m.phase === 'endgame'),
    },
    openedACornerForOpponent: count((m) => m.cornersOpenedForOpponent.length > 0),
    playedAnXSquare: count((m) => m.motifs.includes('x_square')),
    playedACSquare: count((m) => m.motifs.includes('c_square')),
    missedACorner: count((m) => m.motifs.includes('missed_corner')),
    mobilityExplainsLoss: count((m) => m.mobility.explainsLoss),
    solvedExactly: count((m) => m.solvedExactly),
  };
}

const colorName = (p: Player) => (p === 'B' ? 'Black' : 'White');
const round1 = (v: number) => Math.round(v * 10) / 10 || 0;

function boardDiagram(b: Board): string {
  const lines = ['  a b c d e f g h'];
  for (let r = 0; r < 8; r++) {
    lines.push(`${r + 1} ${b.slice(r * 8, r * 8 + 8).map((c) => c ?? '.').join(' ')}`);
  }
  return lines.join('\n');
}

const CORNER_SQUARES: readonly Square[] = CORNERS.map((k) => k.corner);
const cornersFor = (b: Board, p: Player) => CORNER_SQUARES.filter((c) => getFlips(b, p, c).length > 0);

function momentFacts(p: PlyAnalysis, sign: number): MomentFacts {
  const played = p.square!;
  const best = p.bestSquare ?? played;
  const opp = opponent(p.player);
  const afterBest = applyMove(p.boardBefore, p.player, best).board;
  const before = new Set(cornersFor(p.boardBefore, opp));
  const empties = p.boardBefore.filter((c) => c === null).length;
  return {
    ply: p.ply,
    phase: phaseOf(empties),
    emptySquares: empties,
    played: squareToAlg(played),
    playedSquareType: squareType(played),
    engineBest: squareToAlg(best),
    engineBestSquareType: squareType(best),
    classification: p.classification,
    discsLost: round1(p.loss),
    evalWithBestMove: round1(sign * p.evalBefore),
    evalAfterPlayedMove: round1(sign * p.evalAfter),
    engineTopMoves: p.candidates.map((c) => ({
      move: squareToAlg(c.square),
      squareType: squareType(c.square),
      eval: round1(sign * c.eval),
    })),
    motifs: p.motifs,
    mobility: compareMobility(getLegalMoves(p.boardAfter, opp).length, getLegalMoves(afterBest, opp).length),
    cornersOpenedForOpponent: cornersFor(p.boardAfter, opp).filter((c) => !before.has(c)).map(squareToAlg),
    solvedExactly: p.exact,
    board: boardDiagram(p.boardBefore),
  };
}

/** The coach's fact sheet for `player`'s side of an analyzed game. */
export function buildCoachFacts(game: GameSummary, plies: PlyAnalysis[], player: Player): GameFacts {
  const opp = opponent(player);
  const sign = player === 'B' ? 1 : -1;
  const summary = summarize(plies)[player];

  const wholeGameMotifCounts: Partial<Record<Motif, number>> = {};
  for (const p of plies) {
    if (p.player !== player) continue;
    for (const m of p.motifs) wholeGameMotifCounts[m] = (wholeGameMotifCounts[m] ?? 0) + 1;
  }
  const keyMoments = selectKeyMoments(plies, player).map((p) => momentFacts(p, sign));

  const evalTimeline = plies
    .filter((p, i) => p.ply % 10 === 0 || i === plies.length - 1)
    .map((p) => ({ ply: p.ply, eval: round1(sign * p.evalAfter) }));

  const result =
    game.winner === null ? 'no result' : game.winner === 'draw' ? 'drew' : game.winner === player ? 'won' : 'lost';

  return {
    coachedPlayer: { name: game.players[player]?.name ?? colorName(player), color: colorName(player) },
    opponent: { name: game.players[opp]?.name ?? colorName(opp), color: colorName(opp) },
    result,
    endReason: game.endReason,
    finalDiscs: { coachedPlayer: game.counts[player], opponent: game.counts[opp] },
    accuracy: summary.accuracy,
    averageDiscsLostPerMove: summary.avgLoss,
    moveCounts: summary.counts,
    wholeGameMotifCounts,
    evalTimeline,
    keyMoments,
    keyMomentPattern: patternOf(keyMoments),
  };
}

// ---------- grounding the model's answer ----------

/** Every algebraic square named in `text` (e.g. "d3", "H8"), lowercased. */
export function mentionedSquares(text: string): string[] {
  return [...text.toLowerCase().matchAll(/\b([a-h][1-8])\b/g)].map((m) => m[1]);
}

/** Corners and their X/C-squares are always fair to name: they are the vocabulary of the lessons. */
const ALWAYS_NAMEABLE = new Set(CORNERS.flatMap((k) => [k.corner, k.x, ...k.c]).map(squareToAlg));

/** Squares a moment's text may name: the moves in its facts, plus the corner regions. */
export function nameableSquares(m: MomentFacts): Set<string> {
  return new Set([...ALWAYS_NAMEABLE, m.played, m.engineBest, ...m.engineTopMoves.map((c) => c.move), ...m.cornersOpenedForOpponent]);
}

/**
 * Keeps only the moments the facts asked about (one each, in ply order), and drops any that
 * names a square the facts never mentioned: a sign the model invented a variation.
 * Returns the kept moments and a note per dropped one, for logging.
 */
export function groundMoments(moments: CoachMoment[], facts: GameFacts): { moments: CoachMoment[]; dropped: string[] } {
  const byPly = new Map(facts.keyMoments.map((m) => [m.ply, m]));
  const seen = new Set<number>();
  const kept: CoachMoment[] = [];
  const dropped: string[] = [];
  for (const m of moments) {
    const f = byPly.get(m.ply);
    if (!f) {
      dropped.push(`ply ${m.ply}: not a key moment`);
      continue;
    }
    if (seen.has(m.ply)) {
      dropped.push(`ply ${m.ply}: duplicate`);
      continue;
    }
    const allowed = nameableSquares(f);
    const stray = mentionedSquares(`${m.title} ${m.explanation} ${m.lesson}`).filter((s) => !allowed.has(s));
    if (stray.length > 0) {
      dropped.push(`ply ${m.ply}: names ${[...new Set(stray)].join(', ')}, which the facts don't`);
      continue;
    }
    seen.add(m.ply);
    kept.push(m);
  }
  return { moments: kept.sort((a, z) => a.ply - z.ply), dropped };
}

// ---------- one move, explained on demand (Practice "Explain why") ----------

/** What the explained move is compared with, so the model has a concrete "instead of". */
export interface MoveComparison {
  /** 'engine best' when the player missed the best move; 'next best' when they found it. */
  against: 'engine best' | 'next best';
  move: string;
  squareType: SquareType;
  /** How many discs better the engine best was, or how many discs worse the next-best move was. Always >= 0. */
  discsDifference: number;
  opponentRepliesAfterPlayed: number;
  opponentRepliesAfterOther: number;
  /** True when the reply counts differ by at least MOBILITY_MARGIN in a direction that explains the verdict. */
  mobilityExplains: boolean;
  /** The comparison in words, already worked out. */
  mobilityVerdict: string;
}

export interface MoveFacts {
  coachedColor: 'Black' | 'White';
  ply: number;
  phase: GamePhase;
  emptySquares: number;
  played: string;
  playedSquareType: SquareType;
  classification: MoveClass;
  /** True when the played move was the engine's best (or tied with it). */
  playedWasBest: boolean;
  discsLost: number;
  engineBest: string;
  engineBestSquareType: SquareType;
  /** Evals from the coached player's side (+ = they are ahead), in discs. */
  evalWithBestMove: number;
  evalAfterPlayedMove: number;
  engineTopMoves: { move: string; squareType: SquareType; eval: number }[];
  motifs: Motif[];
  cornersOpenedForOpponent: string[];
  /** null when the played move was the only legal move. */
  comparison: MoveComparison | null;
  solvedExactly: boolean;
  board: string;
}

function bestMoveMobility(afterPlayed: number, afterNext: number): { explains: boolean; verdict: string } {
  const diff = afterNext - afterPlayed;
  if (diff >= MOBILITY_MARGIN) {
    return {
      explains: true,
      verdict: `Your move left your opponent ${diff} fewer replies than the next-best move would have (${afterPlayed} instead of ${afterNext}): mobility is part of why it was best.`,
    };
  }
  return {
    explains: false,
    verdict: `Your move and the next-best move left your opponent a similar number of replies, or more after yours (${afterPlayed} vs ${afterNext}): mobility does not explain why your move was better.`,
  };
}

/**
 * The fact sheet for explaining one graded move, whatever its grade: why it lost against the
 * engine's best, or why it beat the next-best move. Built from `gradeMove`'s output.
 */
export function buildMoveFacts(p: PlyAnalysis): MoveFacts {
  if (p.square === null) throw new Error('A pass has nothing to explain');
  const sign = p.player === 'B' ? 1 : -1;
  const m = momentFacts(p, sign);
  const opp = opponent(p.player);
  const playedWasBest = p.bestSquare === p.square || p.loss === 0;

  let comparison: MoveComparison | null = null;
  const replies = (sq: Square) => getLegalMoves(applyMove(p.boardBefore, p.player, sq).board, opp).length;
  if (p.classification !== 'forced' && p.candidates.length > 1) {
    const afterPlayed = getLegalMoves(p.boardAfter, opp).length;
    if (!playedWasBest && p.bestSquare !== null) {
      comparison = {
        against: 'engine best',
        move: squareToAlg(p.bestSquare),
        squareType: squareType(p.bestSquare),
        discsDifference: m.discsLost,
        opponentRepliesAfterPlayed: afterPlayed,
        opponentRepliesAfterOther: m.mobility.opponentRepliesAfterBest,
        mobilityExplains: m.mobility.explainsLoss,
        mobilityVerdict: m.mobility.verdict,
      };
    } else {
      const next = p.candidates.find((c) => c.square !== p.square)!;
      const afterNext = replies(next.square);
      const mob = bestMoveMobility(afterPlayed, afterNext);
      comparison = {
        against: 'next best',
        move: squareToAlg(next.square),
        squareType: squareType(next.square),
        discsDifference: Math.max(0, round1(sign * (p.evalAfter - next.eval))),
        opponentRepliesAfterPlayed: afterPlayed,
        opponentRepliesAfterOther: afterNext,
        mobilityExplains: mob.explains,
        mobilityVerdict: mob.verdict,
      };
    }
  }

  return {
    coachedColor: colorName(p.player),
    ply: m.ply,
    phase: m.phase,
    emptySquares: m.emptySquares,
    played: m.played,
    playedSquareType: m.playedSquareType,
    classification: m.classification,
    playedWasBest,
    discsLost: m.discsLost,
    engineBest: m.engineBest,
    engineBestSquareType: m.engineBestSquareType,
    evalWithBestMove: m.evalWithBestMove,
    evalAfterPlayedMove: m.evalAfterPlayedMove,
    engineTopMoves: m.engineTopMoves,
    motifs: m.motifs,
    cornersOpenedForOpponent: m.cornersOpenedForOpponent,
    comparison,
    solvedExactly: m.solvedExactly,
    board: m.board,
  };
}

/** Squares an explanation of `f` may name, like nameableSquares for a debrief moment. */
export function nameableMoveSquares(f: MoveFacts): Set<string> {
  const extra = f.comparison ? [f.comparison.move] : [];
  return new Set([...ALWAYS_NAMEABLE, f.played, f.engineBest, ...f.engineTopMoves.map((c) => c.move), ...f.cornersOpenedForOpponent, ...extra]);
}

/** Squares an explanation names that its facts don't: a sign the model invented a line. [] = grounded. */
export function strayMoveSquares(e: { title: string; explanation: string; lesson: string }, f: MoveFacts): string[] {
  const allowed = nameableMoveSquares(f);
  return [...new Set(mentionedSquares(`${e.title} ${e.explanation} ${e.lesson}`).filter((s) => !allowed.has(s)))];
}
