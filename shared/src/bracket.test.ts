import { describe, expect, it } from 'vitest';
import { bracketSize, matchWinner, nextMatch, roundCount, roundName, seedOrder } from './bracket';

describe('bracketSize', () => {
  it('rounds up to a power of two, minimum 2', () => {
    expect([2, 3, 4, 5, 6, 7, 8].map(bracketSize)).toEqual([2, 4, 4, 8, 8, 8, 8]);
    expect(roundCount(8)).toBe(3);
  });
});

describe('seedOrder', () => {
  it('uses standard placement', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('never pairs two byes in round 1', () => {
    for (let n = 2; n <= 8; n++) {
      const order = seedOrder(bracketSize(n));
      for (let i = 0; i < order.length; i += 2) {
        expect(order[i] <= n || order[i + 1] <= n).toBe(true);
      }
    }
  });
});

describe('nextMatch', () => {
  it('feeds pairs of slots into one match, upper slot as Black', () => {
    expect(nextMatch(1, 0)).toEqual({ round: 2, slot: 0, seat: 'B' });
    expect(nextMatch(1, 1)).toEqual({ round: 2, slot: 0, seat: 'W' });
    expect(nextMatch(1, 2)).toEqual({ round: 2, slot: 1, seat: 'B' });
    expect(nextMatch(2, 1)).toEqual({ round: 3, slot: 0, seat: 'W' });
  });
});

describe('matchWinner', () => {
  it('gives a draw to White', () => {
    expect(matchWinner('B')).toBe('B');
    expect(matchWinner('W')).toBe('W');
    expect(matchWinner('draw')).toBe('W');
  });
});

describe('roundName', () => {
  it('names rounds from the final back', () => {
    expect([1, 2, 3].map((r) => roundName(r, 3))).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
    expect(roundName(1, 1)).toBe('Final');
  });
});
