import type { ErrorCode, GameSummary, Motif, MoveClass, Player } from '@othello/shared';
import { isGameClientError } from './data/GameClient';

export const colorName = (p: Player) => (p === 'B' ? 'Black' : 'White');

export function playerLabel(game: GameSummary, p: Player): string {
  const info = game.players[p];
  return info ? `${info.name} (${colorName(p)})` : colorName(p);
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  BAD_REQUEST: 'That request was invalid.',
  GAME_NOT_FOUND: 'Game not found.',
  GAME_FULL: 'This game already has two players.',
  GAME_NOT_ACTIVE: 'The game is not in progress.',
  NOT_YOUR_TURN: "It's not your turn.",
  ILLEGAL_MOVE: "That move isn't legal.",
  BAD_TOKEN: "You don't hold a seat in this game.",
  UNAUTHORIZED: 'Your session has expired. Sign in again.',
  USERNAME_TAKEN: 'That username is taken.',
  FORBIDDEN: "You're not allowed to do that.",
  TOURNAMENT_NOT_FOUND: 'Tournament not found.',
  TOURNAMENT_FULL: 'This tournament is full.',
  TOURNAMENT_NOT_OPEN: "That can't be done at this stage of the tournament.",
  INTERNAL: 'Something went wrong on the server. Try again.',
};

export function errorText(e: unknown): string {
  if (isGameClientError(e)) return ERROR_TEXT[e.code] ?? e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

export function resultText(game: GameSummary): string {
  if (game.status !== 'finished' || !game.winner) return '';
  if (game.winner === 'draw') return `Draw, ${game.counts.B}–${game.counts.W}`;
  const loser = game.winner === 'B' ? 'W' : 'B';
  const how =
    game.endReason === 'resign'
      ? 'by resignation'
      : game.endReason === 'forfeit'
        ? 'by forfeit'
        : `${game.counts[game.winner]}–${game.counts[loser]}`;
  return `${playerLabel(game, game.winner)} wins ${how}`;
}

export const CLASS_LABEL: Record<MoveClass, string> = {
  best: 'Best',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  forced: 'Forced',
};

/** Display order for summary tables. */
export const CLASS_ORDER: MoveClass[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder', 'forced'];

export const MOTIF_LABEL: Record<Motif, string> = {
  took_corner: 'Took a corner',
  missed_corner: 'Missed a corner',
  allowed_corner: 'Gave up a corner',
  x_square: 'X-square',
  c_square: 'C-square',
};

/** Black-POV eval as a signed string, e.g. "+3.5", "−12", "0.0". */
export function fmtEval(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  if (s === '0.0' || s === '0') return '0.0';
  return (v > 0 ? '+' : '−') + s;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
