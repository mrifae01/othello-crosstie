import type { Board, Player, Square, Winner } from '../types';

/** The 8 compass directions as [dRow, dCol]. */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function initialBoard(): Board {
  const b: Board = new Array(64).fill(null);
  b[27] = 'W'; // d4
  b[28] = 'B'; // e4
  b[35] = 'B'; // d5
  b[36] = 'W'; // e5
  return b;
}

export function opponent(p: Player): Player {
  return p === 'B' ? 'W' : 'B';
}

/** Squares that playing `sq` would flip, in direction order. [] means the move is illegal. */
export function getFlips(b: Board, p: Player, sq: Square): Square[] {
  if (!Number.isInteger(sq) || sq < 0 || sq > 63 || b[sq] !== null) return [];
  const opp = opponent(p);
  const row = Math.floor(sq / 8);
  const col = sq % 8;
  const flips: Square[] = [];
  for (const [dr, dc] of DIRS) {
    const line: Square[] = [];
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === opp) {
      line.push(r * 8 + c);
      r += dr;
      c += dc;
    }
    if (line.length > 0 && r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === p) {
      flips.push(...line);
    }
  }
  return flips;
}

/** Legal squares for `p`, ascending. */
export function getLegalMoves(b: Board, p: Player): Square[] {
  const moves: Square[] = [];
  for (let sq = 0; sq < 64; sq++) {
    if (b[sq] === null && getFlips(b, p, sq).length > 0) moves.push(sq);
  }
  return moves;
}

function hasLegalMove(b: Board, p: Player): boolean {
  for (let sq = 0; sq < 64; sq++) {
    if (b[sq] === null && getFlips(b, p, sq).length > 0) return true;
  }
  return false;
}

/** Pure: returns a new board. Throws on an illegal move. `flipped` is ascending. */
export function applyMove(b: Board, p: Player, sq: Square): { board: Board; flipped: Square[] } {
  const flipped = getFlips(b, p, sq);
  if (flipped.length === 0) throw new Error(`Illegal move: ${p} at ${sq}`);
  const board = b.slice();
  board[sq] = p;
  for (const f of flipped) board[f] = p;
  return { board, flipped: flipped.sort((x, y) => x - y) };
}

export function countDiscs(b: Board): { B: number; W: number } {
  let B = 0;
  let W = 0;
  for (const c of b) {
    if (c === 'B') B++;
    else if (c === 'W') W++;
  }
  return { B, W };
}

/** Who moves after `justMoved`: the opponent if they can; else justMoved if they can (opponent passes); else null (game over). */
export function nextTurn(b: Board, justMoved: Player): Player | null {
  const opp = opponent(justMoved);
  if (hasLegalMove(b, opp)) return opp;
  if (hasLegalMove(b, justMoved)) return justMoved;
  return null;
}

/** Winner by disc count. Only meaningful on a terminal board (or after a resign, which the caller handles). */
export function winnerOf(b: Board): Winner {
  const { B, W } = countDiscs(b);
  if (B > W) return 'B';
  if (W > B) return 'W';
  return 'draw';
}
