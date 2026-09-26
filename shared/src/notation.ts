import type { Board, Cell, Square } from './types';

const FILES = 'abcdefgh';

/** 19 -> 'd3'. File = column (a..h), rank = row + 1. */
export function squareToAlg(sq: Square): string {
  if (!Number.isInteger(sq) || sq < 0 || sq > 63) throw new RangeError(`Invalid square: ${sq}`);
  return FILES[sq % 8] + String(Math.floor(sq / 8) + 1);
}

/** 'd3' -> 19. Case-insensitive. */
export function algToSquare(alg: string): Square {
  const m = /^([a-h])([1-8])$/.exec(alg.trim().toLowerCase());
  if (!m) throw new RangeError(`Invalid algebraic square: ${alg}`);
  return (Number(m[2]) - 1) * 8 + FILES.indexOf(m[1]);
}

/** 64 chars of '.', 'B', 'W' (the DB format). */
export function boardToString(b: Board): string {
  if (b.length !== 64) throw new RangeError(`Board must have 64 cells, got ${b.length}`);
  return b.map((c) => c ?? '.').join('');
}

export function boardFromString(s: string): Board {
  if (s.length !== 64) throw new RangeError(`Board string must be 64 chars, got ${s.length}`);
  return Array.from(s, (ch): Cell => {
    if (ch === 'B' || ch === 'W') return ch;
    if (ch === '.') return null;
    throw new RangeError(`Invalid board char: ${ch}`);
  });
}
