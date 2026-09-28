import { describe, expect, it } from 'vitest';
import type { Move, Player } from './types';
import { gradeMove } from './engine/analyze';
import { seededRng } from './engine/bot';
import { getLegalMoves } from './engine/rules';
import { search } from './engine/search';
import {
  isReplyPending,
  newPracticeState,
  positionKey,
  practiceReducer,
  replay,
  replayChecked,
  REPLY_DELAY_MS,
  type PracticeAction,
  type PracticeState,
} from './practice';

const run = (s: PracticeState, ...actions: PracticeAction[]) => actions.reduce(practiceReducer, s);

/** Plays one move for whoever is to move: humanMove for the player, a correctly keyed botMove for the bot. */
function step(s: PracticeState, pick: (legal: number[]) => number): PracticeState {
  const pos = replay(s.moves);
  if (!pos.turn) throw new Error('game over');
  const square = pick(getLegalMoves(pos.board, pos.turn));
  return pos.turn === s.human
    ? practiceReducer(s, { type: 'humanMove', square })
    : practiceReducer(s, { type: 'botMove', key: pos.key, square });
}

const first = (l: number[]) => l[0];

/** Finds a seeded random game and the index where `passer` passes, so tests can reach a real pass. */
function findPass(passer: Player): { moves: Move[]; at: number } {
  for (let seed = 1; seed < 2000; seed++) {
    const rand = seededRng(seed);
    let s = newPracticeState('B', 'easy');
    while (replay(s.moves).turn) s = step(s, (l) => l[Math.floor(rand() * l.length)]);
    const at = s.moves.findIndex((m) => m.square === null && m.player === passer);
    if (at > 0 && at < s.moves.length - 1) return { moves: s.moves, at };
  }
  throw new Error('no pass found');
}

/** Replays `moves[0..n)` into a state whose human is `human`, using the right action for each side. */
function stateFrom(moves: Move[], n: number, human: Player): PracticeState {
  let s = newPracticeState(human, 'easy');
  for (const m of moves.slice(0, n)) {
    if (m.square === null) continue; // passes are added by the reducer
    s = step(s, () => m.square!);
  }
  expect(s.moves).toEqual(moves.slice(0, s.moves.length));
  return s;
}

