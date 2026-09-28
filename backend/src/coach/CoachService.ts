import {
  buildCoachFacts,
  groundMoments,
  type CoachDebrief,
  type CoachDebriefResponse,
  type GameFacts,
  type Player,
} from '@othello/shared';
import * as repo from '../db/coachRepo';
import type { DebriefContent } from '../db/coachRepo';
import type { AnalysisRunner } from '../analysis/AnalysisRunner';
import type { GameService } from '../game/GameService';
import { AppError } from '../errors';
import type { Claude, ClaudeUsage } from './claude';
import { buildUserPrompt, DebriefOutput, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt';
import { ClaudeCallLimiter } from './rateLimit';

/**
 * New debriefs (cache misses) per client IP per hour, and for the whole server per hour. Each game
 * allows two, but games are free to create, so the endpoint still needs a budget behind a paid API.
 */
const PER_IP = { max: 10, windowMs: 60 * 60_000 };
const GLOBAL = { max: 200, windowMs: 60 * 60_000 };

/**
 * The AI coach's post-game debrief. The engine analysis is the source of truth: this turns it
 * into a fact sheet (shared/src/coach.ts), asks Claude to explain it, checks the answer against
 * the facts, and caches it in Postgres. Disabled without an API key, and paused after failures.
 */
export class CoachService {
  /** One Claude call per (game, player) at a time; concurrent requests share it. */
  private readonly inFlight = new Map<string, Promise<CoachDebrief>>();
  private readonly limiter = new ClaudeCallLimiter(PER_IP, GLOBAL);

  constructor(
    private readonly games: GameService,
    private readonly analysis: AnalysisRunner,
    private readonly claude: Claude,
  ) {}

  /** Whether new debriefs can be written right now. Cached ones are served regardless. */
  get enabled(): boolean {
    return this.claude.enabled;
  }

  /** GET /api/games/:id/coach: the cached debrief, if any. Never calls Claude. */
  async get(gameId: string, player: Player): Promise<CoachDebriefResponse> {
    await this.games.getSummary(gameId); // GAME_NOT_FOUND
    return { enabled: this.enabled, debrief: await repo.loadDebrief(gameId, player, PROMPT_VERSION) };
  }

  /** POST /api/games/:id/coach: the cached debrief, or a new one. */
  async generate(gameId: string, player: Player, clientIp: string): Promise<CoachDebrief> {
    const key = `${gameId}:${player}`;
    let run = this.inFlight.get(key);
    if (!run) {
      run = this.loadOrCreate(gameId, player, clientIp).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, run);
    }
    return run;
  }

  private async loadOrCreate(gameId: string, player: Player, clientIp: string): Promise<CoachDebrief> {
    const result = await this.analysis.getAnalysis(gameId); // GAME_NOT_FOUND
    const cached = await repo.loadDebrief(gameId, player, PROMPT_VERSION);
    if (cached) return cached;
    if (!this.enabled) throw new AppError('COACH_UNAVAILABLE', 'The AI coach is unavailable right now');
    if (result.status !== 'done') throw new AppError('ANALYSIS_NOT_READY', 'The engine analysis is not finished yet');
    if (!this.limiter.allow(clientIp)) {
      throw new AppError('RATE_LIMITED', 'Too many coach debriefs requested. Try again later.');
    }

    const facts = buildCoachFacts(result.game, result.plies, player);
    const t0 = Date.now();
    const written = await writeDebrief(this.claude, facts, `${gameId}/${player}`);
    console.log(
      `[coach] ${gameId}/${player}: ${written.content.moments.length}/${facts.keyMoments.length} moments, ` +
        `${written.usage.inputTokens} in / ${written.usage.outputTokens} out, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    return repo.saveDebrief({ gameId, player, promptVersion: PROMPT_VERSION, ...written });
  }
}

/**
 * One Claude call: the fact sheet in, a grounded debrief out. Moments that don't match the facts
 * are dropped (and logged under `label`).
 */
async function writeDebrief(
  claude: Claude,
  facts: GameFacts,
  label: string,
): Promise<{ content: DebriefContent; model: string; usage: ClaudeUsage }> {
  const { output, model, usage } = await claude.parse({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(facts),
    schema: DebriefOutput,
    maxTokens: 4096,
    label,
    unusableMessage: 'The coach could not write this debrief. Try again.',
  });
  const { moments, dropped } = groundMoments(output.moments, facts);
  if (dropped.length > 0) console.warn(`[coach] ${label}: dropped moments: ${dropped.join('; ')}`);
  return {
    content: { headline: output.headline, overview: output.overview, strength: output.strength, moments, takeaway: output.takeaway },
    model,
    usage,
  };
}
