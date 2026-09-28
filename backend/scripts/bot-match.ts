/**
 * Bot-vs-bot matches between Practice levels, colors alternating, to tune BOT_LEVELS.
 *   npm run bot-match -w backend [-- --games 20 --seed 1 --pairs easy:medium,medium:hard]
 * Hard searches with ANALYSIS_SEARCH_OPTIONS (400ms per move), so pairs with Hard are slowest.
 */
import {
  applyMove,
  BOT_LEVELS,
  chooseBotMove,
  countDiscs,
  initialBoard,
  isBotLevel,
  nextTurn,
  seededRng,
  type BotLevel,
  type Player,
  type Rng,
} from '@othello/shared';

const argOf = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const games = Number(argOf('games') ?? 20);
const seed = Number(argOf('seed') ?? 1);
const pairs = (argOf('pairs') ?? 'easy:medium,easy:hard,medium:hard').split(',').map((p) => {
  const [a, b] = p.split(':');
  if (!isBotLevel(a) || !isBotLevel(b)) throw new Error(`Bad pair: ${p}`);
  return [a, b] as const;
});

/** Returns the final disc differential, Black minus White. */
function playGame(levels: Record<Player, BotLevel>, rng: Rng): number {
  let b = initialBoard();
  let turn: Player | null = 'B';
  while (turn) {
    const sq = chooseBotMove(b, turn, levels[turn], rng)!;
    b = applyMove(b, turn, sq).board;
    turn = nextTurn(b, turn);
  }
  const c = countDiscs(b);
  return c.B - c.W;
}

console.log('levels', JSON.stringify(BOT_LEVELS));
for (const [x, y] of pairs) {
  const t0 = performance.now();
  const score = { wins: 0, draws: 0, losses: 0, margin: 0 }; // from x's point of view
  for (let g = 0; g < games; g++) {
    const xIsBlack = g % 2 === 0;
    const diff = playGame(xIsBlack ? { B: x, W: y } : { B: y, W: x }, seededRng(seed * 1000 + g));
    const forX = xIsBlack ? diff : -diff;
    score.margin += forX;
    if (forX > 0) score.wins++;
    else if (forX < 0) score.losses++;
    else score.draws++;
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `${x} vs ${y}: ${score.wins}W ${score.draws}D ${score.losses}L for ${x}` +
      ` (avg margin ${(score.margin / games).toFixed(1)}) in ${secs}s`,
  );
}
