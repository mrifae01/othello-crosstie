/**
 * A line is a game's move list from the start, passes included. Every move a game accepts goes
 * through `playMove`, so online games (GameService) and Practice agree on when a pass happens.
 */
import type { Board, Move, Player, Square } from './types';
import { applyMove, getFlips, initialBoard, nextTurn, opponent } from './engine/rules';

export interface MoveResult {
  /** The board after the move. */
  board: Board;
  flipped: Square[];
  /** What the line gains: the move, then the opponent's pass if they have no reply. */
  moves: Move[];
  /** Who moves next; null once neither side can move (game over). */
  turn: Player | null;
}

/** Plays a legal `square` for `player`, adding the opponent's automatic pass when they have no reply. */
export function playMove(board: Board, player: Player, square: Square): MoveResult {
  const { board: after, flipped } = applyMove(board, player, square);
  const turn = nextTurn(after, player);
  const moves: Move[] = [{ player, square }];
  if (turn === player) moves.push({ player: opponent(player), square: null });
  return { board: after, flipped, moves, turn };
}

/** Identifies the position after `moves` (passes included, so it also fixes whose turn it is). */
export function positionKey(moves: Move[]): string {
  return moves.map((m) => (m.square === null ? '--' : String(m.square).padStart(2, '0'))).join('');
}

export interface LinePosition {
  board: Board;
  /** Whose turn it is; null once the game is over. */
  turn: Player | null;
  key: string;
}

/** Replays a line. Assumes it is legal (lines built with `playMove` always are). */
export function replay(moves: Move[]): LinePosition {
  let board = initialBoard();
  let turn: Player | null = 'B';
  for (const m of moves) {
    if (m.square !== null) board = applyMove(board, m.player, m.square).board;
    turn = nextTurn(board, m.player);
  }
  return { board, turn, key: positionKey(moves) };
}

/**
 * Like `replay`, for lines from an untrusted client: throws unless `moves` is a legal game from
 * the start (or a prefix of one), with a pass where (and only where) a player has no move, as
 * `playMove` writes it.
 */
export function replayChecked(moves: Move[]): LinePosition {
  let board = initialBoard();
  let turn: Player | null = 'B';
  let passFor: Player | null = null; // a pass that must come next
  moves.forEach((m, i) => {
    const bad = (why: string) => new Error(`Move ${i + 1}: ${why}`);
    if (m === null || typeof m !== 'object' || (m.player !== 'B' && m.player !== 'W')) throw bad('malformed');
    if (passFor) {
      if (m.player !== passFor || m.square !== null) throw bad(`expected ${passFor} to pass`);
      passFor = null;
      return;
    }
    if (turn === null) throw bad('the game is already over');
    if (m.player !== turn) throw bad(`not ${m.player}'s turn`);
    if (typeof m.square !== 'number' || getFlips(board, m.player, m.square).length === 0) throw bad('illegal move');
    const played = playMove(board, m.player, m.square);
    board = played.board;
    turn = played.turn;
    if (played.moves.length === 2) passFor = opponent(m.player);
  });
  // A line may stop just before an automatic pass: the explained move is then its last entry.
  return { board, turn: passFor ?? turn, key: positionKey(moves) };
}

/** The square of the latest move that placed a disc (passes skipped), or null if none has. */
export function lastPlacedSquare(moves: readonly { square: Square | null }[]): Square | null {
  for (let i = moves.length - 1; i >= 0; i--) {
    const sq = moves[i].square;
    if (sq !== null) return sq;
  }
  return null;
}
