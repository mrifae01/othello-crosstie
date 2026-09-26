# 02 — Frontend session

Prompts received by the frontend implementation session, verbatim, in order. After each task, a short note on what was built and any judgment calls.

---

## Prompt 1

```
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
- You are never to commit to GIT. Instead let me know once you are done and I will review and commit/push manually. 

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

### Task notes

- **Task 1 (setup, mocks only):** Wrote `frontend/package.json`, `vite.config.ts` (5173, `/api` + `/socket.io` ws proxy to 3001, `host: true`, `allowedHosts: true`), `tsconfig.json` (extends the root base, adds DOM + JSX), `index.html`. Pinned `typescript` to the root's `^5.6.3` rather than the newest 7.x so the workspace hoists a single compiler. Added `frontend/.gitignore` for `*.tsbuildinfo` because `tsc -b` writes one and I can't edit the root `.gitignore`.
- **Data seam:** `data/GameClient.ts` (interface + `GameClientError` carrying an `ErrorCode`), `data/ClientContext.tsx` (provider, `useGameClient`, `useSeatToken`), `data/seatStorage.ts` (`othello:seat:<id>`, plus a same-tab change event), `data/gameState.ts` (version rule: drop strictly lower versions, accept equal), `data/useLiveGame.ts` (GET, then subscribe; re-subscribes when the token changes). Judgment call: `subscribe()` resolves to `{ you, state, unsubscribe }`, and the implementation must re-subscribe on reconnect by itself, so pages never deal with sockets. Joining just stores the token, and the page re-subscribes with the seat, which is the same path the dev bar uses to swap seats.
- **Mock:** `data/mockClient.ts` mirrors the server's validation order, auto-pass, game over, resign and analysis lifecycle (pending → running + progress → done + ready), with simulated latency. Fixtures in `mocks/` replay real, legal transcripts through the shared engine (found by a throwaway search script using `rules.ts`). The analyzed game is 63 plies: Black mistake at 25, White's X-square blunder g7 at 38 (Black takes h8), a forced move at 42, and passes at 44/60/62. Its eval curve is authored from a per-ply loss plan, and the exact endgame is anchored to the true final score. Games played in mock mode get heuristic (square-weight) analysis. The `mocks/MockDevBar` (fixture links + Black/White/Spectator seat switch + "follow turn") is how one tab plays both sides. It's mounted only from `main.tsx`, the composition root, and no page imports the mock.
- **Tasks 2–5 (UI):** `Board` (felt, discs, rank/file labels, legal dots, last-move marker, best-move ring, ghost disc tinted by class), Home (create + recent games), Game page (join form, waiting + invite link from `window.location.origin`, turn line, counts, algebraic move list, pass notice, resign with confirm, toasts, result banner, analysis progress, Review button), Review page (stepper + ←/→/Home/End, candidates, class badges, motif chips, per-player summary, hand-rolled SVG eval graph with shaded sides, mistake/blunder dots, cursor, hover tooltip, click-to-jump). Judgment call: every empty square is clickable for a seated player (legal dots only when `turn === you`), so illegal or out-of-turn clicks reach the server and come back as toasts, as §3.4/§6.3 expect. The UI never checks legality itself.
- **Verification:** typecheck + build green. Drove the production build in headless Chrome (puppeteer-core in the scratchpad, not the repo) through every route and state with zero console errors. The already-running dev server on 5173 (not started by this session) was serving a stale Vite dep pre-bundle ("504 Outdated Optimize Dep"). Restarting it fixes that; I left it alone.

---

## Prompt 2

```
kill the job running on port 5173. I want to run this frontend locally to see what is built. When I try using npm run dev -w frontend with a different port nothing appears in my browser, help me troubleshoot
```

### Task notes

- Killed the stray Vite on 5173 (an `npm run dev` I didn't start). Root cause of "nothing appears": `npm run dev -w frontend --port N` (no `--`) makes npm eat `--port` and pass `N` to Vite as the **project root**, so Vite serves an empty `frontend/N/` directory and skips `vite.config.ts`. The fix is `npm run dev -w frontend -- --port N`. Separately, the old server's pre-bundle cache (`frontend/node_modules/.vite`) was stale ("504 Outdated Optimize Dep" → blank page), so I deleted it. It's a disposable cache that regenerates on the next start. Verified both commands in headless Chrome.
