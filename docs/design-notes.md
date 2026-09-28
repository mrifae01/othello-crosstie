# Design notes

## The edge: one engine, one vocabulary

eothello.com lets you play and tells you the result. Crosstie's edge is **coaching**, and it rests on one rule: every coaching surface uses the same engine and the same words.

- **Game Review** diagnoses a finished game: every move is graded, and the AI debrief explains the turning points.
- **Practice** drills you live: you play a bot and every move is graded the moment you play it.
- **Puzzles** (next) will repeat your own mistakes back to you.

A "mistake" means exactly the same thing in all three. It is the same search (`ANALYSIS_SEARCH_OPTIONS`), the same loss thresholds (`CLASS_THRESHOLDS`), the same motif tags (`detectMotifs`) and the same function, `gradeMove`. A player who learns "that was a C-square mistake" in Practice will see the same tag in Review.

## Practice mode

Modeled on chess.com's coach. You pick a level (Easy, Medium or Hard) and a color, then play the bot. The coach grades every move instantly. You can ask for a hint, see the best move, or take a move back, at any time.

### Two searches with different jobs

| Search | Settings | Job |
|---|---|---|
| Coach | Always `ANALYSIS_SEARCH_OPTIONS`, whatever the level | Grades your moves, powers Hint and Show best, and drives the eval bar |
| Bot | The level's own settings (`BOT_LEVELS`) | Picks the bot's reply. It never affects a grade. |

Keeping them apart means an Easy bot doesn't come with an easy grader. The bot is beatable while the coach stays strict. Tuning results are in [contract-deviations.md](contract-deviations.md#tuned-values).

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
- **Nothing is saved.** No backend, no login and no database, so Practice also works in mock mode and offline.

### Where the LLM fits (and where it doesn't)

Grades come from the engine only, and there is no LLM call per move. Per-move LLM calls would add seconds of delay and a cost to every move, and instant grades are the core experience. The optional deeper layer is the on-demand **Explain why** button. It calls `POST /api/coach/explain`, where the server replays the moves, grades the move itself, and has Claude explain the engine's facts, with the same grounding check as the Review debrief. The button is hidden when no API key is set.