describe('practiceReducer', () => {
  it('lets the bot move first when the player is White', () => {
    let s = newPracticeState('W', 'easy');
    expect(replay(s.moves).turn).toBe('B');
    expect(run(s, { type: 'humanMove', square: 19 })).toBe(s); // not the player's turn
    s = step(s, first);
    expect(s.moves).toHaveLength(1);
    expect(replay(s.moves).turn).toBe('W');
  });

  it('ignores illegal and out-of-turn moves', () => {
    const s = newPracticeState('B', 'easy');
    expect(run(s, { type: 'humanMove', square: 0 })).toBe(s);
    expect(run(s, { type: 'botMove', key: positionKey([]), square: 19 })).toBe(s); // the player's turn
  });

  it('take back before the bot replies removes 1 move', () => {
    let s = step(newPracticeState('B', 'easy'), first);
    expect(s.moves).toHaveLength(1);
    s = run(s, { type: 'takeBack' });
    expect(s.moves).toHaveLength(0);
    expect(s.stats.takebacks).toBe(1);
    expect(replay(s.moves).turn).toBe('B');
  });

  it('take back after the bot replies removes 2 moves', () => {
    let s = newPracticeState('B', 'easy');
    for (let i = 0; i < 4; i++) s = step(s, first);
    s = run(s, { type: 'takeBack' });
    expect(s.moves).toHaveLength(2);
    expect(replay(s.moves).turn).toBe('B');
  });

  it('take back with nothing to take back does nothing', () => {
    const s = step(newPracticeState('W', 'easy'), first); // only the bot has moved
    expect(run(s, { type: 'takeBack' })).toBe(s);
  });

  it('take back works across a pass by the bot', () => {
    // The player moves, the bot has to pass, the player moves again. Take back removes only the last move.
    const { moves, at } = findPass('W');
    let s = stateFrom(moves, at + 2, 'B');
    expect(s.moves.at(-2)).toEqual({ player: 'W', square: null });
    s = run(s, { type: 'takeBack' });
    expect(s.moves).toEqual(moves.slice(0, at + 1));
    expect(replay(s.moves).turn).toBe('B');
    // And once more: removes the pass and the move before it, back to the player's earlier turn.
    s = run(s, { type: 'takeBack' });
    expect(s.moves).toEqual(moves.slice(0, at - 1));
    expect(replay(s.moves).turn).toBe('B');
  });

  it('take back works across a pass by the player', () => {
    // The bot moves, the player has to pass, the bot moves again: take back removes all of it.
    const { moves, at } = findPass('W');
    let s = stateFrom(moves, at + 2, 'W');
    const lastHuman = s.moves.map((m) => m.player === 'W' && m.square !== null).lastIndexOf(true);
    s = run(s, { type: 'takeBack' });
    expect(s.moves).toEqual(moves.slice(0, lastHuman));
    expect(replay(s.moves).turn).toBe('W');
  });

  it('reveal while a reply is pending sets paused, and resume clears it', () => {
    let s = step(newPracticeState('B', 'easy'), first);
    expect(isReplyPending(s)).toBe(true);
    s = run(s, { type: 'reveal', level: 'hint' });
    expect(s).toMatchObject({ revealed: 'hint', paused: true, stats: { hintsUsed: 1, bestShown: 0 } });
    s = run(s, { type: 'reveal', level: 'best' });
    expect(s).toMatchObject({ revealed: 'best', paused: true, stats: { hintsUsed: 1, bestShown: 1 } });
    s = run(s, { type: 'resume' });
    expect(s.paused).toBe(false);
    expect(s.revealed).toBe('best');
  });

  it('reveal on the player turn does not pause', () => {
    const s = run(newPracticeState('B', 'easy'), { type: 'reveal', level: 'best' });
    expect(s).toMatchObject({ revealed: 'best', paused: false, stats: { bestShown: 1 } });
    // Asking for a hint after the best move is a no-op.
    expect(run(s, { type: 'reveal', level: 'hint' })).toBe(s);
  });

  it('reveal does nothing while the bot has the first move', () => {
    const s = newPracticeState('W', 'easy');
    expect(run(s, { type: 'reveal', level: 'hint' })).toBe(s);
  });

  it('revealed resets when the position changes', () => {
    let s = run(newPracticeState('B', 'easy'), { type: 'reveal', level: 'hint' });
    s = step(s, first);
    expect(s.revealed).toBe('none');
    s = run(s, { type: 'reveal', level: 'best' });
    s = step(s, first); // the bot replies (after a resume in the app; the reducer accepts it either way)
    expect(s).toMatchObject({ revealed: 'none', paused: false });
    s = run(s, { type: 'reveal', level: 'hint' }, { type: 'takeBack' });
    expect(s.revealed).toBe('none');
  });

  it('accepts a grade for the current line and ignores stale ones', () => {
    const start = newPracticeState('B', 'easy');
    const pos = replay(start.moves);
    const sq = getLegalMoves(pos.board, 'B')[0];
    const grade = gradeMove(pos.board, 'B', sq, search(pos.board, 'B', { depth: 2, exactEmpties: 0 }), 1);
    let s = run(start, { type: 'humanMove', square: sq });
    const key = positionKey(s.moves.slice(0, 1));

    expect(run(s, { type: 'gradeArrived', key: 'nope', grade }).grades).toEqual({});
    s = run(s, { type: 'gradeArrived', key, grade });
    expect(s.grades[1]).toBe(grade);

    // After a take back the move (and its grade) are gone, and a late grade for it is dropped.
    s = run(s, { type: 'takeBack' });
    expect(s.grades).toEqual({});
    expect(run(s, { type: 'gradeArrived', key, grade }).grades).toEqual({});
  });

  it('ignores a bot move computed for another position', () => {
    let s = step(newPracticeState('B', 'easy'), first);
    const staleKey = positionKey(s.moves);
    s = run(s, { type: 'takeBack' });
    s = step(s, (l) => l[1]); // a different move
    const pos = replay(s.moves);
    const reply = getLegalMoves(pos.board, 'W')[0];
    expect(run(s, { type: 'botMove', key: staleKey, square: reply })).toBe(s);
    expect(run(s, { type: 'botMove', key: pos.key, square: reply }).moves).toHaveLength(2);
  });

  it('ends the game when neither side can move', () => {
    let s = newPracticeState('B', 'easy');
    let guard = 0;
    while (replay(s.moves).turn) {
      s = step(s, first);
      if (++guard > 100) throw new Error('game did not end');
    }
    const pos = replay(s.moves);
    expect(pos.turn).toBeNull();
    expect(getLegalMoves(pos.board, 'B')).toEqual([]);
    expect(getLegalMoves(pos.board, 'W')).toEqual([]);
    expect(isReplyPending(s, pos)).toBe(false);
    for (const sq of pos.board.map((_, i) => i)) expect(run(s, { type: 'humanMove', square: sq })).toBe(s);
    expect(run(s, { type: 'reveal', level: 'best' })).toBe(s);
    // Take back still works from a finished game.
    expect(replay(run(s, { type: 'takeBack' }).moves).turn).toBe('B');
  });

  it('newGame starts over with the new settings', () => {
    let s = step(newPracticeState('B', 'easy'), first);
    s = run(s, { type: 'newGame', human: 'W', level: 'hard' });
    expect(s).toEqual(newPracticeState('W', 'hard'));
  });

  it('waits longest after the worst moves', () => {
    expect(REPLY_DELAY_MS.best).toBeLessThan(REPLY_DELAY_MS.inaccuracy);
    expect(REPLY_DELAY_MS.inaccuracy).toBeLessThan(REPLY_DELAY_MS.mistake);
    expect(REPLY_DELAY_MS.blunder).toBe(REPLY_DELAY_MS.mistake);
  });

  it('pause stops a pending reply only, and resume clears it', () => {
    const start = newPracticeState('B', 'easy');
    expect(run(start, { type: 'pause' })).toBe(start); // the player's turn: nothing to pause
    let s = step(start, first);
    s = run(s, { type: 'pause' });
    expect(s).toMatchObject({ paused: true, revealed: 'none', stats: { hintsUsed: 0, bestShown: 0 } });
    expect(run(s, { type: 'resume' }).paused).toBe(false);
  });
});

