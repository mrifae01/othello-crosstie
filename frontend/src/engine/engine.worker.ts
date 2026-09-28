/// <reference lib="webworker" />
/**
 * Runs engine searches off the main thread for Practice mode. Two jobs, deliberately separate:
 * `analyze` is the coach's search (always ANALYSIS_SEARCH_OPTIONS, so grades mean what they mean
 * in Review), `botMove` is the bot's own, level-dependent search, which never affects grades.
 * Requests are handled one at a time, in order.
 */
import type { Board, Player, Square } from '@othello/shared';
import { ANALYSIS_SEARCH_OPTIONS, chooseBotMove, search, type BotLevel, type SearchResult } from '@othello/shared';

export type EngineRequest =
  | { id: number; type: 'analyze'; board: Board; player: Player }
  | { id: number; type: 'botMove'; board: Board; player: Player; level: BotLevel };

export type EngineResponse =
  | { id: number; ok: true; type: 'analyze'; result: SearchResult }
  | { id: number; ok: true; type: 'botMove'; square: Square | null }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<EngineRequest>) => {
  const req = e.data;
  let res: EngineResponse;
  try {
    res =
      req.type === 'analyze'
        ? { id: req.id, ok: true, type: 'analyze', result: search(req.board, req.player, ANALYSIS_SEARCH_OPTIONS) }
        : { id: req.id, ok: true, type: 'botMove', square: chooseBotMove(req.board, req.player, req.level, Math.random) };
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  ctx.postMessage(res);
};
