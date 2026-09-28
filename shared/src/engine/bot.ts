import type { Board, Player, Square } from '../types';
import { ANALYSIS_SEARCH_OPTIONS } from './analyze';
import { search, type SearchOptions, type SearchResult } from './search';

export type BotLevel = 'easy' | 'medium' | 'hard';

export interface BotLevelConfig {
  label: string;
  /** The bot's own search. Never used for grading: the coach always searches with ANALYSIS_SEARCH_OPTIONS. */
  search: SearchOptions;
  /** Picks uniformly from at most this many of its top moves... */
  pool: number;
  /** ...that lose at most this many discs versus its own best (mover POV). */
  maxLoss: number;
}

/** Tuned with `npm run bot-match -w backend` (see "Tuned values" in docs/contract-deviations.md). */
export const BOT_LEVELS: Record<BotLevel, BotLevelConfig> = {
  easy: { label: 'Easy', search: { depth: 2, exactEmpties: 0 }, pool: 4, maxLoss: 10 },
  medium: { label: 'Medium', search: { depth: 4, exactEmpties: 8 }, pool: 2, maxLoss: 3 },
  hard: { label: 'Hard', search: ANALYSIS_SEARCH_OPTIONS, pool: 1, maxLoss: 0 },
};

export const isBotLevel = (v: unknown): v is BotLevel => v === 'easy' || v === 'medium' || v === 'hard';

/** A uniform [0, 1) generator. Pass Math.random in the app and a seeded one in tests. */
export type Rng = () => number;

/** Small seeded PRNG (mulberry32) so bot games are repeatable in tests and scripts. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bot's choice given its own search of the position. null only when `player` has no legal move. */
export function pickBotMove(res: SearchResult, player: Player, level: BotLevel, rng: Rng): Square | null {
  if (res.scores.length === 0) return null;
  const { pool, maxLoss } = BOT_LEVELS[level];
  const sign = player === 'B' ? 1 : -1;
  const best = res.scores[0].eval;
  // scores are sorted best-first for the mover, so the pool is a prefix and always contains the best.
  const options = res.scores.slice(0, pool).filter((c) => sign * (best - c.eval) <= maxLoss);
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))].square;
}

/** Searches with the level's settings and picks a move. null only when `player` has no legal move. */
export function chooseBotMove(board: Board, player: Player, level: BotLevel, rng: Rng): Square | null {
  return pickBotMove(search(board, player, BOT_LEVELS[level].search), player, level, rng);
}
