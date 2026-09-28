import type { Board, Player, Square } from '@othello/shared';
import { applyMove, detectMotifs, getFlips, getLegalMoves, opponent } from '@othello/shared';

/**
 * The idea behind the best move, in plain rules (no LLM): enough to point the player the
 * right way without giving the square away. `best` is the coach search's best move on `board`.
 */
export function hintText(board: Board, player: Player, best: Square): string {
  const motifs = detectMotifs(board, player, best, best);
  if (motifs.includes('took_corner')) return 'A corner is available.';

  const row = Math.floor(best / 8);
  const col = best % 8;
  const where = `Look in the ${row < 4 ? 'top' : 'bottom'}-${col < 4 ? 'left' : 'right'} quarter (files ${col < 4 ? 'a–d' : 'e–h'}, ranks ${row < 4 ? '1–4' : '5–8'}).`;
  return `${where} ${idea(board, player, best, motifs)}`;
}

function idea(board: Board, player: Player, best: Square, motifs: string[]): string {
  if (motifs.includes('allowed_corner')) return 'Every option costs something here: find the one that gives away least.';
  if (motifs.includes('x_square')) return "It's an X-square, usually risky, but here it's the strongest option.";
  if (motifs.includes('c_square')) return "It's a C-square next to an empty corner, and safe this time.";

  const opp = opponent(player);
  const repliesAfter = (sq: Square) => getLegalMoves(applyMove(board, player, sq).board, opp).length;
  const replies = repliesAfter(best);
  const fewest = Math.min(...getLegalMoves(board, player).map(repliesAfter));
  if (replies === fewest) {
    return `It leaves your opponent the fewest replies${replies <= 6 ? ` (only ${replies})` : ''}: squeeze their mobility.`;
  }
  const flips = getFlips(board, player, best).length;
  if (flips <= 2) return `It's a quiet move that flips only ${flips === 1 ? 'one disc' : 'two discs'}: fewer flips, fewer new options for your opponent.`;
  return 'It keeps your position flexible without opening new squares for your opponent.';
}
