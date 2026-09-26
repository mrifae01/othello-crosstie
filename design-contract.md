# Othello Crosstie — Design Contract

**Status:** frozen for implementation. Both sessions build against this document. If you find a flaw, **do not silently diverge**: keep building to the contract, and log the issue in `docs/contract-deviations.md` (what, why, proposed fix). We reconcile during the integration pass.

**Product in one line:** two people play Othello in the browser via an invite link. When the game ends, the server analyzes every move with a minimax engine and shows a chess.com-style review: an eval graph, per-move classification (best → blunder), the best move at each ply, and an accuracy score for each player.

---

## 0a. Why this edge (the business framing the build must support)

The assignment grades *business sense*: whether the edge is real, whether the build supports it, and whether the roadmap and the build tell the same story. So every build decision below traces back to one bet:

> **eothello is a place to *play* Othello. Crosstie is a place to *get better* at Othello.**

eothello already covers multiplayer, an AI opponent, ratings, tournaments and a player base, and we can't out-network an incumbent in 8 hours. Its public site has no post-game review, move evaluation or blunder detection (checked 2026-09-26; re-verify by hand before submitting). Strong analysis engines do exist (Edax, WZebra, SAIO), but they are separate desktop or mobile tools. Our wedge is **coaching built into the place you play, with zero setup.**

| Audience | Why they'd choose us | What in this build serves it |
|---|---|---|
| Improving player | Every game becomes a lesson: where it turned, what you should have played, how accurate you were | Automatic analysis, eval graph, blunder flags, best move per ply, accuracy |
| Club / coach | Review a student's game together from one link | Review pages are public URLs (`/game/:id/analysis`); spectating works via link |
| Tournament organizer | Annotated game records, and commentary-ready eval graphs for broadcast | Per-ply analysis stored in Postgres (the seed of an archive); spectator mode |

What's cut (§7) is cut *because* it doesn't serve this bet: ratings, lobby, clocks and accounts are all table stakes the incumbent already wins on.

---

## 0b. Decisions already made

| Topic | Decision |
|---|---|
| Matchmaking | **Invite link.** Creator gets `/game/:id`, opponent opens it and claims the White seat. No lobby, no queue. |
| Identity | **Anonymous + per-game seat token.** The player enters a display name, and the server returns a random `playerToken` for that seat. The client keeps it in `sessionStorage` under `othello:seat:<gameId>`. A refresh keeps the seat, and a new tab or a different browser is a different player, so two tabs in one browser can play each other. The DB stores only a sha256 of the token. |
| Analysis trigger | **Automatic on game end, persisted.** Results are written per ply into `moves`. Clients receive progress and ready events over the socket, and the analysis page reads over REST. |
| Local Postgres | **docker compose by default, with a no-Docker fallback.** `npm start` brings up the DB, runs migrations, then starts the API and web client. If `DATABASE_URL` is set, Docker is skipped and that database is used. The assignment allows "clearly documented equivalents", and the README must document both paths. |
| Remote second player | Supported via **ngrok (or similar) on the Vite port 5173**. Vite proxies the API and websocket, so a single tunnel URL is enough. The invite link is built from `window.location.origin`. |
| Transport | **REST** for creating, joining and reading things. **Socket.IO** for live game play and push events. The server is authoritative for all game rules. |
| Runtime | Node ≥ 20, TypeScript everywhere, npm workspaces, `tsx` for the backend (no build step), Vite for the frontend. |

---

## 1. Repo layout & tooling

```
othello-crosstie/
├── package.json              # workspaces: ["shared", "backend", "frontend"]; root scripts
├── docker-compose.yml        # postgres:16-alpine, host port 5433
├── tsconfig.base.json
├── design-contract.md        # this file
├── scripts/start.mjs         # npm start orchestration (see below)
├── docs/
│   ├── contract-deviations.md
│   ├── design-notes.md       # deliverable: edge, architecture, decisions, trade-offs
│   ├── roadmap.md            # deliverable: milestones 2 & 3 (§7)
│   └── ai-usage/             # deliverable: prompts saved verbatim, one file per session (§6.4)
├── shared/                   # @othello/shared — types + pure engine. No I/O, no Node/DOM APIs.
│   ├── package.json          # "main": "src/index.ts", "types": "src/index.ts"  (consumed as TS source)
│   └── src/
│       ├── index.ts          # re-exports everything below
│       ├── types.ts          # §2, verbatim
│       ├── notation.ts
│       └── engine/{rules,eval,search,analyze,motifs}.ts
├── backend/                  # @othello/backend — Express + Socket.IO + pg
└── frontend/                 # @othello/frontend — Vite + React + react-router
```

**Ports & env**

| Thing | Value |
|---|---|
| API + Socket.IO | `http://localhost:3001` (`PORT`) |
| Vite dev server | `http://localhost:5173`, which proxies `/api` and `/socket.io` (with `ws: true`) to 3001, so the frontend always uses relative URLs. It also sets `server.host: true` and `server.allowedHosts: true`; without them Vite rejects ngrok's Host header. |
| Postgres | `postgres://othello:othello@localhost:5433/othello` (`DATABASE_URL`). The backend falls back to this default, so no `.env` is required |

