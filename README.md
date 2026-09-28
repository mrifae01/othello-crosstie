# othello-crosstie

Othello in the browser with a built-in coach: play a friend from an invite link, get every move graded when the game ends, and practice against a bot that coaches you as you play.

**Live app:** https://othello-crosstie-frontend.vercel.app

---

## Contents

- [Prerequisites](#prerequisites)
- [Setup & Run](#setup--run)
- [Project Structure](#project-structure)
- [Steps I Took](#steps-i-took)
- [Overall Time Budget Plan](#overall-time-budget-plan)
- [Working Sessions](#working-sessions)
- [Future Roadmap](#future-roadmap)
- [Documentation](#documentation)
- [Notes](#notes)

---

## Prerequisites

- Node 20 or newer
- Docker Desktop (running), **or** any Postgres 13+ database you can point to with `DATABASE_URL`

## Setup & Run

```bash
npm install
npm start
```

`npm start` brings up Postgres with Docker, runs the migrations, and opens the app at http://localhost:5173. To skip Docker, set `DATABASE_URL` to your own Postgres.

Accounts and the AI coach are optional. To turn them on, copy `.env.example` to `.env` and add your Supabase and Anthropic keys.

To play two players, open the invite link in a second tab, or expose port 5173 with ngrok (`ngrok http 5173`). `npm test` runs the engine tests.

## Project Structure

The repo has three workspaces: `frontend`, `backend` and `shared` (the game engine and types, used by both). All of my AI documentation is in `docs/ai-usage`, with each file's prefix mapping to the session I used it in.

The app is hosted on Vercel, Render and Supabase, so you don't have to run anything locally unless you want to.

---

## Steps I Took

After the feedback I received from you (assuming Tyler is the one reading this) in our last interview, I knew I really wanted to be as efficient as possible with the time I was given and how I used Claude. So in my first session it was very important for me to create a strong foundational plan for the basics of the game and my competitive edge. My thought process was to design this project for a player who really wants to learn and get better at Othello. As I mentioned in my interview, I enjoy chess and frequently play on chess.com, and that is where I got my inspiration for this project. My competitive edge was an attempt at creating the strongest practice application for users to keep learning and growing as Othello players.

After my first session, I had an architecture and a plan in place to begin building. I created a shared markdown file, `docs/ai-usage/design-contract.md`, that was used as the source of truth for every session I ran. In my first working session I ran two Claude sessions, one for the backend and one for the frontend. It was important to make clear that the frontend could only build the UI against mock data until the backend had set up the PostgreSQL tables and the API endpoints, and only then wire in the real ones. At the end of my first session I had a complete basic game, along with the post-game analysis.

Starting my second session, I wanted to think about scalability and having this used by multiple people. Naturally I knew I needed to start by letting users create accounts, both to save their history and game data so we can help improve their game, and so they can create and join tournaments. Supabase was, to me, the easiest and most natural integration for that step. Then I had the idea of hosting this on Vercel and Render, not only for ease in your review, but also so that I could integrate genuine AI without having to share my API key and local .env. Lastly, I really wanted to focus on the frontend UI to turn this from a take-home project into something that feels like a real product. To do this I had three sessions running at once: one for the hosting integrations (Render, Supabase and Vercel), one for tournaments, and one for a frontend redesign.

By my third session I felt I had a strong working product, but I needed to really focus on my competitive edge: personalized practice and training using AI. My idea was to build off the engine and have Claude Sonnet explain why certain moves were better than others, so the user could learn from them. At the end of every game the user can open Game Review, which shows each player's accuracy and a grade for every move, good or bad. The user can then click "Get *username*'s debrief", which sends the engine's analysis to Claude Sonnet and gives the user an explanation of the key moments in their game and what to work on next.

Building more off of this, I implemented a practice mode that lets the user play against a bot at Easy, Medium or Hard. This is a pure practice arena for a player: every move is graded the moment it's played, and they can get a hint, see the best move, take a move back, and/or have any move explained to them (using the same Claude Sonnet coach) on why it was good or bad.

Obviously there is much more to build off of here, like puzzles based on each user's previous games and where they went wrong, lessons for users to study to understand Othello better, and even a profile for each user, built from how they play each game, that shows where they are strongest and where they need to improve. These ideas are laid out in [docs/roadmap.md](docs/roadmap.md).

In my final session, I went through all the code to reorganize anything that was duplicated and to remove any code that was created and never used. This last step is important to me, both for my own understanding and to make sure I produce quality and not quantity.

Below, in the overall time budget plan, you can see my original time budget, followed by the times I worked on the code along with my thoughts before and after each session.

## Overall Time Budget Plan

| Time | Focus |
|---|---|
| 30–45 mins | Solo planning with Claude |
| 3–4 hours | Creating the actual game, ensuring the foundations work |
| 1–2 hours | Working on "the competitive edge" |
| 30 mins–1 hour | Final documentation |

## Working Sessions

### Session 1 — 9/26, 9:30 AM – 11:20 AM

**Before:** Complete the architecture plan and begin implementing the foundations of the game.

**After:** Finished the architecture and planning. Basic game implementation along with the initial game analysis.

### Session 2 — 9/27, 9:50 AM – 11:40 AM

**Before:**

First hour: with the basics completed, review and ensure scalability with accounts and tournaments. Integrate Supabase for account creation and add a "tournament" tab for users to create and join tournaments.

Second hour: spend 30 mins focusing on the UI and making it more than just a basic app. Spend the remaining time on hosting this on Vercel so that in the next working session I can embed real AI functionality with my API key without having to share the .env.

**After:** Finished with working account and tournament creation, along with Vercel, Render and Supabase integration for hosting. Did a complete UI redesign to make this feel like an actual app, not just a side project.

In the next working session I'm going to spend my remaining time on my competitive edge and testing, leaving 30 mins to write up documentation.

### Session 3 — 9/28, 9:30 AM – 11:40 AM

**Before:** With roughly four hours remaining in my time budget, I believe at this point I have a solid application that meets the requirements. However, I think it is important for me to spend the majority of my time developing my competitive edge of AI integration: coaching, game review, learning/puzzles (probably won't need AI for this part), etc.

With my remaining time:
- 2 hours: developing the competitive edge
- 1–1.5 hours: testing, and going back through the code to really make sure it is quality and not quantity
- 30–45 mins: documentation and write-up

**After:** Finished developing what I could of my competitive edge: the AI debrief in Game Review and Practice mode. Obviously I couldn't get to everything I wanted, and I've noted that in the roadmap. Going to take a quick lunch break, and in the final working session I'm going to test, review the code, and finish the write-up.

### Session 4 — 9/28, 12:10 PM – 2:30 PM

**Before:** With my remaining two hours, the first hour I'm going to test everything locally and on the live Vercel app. The second and final hour I'm going to spend writing up documentation and making sure everything is ready for handoff.

**After:** Tested locally and on the live app, cleaned up the UI, removed dead code and old test scripts, reorganized duplicated code, tidied up the error codes, and finished this write-up.

---

## Future Roadmap

See [docs/roadmap.md](docs/roadmap.md).

## Documentation

- [Competitive edge](docs/competitive-edge.md)
- [Design notes](docs/design-notes.md)
- [Roadmap](docs/roadmap.md)
- [Design contract](docs/ai-usage/design-contract.md): the original plan every session built against
- [Contract deviations](docs/ai-usage/contract-deviations.md): where the build changed from the plan, and why
- [AI usage](docs/ai-usage/): prompts and transcripts from every session

## Notes

- The live API is on Render's free tier, so the first request after it's been idle can take up to a minute.
- There are no clocks, so if a player leaves mid-game, the game stays open until someone resigns.
