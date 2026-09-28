/**
 * Try the AI coach without a database or a browser: plays a seeded sample game (engine moves
 * mixed with random ones, so there are real errors), analyzes it, prints the coach's fact sheet,
 * and, if ANTHROPIC_API_KEY is set, the debrief Claude writes from it.
 *
 *   npm run coach:preview -w backend              # Black's debrief, seed 1
 *   npm run coach:preview -w backend -- W 7       # White's debrief, seed 7
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  ANALYSIS_SEARCH_OPTIONS,
  analyzeGame,
  applyMove,
  buildCoachFacts,
  countDiscs,
  getLegalMoves,
  initialBoard,
  nextTurn,
  opponent,
  search,
  winnerOf,
  type GameSummary,
  type Move,
  type Player,
} from '@othello/shared';
import { ANTHROPIC_API_KEY, COACH_MODEL } from '../src/config';
import { writeDebrief } from '../src/coach/CoachService';
import { buildUserPrompt } from '../src/coach/prompt';

const player: Player = process.argv[2] === 'W' ? 'W' : 'B';
let seed = Number(process.argv[3] ?? 1) || 1;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

/** Engine moves (shallow) 75% of the time, a random legal move otherwise. */
function sampleGame(): Move[] {
  const moves: Move[] = [];
  let b = initialBoard();
  let turn: Player | null = 'B';
  while (turn) {
    const legal = getLegalMoves(b, turn);
    const sq = random() < 0.75 ? search(b, turn, { depth: 2, exactEmpties: 0 }).best! : legal[Math.floor(random() * legal.length)];
    moves.push({ player: turn, square: sq });
    b = applyMove(b, turn, sq).board;
    const next: Player | null = nextTurn(b, turn);
    if (next === turn) moves.push({ player: opponent(turn), square: null });
    turn = next;
  }
  return moves;
}

const plies = [...analyzeGame(sampleGame(), ANALYSIS_SEARCH_OPTIONS)];
const final = plies[plies.length - 1].boardAfter;
const game: GameSummary = {
  gameId: 'preview',
  status: 'finished',
  players: { B: { name: 'Ada', accountId: null }, W: { name: 'Bo', accountId: null } },
  counts: countDiscs(final),
  winner: winnerOf(final),
  endReason: 'normal',
  analysisStatus: 'done',
  createdAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
};
const facts = buildCoachFacts(game, plies, player);

console.log(buildUserPrompt(facts));
console.log(`\n--- ${facts.keyMoments.length} key moment(s), prompt ${buildUserPrompt(facts).length} chars ---\n`);

if (!ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY is not set: stopping before the Claude call.');
} else {
  const t0 = Date.now();
  const written = await writeDebrief(new Anthropic({ apiKey: ANTHROPIC_API_KEY }), COACH_MODEL, facts, 'preview');
  console.log(JSON.stringify(written, null, 2));
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
