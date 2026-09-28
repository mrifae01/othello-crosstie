# Design notes

## Architecture

```
            ┌────────────────────────── shared/ ──────────────────────────┐
            │  Pure TypeScript engine: rules, search, eval, analysis,     │
            │  grading (gradeMove), bot, coach fact sheets, types         │
            └──────────────┬──────────────────────────────┬───────────────┘
                           │                              │
   frontend/ (React, Vite, on Vercel)          backend/ (Node, Express, Socket.IO, on Render)
   - Pages: Play, Game, Review,                - GameService: live games in memory,
     Practice, Learn, Tournaments                enforces every rule, one move at a time
   - Practice runs the engine in a     REST +  - AnalysisRunner: grades every move
     Web Worker                        socket    when a game ends
   - Renders only what the server   ◄───────►  - Coach: sends engine facts to Claude
     sends for online games                    - Tournaments, accounts (Supabase JWT)
                                                        │
                                               Postgres (Supabase): games, moves +
                                               per-move analysis, accounts,
                                               tournaments, coach debriefs
```

- **`shared/`** is the only place the rules and the engine live. The engine never touches the network or the database, so the same code runs on the server, in the browser, and in the tests.
- **`backend/`** is thin glue around the engine: it validates, saves, broadcasts, and runs analysis. It never re-implements a rule.
- **`frontend/`** talks to the backend through one `GameClient` interface (REST for creating, joining and reading; Socket.IO for live play).

## Key decisions and trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| **The server enforces every rule** for online games | The client can't cheat or fall out of sync. It sends a move, and only renders what the server sends back. | Every move is a round trip, so there's a short delay before the board updates. |
| **Whole game state on every update**, with a version number | Clients just replace their state; there are no diffs to get wrong. Stale updates are dropped by version. Reconnecting is the same as loading. | Slightly more data per move, which doesn't matter for a 64-square board. |
| **Invite links and seat tokens** instead of requiring accounts | Anyone can play from a link with no sign-up. Accounts are optional and only needed for history and tournaments. | A guest's seat lives in one browser tab, so their games aren't tied to them long term. |
| **Analysis saved per move** in the `moves` table | A review is a plain read. It's also the data a skill profile, puzzles and a training plan need later, just by querying rows we already have. | More storage and writes than saving one summary per game. |
| **Analysis runs inside the API process**, one game at a time | No extra services to host or run locally. It pauses between moves so live games stay responsive, and unfinished analysis is re-queued on restart. | One server only, and each move's search can briefly block live games (up to ~0.4 s). Scaling out needs a worker pool and a job queue (see the roadmap). |
| **The engine grades, the AI only explains** | Grades are instant, free and consistent. Claude gets a fact sheet and anything that names a square not in the facts is thrown out, so it can't invent wrong advice. | The AI's explanations are only as deep as the facts we give it. |
| **Practice runs in the browser** | Practice games aren't saved and there's no opponent to cheat, so there's nothing for a server to guard. It's instant and free to run. | Practice games are lost when you leave. Saving them is on the roadmap. |
| **One Node server, a simple engine** (arrays and alpha-beta, not bitboards) | Fast enough for grading one game at a time, and far simpler to read and test. | Not ready for tournament-scale load yet. That's the first item in Milestone 3. |
| **Hosting on Vercel, Render and Supabase** | Reviewers can use the live app, and the Anthropic key stays on the server instead of in anyone's `.env`. | Render's free tier sleeps when idle, so the first request can be slow. |

## The edge: one engine, one vocabulary

Every coaching feature uses the same engine and the same words (see [competitive-edge.md](competitive-edge.md) for why this edge). A "mistake" means exactly the same thing in Game Review, in Practice, and in the puzzles to come: the same search (`ANALYSIS_SEARCH_OPTIONS`), the same loss thresholds (`CLASS_THRESHOLDS`), the same motif tags (`detectMotifs`) and the same function, `gradeMove`.

## Practice mode

Modeled on chess.com's coach. You pick a level (Easy, Medium or Hard) and a color, then play the bot. The coach grades every move instantly. You can ask for a hint, see the best move, or take a move back, at any time.

### Two searches with different jobs

| Search | Settings | Job |
|---|---|---|
| Coach | Always `ANALYSIS_SEARCH_OPTIONS`, whatever the level | Grades your moves, powers Hint and Show best, and drives the eval bar |
| Bot | The level's own settings (`BOT_LEVELS`) | Picks the bot's reply. It never affects a grade. |

Keeping them apart means an Easy bot doesn't come with an easy grader. The bot is beatable while the coach stays strict. Tuning results are in [contract-deviations.md](ai-usage/contract-deviations.md#tuned-values).

### The bot never blocks you

There is no "Continue" button. The bot replies on its own, after a delay chosen by how good your move was:

| Your move | Bot replies after | Why |
|---|---|---|
| Best / Good / Forced | ~0.5 s | Nothing to dwell on: keep the game flowing |
| Inaccuracy | ~1.2 s | Time to read the grade |
| Mistake / Blunder | ~2.5 s, with a countdown ring on Take back | Time to read the grade and take the move back |

- The delay starts only once the grade is visible, so the bot never moves before you've seen feedback.
- The grade stays in the coach bubble after the bot replies, until your next move.
- **Take back** (button or ←) always returns you to your previous turn. Before the bot replies, it cancels the reply and removes your move; after, it removes both moves.
- **Hint / Show best** while a reply is pending **pauses** the bot and shows a **Reply** button (or Space). This is the only pause, and only you can trigger it.

### How it's built

- **`shared/src/practice.ts`** is a pure reducer. The board is derived from the move list and never stored. Passes are added automatically with `nextTurn`. Engine results (grades, bot moves) arrive as actions tagged with the key of the position they were computed for, and any whose key no longer matches are dropped. That makes a take back or a new game safe with no extra bookkeeping.
- **`frontend/src/engine/engine.worker.ts`** runs both searches off the main thread, so the board never freezes during a 400 ms search.
- **`frontend/src/data/usePracticeGame.ts`** connects the reducer to the worker. It keeps a cache of scored positions and scores your options the moment your turn begins, so grades and Show best are instant. It also runs the reply timer, which is tied to the position key: take back, new game or leaving the page cancels it.
- **Hints are plain rules, not an LLM.** "A corner is available" if the best move is a corner. Otherwise the hint names the quarter of the board plus one idea from the best move's motifs, or a mobility line such as "it leaves your opponent the fewest replies".
- **Nothing is saved.** No login and no database. The only server call is Explain why.

### Where the LLM fits (and where it doesn't)

Grades come from the engine only, and there is no LLM call per move. Per-move LLM calls would add seconds of delay and a cost to every move, and instant grades are the core experience. The optional deeper layer is the on-demand **Explain why** button. It calls `POST /api/coach/explain`, where the server replays the moves, grades the move itself, and has Claude explain the engine's facts, with the same grounding check as the Review debrief. The button is hidden when no API key is set.
