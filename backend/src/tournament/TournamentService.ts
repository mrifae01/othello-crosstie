import { randomInt } from 'node:crypto';
import type pg from 'pg';
import {
  bracketSize,
  matchWinner,
  MIN_TOURNAMENT_PLAYERS,
  nextMatch,
  roundCount,
  seedOrder,
  type Account,
  type Player,
  type TournamentDetail,
  type TournamentStatus,
  type TournamentSummary,
  type Winner,
} from '@othello/shared';
import { pool, withTx } from '../db/pool';
import { insertTournamentGame, isValidGameId } from '../db/gamesRepo';
import * as repo from '../db/tournamentsRepo';
import type { LockedTournament } from '../db/tournamentsRepo';
import type { GameService } from '../game/GameService';
import { AppError } from '../errors';

function shuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Single-elimination tournaments. Every write takes the tournament's row lock inside one
 * transaction, so two games finishing at once can't both try to fill the next match.
 * Game play itself stays in GameService; this only watches for tournament games finishing.
 */
export class TournamentService {
  constructor(private readonly games: GameService) {
    // Idempotent, so the repeated finished-state broadcasts (analysis progress) are harmless.
    games.onState((s) => {
      if (s.status === 'finished' && s.winner) {
        this.recordResult(s.gameId, s.winner).catch((err) =>
          console.error(`[tournament] recording game ${s.gameId} failed:`, (err as Error).message),
        );
      }
    });
  }

  async create(organizer: Account, name: string, maxPlayers: number): Promise<TournamentDetail> {
    return this.get(await repo.insertTournament(name, organizer.id, maxPlayers));
  }

  list(opts: { status?: TournamentStatus; limit: number }): Promise<TournamentSummary[]> {
    return repo.listTournaments(opts);
  }

  async get(id: string): Promise<TournamentDetail> {
    const t = isValidGameId(id) ? await repo.loadTournament(id) : null;
    if (!t) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    return t;
  }

  /** Runs `fn` with the tournament row-locked; 404s on an unknown id. */
  private async locked<T>(id: string, fn: (c: pg.PoolClient, t: LockedTournament) => Promise<T>): Promise<T> {
    if (!isValidGameId(id)) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    return withTx(async (c) => {
      const t = await repo.lockTournament(c, id);
      if (!t) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      return fn(c, t);
    });
  }

  async join(id: string, account: Account): Promise<TournamentDetail> {
    await this.locked(id, async (c, t) => {
      if (t.status !== 'registering') throw new AppError('TOURNAMENT_NOT_OPEN', 'Registration is closed');
      const entrants = await repo.listEntrants(c, id);
      if (entrants.some((e) => e.accountId === account.id)) return;
      if (entrants.length >= t.max_players) throw new AppError('TOURNAMENT_FULL', 'This tournament is full');
      await repo.insertEntry(c, id, account.id);
    });
    return this.get(id);
  }

  async leave(id: string, account: Account): Promise<TournamentDetail> {
    await this.locked(id, async (c, t) => {
      if (t.status !== 'registering') throw new AppError('TOURNAMENT_NOT_OPEN', 'The tournament has already started');
      await repo.deleteEntry(c, id, account.id);
    });
    return this.get(id);
  }

  /** Organizer only: random seeding, all matches created, byes resolved, round-1 games created. */
  async start(id: string, account: Account): Promise<TournamentDetail> {
    await this.locked(id, async (c, t) => {
      if (t.organizer_id !== account.id) throw new AppError('FORBIDDEN', 'Only the organizer can start the tournament');
      if (t.status !== 'registering') throw new AppError('TOURNAMENT_NOT_OPEN', 'The tournament has already started');
      const entrants = shuffle(await repo.listEntrants(c, id));
      if (entrants.length < MIN_TOURNAMENT_PLAYERS) {
        throw new AppError('BAD_REQUEST', `At least ${MIN_TOURNAMENT_PLAYERS} players must join before starting`);
      }

      const size = bracketSize(entrants.length);
      const rounds = roundCount(size);
      for (const [i, e] of entrants.entries()) await repo.setSeed(c, id, e.accountId, i + 1);
      await repo.markStarted(c, id, rounds);
      t.rounds = rounds;

      // Seeds past the entrant count are empty slots (byes).
      const order = seedOrder(size);
      const atSeed = (seed: number) => entrants[seed - 1]?.accountId ?? null;
      for (let round = 1; round <= rounds; round++) {
        for (let slot = 0; slot < size >> round; slot++) {
          const [blackId, whiteId] = round === 1 ? [atSeed(order[2 * slot]), atSeed(order[2 * slot + 1])] : [null, null];
          await repo.insertMatch(c, { tournamentId: id, round, slot, blackId, whiteId });
        }
      }
      for (let slot = 0; slot < size >> 1; slot++) {
        const m = (await repo.getMatch(c, id, 1, slot))!;
        if (m.black_id && m.white_id) await this.createMatchGame(c, m);
        else await this.decide(c, t, 1, slot, (m.black_id ?? m.white_id)!); // a bye (never two: see seedOrder)
      }
    });
    return this.get(id);
  }