describe('forward (undo a take back)', () => {
  /** Plays `n` full turns (player move + bot reply) with first-legal moves, grading each player move. */
  function playTurns(n: number): PracticeState {
    let s = newPracticeState('B', 'easy');
    for (let i = 0; i < n; i++) {
      const pos = replay(s.moves);
      const sq = getLegalMoves(pos.board, 'B')[0];
      const grade = gradeMove(pos.board, 'B', sq, search(pos.board, 'B', { depth: 1, exactEmpties: 0 }), s.moves.length + 1);
      s = run(s, { type: 'humanMove', square: sq });
      s = run(s, { type: 'gradeArrived', key: positionKey(s.moves.slice(0, grade.ply)), grade });
      s = step(s, first);
    }
    return s;
  }

  it('restores a taken-back turn, grades included', () => {
    const full = playTurns(3);
    const back = run(full, { type: 'takeBack' });
    expect(back.moves).toHaveLength(full.moves.length - 2);
    expect(back.grades[5]).toBeUndefined();
    const again = run(back, { type: 'forward' });
    expect(again.moves).toEqual(full.moves);
    expect(again.grades).toEqual(full.grades);
    expect(again.redo).toEqual([]);
    expect(again.redoGrades).toEqual({});
  });

  it('steps forward one turn at a time after several take backs', () => {
    const full = playTurns(3);
    let s = run(full, { type: 'takeBack' }, { type: 'takeBack' }, { type: 'takeBack' });
    expect(s.moves).toHaveLength(0);
    s = run(s, { type: 'forward' });
    expect(s.moves).toEqual(full.moves.slice(0, 2));
    s = run(s, { type: 'forward' });
    expect(s.moves).toEqual(full.moves.slice(0, 4));
    s = run(s, { type: 'forward' });
    expect(s.moves).toEqual(full.moves);
    expect(run(s, { type: 'forward' })).toBe(s); // nothing left
  });

  it('a take back before the bot replied forwards to just the player move', () => {
    let s = step(playTurns(1), first); // the player's second move, reply pending
    const withMove = s.moves;
    s = run(s, { type: 'takeBack' });
    s = run(s, { type: 'forward' });
    expect(s.moves).toEqual(withMove);
    expect(isReplyPending(s)).toBe(true);
  });

  it('works across a pass', () => {
    const { moves, at } = findPass('W');
    const full = stateFrom(moves, at + 2, 'B'); // …, B move, W pass, B move
    let s = run(full, { type: 'takeBack' }, { type: 'takeBack' });
    s = run(s, { type: 'forward' }, { type: 'forward' });
    expect(s.moves).toEqual(full.moves);
  });

  it('a new move of their own discards the forward history', () => {
    let s = run(playTurns(2), { type: 'takeBack' });
    expect(s.redo.length).toBeGreaterThan(0);
    s = step(s, (l) => l[l.length - 1]);
    expect(s).toMatchObject({ redo: [], redoGrades: {} });
    expect(run(s, { type: 'forward' })).toBe(s);
  });
});

describe('replayChecked', () => {
  it('accepts every prefix of a real game, passes included', () => {
    const { moves } = findPass('W');
    for (let n = 0; n <= moves.length; n++) {
      expect(replayChecked(moves.slice(0, n)).board).toEqual(replay(moves.slice(0, n)).board);
    }
    expect(replayChecked(moves).turn).toBeNull();
  });

  it('accepts a line that stops just before an automatic pass', () => {
    const { moves, at } = findPass('W');
    expect(replayChecked(moves.slice(0, at)).turn).toBe('W');
  });

  it('rejects illegal, out-of-turn, missing and extra passes', () => {
    const { moves, at } = findPass('W');
    const bad: Move[][] = [
      [{ player: 'B', square: 0 }], // illegal square
      [{ player: 'W', square: 19 }], // White can't open
      [{ player: 'B', square: null }], // a pass with legal moves
      [...moves.slice(0, at), moves[at + 1]], // the pass skipped
      [...moves, { player: 'B', square: 0 }], // after the game ended
      [{ player: 'X', square: 19 } as unknown as Move],
    ];
    for (const line of bad) expect(() => replayChecked(line)).toThrow();
  });
});

