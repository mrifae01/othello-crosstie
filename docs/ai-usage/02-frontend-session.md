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

---

## Prompt 3

```
The backend session reports its game endpoints are implemented and verified. Its report:

BACKEND PART 1 READY
Start the stack: npm install && npm start from the repo root.

Postgres runs in Docker (postgres:16-alpine, service db) on host port 5433.
API and Socket.IO run on :3001.
Vite runs on :5173 and proxies /api and /socket.io to the API.
To skip Docker: DATABASE_URL=postgres://… npm start.
To reset the database: npm run db:reset.
Smoke test (with the stack running): npm run smoke -w backend. Set API_URL=... to point it at a different server.

Unit tests: npm test

REST endpoints (all verified by the smoke test):

Endpoint	Success	Errors
POST /api/games {name}	201 SeatResponse (color B), game is waiting	400 BAD_REQUEST if the name is blank or longer than 24 characters after trimming
POST /api/games/:id/join {name}	200 SeatResponse (color W), game becomes active with turn B, and game:state is broadcast to the room	400, 404 GAME_NOT_FOUND, 409 GAME_FULL
GET /api/games/:id	200 GameState	404 GAME_NOT_FOUND (also returned for ids that aren't UUIDs)
GET /api/games?status=finished&limit=20	200 {games: GameSummary[]}, newest finishedAt first. status is optional and accepts waiting, active or finished.	400 if limit isn't a positive integer. Limits over 50 are cut to 50, not rejected.
GET /api/games/:id/analysis	Always 200: {game, status: analysisStatus, progress: null, plies: [], summary: null}	404
GET /api/health	200 {ok: true, db: boolean}	—
Any other /api/* path	—	404 with code BAD_REQUEST (the contract has no better code)
Every error response has the body {error: {code, message}}.

Socket.IO events (all verified):

game:subscribe {gameId, playerToken?} returns {ok: true, state, you}.

you is 'B', 'W', or null for a missing or invalid token (the socket becomes a spectator, which is not an error).
An unknown game returns GAME_NOT_FOUND.
The socket joins room game:<id>. Re-subscribe on every connect.
game:move {gameId, playerToken, square} is checked in this order, and the first failure is returned:

GAME_NOT_FOUND
GAME_NOT_ACTIVE
BAD_TOKEN
NOT_YOUR_TURN
ILLEGAL_MOVE
On success the move is saved, then acked with {ok: true}, then game:state goes to the whole room, sender included.

game:resign {gameId, playerToken} returns GAME_NOT_FOUND, GAME_NOT_ACTIVE or BAD_TOKEN on failure. On success the winner is the other player, endReason is 'resign', and game:state is broadcast.

game:state is sent after join, move and resign. The server always sends the whole state.

analysis:progress and analysis:ready are not emitted yet. They come in part 2.

Error codes the frontend should expect in socket acks:

GAME_NOT_FOUND, GAME_NOT_ACTIVE, BAD_TOKEN, NOT_YOUR_TURN, ILLEGAL_MOVE, INTERNAL.
BAD_REQUEST if the payload is malformed: gameId missing, or square not an integer from 0 to 63.
Quirks the frontend should know:

Passes are automatic. When the opponent has no legal move, a pass is added right after the real move (square: null, flipped: []) and turn stays with the mover. One broadcast can therefore raise version by 2.
flipped is sorted ascending and does not include the square that was played.
When a game ends normally: status: 'finished', winner by disc count ('draw' on a tie), endReason: 'normal', turn: null, legalMoves: [], analysisStatus: 'pending'.
For now analysisStatus stays pending, because the analysis runner comes in part 2. The UI should show "analysis pending" and not wait forever.
Resign before any move leaves analysisStatus: 'none'.
Resign doesn't change version, so accept a game:state whose version equals the one you hold.
Server restart: games reload from Postgres when first requested, so a refresh keeps the seat as long as the token is still in sessionStorage.
Contract deviations: B1–B11 in docs/contract-deviations.md. The ones that affect the frontend:

B2: unknown /api/* paths return 404 with code BAD_REQUEST.
B3: a malformed game id is treated as not found.
B4: limit over 50 is capped, not rejected.
B6: malformed socket payloads get a BAD_REQUEST ack.
B11: analysis stays pending until part 2.

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

### Task notes

- **Real client:** `data/httpClient.ts` has fetch wrappers (ApiError → `GameClientError`; network/non-ApiError/timeout → `INTERNAL`) and one lazily created typed Socket.IO connection on relative URLs. It keeps a set of live subscriptions, routes `game:state`/`analysis:*` to the ones for that `gameId`, and on every `connect` re-emits `game:subscribe` for each and pushes the fresh state through `onState`. Move and resign use `emitWithAck` with an 8s timeout. `main.tsx` defaults to the real client. `?mock=1` switches the tab to mocks and sticks via sessionStorage (judgment call: a query-only flag would be lost on the first in-app navigation), and `?mock=0` or the dev bar's "Exit mock mode" link leaves.
- **Backend deviations:** mapped each one in `docs/contract-deviations.md` (F1–F9). The only behavior change is B11: pending analysis now reads "Analysis in progress…" with Review disabled, and Home says "Analysis pending". Also fixed a papercut the real two-tab run exposed: the join form no longer pre-fills the last name used in this browser (it was offering the creator's own name in the second tab).
- **Verified against the real API** (backend's `npm start` API on 3001 + a fresh Vite on 5173): curl through the proxy (health, create, join, GET active state, 409, 404, analysis `none`, Socket.IO handshake). Then headless Chrome, three tabs: create → invite link → join → 6 alternating moves synced live → refresh keeps seat → illegal and out-of-turn toasts from server acks → spectator tab → resign propagates to all tabs → pending-analysis states on the game and Review pages → `?mock=1`/`?mock=0`. The websocket runs through the proxy. Not automated: socket reconnect after an API restart (it's in the manual checklist).

---

## Prompt 4

```
Great I have tested manually and everything seems to be working. While the backend is finishing up its current prompt I want to make some UI changes. Firstly, I want to optimize that amount of space that is used. Recent games should be on the far right and the play with a friend should be centered. Also any button, like the resign button should have some sort of background and not be transparent.
```

### Task notes

- **Layout:** widened the app to 1440px. Home is now a 3-column grid with equal side columns, so "Play Othello with a friend" sits dead centre and Recent games sits in the right column; it drops to 2 columns under 1200px and 1 under 900px. Game and Review boards are sized as `min(max, 100vh − chrome)`, so the whole board (and the review stepper) fits the window without scrolling. Sidebars are capped (460 / 560px) and the pair is centred, instead of the sidebar stretching.
- **Buttons:** `.btn` now has a solid warm-grey fill (was white-on-white), and the transparent `.btn-quiet` is removed. Resign uses a new soft-red `.btn-resign` fill, since it's destructive but not the primary action. The review move-list entries (clickable) got a light chip fill so they read as buttons. Checked by screenshots at 1440×900, 1280×720 and 1100×800.

---

## Prompt 5

```
make the recent games overflow after 3 games (roughly the same height as the "play a friend" section". Make the Othello Crosstie header centered and when in another page like /review or /game, make a "Back home" button. If the user is in a game and this happens, they will need a popup that going back home will resign from the current game
```

### Task notes

- **Recent games:** the list shows three games and then scrolls (fixed two-line rows, so "3 rows" is exact; the panel lands about the create panel's height, 276 vs 258px). Rows use a compact one-line result ("Dana won by resignation") with the full text as a tooltip, because the long form was getting ellipsized.
- **Header:** the brand and tagline are centred in a 3-column header. On any non-home route a "← Back home" button sits on the left.
- **Leave guard:** new `components/LeaveGuard.tsx` (provider + `useLeaveGuard` + `useLeave`, native `<dialog>` so focus trap, Esc and backdrop come free). The Game page registers a guard only while you're seated in an *active* game. Both "Back home" and the brand link go through it; the brand link would otherwise have been an unguarded way home. Confirm calls `resign` then navigates; `GAME_NOT_ACTIVE`/`NOT_FOUND` (the game ended meanwhile) just leaves; other errors toast and stay. "Stay in game" is listed first and focused by default. No dialog for waiting games (the server can't resign a waiting game), spectators, finished games or the review page. Not covered: the browser's own Back button, since `BrowserRouter` has no navigation blocker (it would need a data router plus `useBlocker`).
- **Verified** against the real backend in headless Chrome: header centred (brand centre 720/1440), 20 games in the list scroll after 3, no dialog from review/waiting/spectator/finished, dialog from a seated active game via both button and brand, Stay/Esc keep the game, confirm resigns (server: `finished, winner=W, endReason=resign`) and the opponent's tab shows the result.

---

## Prompt 6

```
can you make the recent games length the same verical size the play with a friend section? it is still a little bit larger
```

### Task notes

- Replaced the fixed "3 rows" max-height with a height match: `.recent` gets `contain: size` + `align-self: stretch`, so the create panel alone sizes the grid row and Recent games fills exactly that height, with the list scrolling inside. This is robust to font and row-height differences, unlike the old hard-coded 66px rows. Tightened row padding/gap slightly so three games still fit fully. Under 900px the panels stack and the list falls back to a ~3-row cap. Measured: both panels 84→341px at 1440 and 1100 wide, three rows fully visible, list scrolls.
