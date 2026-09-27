# Contract deviations & interpretations

Places where `design-contract.md` was ambiguous, silent, or conflicted with a session prompt. Each entry gives what, why, and a proposed resolution. We reconcile these in the integration pass.

## Backend session, part 1

| # | Area | What the contract says | What was built | Why / proposed fix |
|---|---|---|---|---|
| B1 | Phase 0 commit | §1 and §6.1 say "commit immediately" | Not committed; the user reviews and commits by hand | The B1 prompt's GIT rule ("never commit") wins. Both sessions share the working tree, so the frontend isn't blocked. |
| B2 | Unknown `/api/*` path | Silent | `404` with `{ error: { code: 'BAD_REQUEST', … } }` | No `ErrorCode` fits and `types.ts` is frozen. Could add `NOT_FOUND` later. |
| B3 | Malformed game id (not a UUID) | Silent | Treated as `GAME_NOT_FOUND` (404 / ack) | Least surprising. It avoids leaking a Postgres cast error as `INTERNAL`. |
| B4 | `GET /api/games` params | Example shows `status=finished`; `limit` defaults to 20, max 50 | `status` is optional and accepts any `GameStatus`. `limit` > 50 is **clamped** to 50; a non-integer or < 1 → 400. Order is `finished_at DESC NULLS LAST, created_at DESC`. | Clamping is friendlier than rejecting. The ordering matches "newest `finishedAt` first" for the finished filter the frontend uses. |
| B5 | HTTP status per error code | Only 400/404/409 listed | `BAD_REQUEST` 400, `GAME_NOT_FOUND` 404, `GAME_FULL` 409, `INTERNAL` 500. `GAME_NOT_ACTIVE`/`NOT_YOUR_TURN` 409, `ILLEGAL_MOVE` 400 and `BAD_TOKEN` 403 are mapped too but are only reachable via socket acks today. | Complete mapping for future REST use. |
| B6 | Socket payload validation | §3.2 lists no `BAD_REQUEST` for sockets | Malformed payloads (missing `gameId`, `square` not an integer 0..63) ack `{ ok:false, error:'BAD_REQUEST' }` before the §3.2 validation chain runs | It's a type-shape check, not a rule, and `BAD_REQUEST` is in `ErrorCode`. |
| B7 | `game:resign` validation order | "Allowed only while active" | exists → `GAME_NOT_ACTIVE` → `BAD_TOKEN` | Mirrors the `game:move` order. |
| B8 | Resign "at least one move" | "enqueues analysis if at least one move was played" | `analysisStatus = moves.length > 0 ? 'pending' : 'none'` | A pass can never be ply 1, so `moves.length > 0` is equivalent. |
| B9 | Migrations on boot | §1: `start.mjs` runs `npm run migrate` | `server.ts` **also** runs migrations on boot (idempotent, advisory-locked) | Makes `npm run dev -w backend` self-sufficient. |
| B10 | Docker CLI discovery | `start.mjs` runs `docker compose …` | Falls back to `/Applications/Docker.app/Contents/Resources/bin/docker` if `docker` isn't on PATH. Root `db:reset` still calls plain `docker` (per §1). | Docker Desktop on the dev Mac didn't put the CLI on PATH. |
| B11 | Analysis (part 1 only) | §3.3/§4.2 runner | ~~Stays `pending`~~ **Superseded in part 2**: the runner is live. | — |

## Frontend session, part 2 (wiring the real backend)

How the frontend absorbs each backend deviation, plus the frontend's own interpretations.

| # | Area | Backend behavior / contract gap | Frontend adjustment | Why |
|---|---|---|---|---|
| F1 | B2 unknown `/api/*` → 404 `BAD_REQUEST` | Only reachable via a bad path | None needed: `BAD_REQUEST` shows the generic "request was invalid" text | The client only calls §3.1 paths. |
| F2 | B3 malformed id → `GAME_NOT_FOUND` | `/game/not-a-uuid` 404s | None needed: Game and Review pages already render "Game not found" on that code | Verified in the browser. |
| F3 | B4 `limit` clamped | — | None: the client always sends `status=finished&limit=20` | — |
| F4 | B6 socket `BAD_REQUEST` ack | Malformed payloads | None: ack errors map to `GameClientError(code)` generically | The UI only ever sends well-formed payloads. |
| F5 | B11 analysis stays `pending` | No `analysis:progress` / `analysis:ready` yet | The game-over panel and Review page show "Analysis in progress…" with the Review button disabled, and say you can leave and come back. The Review page spectates and refetches on any `game:state` whose `analysisStatus` settles, not only on `analysis:ready`. Home shows "Analysis pending". | Must not look stuck or wait forever; part 2 lights it up with no frontend change. |
| F6 | Version can jump by 2 (auto-pass); resign keeps version | Per contract | None: the reducer drops only strictly lower versions | Already §2-compliant. |
| F7 | No server-side unsubscribe event | Contract has none | `unsubscribe()` just drops the local handlers. The socket stays in the room and events for unwatched games are ignored | Harmless; a `game:unsubscribe` could be added later. |
| F8 | Network / timeout errors | `ErrorCode` has no network code | fetch failures, non-`ApiError` error bodies and ack timeouts (8s) surface as `INTERNAL` with a connection-oriented message | `types.ts` is frozen. |
| F9 | Mock flag | §6.2: "mocks stay reachable behind `?mock=1`" | `?mock=1` sticks for the tab (sessionStorage) so in-app navigation and refresh stay mocked; `?mock=0` exits | A query-only flag would silently drop to the real API on the first navigation. |