**Root scripts (backend session owns)**

```jsonc
"start":   "node scripts/start.mjs",
"test":    "npm test -w shared && npm test -w backend --if-present",
"db:reset":"docker compose down -v && docker compose up -d --wait db && npm run migrate -w backend"
```

`scripts/start.mjs` works as follows:

1. If `DATABASE_URL` is unset, run `docker compose up -d --wait db`. If Docker isn't available, exit with a clear message explaining how to set `DATABASE_URL` instead.
2. Run `npm run migrate -w backend`.
3. Run `concurrently -n api,web "npm run dev -w backend" "npm run dev -w frontend"`.

`docker-compose.yml` must define a `healthcheck` (`pg_isready`) so `--wait` works. Target platform is macOS or Linux (the assignment says "Unix").

**Parallel-work mechanics**

1. **Phase 0** (backend session, about 20 min, *before the frontend session starts*): root `package.json`, `tsconfig.base.json`, `docker-compose.yml`, the `shared/` package containing `types.ts` verbatim from §2 and `notation.ts`, and empty `backend/` and `frontend/` package.json stubs. Commit this to `main`.
2. Then branch: `git worktree add ../othello-fe -b frontend` for the frontend session. The backend continues on branch `backend`.
3. **Ownership is by directory.** The frontend session writes only under `frontend/`. The backend session writes everything else. Neither side edits `shared/src/types.ts` after Phase 0.
4. Both branches will touch `package-lock.json`. At integration, resolve that by deleting it and re-running `npm install`.
5. **Commit history is a graded deliverable.** Commit once per task-table row (at minimum) with a descriptive message such as `engine: legal moves + flips with tests`. Never squash. Merge branches with `git merge --no-ff` so the parallel work stays visible.

---

## 2. Shared TypeScript types — `shared/src/types.ts`

This block is the literal file content. Frontend imports use `import type { … } from '@othello/shared'`, plus the runtime helpers from §4.1 (`squareToAlg`, and `initialBoard` for mocks).

