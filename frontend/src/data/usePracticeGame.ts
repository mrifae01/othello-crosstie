import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Board, Player, PlyAnalysis, Square } from '@othello/shared';
import {
  gradeMove,
  isReplyPending,
  lastHumanPly,
  newPracticeState,
  opponent,
  positionKey,
  practiceReducer,
  replay,
  REPLY_DELAY_MS,
  type BotLevel,
  type PracticePosition,
  type PracticeState,
  type SearchResult,
} from '@othello/shared';
import type { EngineRequest, EngineResponse } from '../engine/engine.worker';

type Pending = { resolve: (r: EngineResponse) => void; reject: (e: Error) => void };
type RequestBody =
  | { type: 'analyze'; board: Board; player: Player }
  | { type: 'botMove'; board: Board; player: Player; level: BotLevel };

/** Promise wrapper over the engine worker. Requests are answered in order. */
class EngineClient {
  private readonly worker = new Worker(new URL('../engine/engine.worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      this.pending.get(e.data.id)?.resolve(e.data);
      this.pending.delete(e.data.id);
    };
  }

  private send(body: RequestBody): Promise<EngineResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...body } as EngineRequest);
    });
  }

  async analyze(board: Board, player: Player): Promise<SearchResult> {
    const r = await this.send({ type: 'analyze', board, player });
    if (!r.ok) throw new Error(r.error);
    if (r.type !== 'analyze') throw new Error('Unexpected engine response');
    return r.result;
  }

  async botMove(board: Board, player: Player, level: BotLevel): Promise<Square | null> {
    const r = await this.send({ type: 'botMove', board, player, level });
    if (!r.ok) throw new Error(r.error);
    if (r.type !== 'botMove') throw new Error('Unexpected engine response');
    return r.square;
  }

  /** Stops the worker. Requests still waiting are rejected, so nothing awaits them forever. */
  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Engine stopped'));
    this.pending.clear();
  }
}

/** The bot's scheduled reply to the current position. */
interface Reply {
  key: string;
  /** The delay started at `startedAt` and lasts `ms`; the page draws its progress ring from these. */
  startedAt: number;
  ms: number;
  delayDone: boolean;
  /** undefined until the bot's search returns. */
  square: Square | null | undefined;
}

export interface PracticeGame {
  state: PracticeState;
  pos: PracticePosition;
  /** The coach's search of the current position, once ready (the player's turn only). */
  scored: SearchResult | null;
  /** Grade of the player's latest move, shown until their next move. */
  grade: PlyAnalysis | null;
  /** The player has moved but the grade isn't in yet. */
  grading: boolean;
  /** The bot's scheduled reply, while its delay runs. */
  reply: Reply | null;
  /** Black-POV eval of the position on the board, when known. */
  evalNow: number | null;
  error: string | null;
  move: (sq: Square) => void;
  takeBack: () => void;
  /** Undoes a take back, one turn at a time. */
  forward: () => void;
  reveal: (level: 'hint' | 'best') => void;
  resume: () => void;
  /** Pauses a pending bot reply (Explain why), like a reveal does. */
  pause: () => void;
  /** Replaces the grade of the move ending `key` (a line up to and including it), e.g. with the server's. */
  acceptGrade: (key: string, grade: PlyAnalysis) => void;
  newGame: (human: Player, level: BotLevel) => void;
}

/**
 * Practice mode's engine wiring: a cache of scored positions (coach search), grading each
 * player move as soon as it's made, and the cancellable, pausable timer for the bot's reply.
 */