  /** Organizer only: ends a playing match's game against a player who didn't show. */
  async forfeit(id: string, account: Account, round: number, slot: number, loser: Player): Promise<TournamentDetail> {
    const gameId = await this.locked(id, async (c, t) => {
      if (t.organizer_id !== account.id) throw new AppError('FORBIDDEN', 'Only the organizer can forfeit a match');
      if (t.status !== 'active') throw new AppError('TOURNAMENT_NOT_OPEN', 'The tournament is not in progress');
      const m = await repo.getMatch(c, id, round, slot);
      if (!m) throw new AppError('BAD_REQUEST', 'No such match');
      if (!m.game_id || m.winner_id) throw new AppError('TOURNAMENT_NOT_OPEN', 'That match is not being played');
      return m.game_id;
    });
    const state = await this.games.forfeit(gameId, loser);
    // The onState listener records this too; awaiting it here makes the response include the advance.
    await this.recordResult(gameId, state.winner!);
    return this.get(id);
  }

  /**
   * Organizer only: ends the tournament before it has a champion. The bracket freezes as it
   * stands, and games still being played are force-ended with no winner. Never deletes anything.
   */
  async cancel(id: string, account: Account): Promise<TournamentDetail> {
    const playing = await this.locked(id, async (c, t) => {
      if (t.organizer_id !== account.id) throw new AppError('FORBIDDEN', 'Only the organizer can end the tournament');
      if (t.status !== 'registering' && t.status !== 'active') {
        throw new AppError('TOURNAMENT_NOT_OPEN', 'The tournament is already over');
      }
      await repo.markCancelled(c, id);
      return repo.playingGameIds(c, id);
    });
    // After the commit: a game finishing on its own meanwhile is ignored by recordResult.
    // If we die before these run, reconcileOnBoot finishes the job.
    for (const gameId of playing) await this.games.abort(gameId);
    return this.get(id);
  }

  /** Feeds a finished game's result into its bracket. A no-op for casual games, repeats and ended tournaments. */
  async recordResult(gameId: string, winner: Winner): Promise<void> {
    const match = await repo.matchForGame(pool, gameId);
    if (!match || match.winner_id) return;
    await this.locked(match.tournament_id, async (c, t) => {
      const m = await repo.matchForGame(c, gameId);
      if (!m || m.winner_id) return; // someone else recorded it while we waited for the lock
      if (t.status !== 'active') return; // cancelled: the bracket is frozen
      const seat = matchWinner(winner);
      await this.decide(c, t, m.round, m.slot, (seat === 'B' ? m.black_id : m.white_id)!);
    });
  }

  /**
   * Call once on boot: re-feeds results that never reached the bracket, and force-ends games
   * left running in tournaments that were cancelled. Returns how many games it touched.
   */
  async reconcileOnBoot(): Promise<number> {
    const pending = await repo.listUnrecordedResults();
    for (const r of pending) await this.recordResult(r.gameId, r.winner);
    const orphaned = await repo.listOrphanedCancelledGames();
    for (const gameId of orphaned) await this.games.abort(gameId);
    return pending.length + orphaned.length;
  }

  /** Records a match winner and moves them on: into the next match, or to the title. */
  private async decide(c: pg.PoolClient, t: LockedTournament, round: number, slot: number, winnerId: string): Promise<void> {
    await repo.setMatchWinner(c, t.id, round, slot, winnerId);
    if (round === t.rounds) {
      await repo.markFinished(c, t.id, winnerId);
      return;
    }
    const next = nextMatch(round, slot);
    const m = await repo.setMatchSeat(c, t.id, next.round, next.slot, next.seat, winnerId);
    if (m.black_id && m.white_id) await this.createMatchGame(c, m);
  }

  private async createMatchGame(c: pg.PoolClient, m: repo.MatchRow): Promise<void> {
    const black = { name: await repo.usernameOf(c, m.black_id!), accountId: m.black_id! };
    const white = { name: await repo.usernameOf(c, m.white_id!), accountId: m.white_id! };
    const gameId = await insertTournamentGame(c, black, white);
    await repo.setMatchGame(c, m.tournament_id, m.round, m.slot, gameId);
  }
}