```ts
// ============================================================
// shared/src/types.ts — FROZEN CONTRACT (see design-contract.md)
// ============================================================

// ---------- Core board ----------

/** Black always moves first. */
export type Player = 'B' | 'W';
export type Cell = Player | null;

/**
 * 64 cells, row-major. index = row * 8 + col.
 * row 0 = rank "1" (top of the screen), col 0 = file "a" (left).
 * Start position: d4=27 'W', e4=28 'B', d5=35 'B', e5=36 'W'.
 */
export type Board = Cell[];

/** Integer 0..63. Algebraic: squareToAlg(19) === 'd3'. */
export type Square = number;

export interface Move {
  player: Player;
  /** null = pass. Passes are generated by the server only; clients never send them. */
  square: Square | null;
}

export interface PlayedMove extends Move {
  /** 1-based, contiguous, passes included. */
  ply: number;
  /** Squares flipped by this move ([] for a pass). Does not include `square` itself. */
  flipped: Square[];
}

// ---------- Game ----------

export type GameStatus = 'waiting' | 'active' | 'finished';
export type Winner = Player | 'draw';
export type EndReason = 'normal' | 'resign';
export type AnalysisStatus = 'none' | 'pending' | 'running' | 'done' | 'failed';

export interface PlayerInfo {
  name: string;
}

/** Lightweight game header: used in lists, in GameState, and in AnalysisResult. */
export interface GameSummary {
  gameId: string;
  status: GameStatus;
  players: { B: PlayerInfo; W: PlayerInfo | null }; // W is null while status === 'waiting'
  counts: { B: number; W: number };
  winner: Winner | null;        // non-null iff status === 'finished'
  endReason: EndReason | null;  // non-null iff status === 'finished'
  analysisStatus: AnalysisStatus;
  createdAt: string;            // ISO 8601
  finishedAt: string | null;    // ISO 8601
}

/** Full live state. The server always sends the whole thing, never diffs. */
export interface GameState extends GameSummary {
  board: Board;
  /** Whose turn it is. null unless status === 'active'. */
  turn: Player | null;
  /** Legal squares for `turn`. [] when turn is null. Clients use this for hints; never compute rules client-side. */
  legalMoves: Square[];
  /** Full history, including server-generated passes. */
  moves: PlayedMove[];
  /**
   * === moves.length. Clients must ignore any GameState whose version is
   * strictly LOWER than the one they hold (equal is fine: resign / analysis
   * status changes re-broadcast at the same version).
   */
  version: number;
}

// ---------- Analysis ----------

/**
 * All evals are in "disc" units from BLACK's point of view (+ = Black better),
 * like chess engines report from White's POV. Heuristic evals are scaled to
 * roughly approximate final disc differential. When `exact` is true the value
 * IS the final disc differential under perfect play. Range is always [-64, 64].
 */
export type MoveClass = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'forced';

/** Rule-based coaching tags. May be [] (backend fills these if time allows). */
export type Motif =
  | 'took_corner'     // played a corner
  | 'missed_corner'   // a corner was legal and the best move, but not played
  | 'allowed_corner'  // after this move the opponent has a legal corner they didn't have before
  | 'x_square'        // played b2/g2/b7/g7 while the adjacent corner is empty
  | 'c_square';       // played a C-square (a1-adjacent edge squares etc.) while the adjacent corner is empty

export interface CandidateMove {
  square: Square;
  eval: number; // Black POV
}

export interface PlyAnalysis {
  ply: number;
  player: Player;
  square: Square | null;        // null = pass
  flipped: Square[];
  boardBefore: Board;
  boardAfter: Board;
  /** Black-POV eval of the position before this ply, assuming best play (= best candidate's eval). */
  evalBefore: number;
  /** Black-POV eval after the move actually played. Plot this for the eval graph. */
  evalAfter: number;
  /** Discs given up versus the best move, from the MOVER's POV. Always >= 0. 0 for forced moves. */
  loss: number;
  /** Engine's best move. null only for passes. */
  bestSquare: Square | null;
  classification: MoveClass;
  isBlunder: boolean;           // === (classification === 'blunder')
  /** Up to 3 root moves, best-first from the mover's POV. Evals are Black POV. */
  candidates: CandidateMove[];
  motifs: Motif[];
  depth: number;                // search depth reached
  exact: boolean;               // true if solved to the end of the game
}

export interface PlayerAnalysisSummary {
  /** 0..100. 100 * mean(exp(-loss / 6)) over this player's non-forced moves; 100 if none. */
  accuracy: number;
  /** Mean loss over non-forced moves; 0 if none. */
  avgLoss: number;
  counts: Record<MoveClass, number>;
}

export interface AnalysisResult {
  game: GameSummary;
  status: AnalysisStatus;
  /** Non-null only while status === 'running'. */
  progress: { done: number; total: number } | null;
  /** Populated (length === moves.length) iff status === 'done'; otherwise []. */
  plies: PlyAnalysis[];
  /** Non-null iff status === 'done'. */
  summary: { B: PlayerAnalysisSummary; W: PlayerAnalysisSummary } | null;
}

// ---------- REST DTOs ----------

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'GAME_NOT_FOUND'
  | 'GAME_FULL'
  | 'GAME_NOT_ACTIVE'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_MOVE'
  | 'BAD_TOKEN'
  | 'INTERNAL';

/** Body of every non-2xx REST response. */
export interface ApiError {
  error: { code: ErrorCode; message: string };
}

export interface CreateGameRequest { name: string }   // trimmed, 1..24 chars
export interface JoinGameRequest { name: string }     // trimmed, 1..24 chars

/** Returned by both create (color 'B') and join (color 'W'). */
export interface SeatResponse {
  gameId: string;
  color: Player;
  playerToken: string;
}

export interface ListGamesResponse {
  games: GameSummary[];
}

// ---------- Socket.IO ----------

export type Ack<T extends object = {}> =
  | ({ ok: true } & T)
  | { ok: false; error: ErrorCode; message: string };

export interface SubscribePayload {
  gameId: string;
  /** Omit to watch as a spectator. */
  playerToken?: string;
}
export interface SubscribeResult {
  state: GameState;
  /** Seat that the token maps to; null for spectators or an invalid/missing token. */
  you: Player | null;
}

export interface MovePayload {
  gameId: string;
  playerToken: string;
  square: Square;
}

export interface ResignPayload {
  gameId: string;
  playerToken: string;
}

export interface AnalysisProgressPayload {
  gameId: string;
  done: number;
  total: number;
}

export interface AnalysisReadyPayload {
  gameId: string;
  status: 'done' | 'failed';
}

/** Pass as generics: io<ClientToServerEvents, ServerToClientEvents>(), new Server<ClientToServerEvents, ServerToClientEvents>() */
export interface ClientToServerEvents {
  'game:subscribe': (p: SubscribePayload, ack: (r: Ack<SubscribeResult>) => void) => void;
  'game:move': (p: MovePayload, ack: (r: Ack) => void) => void;
  'game:resign': (p: ResignPayload, ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'game:state': (s: GameState) => void;
  'analysis:progress': (p: AnalysisProgressPayload) => void;
  'analysis:ready': (p: AnalysisReadyPayload) => void;
}
```

---

## 3. API & socket contract

