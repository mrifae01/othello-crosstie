/**
 * Replays a transcript with the shared engine. Mock-only: the mock stands in for
 * the server, which is the only place rules run. UI code never imports this.
 */
import type { Board, PlayedMove, Player, Square } from '@othello/shared';
import { algToSquare, applyMove, initialBoard, nextTurn, opponent } from '@othello/shared';

export interface Replayed {
  board: Board;
  moves: PlayedMove[];
  /** null = game over. */
  turn: Player | null;
}

/** Appends one placed move (plus the automatic pass that may follow it), exactly like the server does (§3.3). */
export function playMove(board: Board, moves: PlayedMove[], player: Player, square: Square): Replayed {
  const { board: after, flipped } = applyMove(board, player, square);
  const out = [...moves, { ply: moves.length + 1, player, square, flipped }];
  const turn = nextTurn(after, player);
  if (turn === player) out.push({ ply: out.length + 1, player: opponent(player), square: null, flipped: [] });
  return { board: after, moves: out, turn };
}

/** Transcript like "f5d6c3…" (placed squares only; passes are inserted automatically). */
export function replay(transcript: string, maxPlaced = Infinity): Replayed {
  let state: Replayed = { board: initialBoard(), moves: [], turn: 'B' };
  const squares = transcript.match(/[a-h][1-8]/g) ?? [];
  for (const alg of squares.slice(0, maxPlaced)) {
    if (!state.turn) throw new Error(`Transcript continues after game over at ${alg}`);
    state = playMove(state.board, state.moves, state.turn, algToSquare(alg));
  }
  return state;
}

/** Board before each ply, derived by re-applying moves from the start position. */
export function boardsBefore(moves: PlayedMove[]): Board[] {
  const out: Board[] = [];
  let b = initialBoard();
  for (const m of moves) {
    out.push(b);
    if (m.square !== null) b = applyMove(b, m.player, m.square).board;
  }
  out.push(b);
  return out;
}
