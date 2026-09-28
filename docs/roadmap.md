# Roadmap

## Coaching

### LLM "Explain why" in Practice

**Status:** placeholder only. A disabled **Explain why** button with a *Coming soon* badge appears in the coach bubble on graded Practice moves.

**Why an LLM here at all.** The template grade says *what* was wrong ("c4 is a mistake: gives away about 6 discs. f5 was best."). An LLM can explain *why* in plain language. It uses the same grounded approach as the Review debrief: the engine decides what's right, and Claude only explains a fact sheet. It never judges moves itself.

**Why only on demand, never on every move.** Per-move LLM calls would add seconds of delay and a cost to every move. Instant engine grades are the core experience; the LLM is an optional deeper layer.

**What carries over from the Review coach:**
- `momentFacts()` in `shared/src/coach.ts` already builds a fact sheet for one move from a `PlyAnalysis`, which is exactly what `gradeMove` produces. It's module-private today; the plan exports it behind a new `buildMoveFacts(ply)`.
- The grounding check: `mentionedSquares` and `nameableSquares` reject any explanation that names a square the facts don't.
- The prompt's "how to read the facts" and "rules" sections.
- The Anthropic client, `COACH_MODEL` and structured output.
- The `CoachMoment` shape (`title` / `explanation` / `lesson`), which `CoachBubble` already renders.

**What can't be reused:** the `/api/games/:id/coach` endpoints and the `coach_debriefs` table. Both need a saved game, and practice games aren't saved.

**Planned design:**
- `POST /api/coach/explain` with `{ moves, ply }`. The server replays the moves (rejecting illegal ones), searches, then calls `gradeMove`, `buildMoveFacts` and Claude. It checks every square Claude names against the facts, reusing the grounding check above. The server trusts nothing from the client except the moves, which also leaves nothing to inject into the prompt.
- `GET /api/coach` returns `{ enabled }`, so the button can be hidden when no API key is set.
- An in-memory cache keyed by position + move + prompt version.
- A per-IP rate limit, since this is a public endpoint behind a paid API.
- `explainMove` on `GameClient`, with a canned mock version.

**UX once built.** Clicking Explain while a bot reply is pending pauses the bot, like Hint does. The explanation replaces the template text, with the "AI coach" badge, and stays until the next move.

**Why it's deferred.** It touches files owned by the Review-debrief work (`coach.ts`, `prompt.ts`, `CoachService.ts`), and the time budget is tight. It comes after the debrief work is committed.

### Save practice games for a skill profile

Practice games are thrown away today. Saving them for signed-in players (moves plus grades, which the client already has) would give the Learn page's skill profile real data: accuracy by phase, and how often each motif (corners, X-squares, C-squares) shows up in your mistakes. It would also let the coach's training plan pick a level and focus for you.

### Practice from a mistake found in Review

Add a "Practice this position" button on a Review mistake. It would open Practice at that position (the move list up to that ply), with you to move and the bot playing the other side. You replay the moment until you find the right idea, graded with the same `gradeMove`. It needs a `from` parameter on `/practice` and a reducer action that starts from a given line.

### Puzzles from your own mistakes

Generate puzzles from the blunders and mistakes in your reviewed games: the position before the move, where the best move clearly beats the rest. Solving one reuses the Practice pieces: the engine worker scores the position, and `gradeMove` grades your answer in the same vocabulary as Review and Practice. Spaced repetition then brings back the ones you miss.