### 3.1 REST (all JSON, prefix `/api`)

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `POST /api/games` | `CreateGameRequest` | `201 SeatResponse` (color `'B'`), game `status: 'waiting'` | 400 `BAD_REQUEST` |
| `POST /api/games/:id/join` | `JoinGameRequest` | `200 SeatResponse` (color `'W'`). The game becomes `active`, `turn: 'B'`, and the server broadcasts `game:state` to the room | 400, 404 `GAME_NOT_FOUND`, 409 `GAME_FULL` (already has White, or not `waiting`) |
| `GET /api/games/:id` | — | `200 GameState` (public, no token) | 404 |
| `GET /api/games?status=finished&limit=20` | — | `200 ListGamesResponse`, newest `finishedAt` first. `limit` defaults to 20, max 50 | 400 |
| `GET /api/games/:id/analysis` | — | `200 AnalysisResult`. Always 200 for an existing game, and the frontend switches on `status` | 404 |
| `GET /api/health` | — | `200 { ok: true, db: boolean }` | — |

Every non-2xx response has an `ApiError` body.

### 3.2 Socket.IO

Rooms are named `game:<gameId>`. Any number of sockets can subscribe to a room: both players, extra tabs, and spectators.

| Direction | Event | Payload | Semantics |
|---|---|---|---|
| C→S | `game:subscribe` | `SubscribePayload` → ack `Ack<SubscribeResult>` | Joins the room and returns the current state along with your seat. The client calls this on every (re)connect, because Socket.IO reconnects create a fresh socket that is in no rooms. Error: `GAME_NOT_FOUND`. An invalid token is **not** an error: the socket becomes a spectator and `you: null` is returned. |
| C→S | `game:move` | `MovePayload` → ack `Ack` | Validate in this order: game exists → `status === 'active'` (`GAME_NOT_ACTIVE`) → token matches a seat (`BAD_TOKEN`) → seat === turn (`NOT_YOUR_TURN`) → square is legal (`ILLEGAL_MOVE`). On success, persist first, then ack `{ok:true}`, then broadcast `game:state` to the room (the sender included). The client **does not** apply moves optimistically; it renders only from `game:state`. |
| C→S | `game:resign` | `ResignPayload` → ack `Ack` | Allowed only while `active`. Sets `status: 'finished'`, `winner` = the other player, and `endReason: 'resign'`. Broadcasts `game:state` and enqueues analysis if at least one move was played (otherwise `analysisStatus` stays `'none'`). |
| S→C | `game:state` | `GameState` | Sent after join, move, resign, and every `analysisStatus` transition. Clients replace their state wholesale, subject to the `version` rule. |
| S→C | `analysis:progress` | `AnalysisProgressPayload` | Sent after each ply is analyzed. |
| S→C | `analysis:ready` | `AnalysisReadyPayload` | Sent once at the end. The client then `GET`s `/api/games/:id/analysis`. |

### 3.3 Server-side game semantics (backend implements, frontend relies on)

- **Passes are automatic.** After a move, if the opponent has no legal move but the mover does, the server appends a pass `PlayedMove` for the opponent (`square: null`, `flipped: []`, its own ply) in the **same transaction**, and `turn` stays with the mover. Clients see the pass in `moves` and should show a short "White has no moves — pass" notice when the latest move is a pass.
- **Game over** happens when neither player has a legal move, which includes a full board. Then `status: 'finished'`, `winner` goes by disc count (`'draw'` on a tie), `endReason: 'normal'`, `turn: null`, `legalMoves: []`, and analysis is enqueued.
- **Concurrency:** the server applies moves to a single game one at a time, using a per-game promise-chain mutex around validate → persist → mutate cache → broadcast. If persistence fails, the in-memory state is left untouched and the ack returns `INTERNAL`.
- **Server restart:** `game:subscribe` or `GET` for a game not in memory loads it from Postgres, using `games.board`, `turn`, and the moves list. Games whose analysis was `pending` or `running` are re-queued on boot.

### 3.4 Client flows (frontend implements)

**Routes:** `/` (home), `/game/:id` (play), `/game/:id/analysis` (review).

1. **Create:** on Home, enter a name → `POST /api/games` → store the token in `sessionStorage['othello:seat:<id>']` → navigate to `/game/:id`. The page shows "Waiting for opponent" with a **Copy invite link** button.
2. **Join:** open `/game/:id` → `GET /api/games/:id`. If `status === 'waiting'` and there is no stored token, show a name form → `POST …/join` → store the token → subscribe. If the game is `active` or `finished` and there is no token, subscribe as a spectator.
3. **Play:** subscribe with the stored token. Highlight `legalMoves` only when `state.turn === you`. Clicking a square emits `game:move`, and a `{ok:false}` ack is shown as a toast. Also show disc counts, whose turn it is, a move list in algebraic notation, and a Resign button with a confirm step.
4. **Game over:** show the result banner. While `analysisStatus` is `pending` or `running`, show a progress bar driven by `analysis:progress`. When `analysis:ready` arrives with `status: 'done'`, enable a **Review game** button that goes to `/game/:id/analysis`.
5. **Review:** `GET /api/games/:id/analysis`. If the result isn't `done`, subscribe as a spectator and wait for `analysis:ready`, then refetch. When it is `done`, render the review UI described in §5.2.

---

## 4. Engine module boundary

### 4.1 `@othello/shared`: pure, deterministic, and runs in Node or the browser

