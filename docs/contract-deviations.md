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
| B11 | Analysis (part 1 only) | §3.3/§4.2 runner | Game end sets `analysis_status='pending'` and broadcasts. Nothing moves it past `pending` yet. `GET …/analysis` returns `{status, progress:null, plies:[], summary:null}`. | Per the B1 prompt scope. Part 2 adds the runner and the boot re-queue. |