export function usePracticeGame(human: Player, level: BotLevel): PracticeGame {
  const [state, dispatch] = useReducer(practiceReducer, undefined, () => newPracticeState(human, level));
  const pos = useMemo(() => replay(state.moves), [state.moves]);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<EngineClient | null>(null);
  const engine = useCallback(() => (engineRef.current ??= new EngineClient()), []);
  // Coach searches by position key. Both finished results and in-flight requests are cached so
  // prefetching the player's turn and grading their move never search the same position twice.
  const cache = useRef(new Map<string, SearchResult>());
  const inflight = useRef(new Map<string, Promise<SearchResult>>());
  const [, bumpCache] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () => () => {
      // Forget in-flight searches with the worker: a remount (StrictMode does one) must not await them.
      inflight.current.clear();
      engineRef.current?.terminate();
      engineRef.current = null;
    },
    [],
  );
  const analyze = useCallback(
    (key: string, board: Board, player: Player): Promise<SearchResult> => {
      const hit = cache.current.get(key);
      if (hit) return Promise.resolve(hit);
      let p = inflight.current.get(key);
      if (!p) {
        p = engine()
          .analyze(board, player)
          .then((r) => {
            cache.current.set(key, r);
            bumpCache();
            return r;
          })
          .finally(() => {
          if (inflight.current.get(key) === p) inflight.current.delete(key);
        });
        inflight.current.set(key, p);
      }
      return p;
    },
    [engine],
  );

  // 6. Score the player's options as soon as it's their turn: grades and Show best are then instant.
  useEffect(() => {
    if (pos.turn !== state.human) return;
    let cancelled = false;
    analyze(pos.key, pos.board, state.human).catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [pos, state.human, analyze]);

  // 2. Grade the player's latest move (from the cache, else from the worker).
  const humanPly = lastHumanPly(state);
  const grade = humanPly !== null ? (state.grades[humanPly] ?? null) : null;
  useEffect(() => {
    if (humanPly === null || state.grades[humanPly]) return;
    const before = state.moves.slice(0, humanPly - 1);
    const { board } = replay(before);
    const square = state.moves[humanPly - 1].square!;
    const gradedKey = positionKey(state.moves.slice(0, humanPly));
    let cancelled = false;
    analyze(positionKey(before), board, state.human)
      .then((res) => {
        if (!cancelled) dispatch({ type: 'gradeArrived', key: gradedKey, grade: gradeMove(board, state.human, square, res, humanPly) });
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [humanPly, state.grades, state.moves, state.human, analyze]);

  // 3–5. The bot's reply. Starts once the grade is visible; plays when the delay has passed AND
  // its move is ready AND the player hasn't paused. Tied to the position key, so a take back,
  // a new game or unmounting cancels it.
  const botTurn = pos.turn === opponent(state.human);
  const needsGrade = isReplyPending(state, pos) && lastMoveWasHuman(state) && !grade;
  const [reply, setReply] = useState<Reply | null>(null);
  useEffect(() => {
    setReply(null);
    if (!botTurn || needsGrade) return;
    // After the player's move, wait by its grade; otherwise (the bot opens, or moves again after
    // the player passes) use the short delay.
    const ms = lastMoveWasHuman(state) && grade ? REPLY_DELAY_MS[grade.classification] : REPLY_DELAY_MS.best;
    const key = pos.key;
    let cancelled = false;
    setReply({ key, startedAt: performance.now(), ms, delayDone: false, square: undefined });
    const timer = window.setTimeout(() => {
      if (!cancelled) setReply((r) => (r && r.key === key ? { ...r, delayDone: true } : r));
    }, ms);
    engine()
      .botMove(pos.board, opponent(state.human), state.level)
      .then((square) => {
        if (!cancelled) setReply((r) => (r && r.key === key ? { ...r, square } : r));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Only the position (and whether its grade is in) restarts the timer: pausing must not.
  }, [pos.key, botTurn, needsGrade]);

  useEffect(() => {
    if (!reply || reply.key !== pos.key || !reply.delayDone || reply.square === undefined || state.paused) return;
    if (reply.square !== null) dispatch({ type: 'botMove', key: reply.key, square: reply.square });
  }, [reply, pos.key, state.paused]);

  const scored = pos.turn === state.human ? (cache.current.get(pos.key) ?? null) : null;
  // Hold the last known eval while a new position is being scored, so the bar doesn't blink.
  const lastEval = useRef<number | null>(null);
  const known = scored && scored.scores.length > 0 ? scored.scores[0].eval : grade && lastMoveWasHuman(state) ? grade.evalAfter : null;
  if (known !== null) lastEval.current = known;
  if (state.moves.length === 0) lastEval.current = known;
  const evalNow = lastEval.current;

  return {
    state,
    pos,
    scored,
    grade,
    grading: humanPly !== null && !grade,
    reply: reply && reply.key === pos.key ? reply : null,
    evalNow,
    error,
    move: useCallback((square: Square) => dispatch({ type: 'humanMove', square }), []),
    takeBack: useCallback(() => dispatch({ type: 'takeBack' }), []),
    forward: useCallback(() => dispatch({ type: 'forward' }), []),
    reveal: useCallback((l: 'hint' | 'best') => dispatch({ type: 'reveal', level: l }), []),
    resume: useCallback(() => dispatch({ type: 'resume' }), []),
    pause: useCallback(() => dispatch({ type: 'pause' }), []),
    acceptGrade: useCallback((key: string, g: PlyAnalysis) => dispatch({ type: 'gradeArrived', key, grade: g }), []),
    newGame: useCallback((h: Player, l: BotLevel) => {
      setError(null);
      dispatch({ type: 'newGame', human: h, level: l });
    }, []),
  };
}

/** True when the last non-pass move in the line is the player's (the bot is replying to it). */
function lastMoveWasHuman(s: PracticeState): boolean {
  for (let i = s.moves.length - 1; i >= 0; i--) {
    if (s.moves[i].square !== null) return s.moves[i].player === s.human;
  }
  return false;
}