These are declarations only. The backend session implements them and writes unit tests for them.

```ts
// notation.ts  (Phase 0; frontend uses these)
squareToAlg(sq: Square): string;          // 19 -> 'd3'
algToSquare(alg: string): Square;         // 'd3' -> 19
boardToString(b: Board): string;          // 64 chars of '.', 'B', 'W' (DB format)
boardFromString(s: string): Board;

// engine/rules.ts
initialBoard(): Board;
opponent(p: Player): Player;
getFlips(b: Board, p: Player, sq: Square): Square[];     // [] => illegal
getLegalMoves(b: Board, p: Player): Square[];            // ascending order
applyMove(b: Board, p: Player, sq: Square): { board: Board; flipped: Square[] }; // pure; throws on illegal
countDiscs(b: Board): { B: number; W: number };
/** Who moves after `justMoved`: the opponent if they can; else justMoved if they can (opponent passes); else null (game over). */
nextTurn(b: Board, justMoved: Player): Player | null;
winnerOf(b: Board): Winner;

// engine/eval.ts
/** Static heuristic, Black POV, disc units, clamped to [-64, 64]. Terminal boards return the exact disc differential. */
evaluate(b: Board): number;

// engine/search.ts
interface SearchOptions {
  depth: number;          // nominal ply depth (default 6)
  exactEmpties: number;   // solve to the end when empties <= this (default 10)
  timeBudgetMs?: number;  // iterative deepening stops at this; returns the deepest completed
}
interface SearchResult {
  scores: CandidateMove[];   // EVERY legal root move, full-window (exact at the searched depth), sorted best-first for `p`
  best: Square | null;       // null if p has no legal moves
  depth: number;
  exact: boolean;
  nodes: number;
}
search(b: Board, p: Player, opts?: Partial<SearchOptions>): SearchResult;

// engine/motifs.ts
detectMotifs(before: Board, p: Player, sq: Square, best: Square | null): Motif[];

// engine/analyze.ts
/** Yields one PlyAnalysis per move, in order. A generator, so the caller controls yielding and persistence. */
analyzeGame(moves: Move[], opts?: Partial<SearchOptions>): Generator<PlyAnalysis>;
summarize(plies: PlyAnalysis[]): { B: PlayerAnalysisSummary; W: PlayerAnalysisSummary };
```

**Engine rules the implementation must respect**

- **Search:** negamax with alpha-beta. The tree handles passes: a side with no moves passes and does not use up depth, and two passes in a row is terminal. Order moves by a static square-weight table with corners first and X-squares last. Every **root** move gets its own full-window score, because `loss` needs the exact score of the move that was actually played and not just an alpha-beta bound. That costs roughly the branching factor in extra work, which is fine for about 60 plies once.
- **Heuristic** (`evaluate`): a phase-weighted blend of mobility, corner occupancy, X/C-square penalties when the adjacent corner is empty, frontier discs, and disc parity with low weight early and high weight late. It is scaled so that the values mean roughly "discs". The exact weights are the backend's choice.
- **Per-ply analysis:** `search(boardBefore, mover)` →
  - `evalBefore` = the best score, `evalAfter` = the played move's score, `loss` = the mover-POV difference, floored at 0.
  - Moves with one legal option, and passes, are classified `'forced'` with `loss: 0`. For a pass, `evalBefore = evalAfter = evaluate(board)`, or the search value if that's cheap.
  - `candidates` is the top 3 of `scores`.
- **Classification thresholds** (loss in discs, starting values; the backend may tune them and must document the final values in the README):

  | best | good | inaccuracy | mistake | blunder |
  |---|---|---|---|---|
  | ≤ 0.5 | ≤ 2 | ≤ 5 | ≤ 10 | > 10 |

- **Required unit tests:**
  - Black's initial legal moves are exactly `[19, 26, 37, 44]` (d3, c4, f5, e6).
  - `applyMove(initialBoard(), 'B', 19)` flips `[27]`.
  - A forced-pass position produces a pass from `nextTurn`.
  - A full board is terminal.
  - `search` on a position with an obvious free corner picks the corner.
  - Exact solve on a position with 4 or fewer empties matches brute force.

### 4.2 Backend-only glue (`backend/`)

| Module | Responsibility |
|---|---|
| `config.ts` | `PORT` and `DATABASE_URL`, with the defaults from §1 |
| `db/pool.ts`, `db/migrate.ts`, `migrations/001_init.sql` | `pg` Pool, plus a tiny migration runner that applies ordered `.sql` files and tracks them in `schema_migrations` |
| `db/gamesRepo.ts` | Create/join/load/list games, insert moves plus the game update in one transaction, and write the analysis columns |
| `game/GameService.ts` | In-memory `Map<gameId, LoadedGame>` cache, token hashing and checking, the per-game mutex, move validation using the shared rules, auto-pass, game-over detection, resign, and `toGameState()` |
| `analysis/AnalysisRunner.ts` | In-process FIFO queue that analyzes **one game at a time**. It iterates `analyzeGame()`, and after each ply it `UPDATE`s that `moves` row, emits `analysis:progress`, and does `await new Promise(r => setImmediate(r))` so live games stay responsive. Status transitions are `pending → running → done/failed`, each re-broadcasting `game:state`. It keeps in-memory `progress` for `GET …/analysis` and re-queues on boot. |
| `http/routes.ts` | The REST endpoints from §3.1, with input validation (hand-rolled, no zod needed) and `ApiError` mapping |
| `socket/handlers.ts` | The socket events from §3.2 and room management |
| `server.ts` | Wires Express and Socket.IO onto one `http.Server` |

