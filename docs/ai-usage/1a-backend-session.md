# 01 — Backend session

## Prompt 1 (B1: backend part 1)

```text
You are the BACKEND implementation session for othello-crosstie. Read design-contract.md in full before doing anything. It is the source of truth; where this prompt and the contract disagree, this prompt wins.

A FRONTEND session is running concurrently in this same working tree, on the same branch (main).

OWNERSHIP
- You own: shared/, backend/, scripts/, and root files (package.json, package-lock.json, tsconfig.base.json, docker-compose.yml, .gitignore, .env.example).
- Never create or edit anything under frontend/, with one exception: if frontend/package.json does not exist when you set up workspaces, create exactly
  {"name":"@othello/frontend","private":true,"version":"0.0.0"}
  so the workspace resolves. If it already exists, don't touch it.
- After you create shared/src/types.ts, never modify it.

GIT
- You are never to commit to GIT. Instead let me know once you are done and I will review and commit/push manually. 

PROMPT LOG
- Create docs/ai-usage/01-backend-session.md. Paste this prompt verbatim at the top, and append every later prompt you receive in this session, verbatim.
- After each task, append 1–3 lines: what you built, and any judgment call you made and why.

SCOPE: design-contract.md §6.1 tasks 1–4. Stop after task 4.

1. Phase 0 (§1). Do this FIRST and commit immediately, because the frontend session is blocked on it:
   - Root package.json: workspaces ["shared","backend","frontend"] and the root scripts from §1.
   - tsconfig.base.json (strict), .gitignore (node_modules, dist, .env, *.log, .DS_Store), .env.example.
   - docker-compose.yml: postgres:16-alpine, service name "db", host port 5433, user/password/db all "othello", pg_isready healthcheck, named volume.
   - scripts/start.mjs with the behavior described in §1.
   - shared/: package.json (name @othello/shared, main + types → src/index.ts), src/types.ts copied VERBATIM from §2, src/notation.ts, src/index.ts re-exports.
   - Run `npm install` at the root, and verify shared type-checks.
2. shared/src/engine/rules.ts, plus the vitest unit tests from the §4.1 "Required unit tests" list that apply to rules.
3. backend/migrations/001_init.sql VERBATIM from §5, the migration runner (npm run migrate -w backend), the pg pool, and gamesRepo.
4. GameService (per-game mutex, auto-pass, game over, resign), the REST routes from §3.1, the Socket.IO handlers from §3.2, and server.ts.
   - GET /api/games/:id/analysis: return a valid AnalysisResult from DB state (plies [] and summary null for now). The runner comes in part 2.
   - On game end: set analysis_status = 'pending' and broadcast game:state. Don't run analysis yet.

VERIFY BEFORE REPORTING
- `npm start` from the root brings up Postgres, migrates, and serves the API on :3001. The frontend half may fail to start if it isn't scaffolded yet; that's fine.
- Write backend/scripts/smoke.ts (run via `npm run smoke -w backend`, against the running server). It must use socket.io-client and fetch to: create a game, join it, subscribe both seats, play to completion by always choosing legalMoves[0], then assert status === 'finished', a non-null winner, and that GET /api/games/:id returns moves.length equal to the final state's version. Also assert that one illegal move and one out-of-turn move are rejected with the right ack error codes. It must pass.
- `npm test` is green.

RULES
- No game-rule logic outside shared/src/engine.
- If the contract is wrong or ambiguous, pick the least surprising option, keep going, and log it in docs/contract-deviations.md.
- Build nothing from §7.

END your final message with a section titled "BACKEND PART 1 READY" that the user will paste into the frontend session. List: each endpoint and event you implemented and verified, how to start the stack and run the smoke test, any deviations from the contract, and anything the frontend must know (ports, quirks, error codes you actually return).
```

## Task notes

- **Task 1 (Phase 0):** root workspaces + scripts, strict `tsconfig.base.json`, compose (postgres:16-alpine on 5433, `pg_isready` healthcheck), `scripts/start.mjs`, `shared/` with `types.ts` extracted byte-for-byte from §2 and `notation.ts`; created the `frontend/package.json` stub.
  - Judgment calls: the prompt says both "commit immediately" and "never commit"; I followed the explicit GIT rule and didn't commit (the frontend shares the working tree, so it can see the files anyway). I also put `rules.ts` into Phase 0 so the frontend can import `initialBoard` for mocks straight away. `start.mjs` falls back to Docker Desktop's bundled CLI path because `docker` wasn't on PATH on this machine.
