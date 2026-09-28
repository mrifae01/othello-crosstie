import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  buildCoachFacts,
  groundMoments,
  type CoachDebrief,
  type CoachDebriefResponse,
  type GameFacts,
  type Player,
} from '@othello/shared';
import { ANTHROPIC_API_KEY, COACH_MODEL } from '../config';
import * as repo from '../db/coachRepo';
import type { DebriefContent } from '../db/coachRepo';
import type { AnalysisRunner } from '../analysis/AnalysisRunner';
import { GameError, type GameService } from '../game/GameService';
import { buildUserPrompt, DebriefOutput, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt';

/**
 * How long the coach stays off after a failed call, by kind. `account` failures (no balance,
 * bad key, rejected request) won't fix themselves; `transient` ones (timeout, overload) might.
 * While off, clients fall back to the plain engine review instead of waiting on a dead API.
 */
const COOLDOWN_MS = { account: 30 * 60_000, transient: 2 * 60_000 } as const;

/**
 * The AI coach's post-game debrief. The engine analysis is the source of truth: this turns it
 * into a fact sheet (shared/src/coach.ts), asks Claude to explain it, checks the answer against
 * the facts, and caches it in Postgres. Disabled without an API key, and paused after failures.
 */
export class CoachService {
  private readonly client: Anthropic | null;
  /** One Claude call per (game, player) at a time; concurrent requests share it. */
  private readonly inFlight = new Map<string, Promise<CoachDebrief>>();
  /** Epoch ms until which new debriefs aren't attempted (see COOLDOWN_MS). */
  private pausedUntil = 0;

  constructor(
    private readonly games: GameService,
    private readonly analysis: AnalysisRunner,
    apiKey = ANTHROPIC_API_KEY,
    private readonly model = COACH_MODEL,
  ) {
    // A debrief takes ~15s. Worst case with one retry is ~1 min before the user sees the fallback.
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 }) : null;
  }

  /** Whether new debriefs can be written right now. Cached ones are served regardless. */
  get enabled(): boolean {
    return this.client !== null && Date.now() >= this.pausedUntil;
  }

  /** The Claude client and model, for other coach features (Practice's Explain why) to share. null without a key. */
  get claude(): { client: Anthropic; model: string } | null {
    return this.client ? { client: this.client, model: this.model } : null;
  }

  /** Pauses the coach after a failed call from another coach feature, exactly as a failed debrief does. */
  pauseAfter(err: CoachCallError): void {
    this.pausedUntil = Date.now() + COOLDOWN_MS[err.kind];
    console.warn(`[coach] paused for ${COOLDOWN_MS[err.kind] / 60_000} min after a ${err.kind} failure`);
  }

  /** GET /api/games/:id/coach: the cached debrief, if any. Never calls Claude. */
  async get(gameId: string, player: Player): Promise<CoachDebriefResponse> {
    await this.games.getSummary(gameId); // GAME_NOT_FOUND
    return { enabled: this.enabled, debrief: await repo.loadDebrief(gameId, player, PROMPT_VERSION) };
  }

  /** POST /api/games/:id/coach: the cached debrief, or a new one. */
  async generate(gameId: string, player: Player): Promise<CoachDebrief> {
    const key = `${gameId}:${player}`;
    let run = this.inFlight.get(key);
    if (!run) {
      run = this.loadOrCreate(gameId, player).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, run);
    }
    return run;
  }

  private async loadOrCreate(gameId: string, player: Player): Promise<CoachDebrief> {
    const result = await this.analysis.getAnalysis(gameId); // GAME_NOT_FOUND
    const cached = await repo.loadDebrief(gameId, player, PROMPT_VERSION);
    if (cached) return cached;
    if (!this.client || !this.enabled) throw new GameError('COACH_UNAVAILABLE', 'The AI coach is unavailable right now');
    if (result.status !== 'done') throw new GameError('ANALYSIS_NOT_READY', 'The engine analysis is not finished yet');

    const facts = buildCoachFacts(result.game, result.plies, player);
    const t0 = Date.now();
    let written: WrittenDebrief;
    try {
      written = await writeDebrief(this.client, this.model, facts, `${gameId}/${player}`);
    } catch (err) {
      if (err instanceof CoachCallError) {
        this.pausedUntil = Date.now() + COOLDOWN_MS[err.kind];
        console.warn(`[coach] paused for ${COOLDOWN_MS[err.kind] / 60_000} min after a ${err.kind} failure`);
      }
      throw err;
    }
    console.log(
      `[coach] ${gameId}/${player}: ${written.content.moments.length}/${facts.keyMoments.length} moments, ` +
        `${written.usage.inputTokens} in / ${written.usage.outputTokens} out, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    return repo.saveDebrief({ gameId, player, promptVersion: PROMPT_VERSION, ...written });
  }
}

/**
 * A Claude call that failed before producing an answer. `account`: a 4xx other than rate
 * limiting (out of credit, invalid or revoked key, rejected request). `transient`: timeouts,
 * connection errors, rate limits, overload and other 5xx.
 */
export class CoachCallError extends GameError {
  constructor(
    readonly kind: 'account' | 'transient',
    message: string,
  ) {
    super('COACH_UNAVAILABLE', message);
  }
}

export function failureKind(err: unknown): CoachCallError['kind'] {
  if (err instanceof Anthropic.RateLimitError) return 'transient';
  if (err instanceof Anthropic.APIError && err.status !== undefined && err.status >= 400 && err.status < 500) return 'account';
  return 'transient'; // connection errors and timeouts (status undefined), 5xx, anything unexpected
}

export interface WrittenDebrief {
  content: DebriefContent;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * One Claude call: the fact sheet in, a grounded debrief out. Moments that don't match the
 * facts are dropped (and logged under `label`). Throws CoachCallError if the call fails, and a
 * plain COACH_UNAVAILABLE GameError if the model answered but not usably.
 */
export async function writeDebrief(client: Anthropic, model: string, facts: GameFacts, label: string): Promise<WrittenDebrief> {
  let response;
  try {
    // Thinking off: the reasoning is already in the facts, and it keeps cost per debrief flat.
    // Accepted by Sonnet 5 and Haiku 4.5; Opus 5.5 would need this line removed.
    response = await client.messages.parse({
      model,
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      output_config: { format: zodOutputFormat(DebriefOutput) },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(facts) }],
    });
  } catch (err) {
    const kind = failureKind(err);
    console.error(`[coach] ${label}: Claude request failed (${kind}):`, (err as Error).message);
    throw new CoachCallError(kind, 'The AI coach is unavailable right now');
  }

  const output = response.parsed_output;
  if (response.stop_reason !== 'end_turn' || !output) {
    console.error(`[coach] ${label}: no usable debrief (stop_reason ${response.stop_reason})`);
    throw new GameError('COACH_UNAVAILABLE', 'The coach could not write this debrief. Try again.');
  }

  const { moments, dropped } = groundMoments(output.moments, facts);
  if (dropped.length > 0) console.warn(`[coach] ${label}: dropped moments: ${dropped.join('; ')}`);
  return {
    content: { headline: output.headline, overview: output.overview, strength: output.strength, moments, takeaway: output.takeaway },
    model: response.model,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