The engine never touches I/O, and the glue never re-implements a rule.

---

## 5. Postgres schema — `backend/migrations/001_init.sql`

```sql
CREATE TABLE IF NOT EXISTS games (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  status            text        NOT NULL DEFAULT 'waiting'
                                CHECK (status IN ('waiting','active','finished')),
  black_name        text        NOT NULL,
  white_name        text,
  black_token_hash  text        NOT NULL,          -- sha256 hex of playerToken
  white_token_hash  text,
  board             char(64)    NOT NULL,          -- current position, boardToString()
  turn              char(1)     CHECK (turn IN ('B','W')),  -- NULL unless active
  black_count       smallint    NOT NULL DEFAULT 2,
  white_count       smallint    NOT NULL DEFAULT 2,
  winner            text        CHECK (winner IN ('B','W','draw')),
  end_reason        text        CHECK (end_reason IN ('normal','resign')),
  analysis_status   text        NOT NULL DEFAULT 'none'
                                CHECK (analysis_status IN ('none','pending','running','done','failed')),
  analysis_error    text,
  analyzed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,                   -- set on join
  finished_at       timestamptz
);

CREATE INDEX IF NOT EXISTS games_finished_idx
  ON games (finished_at DESC) WHERE status = 'finished';

CREATE TABLE IF NOT EXISTS moves (
  game_id         uuid        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply             smallint    NOT NULL CHECK (ply >= 1),
  player          char(1)     NOT NULL CHECK (player IN ('B','W')),
  square          smallint    CHECK (square BETWEEN 0 AND 63),   -- NULL = pass
  flipped         smallint[]  NOT NULL DEFAULT '{}',
  board_after     char(64)    NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- ---- analysis: NULL until the AnalysisRunner writes this row ----
  eval_before     real,                                        -- Black POV, discs
  eval_after      real,                                        -- Black POV, discs
  loss            real        CHECK (loss >= 0),               -- mover POV
  best_square     smallint    CHECK (best_square BETWEEN 0 AND 63),
  classification  text        CHECK (classification IN
                              ('best','good','inaccuracy','mistake','blunder','forced')),
  is_blunder      boolean     GENERATED ALWAYS AS (classification = 'blunder') STORED,
  candidates      jsonb,                                       -- CandidateMove[] (top 3)
  motifs          text[]      NOT NULL DEFAULT '{}',
  search_depth    smallint,
  is_exact        boolean,

  PRIMARY KEY (game_id, ply)
);
```

**Mapping notes**

- `PlyAnalysis.boardBefore` comes from the previous row's `board_after`, or `initialBoard()` for ply 1. It is derived on read, not stored.
- `summary` is computed on read with `summarize()` and is not stored, since it is cheap and avoids drift if thresholds change.
- `games.board`, `turn` and the counts are a denormalized snapshot. They let the server rehydrate a game without replaying moves, and they must be updated in the same transaction as the move insert.

---

## 6. Task split

### 6.1 Backend session: about 3h (it owns `shared/`, `backend/`, and the root)

Work in this order. **Items 1–4 cover the floor requirement.** Don't start item 5 until a full game can be played through the socket and is persisted.

| # | Task | Est. |
|---|---|---|
| 1 | **Phase 0 scaffold** (§1): workspaces, tsconfig, docker compose with healthcheck, `shared/` containing `types.ts` verbatim and `notation.ts`, root scripts. **Commit to `main` so the frontend can start.** | 0:20 |
| 2 | `engine/rules.ts` and its unit tests (vitest) | 0:30 |
| 3 | Migrations, pool, `gamesRepo` | 0:25 |
| 4 | `GameService` (mutex, auto-pass, game over, resign), REST routes, socket handlers. Smoke-test with two `socket.io-client` scripts, or curl plus a tiny script | 0:45 |
| 5 | `eval.ts` and `search.ts` (negamax/α-β, pass handling, exact endgame, iterative deepening with a time budget) with tests | 0:35 |
| 6 | `analyze.ts`, `summarize`, `AnalysisRunner`, the `GET …/analysis` endpoint, and boot re-queue | 0:25 |
| — | *Stretch, only if ahead:* `motifs.ts` (otherwise return `[]`), and tuning so a full-game analysis finishes in under about 30s | — |