- **Task 2 (rules):** `shared/src/engine/rules.ts` + `rules.test.ts` (14 vitest tests): the §4.1 rules-related tests (initial moves, d3 flips d4, forced pass, full-board terminal), plus notation round-trips, multi-direction flips, and 50 seeded random playouts checking disc-count invariants. The two search tests are part-2 scope.
  - Judgment call: `applyMove` returns `flipped` sorted ascending (the contract doesn't specify an order), so the DB and UI see a stable order.
- **Task 3 (DB):** `001_init.sql` extracted verbatim, a migration runner with `schema_migrations` + a pg advisory lock, `pool.ts` with a `withTx` helper, and `gamesRepo.ts` (create, conditional join, load, list, move insert + snapshot in one tx).
  - Judgment call: join is a conditional `UPDATE … WHERE status='waiting' AND white_token_hash IS NULL`, so two racing joins can't both win, even across processes.
- **Task 4 (game flow):** `GameService` (cache, promise-chain mutex, sha256 token hashing with timing-safe compare, auto-pass in the same tx, game over → `pending`, resign), REST routes, socket handlers, `server.ts`, and `scripts/smoke.ts`.
  - Judgment call: the service takes an `afterPersist` callback so the order persist → ack → broadcast happens inside the per-game lock. Broadcasts go through `GameService.onState`, so REST join and socket moves share one broadcast path. Deviations are in `docs/contract-deviations.md` (B1–B11).

## Prompt 2

```text
So now with backend part 1 done the frontend session should be good to start wiring up the endpoints?
```

- Answered: yes. The game-flow endpoints and events are live and smoke-tested; analysis is still stubbed (`pending`, no `analysis:*` events) until part 2.

## Prompt 3 (B2: backend part 2)

```text
ok while the frontend is working on that initial wiring, correct me if I am wrong, but you should be good to starting working on part 2:

Part 2: design-contract.md §6.1 tasks 5–6. Same ownership, git, and prompt-log rules as before. Append this prompt to docs/ai-usage/01-backend-session.md verbatim.

5. shared/src/engine/eval.ts and search.ts, following "Engine rules the implementation must respect" in §4.1: negamax + alpha-beta, pass handling inside the tree, a full-window score for every root move, an exact solve when empties <= exactEmpties, and iterative deepening with timeBudgetMs. Add the remaining required tests from §4.1 (free corner, exact solve vs. brute force at <= 4 empties).
   Measure early: time search() on each position of one full game (the smoke-test game is fine) and log the per-ply time. Target a full-game analysis under ~30s. Tune depth, timeBudgetMs, and exactEmpties to hit it.
6. shared/src/engine/analyze.ts (the analyzeGame generator, plus summarize), backend AnalysisRunner (§4.2), a complete GET /api/games/:id/analysis, and re-queueing pending/running games on boot. Emit analysis:progress after each ply and analysis:ready at the end, and re-broadcast game:state on every analysis status transition. Motifs return [] for now.

VERIFY
- Extend the smoke script: after the game ends, wait for analysis:ready, GET the analysis, and assert status === 'done', plies.length === moves.length, every non-pass ply has a non-null bestSquare, loss >= 0, isBlunder === (classification === 'blunder'), and summary is non-null. Print the total analysis time and the per-player class counts.
- Sanity check the classifications: with legalMoves[0] play, expect a mix of classes, not all "blunder" and not all "best". If it's lopsided, fix the eval scale (not the thresholds) per §8 risk 2.
- `npm test` is green.
- Record the final thresholds and the depth/time settings under a "Tuned values" heading in docs/contract-deviations.md.

STRETCH, only if everything above passes: shared/src/engine/motifs.ts per the Motif definitions in §2, with a test for took_corner and x_square.

END your final message with a section titled "BACKEND PART 2 READY" for the frontend session: what's live, the typical analysis duration, the smoke-test game ID(s) left in the DB that the frontend can open at /game/:id/analysis, and any deviations.
```

- **Task 5 (eval + search):** `engine/core.ts` (an internal Int8Array board with in-place make/unmake), `eval.ts`, and `search.ts` (negamax + α-β with pass handling, full-window scores for every root move, exact solve ≤ `exactEmpties`, iterative deepening with a deadline). Tests cover the free corner (both colours), exact solve vs. brute-force minimax at ≤ 4 empties (60 random positions, every root move), a pass inside the tree, colour/rotation symmetry, the time budget, and core-vs-rules move generation.
  - Judgment calls: I used a separate fast board representation rather than calling `rules.ts` in the search loop, for speed, and cross-tested the two for equivalence. When the corner test failed I first suspected an asymmetry bug; a mirror test showed the engine was symmetric and my hand-typed position was wrong. The real issue was a corner weight of 8, which I raised to 12. Timing was measured before choosing settings (below).
- **Task 6 (analysis):** `analyze.ts` (`analyzeGame` generator, `classify`, `summarize`), `AnalysisRunner` (FIFO, one game at a time, per-ply DB write + `analysis:progress` + `setImmediate`, status transitions re-broadcast through `GameService`, boot re-queue, clean stop on shutdown), the full `GET …/analysis`, and an extended smoke test. Settings: depth 8, exactEmpties 12, 400 ms/ply, giving 2.6 s for the smoke game and 11–19 s for random games. Verified the restart-mid-analysis re-queue live.
  - Judgment calls: a pass reuses the previous ply's `evalAfter` (the same position, already searched). The runner subscribes to `GameService.onState` and enqueues on `pending`, so neither move nor resign code knows about analysis. The first restart test showed shutdown trying to mark a game `failed` after the pool closed, so I added `stop()` to leave it `running` for re-queue.
- **Stretch (motifs):** `motifs.ts` implements all five §2 motifs, with tests for took_corner, missed_corner, x_square (incl. the corner-occupied case), allowed_corner and c_square. Deviations are B12–B21, with a "Tuned values" section, in `docs/contract-deviations.md`.
