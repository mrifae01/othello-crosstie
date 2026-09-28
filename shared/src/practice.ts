/**
 * Practice mode (play the bot with live coaching) as a pure reducer. The board is always derived
 * from `moves`; engine results (grades, bot moves) arrive as actions tagged with the key of the
 * position they were computed for, and stale ones are dropped. Timers and workers live in the
 * frontend hook (usePracticeGame), not here.
 */
import type { Board, Move, MoveClass, Player, PlyAnalysis, Square } from './types';
import type { BotLevel } from './engine/bot';
import { applyMove, getFlips, initialBoard, nextTurn, opponent } from './engine/rules';

export type Reveal = 'none' | 'hint' | 'best';

export interface PracticeState {
  human: Player;
  level: BotLevel;
  /** Accepted line including passes. The board is derived from it, never stored. */
  moves: Move[];
  /** By ply (1-based, as in Review), human moves only. */
  grades: Record<number, PlyAnalysis>;
  /** What the player has asked to see. Resets whenever the position changes. */
  revealed: Reveal;
  /** Set by a reveal while a bot reply is pending; the bot waits until `resume`. */
  paused: boolean;
  stats: { takebacks: number; hintsUsed: number; bestShown: number };
  /**
   * Moves removed by take backs, in line order, so Forward can replay them. Cleared when the
   * player plays a move of their own (the line has changed) or starts a new game.
   */
  redo: Move[];
  /** Grades of the player's moves in `redo`, by ply, restored with them. */
  redoGrades: Record<number, PlyAnalysis>;
}

export type PracticeAction =
  | { type: 'humanMove'; square: Square }
  | { type: 'gradeArrived'; key: string; grade: PlyAnalysis }
  | { type: 'botMove'; key: string; square: Square }
  | { type: 'reveal'; level: 'hint' | 'best' }
  | { type: 'resume' }
  /** Explain why was asked for: pauses a pending bot reply, like a reveal, without revealing anything. */
  | { type: 'pause' }
  | { type: 'takeBack' }
  /** Undoes a take back: replays the player's next move and the bot's reply to it, if it had one. */
  | { type: 'forward' }
  | { type: 'newGame'; human: Player; level: BotLevel };

/**
 * How long the bot waits (after the grade is shown) before replying, by the grade of the
 * player's move: long enough to read the feedback, and to take back a bad move.
 */
export const REPLY_DELAY_MS: Record<MoveClass, number> = {
  best: 500,
  good: 500,
  forced: 500,
  inaccuracy: 1200,
  mistake: 2500,
  blunder: 2500,
};

export function newPracticeState(human: Player, level: BotLevel): PracticeState {
  return {
    human,
    level,
    moves: [],
    grades: {},
    revealed: 'none',
    paused: false,
    stats: { takebacks: 0, hintsUsed: 0, bestShown: 0 },
    redo: [],
    redoGrades: {},
  };
}

/** Identifies the position after `moves` (passes included, so it also fixes whose turn it is). */
export function positionKey(moves: Move[]): string {
  return moves.map((m) => (m.square === null ? '--' : String(m.square).padStart(2, '0'))).join('');
}

export interface PracticePosition {
  board: Board;
  /** Whose turn it is; null once the game is over. */
  turn: Player | null;
  key: string;
}

/** Replays a line. Assumes it is legal (the reducer only ever accepts legal moves). */
export function replay(moves: Move[]): PracticePosition {
  let board = initialBoard();
  let turn: Player | null = 'B';
  for (const m of moves) {
    if (m.square !== null) board = applyMove(board, m.player, m.square).board;
    turn = nextTurn(board, m.player);
  }
  return { board, turn, key: positionKey(moves) };
}

/**
 * Like `replay`, for lines from an untrusted client: throws unless `moves` is a legal game from
 * the start (or a prefix of one), with a pass where (and only where) a player has no move, as
 * the reducer writes it.
 */
export function replayChecked(moves: Move[]): PracticePosition {
  let board = initialBoard();
  let turn: Player | null = 'B';
  let passFor: Player | null = null; // a pass that must come next
  moves.forEach((m, i) => {
    const bad = (why: string) => new Error(`Move ${i + 1}: ${why}`);
    if (m === null || typeof m !== 'object' || (m.player !== 'B' && m.player !== 'W')) throw bad('malformed');
    if (passFor) {
      if (m.player !== passFor || m.square !== null) throw bad(`expected ${passFor} to pass`);
      passFor = null;
      return;
    }
    if (turn === null) throw bad('the game is already over');
    if (m.player !== turn) throw bad(`not ${m.player}'s turn`);
    if (typeof m.square !== 'number' || getFlips(board, m.player, m.square).length === 0) throw bad('illegal move');
    board = applyMove(board, m.player, m.square).board;
    const next = nextTurn(board, m.player);
    if (next === m.player) passFor = opponent(m.player);
    turn = next;
  });
  // A line may stop just before an automatic pass: the explained move is then its last entry.
  return { board, turn: passFor ?? turn, key: positionKey(moves) };
}

