import {
  ANALYSIS_SEARCH_OPTIONS,
  buildMoveFacts,
  gradeMove,
  positionKey,
  replayChecked,
  search,
  type ExplainMoveResponse,
  type Move,
} from '@othello/shared';
import { AppError } from '../errors';
import type { Claude } from './claude';
import { EXPLAIN_PROMPT_VERSION, writeExplanation } from './explain';
import { ClaudeCallLimiter } from './rateLimit';

/** A full game is 60 moves plus passes; anything longer isn't a game. */
const MAX_LINE = 128;
/** Explanations kept in memory (oldest dropped first). The same mistakes recur across players. */
const CACHE_SIZE = 1000;
/** New explanations (cache misses) per client IP per hour (~1.5–2 fully explained games), and for the whole server. */
const PER_IP = { max: 50, windowMs: 60 * 60_000 };
const GLOBAL = { max: 600, windowMs: 60 * 60_000 };

/**
 * Practice's "Explain why": the server replays the client's line, grades the move with the same
 * search and gradeMove as Game Review, builds the move's fact sheet and asks Claude to explain
 * it. Only the moves come from the client. Practice games aren't saved, so results are cached in
 * memory by position, and new ones are rate limited (this is a public endpoint behind a paid API).
 */
export class ExplainService {
  private readonly cache = new Map<string, ExplainMoveResponse>();
  private readonly inFlight = new Map<string, Promise<ExplainMoveResponse>>();
  private readonly limiter = new ClaudeCallLimiter(PER_IP, GLOBAL);

  constructor(private readonly claude: Claude) {}

  /** POST /api/coach/explain */
  async explain(body: unknown, clientIp: string): Promise<ExplainMoveResponse> {
    const line = parseLine(body);
    const key = `${positionKey(line)}:${EXPLAIN_PROMPT_VERSION}:${this.claude.model}`;

    const cached = this.cache.get(key);
    if (cached) return cached;
    const running = this.inFlight.get(key);
    if (running) return running;

    if (!this.claude.enabled) throw new AppError('COACH_UNAVAILABLE', 'The AI coach is unavailable right now');
    if (!this.limiter.allow(clientIp)) {
      throw new AppError('RATE_LIMITED', 'Too many explanations requested. Try again in a few minutes.');
    }

    const run = this.create(line).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    const result = await run;
    this.cache.set(key, result);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }

  private async create(line: Move[]): Promise<ExplainMoveResponse> {
    const ply = line.length;
    const { player, square } = line[ply - 1];
    const before = replayChecked(line.slice(0, -1)).board;
    const grade = gradeMove(before, player, square!, search(before, player, ANALYSIS_SEARCH_OPTIONS), ply);
    const facts = buildMoveFacts(grade);

    const t0 = Date.now();
    const label = `ply ${ply} ${facts.played}`;
    const written = await writeExplanation(this.claude, facts, label);
    console.log(
      `[coach] explain ${label} (${grade.classification}): ` +
        `${written.usage.inputTokens} in / ${written.usage.outputTokens} out, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    return { grade, explanation: written.explanation, model: written.model };
  }
}

/**
 * Validates `{ moves, ply }` and returns the line up to and including the explained move.
 * Throws BAD_REQUEST unless it's a legal game whose ply `ply` is a move (not a pass).
 */
export function parseLine(body: unknown): Move[] {
  const { moves, ply } = (body ?? {}) as { moves?: unknown; ply?: unknown };
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > MAX_LINE) {
    throw new AppError('BAD_REQUEST', `\`moves\` must be an array of 1..${MAX_LINE} moves`);
  }
  if (typeof ply !== 'number' || !Number.isInteger(ply) || ply < 1 || ply > moves.length) {
    throw new AppError('BAD_REQUEST', '`ply` must be an integer within `moves`');
  }
  // Rebuild each move from its two fields, so nothing else the client sent travels any further.
  const line: Move[] = moves.slice(0, ply).map((m: unknown) => {
    const { player, square } = (m ?? {}) as { player?: unknown; square?: unknown };
    if (player !== 'B' && player !== 'W') throw new AppError('BAD_REQUEST', "Each move's `player` must be 'B' or 'W'");
    if (square !== null && !(typeof square === 'number' && Number.isInteger(square) && square >= 0 && square < 64)) {
      throw new AppError('BAD_REQUEST', "Each move's `square` must be 0..63 or null");
    }
    return { player, square };
  });
  if (line[ply - 1].square === null) throw new AppError('BAD_REQUEST', 'A pass has nothing to explain');
  try {
    replayChecked(line);
  } catch (err) {
    throw new AppError('ILLEGAL_MOVE', (err as Error).message);
  }
  return line;
}
