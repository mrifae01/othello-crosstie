import type { Board, Motif, Player, Square } from '../types';
import { CORNERS } from './eval';
import { applyMove, getFlips, opponent } from './rules';

const CORNER_SQUARES: readonly Square[] = CORNERS.map((k) => k.corner);

function legalCorners(b: Board, p: Player): Set<Square> {
  return new Set(CORNER_SQUARES.filter((c) => getFlips(b, p, c).length > 0));
}

/** Rule-based coaching tags for `p` playing `sq` on `before` (definitions in shared/src/types.ts). */
export function detectMotifs(before: Board, p: Player, sq: Square, best: Square | null): Motif[] {
  const motifs: Motif[] = [];
  const isCorner = CORNER_SQUARES.includes(sq);
  if (isCorner) motifs.push('took_corner');
  if (best !== null && best !== sq && CORNER_SQUARES.includes(best)) motifs.push('missed_corner');

  const opp = opponent(p);
  const oppBefore = legalCorners(before, opp);
  const after = applyMove(before, p, sq).board;
  for (const c of legalCorners(after, opp)) {
    if (!oppBefore.has(c)) {
      motifs.push('allowed_corner');
      break;
    }
  }

  for (const k of CORNERS) {
    if (before[k.corner] !== null) continue;
    if (sq === k.x) motifs.push('x_square');
    if ((k.c as readonly number[]).includes(sq)) motifs.push('c_square');
  }
  return motifs;
}
