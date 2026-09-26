# Session Prompts

Prompts handed to the parallel implementation sessions. Both sessions run concurrently in the same working tree on `main`, as `design-contract.md` §1 describes.

## Run order

```
 BACKEND                                  FRONTEND
 ───────                                  ────────
 B1  Phase 0 → rules → DB → game flow      F1  Scaffold + all UI against mocks
      │  (reports "BACKEND PART 1 READY")        │  (reports "FRONTEND PART 1 READY")
      ├──────── paste B1 report into ──────────► F2  Wire real game flow
 B2  Eval → search → analysis runner            │
      │  (reports "BACKEND PART 2 READY")        │
      └──────── paste B2 report into ──────────► F3  Wire real analysis
                                   ▼
                     Integration pass (§6.3), you + one session
```

Start B1 and F1 at the same time. F1 will write code and wait for the backend's Phase 0 before running `npm install`. That usually takes about 20 minutes.

**Before starting:** Docker Desktop must be running, and Node ≥ 20 must be on your PATH.

---

## B1: Backend, part 1 (floor)

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
- Stage only your own paths explicitly (e.g. `git add shared backend scripts package.json package-lock.json ...`). Never `git add -A` or `git add .`.
- Commit after each numbered task below (more often is fine), with descriptive messages like "engine: legal moves and flips with tests".
- If .git/index.lock exists, wait a few seconds and retry. Do not push.

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

---

## B2: Backend, part 2 (engine and analysis)

Paste this into the **same** backend session after B1 finishes.

```text
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

---

## F1: Frontend, part 1 (everything against mocks)

```text
You are the FRONTEND implementation session for othello-crosstie. Read design-contract.md in full before doing anything. It is the source of truth; where this prompt and the contract disagree, this prompt wins.

A BACKEND session is running concurrently in this same working tree, on the same branch (main). Its endpoints DO NOT exist yet. In this prompt you must NOT connect to the real backend: build everything against mocks. You'll get a separate prompt to wire the real endpoints once the backend reports they're ready.

OWNERSHIP
- You own only frontend/ and docs/ai-usage/02-frontend-session.md.
- Never edit shared/, backend/, scripts/, root package.json, tsconfig.base.json, or docker-compose.yml. If you need something changed there, log it in docs/contract-deviations.md and work around it.

DEPENDENCY ON BACKEND PHASE 0
- The backend is creating the root package.json (npm workspaces) and the @othello/shared package (shared/src/types.ts) as its first task, which takes about 20 minutes.
- Check whether they exist. If they don't yet, start writing frontend source files that import from '@othello/shared' exactly as §2 defines. Do NOT create shared stubs or copies of the types. Hold off on `npm install` and type-checking until the root package.json exists, and re-check between tasks.
- If frontend/package.json exists as a minimal stub, it's yours: fill it in.

PACKAGE
- frontend/package.json: name @othello/frontend. Deps: react, react-dom, react-router-dom, socket.io-client, "@othello/shared": "*". DevDeps: vite, @vitejs/plugin-react, typescript, @types/react, @types/react-dom. Scripts: dev (vite), build (tsc -b && vite build), typecheck (tsc --noEmit).
- Run `npm install` from the repo ROOT. If it fails because the backend is installing at the same time, wait and retry.
- vite.config.ts: port 5173; proxy /api and /socket.io (ws: true) to http://localhost:3001; server.host: true; server.allowedHosts: true (needed for ngrok). This is config only and harmless before the backend exists.

GIT
- Stage only frontend/ and your log file explicitly. Never `git add -A` or `git add .`.
- Commit after each numbered task below. If .git/index.lock exists, wait and retry. Do not push.

PROMPT LOG
- Create docs/ai-usage/02-frontend-session.md. Paste this prompt verbatim at the top, and append every later prompt you receive in this session, verbatim.
- After each task, append 1–3 lines: what you built, and any judgment call you made and why.

ARCHITECTURE REQUIREMENT: a single data-access seam
- frontend/src/data/GameClient.ts defines an interface that covers everything the UI needs from the backend, mirroring §3: createGame, joinGame, getGame, listFinishedGames, getAnalysis, subscribe(gameId, playerToken | undefined, handlers: { onState, onAnalysisProgress, onAnalysisReady }) → Promise<{ you, state }> plus an unsubscribe, move, and resign. It uses only types from @othello/shared. Errors surface as a typed error carrying an ErrorCode.
- frontend/src/data/mockClient.ts is the in-memory implementation, backed by fixtures in frontend/src/mocks/: a waiting game, an active game, a finished game, and a finished game with a complete AnalysisResult (roughly 20+ plies with a believable eval swing that includes at least one blunder, one mistake, one forced move and one pass).
  - Build fixture boards with initialBoard() and, once it exists, the shared engine (shared/src/engine/rules.ts, written by the backend in its task 2). The mock stands in for the server, so it may use the shared engine. UI components must never compute legality themselves; they use state.legalMoves only.
  - Until rules.ts exists, use static fixtures, then upgrade the mock so moves on the active game actually play out (both seats controllable from one tab).
