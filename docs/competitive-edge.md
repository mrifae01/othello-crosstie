# Competitive Edge

**eothello is a place to play Othello. Crosstie is a place to get better at Othello.**

## Why this edge

eothello already has multiplayer, an AI opponent, ratings, tournaments and a player base, and there's no way to out-network that in 8 hours. So instead of competing on playing, I compete on improving.

My inspiration came from chess.com. What keeps me coming back there is the game review: seeing where the game turned, what I should have played, and how accurate I was. eothello has nothing like that. You play, you see the result, and that's it. Strong Othello engines exist, but they're separate desktop tools you have to set up yourself. My edge is **coaching built into the place you play, with zero setup**.

## Who would choose Crosstie

- **Players** get every game turned into a lesson, plus a practice mode with a coach grading every move.
- **Clubs and coaches** can review a student's game together from one link.
- **Tournament organizers** get annotated game records and eval graphs that make games easy to commentate.

## What I built to support it

- **Game Review:** every move is analyzed when the game ends, with an eval graph, a grade for each move, the best move, and accuracy for both players.
- **AI debrief:** Claude Sonnet explains the key moments of the game and the one thing to work on next.
- **Practice mode:** play a bot at Easy, Medium or Hard while a coach grades every move, with hints, show best, take backs and "Explain why".

Review and Practice use the same engine and grading, so a "mistake" means the same thing everywhere.

## How I used AI in the product

The engine decides what's right and wrong, and Claude only explains it. Grades never wait on AI, so they're instant, and the AI explanations are on demand.

## What I cut

Ratings, a lobby, clocks and live eval during games. eothello already wins on the first three, and live eval would give players hints mid-game.

See [roadmap.md](roadmap.md) for what's next.
