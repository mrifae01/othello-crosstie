# Roadmap

Everything here follows the same bet as the build: Crosstie is a place to get better at Othello (see [competitive-edge.md](competitive-edge.md)).

## Milestone 2: historical recordkeeping and coaching across games

Every game is already analyzed and stored move by move, but each review only looks at one game. Milestone 2 uses that history.

### Training plan and lessons

The Learn page shows a training plan and lessons, but neither is built yet. The plan uses sample data, and only "The rules" lesson works. I chose to spend my time on Practice mode instead, because it gives a player something real to do today.

The training plan is what ties the product together. Review tells a player what went wrong in one game. The plan looks across all their games, finds the pattern, and sends them to the lesson, puzzle or practice position that will help most. eothello has game history, but nothing that turns it into a next step.

Most of the data is already stored. Every analyzed move has its grade, disc loss and motifs (corner, X-square, C-square), and accounts are linked to their games. A skill profile is just a query over those rows, grouped by theme instead of by game. The plan is then a simple rule: find the weakest theme and suggest the matching lesson, puzzles and a practice game. The engine and SQL choose what to recommend, not an LLM.

Each lesson would be short, written by hand, and end with a few positions the player solves, graded the same way as Practice. The lesson topics already match the engine's motif tags, so when a move is flagged as an X-square mistake, the coach can link straight to "Corners and X-squares". I would write the lessons myself rather than generate them, because wrong strategy presented as a lesson would damage trust in the whole product.

### Puzzles from your own mistakes

Turn the mistakes from your reviewed games into puzzles, since each analyzed move already stores the best move. Puzzles would come before the training plan, because they're the most useful thing it can recommend.

### Smaller pieces

- **Practice this position:** a button on a Review mistake that opens Practice at that position.
- **Save practice games** for signed-in players, to give the skill profile more data.
- **Import and export games** in standard notation, so games played elsewhere can be analyzed too.

## Milestone 3: world tournament scale

### Backend scalability

For this to host games at a world tournament scale, it would be very important to make sure the game cache is as efficient as possible, and to cut down the time the end-of-game analysis takes, since that is our competitive edge. Right now the API has to run as a single server because live games are held in memory, so scaling out would need something like a Redis adapter and a job queue for analysis. We would also need load testing, with a tool like Locust (which I'm most familiar with), to see what load we can really handle.

### Tournaments

Real Othello tournaments are Swiss, not single elimination, so we'd need a pairing system, plus clocks and automatic forfeits for players who disconnect.

### Live broadcast

A live eval bar for spectators only (never the players) would make tournament games worth watching and commentating.

## Open questions

- **What should a skill score be compared against?** "You misplay corners more than players at your level" needs ratings and enough players.
- **How much history does the plan need to be honest?** My guess is around five games, but that should be tested.
- **Our own ratings, or the World Othello Federation's?**
- **Anti-cheat:** what stops engine-assisted play in online tournaments?
- **Pricing:** are the analysis and training plan a paid tier, or a free hook to bring players in?