- Components and pages get the client from a React context provider. They must never import mockClient directly. Do NOT write the real HTTP/socket client yet.
- frontend/src/data/seatStorage.ts: sessionStorage key `othello:seat:<gameId>`.

SCOPE: design-contract.md §6.2 tasks 2–5 (task 1 is the setup above, minus the real api.ts/socket.ts), and the client flows in §3.4.
- Routes: / (home), /game/:id (play), /game/:id/analysis (review).
- Board component, Home, Game page (every state in §3.4: join form, waiting + copy invite link built from window.location.origin, turn indicator, counts, move list in algebraic notation via squareToAlg, pass notice, resign with confirm, error toasts, game-over banner, analysis progress, Review button), and the Review page with the hand-rolled SVG eval graph, stepper plus ←/→ keys, best-move ring, candidates, class badges, per-player summary, and motif chips when present.
- Styling: clean and readable, plain CSS or CSS modules, no UI framework. A board that looks like an Othello board (green felt, black/white discs). Should work at laptop width; mobile polish isn't required.
- Honor the GameState.version rule (§2) in the state reducer.

VERIFY BEFORE REPORTING
- `npm run typecheck -w frontend` and `npm run build -w frontend` pass.
- Walk every route and state against the mocks and list what you checked.

END your final message with a section titled "FRONTEND PART 1 READY": what's built, the GameClient interface signature, what the real client will need to implement, and any contract questions for the backend.
```

---

## F2: Frontend, part 2 (wire the real game flow)

Paste this into the **same** frontend session after B1 reports ready, with the B1 report filled in.

```text
The backend session reports its game endpoints are implemented and verified. Its report:

<<<PASTE THE "BACKEND PART 1 READY" SECTION HERE>>>

Same ownership, git, and prompt-log rules as before. Append this prompt to docs/ai-usage/02-frontend-session.md verbatim.

Wire the real backend for the GAME FLOW:
- Implement frontend/src/data/httpClient.ts (the real GameClient): fetch wrappers for §3.1 that turn ApiError bodies into your typed error; a typed singleton Socket<ServerToClientEvents, ClientToServerEvents> using relative URLs (Vite proxies); re-emit game:subscribe for every active subscription on every 'connect', because a reconnect creates a fresh socket in no rooms; and ack → resolve/reject mapping for move and resign.
- Make the real client the default. Keep mocks reachable via ?mock=1.
- Analysis on the real backend currently returns status 'pending' or 'none' with empty plies (the runner isn't built yet). The game-over screen and review page must handle that gracefully with a "Analysis in progress…" state. The review UI can still be exercised with ?mock=1.
- Adjust anything the backend report says differs from the contract, and log each adjustment.

VERIFY
- `npm run typecheck -w frontend` and `npm run build -w frontend` pass.
- With `npm start` running (start it yourself if it isn't): curl http://localhost:5173/api/health through the Vite proxy; create and join a game via curl through the proxy; confirm GET /api/games/:id returns an active GameState.
- You can't click through a browser, so end with a short MANUAL TEST CHECKLIST for me: two tabs, create → copy link → join in a second tab (pasted into a new tab) → play several moves → refresh mid-game (seat kept) → illegal click → resign.

END with a section titled "FRONTEND PART 2 READY".
```

---

## F3: Frontend, part 3 (wire real analysis)

Paste this into the **same** frontend session after B2 reports ready.

```text
The backend session reports post-game analysis is live. Its report:

<<<PASTE THE "BACKEND PART 2 READY" SECTION HERE>>>

Same rules as before. Append this prompt to docs/ai-usage/02-frontend-session.md verbatim.

- Wire analysis:progress and analysis:ready through the real client. The game-over screen shows live progress and enables "Review game" on ready. The review page, if opened before analysis is done, subscribes as a spectator, waits for ready, then refetches.
- Point the review page at real data and fix anything that real results expose: eval ranges, passes, forced moves, empty candidates, empty motifs, very short (resigned) games.
- If the backend implemented motifs, confirm the chips render.

VERIFY
- typecheck and build pass.
- Fetch the smoke-test game's analysis via curl through the Vite proxy and check the review page's data handling against it (e.g. write a quick node/tsx check that runs your eval-graph point builder over the real payload).
- Add to the manual checklist: finish a game in two tabs → watch progress → open the review → step through with the arrow keys → click a blunder dot on the graph.

END with a section titled "FRONTEND PART 3 READY".
```

---

## Integration (after B2 and F3)

Run this in a fresh session, or in the backend session.

```text
Both implementation sessions are done. Run the integration pass in design-contract.md §6.3, steps 1–5. Save this prompt verbatim to docs/ai-usage/03-integration.md and log what you find and fix there.

- Step 1: fresh clone into a temp dir, then `npm install && npm start`. Test both the Docker path and the DATABASE_URL path.
- Run `npm test` and the backend smoke script.
- Resolve every open item in docs/contract-deviations.md: fix it, or mark it as an accepted deviation with a reason.
- Fix only real integration bugs. No new features, nothing from §7.
- Commit fixes in small, descriptive commits.
- End with a list of the manual checks I still need to do myself (two tabs, ngrok remote join, edge cases from §6.3 step 4).
```
