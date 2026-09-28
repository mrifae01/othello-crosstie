import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { ANTHROPIC_API_KEY, COACH_MODEL } from '../config';
import { AppError } from '../errors';

/**
 * How long the coach stays off after a failed call, by kind. `account` failures (no balance,
 * bad key, rejected request) won't fix themselves; `transient` ones (timeout, overload) might.
 * While off, clients fall back to the plain engine review instead of waiting on a dead API.
 */
const COOLDOWN_MS = { account: 30 * 60_000, transient: 2 * 60_000 } as const;

/**
 * Why a Claude request failed. `account`: a 4xx other than rate limiting (out of credit, invalid
 * or revoked key, rejected request). `transient`: timeouts, connection errors, rate limits,
 * overload and other 5xx.
 */
function failureKind(err: unknown): keyof typeof COOLDOWN_MS {
  if (err instanceof Anthropic.RateLimitError) return 'transient';
  if (err instanceof Anthropic.APIError && err.status !== undefined && err.status >= 400 && err.status < 500) return 'account';
  return 'transient'; // connection errors and timeouts (status undefined), 5xx, anything unexpected
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ParseRequest<S extends z.ZodType> {
  system: string;
  user: string;
  /** The structured output Claude must return. */
  schema: S;
  maxTokens: number;
  /** Identifies the call in logs, e.g. `<gameId>/B` or `explain ply 12 c4`. */
  label: string;
  /** Shown to the player when Claude answers but not usably. */
  unusableMessage: string;
}

/**
 * The one Claude client every coach feature shares: the model, the structured-output call, and
 * the cooldown after failures. A failure from any feature pauses them all, since they share the
 * key and the account. Disabled (null client) without an API key.
 */
export class Claude {
  private readonly client: Anthropic | null;
  /** Epoch ms until which new calls aren't attempted (see COOLDOWN_MS). */
  private pausedUntil = 0;

  constructor(
    apiKey = ANTHROPIC_API_KEY,
    readonly model = COACH_MODEL,
  ) {
    // A debrief takes ~15s. Worst case with one retry is ~1 min before the user sees the fallback.
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 }) : null;
  }

  /** Whether new calls can be made right now (a key is set and the coach isn't paused). */
  get enabled(): boolean {
    return this.client !== null && Date.now() >= this.pausedUntil;
  }

  /**
   * One structured-output call. Throws a COACH_UNAVAILABLE AppError when the coach is off, when the
   * request fails (pausing the coach, see COOLDOWN_MS), or when the answer isn't usable.
   */
  async parse<S extends z.ZodType>(req: ParseRequest<S>): Promise<{ output: z.infer<S>; model: string; usage: ClaudeUsage }> {
    if (!this.client || !this.enabled) throw new AppError('COACH_UNAVAILABLE', 'The AI coach is unavailable right now');

    let response;
    try {
      // Thinking off: the reasoning is already in the fact sheets, and it keeps cost per call flat.
      // Accepted by Sonnet 5 and Haiku 4.5; Opus 5.5 would need this line removed.
      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: req.maxTokens,
        thinking: { type: 'disabled' },
        output_config: { format: zodOutputFormat(req.schema) },
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      });
    } catch (err) {
      const kind = failureKind(err);
      console.error(`[coach] ${req.label}: Claude request failed (${kind}):`, (err as Error).message);
      this.pausedUntil = Date.now() + COOLDOWN_MS[kind];
      console.warn(`[coach] paused for ${COOLDOWN_MS[kind] / 60_000} min after a ${kind} failure`);
      throw new AppError('COACH_UNAVAILABLE', 'The AI coach is unavailable right now');
    }

    const output = response.parsed_output;
    if (response.stop_reason !== 'end_turn' || !output) {
      console.error(`[coach] ${req.label}: no usable answer (stop_reason ${response.stop_reason})`);
      throw new AppError('COACH_UNAVAILABLE', req.unusableMessage);
    }
    return {
      output,
      model: response.model,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}