/** Ply of the player's most recent move in the line, or null if they haven't moved. */
export function lastHumanPly(s: PracticeState): number | null {
  for (let i = s.moves.length - 1; i >= 0; i--) {
    if (s.moves[i].player === s.human && s.moves[i].square !== null) return i + 1;
  }
  return null;
}

/**
 * True while the bot is due to reply to the player's move (the only time a reveal pauses it).
 * False at the start when the bot has the first move: there is no player move to talk about yet.
 */
export function isReplyPending(s: PracticeState, pos: PracticePosition = replay(s.moves)): boolean {
  return pos.turn === opponent(s.human) && lastHumanPly(s) !== null;
}

/** Appends `square` for `player`, plus the opponent's pass if they have no move. */
function play(moves: Move[], board: Board, player: Player, square: Square): Move[] {
  const out = [...moves, { player, square }];
  const after = applyMove(board, player, square).board;
  if (nextTurn(after, player) === player) out.push({ player: opponent(player), square: null });
  return out;
}

export function practiceReducer(s: PracticeState, a: PracticeAction): PracticeState {
  switch (a.type) {
    case 'humanMove': {
      const pos = replay(s.moves);
      if (pos.turn !== s.human || getFlips(pos.board, s.human, a.square).length === 0) return s;
      return {
        ...s,
        moves: play(s.moves, pos.board, s.human, a.square),
        revealed: 'none',
        paused: false,
        redo: [],
        redoGrades: {},
      };
    }

    case 'gradeArrived': {
      // The key is the line up to and including the graded move. Accept it only if that move is
      // still on the board (a take back may have removed it).
      const ply = a.grade.ply;
      if (ply < 1 || ply > s.moves.length || s.moves[ply - 1].player !== s.human) return s;
      if (positionKey(s.moves.slice(0, ply)) !== a.key) return s;
      return { ...s, grades: { ...s.grades, [ply]: a.grade } };
    }

    case 'botMove': {
      const pos = replay(s.moves);
      const bot = opponent(s.human);
      if (a.key !== pos.key || pos.turn !== bot || getFlips(pos.board, bot, a.square).length === 0) return s;
      return { ...s, moves: play(s.moves, pos.board, bot, a.square), revealed: 'none', paused: false };
    }

    case 'reveal': {
      const pos = replay(s.moves);
      const pending = isReplyPending(s, pos);
      if (pos.turn !== s.human && !pending) return s;
      // Never downgrade: asking for a hint after seeing the best move changes nothing.
      const revealed = s.revealed === 'best' || a.level === 'best' ? 'best' : 'hint';
      if (revealed === s.revealed && (s.paused || !pending)) return s;
      return {
        ...s,
        revealed,
        paused: s.paused || pending,
        stats: {
          ...s.stats,
          hintsUsed: s.stats.hintsUsed + (revealed === 'hint' && s.revealed === 'none' ? 1 : 0),
          bestShown: s.stats.bestShown + (revealed === 'best' && s.revealed !== 'best' ? 1 : 0),
        },
      };
    }

    case 'resume':
      return s.paused ? { ...s, paused: false } : s;

    case 'pause':
      return !s.paused && isReplyPending(s) ? { ...s, paused: true } : s;

    case 'takeBack': {
      // Pop moves until the one popped is the player's: before the bot replies that's just their
      // move; after, the bot's reply too; either way, plus any passes in between.
      const last = lastHumanPly(s);
      if (last === null) return s;
      const moves = s.moves.slice(0, last - 1);
      const grades: Record<number, PlyAnalysis> = {};
      const redoGrades = { ...s.redoGrades };
      for (const [k, g] of Object.entries(s.grades)) {
        if (Number(k) <= moves.length) grades[Number(k)] = g;
        else redoGrades[Number(k)] = g;
      }
      return {
        ...s,
        moves,
        grades,
        revealed: 'none',
        paused: false,
        stats: { ...s.stats, takebacks: s.stats.takebacks + 1 },
        redo: [...s.moves.slice(last - 1), ...s.redo],
        redoGrades,
      };
    }

    case 'forward': {
      // The mirror of takeBack: the player's move, then everything up to their next move (the
      // bot's reply and any passes). Take back always lands on the player's turn, so that's
      // where Forward starts.
      const pos = replay(s.moves);
      if (s.redo.length === 0 || pos.turn !== s.human) return s;
      let n = 1;
      while (n < s.redo.length && !(s.redo[n].player === s.human && s.redo[n].square !== null)) n++;
      const moves = [...s.moves, ...s.redo.slice(0, n)];
      const grades = { ...s.grades };
      const redoGrades = { ...s.redoGrades };
      for (let ply = s.moves.length + 1; ply <= moves.length; ply++) {
        if (redoGrades[ply]) grades[ply] = redoGrades[ply];
        delete redoGrades[ply];
      }
      return { ...s, moves, grades, redo: s.redo.slice(n), redoGrades, revealed: 'none', paused: false };
    }

    case 'newGame':
      return newPracticeState(a.human, a.level);
  }
}
