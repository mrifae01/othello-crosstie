/**
 * Static teaching positions for marketing and Learn pages (rules diagrams, the hero board,
 * the puzzle preview). These are illustrations computed once at load, never live game
 * state: the server stays the only rule authority for real games.
 */
import type { Board, Player, Square } from '@othello/shared';
import { algToSquare, applyMove, getLegalMoves, initialBoard, nextTurn } from '@othello/shared';

export interface Diagram {
  board: Board;
  /** Side to move after the transcript, or null if the game is over. */
  turn: Player | null;
  lastMove: Square | null;
  flipped: Square[];
}

/** Replays placed squares ("f5d6c3…"); passes are implied, as on the server. */
function position(transcript: string): Diagram {
  let board = initialBoard();
  let turn: Player | null = 'B';
  let lastMove: Square | null = null;
  let flipped: Square[] = [];
  for (const alg of transcript.match(/[a-h][1-8]/g) ?? []) {
    if (!turn) throw new Error(`Diagram transcript continues after game over at ${alg}`);
    const sq = algToSquare(alg);
    ({ board, flipped } = applyMove(board, turn, sq));
    lastMove = sq;
    turn = nextTurn(board, turn);
  }
  return { board, turn, lastMove, flipped };
}

/** A complete, legal game used for the hero board and the puzzle preview. */
const SAMPLE_GAME =
  'c4c5e6c3b4a3c2c1b3f5c6a4f6d7f7f4g4h3d3e2d6c7e3f2f3f8c8e8g6h7h6h5d2e1g5e7d8g7h8g8d1b8a8h4g3a5a6f1g1b5b6b1a1h2g2a2b2a7b7h1';
const prefix = (placed: number) => SAMPLE_GAME.slice(0, placed * 2);

export const START = position('');
export const START_LEGAL = getLegalMoves(START.board, 'B');

/** Black plays f5 and flips e5. */
export const FIRST_MOVE = position('f5');

/** The finished game: Black wins 35–29. */
export const FINAL = position(SAMPLE_GAME);

/** A balanced middlegame (16–16) for the hero. */
export const HERO = position('c4c3e6b4a4a5c2f4g4a3d2e2c1b2e1a1a2c5b5a6b3d1a7a8b6f3f2d3');

/** White just played the g7 X-square; Black to move can take the h8 corner. */
export const CORNER_PUZZLE = position(prefix(38));
export const CORNER_PUZZLE_ANSWER = algToSquare('h8');
export const CORNER_PUZZLE_LEGAL = getLegalMoves(CORNER_PUZZLE.board, 'B');

export const CORNERS: Square[] = ['a1', 'h1', 'a8', 'h8'].map(algToSquare);
export const X_SQUARES: Square[] = ['b2', 'g2', 'b7', 'g7'].map(algToSquare);
