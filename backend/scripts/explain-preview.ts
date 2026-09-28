/**
 * Try Practice's "Explain why" without a database or a browser: plays a seeded sample game,
 * picks a few moves (a best move, the worst error, a forced move if any), and for each prints
 * the fact sheet and, if ANTHROPIC_API_KEY is set, the explanation Claude writes from it.
 *
 *   npm run explain:preview -w backend              # seed 1
 *   npm run explain:preview -w backend -- 7         # seed 7
 *   npm run explain:preview -w backend -- 7 --facts # fact sheets only, no API calls
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  ANALYSIS_SEARCH_OPTIONS,
  applyMove,
  buildMoveFacts,
  getLegalMoves,
  gradeMove,
  initialBoard,
  nextTurn,
  opponent,
  replayChecked,
  search,
  type Move,
  type Player,
  type PlyAnalysis,
} from '@othello/shared';
import { ANTHROPIC_API_KEY, COACH_MODEL } from '../src/config';
import { parseLine } from '../src/coach/ExplainService';
import { buildExplainUserPrompt, writeExplanation } from '../src/coach/explain';

let seed = Number(process.argv[2] ?? 1) || 1;
const factsOnly = process.argv.includes('--facts');
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

/** Engine moves (shallow) 75% of the time, a random legal move otherwise, with auto-passes. */
function sampleGame(): Move[] {
  const moves: Move[] = [];
  let b = initialBoard();
  let turn: Player | null = 'B';
  while (turn) {
    const legal = getLegalMoves(b, turn);
    const sq = random() < 0.75 ? search(b, turn, { depth: 3, exactEmpties: 6 }).best! : legal[Math.floor(random() * legal.length)];
    moves.push({ player: turn, square: sq });
    b = applyMove(b, turn, sq).board;
    const next = nextTurn(b, turn);
    if (next === turn) moves.push({ player: opponent(turn), square: null });
    turn = next;
  }
  return moves;
}

/** Grades ply `ply` of `moves` exactly as the endpoint does. */
function gradeAt(moves: Move[], ply: number): PlyAnalysis {
  const line = parseLine({ moves, ply });
  const { player, square } = line[ply - 1];
  const before = replayChecked(line.slice(0, -1)).board;
  return gradeMove(before, player, square!, search(before, player, ANALYSIS_SEARCH_OPTIONS), ply);
}

const moves = sampleGame();
// Grade Black's moves in the first 40 plies (quick), then pick the interesting ones.
const graded = moves
  .map((m, i) => ({ m, ply: i + 1 }))
  .filter(({ m, ply }) => m.player === 'B' && m.square !== null && ply <= 40)
  .map(({ ply }) => gradeAt(moves, ply));
const picks = [
  graded.find((g) => g.classification === 'best'),
  [...graded].sort((a, z) => z.loss - a.loss)[0],
  graded.find((g) => g.classification === 'forced'),
].filter((g, i, all): g is PlyAnalysis => !!g && all.indexOf(g) === i);

const client = ANTHROPIC_API_KEY && !factsOnly ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 }) : null;
if (!client && !factsOnly) console.log('(No ANTHROPIC_API_KEY: printing fact sheets only.)\n');

for (const g of picks) {
  const facts = buildMoveFacts(g);
  console.log(`\n=== ply ${g.ply}: ${facts.played} (${g.classification}, lost ${facts.discsLost}) ===`);
  if (!client) {
    console.log(buildExplainUserPrompt(facts));
    continue;
  }
  const t0 = Date.now();
  try {
    const w = await writeExplanation(client, COACH_MODEL, facts, `preview ply ${g.ply}`);
    console.log(`${w.explanation.title}\n${w.explanation.explanation}\nLesson: ${w.explanation.lesson}`);
    console.log(`(${w.model}, ${w.usage.inputTokens} in / ${w.usage.outputTokens} out, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.log(`FAILED: ${(err as Error).message}`);
  }
}
