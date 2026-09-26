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