**Definition of done:** `npm install && npm start` works from a clean clone with Docker running. Two socket clients can play a full game, rows land in `games` and `moves`, and analysis fills every `moves` analysis column and emits the events. `npm test` is green.

### 6.2 Frontend session: about 2h (it owns `frontend/` only)

Start after the Phase 0 commit exists. **Build against mocks first.** Put hand-written `GameState` and `AnalysisResult` fixtures in `frontend/src/mocks/`, built with `initialBoard()` from shared, and use a `?mock=1` query flag. That way nothing waits on the backend.

| # | Task | Est. |
|---|---|---|
| 1 | Vite + React + react-router + socket.io-client setup. Vite proxy (§1). A typed `api.ts` (fetch wrappers that throw on `ApiError`), a typed `socket.ts` (singleton `Socket<ServerToClientEvents, ClientToServerEvents>` that re-emits `game:subscribe` on every `connect`), and `seatStorage.ts` | 0:15 |
| 2 | `<Board>`: an 8×8 grid with file and rank labels, discs, legal-move dots, a last-move marker, and optional props for a best-move ring and highlighted squares (reused on the review page). A CSS flip animation is optional. | 0:25 |
| 3 | Home (create form, plus a "Recent games" list from `GET /api/games?status=finished` linking to review) and the Game page (join form, waiting state with copy link, turn indicator, counts, move list, pass notice, resign, error toasts, game-over banner, analysis progress, Review button) | 0:30 |
| 4 | Review page: board plus stepper (◀ ▶ buttons and ←/→ keys, starting at ply 0), showing `boardBefore` with a ring on `bestSquare` and a marker on the played square, a classification badge, the loss, and `candidates` | 0:25 |
| 5 | Eval graph: **hand-rolled SVG**, no chart library. Points are `[plies[0].evalBefore, ...plies.map(p => p.evalAfter)]`, clamped to ±32 for display, with the area above or below 0 shaded by side. Blunder and mistake plies get colored dots, clicking the graph jumps to that ply, and the current ply shows as a cursor line. Add a per-player summary card with accuracy and class counts, and a move list with class-colored badges. Render `motifs` as chips when present. | 0:25 |

**Definition of done:** every screen works against the mocks, and switching mocks off requires no code changes beyond the flag. There is no rules logic in the frontend: legality comes only from `state.legalMoves`.

### 6.3 Integration pass: about 1h, both together

1. Merge `backend` and `frontend` into `main` (`--no-ff`), regenerate `package-lock.json`, and confirm `npm install && npm start` works from a fresh clone. Test both the Docker path and the `DATABASE_URL` path.
2. **Floor script:** in two separate tabs, create a game, join it, play to the end (including a pass if possible, which a scripted short game can force), and confirm the result is in Postgres (`psql` or `GET`). Repeat once with the second player joining through an ngrok URL.
3. Watch analysis progress, open the review, and sanity-check that the classifications look plausible. Tune thresholds and depth if analysis takes more than about 30s or everything shows as a blunder.
4. Edge cases: refresh mid-game (seat is kept), a spectator tab, an illegal or out-of-turn click (toast shown), resign, and restarting the server mid-game.
5. Resolve `docs/contract-deviations.md`.

Remaining budget: about 2h of the 8h, for this design, the written deliverables in §6.4, and a buffer. **The written deliverables are graded as heavily as the code, so don't let integration eat that time.**

### 6.4 Written deliverables (you, with AI assistance; about 1.5h, after integration)

The assignment requires all of these in the repo:

| File | Contents |
|---|---|
| `README.md` | Prerequisites (Node ≥ 20, Docker *or* a Postgres URL). `npm install && npm start`. How to play two-player on one machine (two tabs) and remotely (ngrok on 5173). How to run tests. **"Steps I took"**: a short chronological narrative of how the work was done. |
| `docs/design-notes.md` | The competitive edge and why (expand §0a, including what you observed on eothello). Architecture diagram: shared engine / backend glue / frontend. Key decisions and trade-offs, summarizing §0 plus the "why" behind server-authoritative rules, whole-state broadcasts, analysis stored per ply, and in-process analysis. |
| `docs/roadmap.md` | Milestone 2 and Milestone 3, built from §7, including what you ran out of time for and where it plugs into the existing code. Leave genuinely open questions open. |
| `docs/ai-usage/` | `00-design-contract.md` (this conversation's prompts), `01-backend-session.md`, `02-frontend-session.md`, `03-integration.md`. Save each prompt verbatim, and add a line on what you accepted, corrected or rejected and why. That line is what shows "whether you understand what it produced". |

**Instruction to both sessions:** append every prompt you receive, verbatim, to your `docs/ai-usage/0N-*.md` file as you go, rather than reconstructing them at the end. Each session writes only its own file.

---

## 7. Cut or deferred to the roadmap

### 7.1 Milestone framing (the skeleton for `docs/roadmap.md`)

The assignment asks for milestones 2 and 3, named as "world tournament scale" and "historical recordkeeping". Each one extends what this build already has:

**Milestone 1: this build.** Rules-enforced two-player games, persisted results, and automatic per-ply engine analysis with a shareable review page.

**Milestone 2: Coaching across games (identity + historical recordkeeping).**
- Accounts replace seat tokens: a `players` table, and `games.black_player_id` / `white_player_id` replace the `*_token_hash` columns. Existing anonymous games stay readable.
- Because analysis is already stored per ply in `moves`, cross-game coaching is **just SQL over existing rows**. For example: "you play X-squares 3× more than players at your level", accuracy trend over time, and puzzles mined from your own blunders (positions where `is_blunder` is true and `best_square` is the answer).
- Also in this milestone: an AI opponent (§7.2 row 1), ratings, and game import/export in standard transcript notation (e.g. `f5d6c3…`) so historical games from other sources can be analyzed too. That feeds archive building.

**Milestone 3: World tournament scale.**
- Tournament entities (`tournaments`, `rounds`, `pairings` referencing `games`), pairing systems (Swiss is the Othello standard), clocks, and abandonment rules.
- Live broadcast: spectator rooms already exist, and adding a live eval bar for **spectators only** (never players) is commentary-grade content that eothello lacks.
- Infra: bitboard engine plus a worker or job-queue analysis tier, the Socket.IO Redis adapter, and read replicas for the archive.
- **Open questions (leave these open):** Do we federate with the World Othello Federation's rating system, or run our own? What anti-cheat applies to engine-assisted online tournament play? And is the analysis engine eventually a paid tier, or a free acquisition hook?

### 7.2 What's cut from this build, and why

| Item | Why it's cut | Roadmap note |
|---|---|---|
| **Play vs. AI opponent** | The incumbent already has one, so it isn't our edge, and it's not in the floor requirement. | **First roadmap item.** It's cheap once the engine exists: roughly 45 min for the server to play `search().best` as White. |
| Accounts, auth, ratings/ELO, player profiles | About 1.5h or more, and it would take time away from the differentiator. Seat tokens are enough to prove multiplayer. | Milestone 2 (§7.1): a `players` table, with `*_player_id` foreign keys replacing the `*_token_hash` columns. |
| Lobby, matchmaking queue | An invite link covers the demo, and a queue is hard to demo when testing alone. | — |
| Clocks and time controls, abandonment and disconnect handling, presence indicators | Each one adds server timers and edge cases. Resign covers the "I'm leaving" case. | A game whose player leaves stays `active` forever. That is a known limitation and gets documented. |
| Rematch, chat, spectator list UI | Nice-to-haves with no floor or differentiation value. Spectating already works via the link. | — |
| **Live eval during play** | Dual risk: it leaks hints mid-game, which is a fairness problem, and it adds CPU per move. | It could be offered in a "casual / learning mode" toggle later. |
| Bitboard engine, worker-thread analysis, transposition table, opening book | Arrays plus α-β at depth ~6 are fast enough for one-off post-game analysis. Yielding with `setImmediate` between plies keeps the event loop responsive. | Needed before stronger depth or concurrent analyses at scale: bitboards give about 10–50× speedup, and a `worker_threads` pool gets analysis off the main thread. |
| Tuned or learned evaluation (pattern tables, Edax-style) | Tuning is a multi-day project. The heuristic plus exact endgame solving already gives believable coaching. | This is where "coach quality" improves most. |
| LLM or natural-language move explanations | Adds cost, latency, and non-determinism. The `motifs` tags are the cheap, deterministic seed of this feature. | Templated sentences built from `motifs` come next, with LLM narration after that. |
| Horizontal scaling | The in-memory game cache and in-process queue assume one server. | Moving to multiple servers needs the Socket.IO Redis adapter plus a DB-backed job queue (`SELECT … FOR UPDATE SKIP LOCKED`). |
| E2E and browser tests, frontend unit tests | Not enough time. Engine unit tests carry the correctness risk, and the integration pass covers the UI manually. | Playwright covering two-context game flows. |
| Deployment and CI | The requirement is "runs locally". | — |

---

## 8. Known risks to watch

1. **Analysis runtime.** Plain arrays in JS at depth 6, with full-window root scoring, could take several seconds per ply in the midgame. The budget is `timeBudgetMs` of about 400ms per ply, or dropping to depth 5. The backend should measure this with one real game early in task 5.
2. **Eval scale drift.** If the heuristic isn't roughly in disc units, the thresholds misclassify moves. That shows up as "everything is a blunder" or "nothing is". Check this during integration step 3 and tune the scale factor rather than the thresholds.
3. **Horizon effect.** `evalAfter[k]` and `evalBefore[k+1]` describe the same position at different depths, so the graph can wiggle slightly. That's acceptable, and plotting only `evalAfter` keeps graph swings consistent with the reported losses.
4. **Contract drift between sessions.** This is mitigated by `types.ts` being frozen in Phase 0, by the whole-state `game:state` model with no diffs, and by the deviations log.
