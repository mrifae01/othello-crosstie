import type { Board } from '../types';
import { countMoves, discDiff, NEIGHBORS, toCells, type Cells } from './core';

/** Corner → its X-square (diagonal) and C-squares (edge-adjacent). */
export const CORNERS = [
  { corner: 0, x: 9, c: [1, 8] },     // a1: b2; b1, a2
  { corner: 7, x: 14, c: [6, 15] },   // h1: g2; g1, h2
  { corner: 56, x: 49, c: [48, 57] }, // a8: b7; a7, b8
  { corner: 63, x: 54, c: [55, 62] }, // h8: g7; h7, g8
] as const;

/**
 * Heuristic weights, in "discs". Tuned so that typical swings (a lost corner ≈ 8–12 discs,
 * a mobility collapse ≈ 5–10) roughly match the eventual disc differential. See
 * "Tuned values" in docs/contract-deviations.md.
 */
export const EVAL_WEIGHTS = {
  corner: 12,
  xSquare: 4,
  cSquare: 1.5,
  mobility: 10,  // × (mB − mW) / (mB + mW + 2)
  frontier: 5,   // × (fW − fB) / (fB + fW + 2)
  discLate: 0.6, // disc-parity weight at the end of the game; ramps up from 0 as the board fills
};

const clamp = (v: number) => (v > 64 ? 64 : v < -64 ? -64 : v);

/** Internal: Black-POV heuristic on Int8 cells. Terminal positions return the exact disc differential. */
export function evaluateCells(cells: Cells): number {
  const mB = countMoves(cells, 1);
  const mW = countMoves(cells, -1);
  const diff = discDiff(cells);
  if (mB === 0 && mW === 0) return diff; // terminal (includes a full board)

  let empties = 0;
  let fB = 0;
  let fW = 0;
  for (let sq = 0; sq < 64; sq++) {
    const v = cells[sq];
    if (v === 0) {
      empties++;
      continue;
    }
    for (const n of NEIGHBORS[sq]) {
      if (cells[n] === 0) {
        if (v === 1) fB++;
        else fW++;
        break;
      }
    }
  }

  let corner = 0;
  let x = 0;
  let c = 0;
  for (const k of CORNERS) {
    const cv = cells[k.corner];
    if (cv !== 0) {
      corner += cv;
    } else {
      x += cells[k.x];
      c += cells[k.c[0]] + cells[k.c[1]];
    }
  }

  const w = EVAL_WEIGHTS;
  const filled = (60 - empties) / 60; // 0 at the start, 1 on a full board
  const score =
    w.corner * corner -
    w.xSquare * x -
    w.cSquare * c +
    (w.mobility * (mB - mW)) / (mB + mW + 2) +
    (w.frontier * (fW - fB)) / (fB + fW + 2) +
    w.discLate * filled * filled * diff;
  return clamp(score);
}

/** Static heuristic, Black POV, disc units, clamped to [-64, 64]. Terminal boards return the exact disc differential. */
export function evaluate(b: Board): number {
  return evaluateCells(toCells(b));
}
