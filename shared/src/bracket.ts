// Single-elimination bracket math, shared by the server (seeding, advancement) and the UI (labels).
import type { Player, Winner } from './types';

export const MIN_TOURNAMENT_PLAYERS = 2;
export const MAX_TOURNAMENT_PLAYERS = 8;

/** Smallest power of two that fits `entrants` (at least 2). */
export function bracketSize(entrants: number): number {
  let size = 2;
  while (size < entrants) size *= 2;
  return size;
}

export function roundCount(size: number): number {
  return Math.log2(size);
}

/**
 * Seeds in bracket order: round-1 match `slot` is seedOrder[2*slot] vs seedOrder[2*slot + 1].
 * Standard placement (1v8, 4v5, 2v7, 3v6), so seeds 1 and 2 can only meet in the final and
 * byes (seeds above the entrant count) always face the top seeds, never each other.
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Where the winner of (round, slot) plays next: the upper feeder takes Black. */
export function nextMatch(round: number, slot: number): { round: number; slot: number; seat: Player } {
  return { round: round + 1, slot: slot >> 1, seat: slot % 2 === 0 ? 'B' : 'W' };
}

/** A tournament game always produces a winner: a draw goes to White. */
export function matchWinner(winner: Winner): Player {
  return winner === 'draw' ? 'W' : winner;
}

export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${round}`;
}
