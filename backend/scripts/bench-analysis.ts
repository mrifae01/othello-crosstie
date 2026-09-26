/**
 * Times analyzeGame() per ply on the smoke-test game (always legalMoves[0]) and a few seeded
 * random games, and prints class counts. Used to tune ANALYSIS_SEARCH_OPTIONS.
 *   npm run bench -w backend [-- --depth 6 --exact 12 --budget 400 --verbose]
 */
import {
  ANALYSIS_SEARCH_OPTIONS,
  analyzeGame,
  applyMove,
  getLegalMoves,
  initialBoard,
  nextTurn,
  opponent,
  squareToAlg,
  summarize,
  type Move,
  type Player,
  type PlyAnalysis,
  type SearchOptions,
} from '@othello/shared';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : undefined;
};
const opts: SearchOptions = {
  depth: arg('depth') ?? ANALYSIS_SEARCH_OPTIONS.depth,
  exactEmpties: arg('exact') ?? ANALYSIS_SEARCH_OPTIONS.exactEmpties,
  timeBudgetMs: arg('budget') ?? ANALYSIS_SEARCH_OPTIONS.timeBudgetMs,
};
const verbose = process.argv.includes('--verbose');

function playGame(pick: (legal: number[]) => number): Move[] {
  const moves: Move[] = [];
  let b = initialBoard();
  let turn: Player | null = 'B';
  while (turn) {
    const sq = pick(getLegalMoves(b, turn));
    moves.push({ player: turn, square: sq });
    b = applyMove(b, turn, sq).board;
    const next = nextTurn(b, turn);
    if (next === turn) moves.push({ player: opponent(turn), square: null });
    turn = next;
  }
  return moves;
}

function run(label: string, moves: Move[]) {
  const t0 = performance.now();
  const plies: PlyAnalysis[] = [];
  let maxMs = 0;
  let last = t0;
  for (const p of analyzeGame(moves, opts)) {
    const now = performance.now();
    const ms = now - last;
    last = now;
    maxMs = Math.max(maxMs, ms);
    plies.push(p);
    if (verbose) {
      const sq = p.square === null ? 'pass' : squareToAlg(p.square);
      console.log(
        `  ${String(p.ply).padStart(2)} ${p.player} ${sq.padEnd(4)} ${ms.toFixed(0).padStart(5)}ms d=${p.depth}${p.exact ? '*' : ' '}` +
          ` before=${p.evalBefore.toFixed(1).padStart(6)} after=${p.evalAfter.toFixed(1).padStart(6)} loss=${p.loss.toFixed(1).padStart(5)} ${p.classification}`,
      );
    }
  }
  const total = (performance.now() - t0) / 1000;
  const s = summarize(plies);
  const fmt = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`${label}: ${plies.length} plies in ${total.toFixed(1)}s (max ply ${maxMs.toFixed(0)}ms)`);
  console.log(`   B acc ${s.B.accuracy} avgLoss ${s.B.avgLoss} | ${fmt(s.B.counts)}`);
  console.log(`   W acc ${s.W.accuracy} avgLoss ${s.W.avgLoss} | ${fmt(s.W.counts)}`);
  return total;
}

console.log('options', opts);
run('smoke game (legalMoves[0])', playGame((l) => l[0]));
for (const seed of [1, 2, 3]) {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  run(`random game seed ${seed}`, playGame((l) => l[Math.floor(rand() * l.length)]));
}
