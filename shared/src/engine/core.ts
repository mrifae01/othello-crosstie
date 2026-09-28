/**
 * Internal fast board representation for eval/search (not part of the public API).
 * Cells are Int8: 1 = Black, -1 = White, 0 = empty. Moves are made and unmade in place.
 * Rule semantics are identical to rules.ts (rules.test.ts + search.test.ts cross-check them).
 */
import type { Board, Player } from '../types';

export type Color = 1 | -1;
export type Cells = Int8Array;

export const colorOf = (p: Player): Color => (p === 'B' ? 1 : -1);

export function toCells(b: Board): Cells {
  const c = new Int8Array(64);
  for (let i = 0; i < 64; i++) c[i] = b[i] === 'B' ? 1 : b[i] === 'W' ? -1 : 0;
  return c;
}

/** RAYS[sq] = up to 8 rays, each the list of squares walking outward from sq (excluding sq). */
export const RAYS: number[][][] = [];
/** NEIGHBORS[sq] = the up-to-8 adjacent squares. */
export const NEIGHBORS: number[][] = [];
for (let sq = 0; sq < 64; sq++) {
  const r0 = Math.floor(sq / 8);
  const c0 = sq % 8;
  const rays: number[][] = [];
  const nbrs: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const ray: number[] = [];
      let r = r0 + dr;
      let c = c0 + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        ray.push(r * 8 + c);
        r += dr;
        c += dc;
      }
      if (ray.length > 0) nbrs.push(ray[0]);
      if (ray.length >= 2) rays.push(ray); // a ray needs room for >=1 flip + an anchor
    }
  }
  RAYS.push(rays);
  NEIGHBORS.push(nbrs);
}

export function isLegal(cells: Cells, color: Color, sq: number): boolean {
  if (cells[sq] !== 0) return false;
  for (const ray of RAYS[sq]) {
    if (cells[ray[0]] !== -color) continue;
    for (let i = 1; i < ray.length; i++) {
      const v = cells[ray[i]];
      if (v === color) return true;
      if (v === 0) break;
    }
  }
  return false;
}

export function countMoves(cells: Cells, color: Color): number {
  let n = 0;
  for (let sq = 0; sq < 64; sq++) if (cells[sq] === 0 && isLegal(cells, color, sq)) n++;
  return n;
}

/**
 * Plays `sq` for `color` in place, writing flipped squares into `out` starting at `offset`.
 * Returns the number of flips (0 = illegal, and the board is untouched).
 */
export function makeMove(cells: Cells, color: Color, sq: number, out: Int8Array, offset: number): number {
  if (cells[sq] !== 0) return 0;
  let n = 0;
  for (const ray of RAYS[sq]) {
    if (cells[ray[0]] !== -color) continue;
    let end = -1;
    for (let i = 1; i < ray.length; i++) {
      const v = cells[ray[i]];
      if (v === color) {
        end = i;
        break;
      }
      if (v === 0) break;
    }
    for (let i = 0; i < end; i++) {
      cells[ray[i]] = color;
      out[offset + n++] = ray[i];
    }
  }
  if (n > 0) cells[sq] = color;
  return n;
}

export function unmakeMove(cells: Cells, color: Color, sq: number, flips: Int8Array, offset: number, n: number): void {
  cells[sq] = 0;
  for (let i = 0; i < n; i++) cells[flips[offset + i]] = -color as Color;
}

/** Black minus White disc count. */
export function discDiff(cells: Cells): number {
  let d = 0;
  for (let i = 0; i < 64; i++) d += cells[i];
  return d;
}

export function countEmpties(cells: Cells): number {
  let e = 0;
  for (let i = 0; i < 64; i++) if (cells[i] === 0) e++;
  return e;
}
