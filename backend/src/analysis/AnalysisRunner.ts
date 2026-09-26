import {
  ANALYSIS_SEARCH_OPTIONS,
  analyzeGame,
  summarize,
  type AnalysisProgressPayload,
  type AnalysisReadyPayload,
  type AnalysisResult,
  type GameState,
} from '@othello/shared';
import * as repo from '../db/gamesRepo';
import type { GameService } from '../game/GameService';

export interface AnalysisEvents {
  progress(p: AnalysisProgressPayload): void;
  ready(p: AnalysisReadyPayload): void;
}

const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

/**
 * In-process FIFO queue that analyzes one game at a time (design-contract.md §4.2).
 * Status transitions pending → running → done/failed each re-broadcast game:state via GameService.
 */
export class AnalysisRunner {
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly progress = new Map<string, { done: number; total: number }>();
  private draining = false;
  private stopped = false;

  constructor(
    private readonly games: GameService,
    private readonly events: AnalysisEvents,
  ) {
    // Any game that finishes (status becomes 'pending') gets queued automatically.
    games.onState((s: GameState) => {
      if (s.analysisStatus === 'pending') this.enqueue(s.gameId);
    });
  }

  /**
   * Stop after the current ply (shutdown). The in-flight game is left 'running' in the DB,
   * so the next boot re-queues it rather than it being marked failed.
   */
  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
  }

  enqueue(gameId: string): void {
    if (this.stopped || this.queued.has(gameId)) return;
    this.queued.add(gameId);
    this.queue.push(gameId);
    void this.drain();
  }

  /** Re-queue games left pending/running by a previous process. */
  async requeueOnBoot(): Promise<number> {
    const ids = await repo.listGamesNeedingAnalysis();
    ids.forEach((id) => this.enqueue(id));
    return ids.length;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const gameId = this.queue.shift()!;
        try {
          await this.analyze(gameId);
        } finally {
          this.queued.delete(gameId);
          this.progress.delete(gameId);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async analyze(gameId: string): Promise<void> {
    const t0 = Date.now();
    try {
      const game = await this.games.getMoves(gameId);
      if (!game) return;
      const { moves } = game;
      this.progress.set(gameId, { done: 0, total: moves.length });
      await this.games.setAnalysisStatus(gameId, 'running');
      await yieldToEventLoop();

      let done = 0;
      for (const ply of analyzeGame(moves, ANALYSIS_SEARCH_OPTIONS)) {
        if (this.stopped) return;
        await repo.writePlyAnalysis(gameId, ply);
        done++;
        this.progress.set(gameId, { done, total: moves.length });
        this.events.progress({ gameId, done, total: moves.length });
        await yieldToEventLoop(); // keep live games responsive between plies
      }

      await this.games.setAnalysisStatus(gameId, 'done');
      this.events.ready({ gameId, status: 'done' });
      console.log(`[analysis] ${gameId}: ${moves.length} plies in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      if (this.stopped) return; // shutting down: leave it for the boot re-queue
      const message = (err as Error).message ?? String(err);
      console.error(`[analysis] ${gameId} failed:`, message);
      try {
        await this.games.setAnalysisStatus(gameId, 'failed', message.slice(0, 500));
      } catch (e) {
        console.error(`[analysis] ${gameId}: could not record failure:`, (e as Error).message);
      }
      this.events.ready({ gameId, status: 'failed' });
    }
  }

  /** GET /api/games/:id/analysis. */
  async getAnalysis(gameId: string): Promise<AnalysisResult> {
    const game = await this.games.getSummary(gameId);
    const base: AnalysisResult = { game, status: game.analysisStatus, progress: null, plies: [], summary: null };
    if (game.analysisStatus === 'running') {
      return { ...base, progress: this.progress.get(gameId) ?? { done: 0, total: 0 } };
    }
    if (game.analysisStatus === 'done') {
      const plies = await repo.loadPlyAnalyses(gameId);
      if (plies) return { ...base, plies, summary: summarize(plies) };
      // Shouldn't happen (done implies every row written); report honestly rather than half a result.
      return { ...base, status: 'failed' };
    }
    return base;
  }
}