## Backend session, part 2

| # | Area | What the contract says | What was built | Why / proposed fix |
|---|---|---|---|---|
| B12 | Terminal eval | "exact disc differential" | Raw `B − W` disc count. Empty squares on an early-terminated board are **not** awarded to the winner. | Matches `countDiscs` / `winnerOf` and what the UI shows. The WOF empties-to-winner rule would make the graph disagree with the displayed score. |
| B13 | Pass plies | `evalBefore = evalAfter = evaluate(board)`, "or the search value if that's cheap" | Both are set to the **previous ply's `evalAfter`**, and `depth`/`exact` are inherited from it | That is the search value of the same position (negamax handles the pass), so it costs nothing and the graph stays flat across a pass. |
| B14 | `timeBudgetMs` | "iterative deepening stops at this" | Depth 1 always completes. The exact endgame solve (empties ≤ `exactEmpties`) ignores the budget. | So there's always a result, and exact solves at ≤ 12 empties take < 100 ms here anyway. |
| B15 | `summary.counts` | `Record<MoveClass, number>` | Counts **every** ply of that player, including passes (as `forced`). So `sum(counts) ===` that player's ply count. Accuracy and `avgLoss` exclude forced plies, per the contract. | Lets the move-list badges and the summary card agree. |
| B16 | Eval precision | — | `evalBefore`, `evalAfter`, `loss` and candidate evals are rounded to 2 decimals. The `real` DB columns are re-rounded on read. | Avoids float4 noise such as `4.329999923`. |
| B17 | Live responsiveness during analysis | "`setImmediate` between plies so live games stay responsive" | Implemented, but one ply's search blocks for up to ~400 ms (the budget). Measured: `/api/health` took 0.4 s typically, with one 1.2 s spike, while a game was being analyzed. | Within the §8 budget. The fix is the roadmap's `worker_threads` pool (§7.2). |
| B18 | `GET …/analysis` consistency | `plies` populated iff `done` | If status is `done` but some `moves` row lacks analysis (shouldn't happen), the API reports `status: 'failed'` rather than a partial result | Defensive: never violate "length === moves.length iff done". |
| B19 | Shutdown mid-analysis | Silent | `SIGINT`/`SIGTERM` stops the runner after the current ply without marking the game failed. It stays `running` and is re-queued on the next boot (verified). | Restarts shouldn't produce spurious `failed` reviews. |
| B20 | Motifs (stretch) | §2 definitions | Implemented. `allowed_corner` = corners legal for the opponent after the move that weren't legal for them on `boardBefore`. `x_square`/`c_square` require the adjacent corner to be empty on `boardBefore`. | Straight reading of §2. |
| B21 | Tooling | — | `npm run bench -w backend [-- --depth N --exact N --budget MS --verbose]` times `analyzeGame` per ply. `SMOKE_SEED=<n> npm run smoke -w backend` plays seeded random moves instead of `legalMoves[0]`. | Used for tuning, and gives the frontend realistic games to review. |

## Tuned values

**Classification thresholds** (loss in discs, mover POV; unchanged from §4.1):

| best | good | inaccuracy | mistake | blunder |
|---|---|---|---|---|
| ≤ 0.5 | ≤ 2 | ≤ 5 | ≤ 10 | > 10 |

Moves with exactly one legal option, and passes, are `forced` (loss 0). Accuracy per player is `100 · mean(exp(−loss/6))` over non-forced moves.

**Search settings** (`ANALYSIS_SEARCH_OPTIONS` in `shared/src/engine/analyze.ts`): `depth: 8`, `exactEmpties: 12`, `timeBudgetMs: 400` per ply (iterative deepening; the deepest completed depth is used).

**Eval weights** (`EVAL_WEIGHTS` in `shared/src/engine/eval.ts`, disc units, Black POV):
- corner ±12
- X-square −4 and C-square −1.5, each only while the adjacent corner is empty
- mobility `10·(mB−mW)/(mB+mW+2)`
- frontier `5·(fW−fB)/(fB+fW+2)`
- disc parity `0.6·filled²·(B−W)`, where `filled` goes from 0 to 1 over the game
- clamped to ±64

The corner weight was raised from 8 to 12 because at 8 an obviously free corner scored below quiet moves.

**Measured** (M-series Mac, `npm run bench -w backend`):

| Game | Plies | Full analysis | Slowest ply |
|---|---|---|---|
| Smoke game (always `legalMoves[0]`) | 64 | 2.6 s | 0.2 s |
| Seeded random games | 60–62 | 11–19 s | ≈ 0.5 s |
| Hard ceiling | ~60 | ≈ 60 × 0.4 s ≈ 25 s, plus the endgame (< 1 s) | — |

**Scale check (§8 risk 2):** the eval scale needed no change.
- Random play gives a spread: roughly 25% best, 15% good, 20% inaccuracy, 15–20% mistake, 15–20% blunder.
- The smoke game has 25 best and 11 blunders out of 64 plies.
- Accuracy lands at 50–70% for random or first-legal-move play.
- Neither "everything is a blunder" nor "nothing is" occurs.

## Session 2: optional accounts (Supabase Auth)

The contract cut accounts (§7.2) and planned them for Milestone 2 (§7.1). They were pulled forward because cross-game coaching and tournaments both need a stable identity. Guest play is unchanged.

| # | Area | What the contract says | What was built | Why |
|---|---|---|---|---|
| A1 | Identity | Anonymous seat tokens only (§0b) | Seat tokens are **still** the in-game credential for everyone. Accounts are optional: Supabase Auth issues the session, and the API verifies its JWT locally via JWKS (`jose`). Legacy HS256 projects are supported via `SUPABASE_JWT_SECRET`. | Guests and account holders share one game flow, and the socket layer is untouched. Local verification means no per-request call to Supabase. |
| A2 | Schema | §7.1 planned `players` + `*_player_id` **replacing** `*_token_hash` | `002_accounts.sql`: an `accounts` table (id = Supabase user id, unique case-insensitive `username`), plus nullable `black_account_id`/`white_account_id` **alongside** the token hashes | Named `accounts` because `Player` already means `'B' \| 'W'`. The token hashes stay because guests still exist. Old games read as guest seats. |
| A3 | Where auth data lives | — | Only identity lives in Supabase. The `accounts` row and all game data stay in our Postgres. | `npm start` still works with zero keys (guest-only mode), and the backend stays the single authority. In production, `DATABASE_URL` can point at Supabase's Postgres. |
| A4 | `types.ts` | Frozen | Added `PlayerInfo.accountId`, `Account`, `MeResponse`, `ClaimUsernameRequest`, and `ErrorCode` values `UNAUTHORIZED` (401) and `USERNAME_TAKEN` (409) | These are additive changes. The mock fixtures were updated to match. |
| A5 | Seat name | Free-text `name` on create/join | For a signed-in caller with a username, the server uses the username and **ignores** the body's `name`. Guests are unchanged. | Stops anyone posing as a registered player. That matters once results feed profiles and tournaments. |
| A6 | Bad bearer token | — | A present-but-invalid `Authorization` header → 401 `UNAUTHORIZED`. It never silently downgrades to a guest. | Otherwise a game could silently fail to reach the player's profile. |
| A7 | New endpoints | — | `GET /api/me`, `PUT /api/me` `{username}`, `GET /api/me/games?limit=` (finished games where the account holds either seat) | `me/games` is the first cross-game query and the seed for Milestone 2 coaching. |

## Session 2: deployment prep (Supabase Postgres, split web/API hosting)

| # | Area | What the contract says | What was built | Why |
|---|---|---|---|---|
| D1 | Data API exposure | — | `003_enable_rls.sql`: RLS on for every table, with no policies | Supabase exposes `public` over its Data API to anyone holding the browser-shipped publishable key. Our API connects as the table owner, so it isn't affected by RLS. No-op on local Postgres. |
| D2 | DB TLS | — | `DATABASE_CA_CERT` (PEM or path) → verified TLS. `sslmode` etc. are stripped from `DATABASE_URL` when it's set. | pg treats `sslmode=require` as verify-full, and URL SSL params override the `ssl` option. Verifying against Supabase's CA beats `rejectUnauthorized: false`. |
| D3 | Same-origin assumption (§0b) | Relative URLs via the Vite proxy | Optional `VITE_API_URL` (REST + socket) and `WEB_ORIGIN` (CORS allowlist for Express and Socket.IO). Both unset locally, so dev and ngrok are unchanged. | The web app (static host) and the API (long-running Node host) live on different domains once deployed. |
| D4 | Runtime deps | `tsx` as a dev dependency | `tsx` moved to `dependencies` | The API runs through `tsx` in production, and hosts may skip dev dependencies. |

## Session 2: tournaments (single elimination)

The contract put tournaments in Milestone 3 (§7.1) as round-based Swiss. This build does a smaller version on top of accounts: single elimination, 2–8 players, with the simplest rules that still produce a champion.

| # | Area | What the contract says | What was built | Why |
|---|---|---|---|---|
| T1 | Format | Swiss (§7.1) | Single elimination. Bracket size = next power of two, random seeding at start, standard placement (1v8, 4v5, 2v7, 3v6), so byes always go to top seeds. | A bracket needs no pairing engine or tie-breaks, and it's easy to follow. Swiss stays on the roadmap. |
| T2 | Rules | — | The upper slot plays Black. **A draw goes to White.** A resign or a forfeit counts as a loss. | A knockout match needs a winner. "Draw → White" avoids replays. |
| T3 | Who can take part | — | Accounts with a claimed username create and join. The creator **organizes** (starts the tournament, forfeits no-shows) and plays only if they also join. Guests can view brackets and watch games. | Results belong to identities. An organizer running an event they don't play in is the normal case. |
| T4 | Schema | `tournaments`, `rounds`, `pairings` (§7.1) | `004_tournaments.sql`: `tournaments`, `tournament_entries`, and `tournament_matches` (primary key `(tournament_id, round, slot)`, `game_id` → `games`). All matches are created on start, and later rounds fill in as winners advance. `games.black_token_hash` is now nullable, and `end_reason` gains `'forfeit'`. | A round is just a column. Pre-created match rows make the bracket a plain read. |
| T5 | Seat credential | Seat tokens from create/join | Tournament games are created **active**, with both seats assigned to accounts and no tokens. `POST /api/games/:id/seat` (account required) issues or rotates the caller's own seat token. After that, socket play is unchanged. | Tokens are stored only as hashes, so they can't be handed out later. Claiming keeps the socket layer untouched. Because the game is already active, the open-seat `join` can't hijack it. |
| T6 | Advancement | — | `TournamentService` listens to `GameService.onState`. When a tournament game finishes, it records the winner and fills the next match (creating that game once both players are known) or finishes the tournament. Every write holds the tournament's row lock in one transaction. On boot, it re-feeds any finished results that were missed. | Two semifinals ending at once can't both create the final. Recording is idempotent, so repeated finished broadcasts are harmless. |
| T7 | No-shows | Abandonment rules (§7.1) | The organizer can forfeit a playing match: `POST /api/tournaments/:id/matches/:round/:slot/forfeit {loser}`. The game ends with `endReason: 'forfeit'` and still gets analyzed. | In a knockout, a single stuck game blocks the whole bracket. Clocks and automatic forfeits remain roadmap items. |
| T8 | `types.ts` | Frozen | Added `Tournament*` types, `MatchStatus`, `ForfeitRequest`, `EndReason 'forfeit'`, and `ErrorCode` values `FORBIDDEN` (403), `TOURNAMENT_NOT_FOUND` (404), `TOURNAMENT_FULL` and `TOURNAMENT_NOT_OPEN` (409). Bracket math lives in `shared/src/bracket.ts` (unit tested). | These are additive changes, and the server and UI share the same bracket math. |
| T9 | Live updates | — | The tournament page polls every 5 seconds while a tournament isn't finished. There's no tournament socket room. | A bracket changes once per game, so polling is enough for now. |
| T10 | Ending early | — | The organizer can end a tournament that is `registering` or `active` (`POST /api/tournaments/:id/cancel`). It becomes `cancelled`, with `finished_at` as the end time, and it is **never deleted**, so links keep working. The bracket freezes as it stood. Games still in progress are force-ended. From then on, late results, forfeits, joins and starts are all refused. On boot, the server force-ends any game left running by a crash between the cancel and the abort. | Organizers need a way out of a stalled or abandoned event. Keeping the record preserves every game already played. |
| T11 | Finished games without a winner | `winner` is non-null iff `status === 'finished'` (§3) | One exception: `endReason: 'cancelled'`. A tournament game force-ended by cancellation is `finished` with `winner: null`. It is still analyzed if it has moves. The UI labels it "Tournament cancelled". | No one won, and inventing a result would be worse. Every consumer already tolerated a null winner. |
