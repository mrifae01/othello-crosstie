import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Player, PlyAnalysis } from '@othello/shared';
import {
  BOT_LEVELS,
  countDiscs,
  getLegalMoves,
  isBotLevel,
  isReplyPending,
  lastHumanPly,
  opponent,
  REPLY_DELAY_MS,
  squareToAlg,
  summarize,
  type BotLevel,
} from '@othello/shared';
import { usePracticeGame, type PracticeGame } from '../data/usePracticeGame';
import { useExplainMove } from '../data/useExplainMove';
import { hintText } from '../data/practiceHint';
import { Board } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { CoachBubble, CoachSeal } from '../components/CoachBubble';
import { PlayerBar } from '../components/PlayerBar';
import { MoveList, type MoveListItem } from '../components/MoveList';
import { BotIcon, BulbIcon, RedoIcon, TargetIcon, UndoIcon } from '../components/icons';
import { CLASS_LABEL, CLASS_ORDER, colorName } from '../format';

type ColorChoice = Player | 'random';
const LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];
const EVAL_KEY = 'practice.evalBar';

const pickColor = (c: ColorChoice): Player => (c === 'random' ? (Math.random() < 0.5 ? 'B' : 'W') : c);

/** /practice?level=easy|medium|hard&color=B|W|random. Practice games are never saved. */
export function PracticePage() {
  const [params] = useSearchParams();
  const rawLevel = params.get('level');
  const rawColor = params.get('color');
  const level: BotLevel = isBotLevel(rawLevel) ? rawLevel : 'easy';
  const color: ColorChoice = rawColor === 'B' || rawColor === 'W' ? rawColor : 'random';
  return <PracticeSession key={`${level}-${color}`} level={level} color={color} />;
}

function PracticeSession({ level, color }: { level: BotLevel; color: ColorChoice }) {
  const [initialHuman] = useState(() => pickColor(color));
  const game = usePracticeGame(initialHuman, level);
  const { state, pos, scored, grade, reply } = game;
  const human = state.human;
  const bot = opponent(human);
  const gameOver = pos.turn === null;
  const pending = isReplyPending(state, pos);
  const canTakeBack = lastHumanPly(state) !== null;
  const canForward = state.redo.length > 0 && pos.turn === human;
  const [showEval, setShowEval] = useEvalToggle();
  const coach = useExplainMove(game);
  const explained = coach.current;

  const { takeBack, forward, resume } = game;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'ArrowLeft') takeBack();
      else if (e.key === 'ArrowRight') forward();
      else if (e.key === ' ' && state.paused) resume();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [takeBack, forward, resume, state.paused]);

  // What Hint / Show best talk about: the player's options on their turn, or, while the bot's
  // reply is pending, the decision they just made.
  const target =
    pos.turn === human
      ? scored?.best != null
        ? { board: pos.board, best: scored.best }
        : null
      : pending && grade?.bestSquare != null
        ? { board: grade.boardBefore, best: grade.bestSquare }
        : null;
  const canReveal = !gameOver && (pos.turn === human || pending);

  const lastMove = [...state.moves].reverse().find((m) => m.square !== null)?.square ?? null;
  const counts = countDiscs(pos.board);
  const botInfo = { name: `${BOT_LEVELS[state.level].label} bot`, accountId: 'bot' }; // non-null: no "guest" tag
  const youInfo = { name: 'You', accountId: 'you' };
  const moveItems: MoveListItem[] = state.moves.map((m, i) => ({
    ply: i + 1,
    player: m.player,
    square: m.square,
    classification: state.grades[i + 1]?.classification,
  }));
  const newGame = () => game.newGame(pickColor(color), level);

  const board = (
    <Board
      board={pos.board}
      legalMoves={pos.turn === human ? getLegalMoves(pos.board, human) : []}
      hintPlayer={human}
      lastMove={lastMove}
      bestSquare={state.revealed === 'best' && target ? target.best : null}
      onSquareClick={game.move}
      disabled={pos.turn !== human}
    />
  );

  return (
    <div className={`stage stage-practice${showEval ? ' stage-review' : ''}`}>
      <section className="stage-board">
        <PlayerBar color={bot} info={botInfo} count={counts[bot]} toMove={pos.turn === bot} />
        {showEval ? (
          <div className="board-with-eval">
            <EvalBar value={game.evalNow ?? 0} />
            {board}
          </div>
        ) : (
          board
        )}
        <PlayerBar color={human} info={youInfo} count={counts[human]} toMove={pos.turn === human} />
      </section>

      <aside className="stage-panel">
        <header className="panel-head">
          <BotIcon size={22} /> Practice
          <span className="panel-head-note">
            {BOT_LEVELS[state.level].label} · you play {colorName(human)}
          </span>
        </header>

        <div className="panel-body">
          {gameOver ? (
            <CoachBubble ply={null} summary={resultLine(counts, human)} variant="practice" />
          ) : grade ? (
            <CoachBubble
              ply={grade}
              summary=""
              variant="practice"
              moment={explained?.status === 'done' ? explained.moment : null}
              onExplain={coach.enabled ? coach.explain : undefined}
              explaining={explained?.status === 'loading'}
            />
          ) : (
            <StatusBubble headline={game.grading ? 'Coach is thinking…' : 'Coached practice'}>
              {game.grading
                ? 'Grading your move.'
                : human === 'B'
                  ? 'You move first. Every move you make is graded straight away; take back anything you like.'
                  : 'The bot opens. Every move you make is graded straight away; take back anything you like.'}
            </StatusBubble>
          )}

          {state.revealed !== 'none' && (
            <div className="practice-hint">
              <BulbIcon size={18} />
              <p>
                {!target ? (
                  'Looking…'
                ) : (
                  <>
                    {pos.turn !== human && <strong>For the move you just played: </strong>}
                    {state.revealed === 'best' ? (
                      <>
                        Best was <strong>{squareToAlg(target.best)}</strong> (ringed on the board).
                      </>
                    ) : (
                      hintText(target.board, human, target.best)
                    )}
                  </>
                )}
              </p>
            </div>
          )}

          {explained?.status === 'error' && <p className="error-text small">{explained.message}</p>}

          {!gameOver && <p className={`turn-line${pos.turn === human ? ' your-turn' : ''}`}>{statusLine(game)}</p>}
          {game.error && <p className="error-text small">{game.error}</p>}

          {gameOver && <GameOverCard game={game} counts={counts} onNewGame={newGame} color={color} />}

          {state.moves.length > 0 && (
            <div>
              <h3 className="section-label">Moves</h3>
              <MoveList moves={moveItems} currentPly={state.moves.length} />
            </div>
          )}
        </div>

        <footer className="panel-foot practice-controls">
          <div className="practice-row">
            <button
              type="button"
              className="btn practice-takeback"
              onClick={game.takeBack}
              disabled={!canTakeBack}
              title="Take back (←)"
            >
              {reply && reply.ms >= REPLY_DELAY_MS.mistake && !reply.delayDone ? (
                <ProgressRing key={reply.key} ms={reply.ms} startedAt={reply.startedAt} />
              ) : (
                <UndoIcon size={18} />
              )}{' '}
              Take back
            </button>
            {canForward && (
              <button type="button" className="btn" onClick={game.forward} title="Forward (→)" aria-label="Forward">
                <RedoIcon size={18} />
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => game.reveal('hint')}
              disabled={!canReveal || state.revealed !== 'none'}
            >
              <BulbIcon size={18} /> Hint
            </button>
            <button type="button" className="btn" onClick={() => game.reveal('best')} disabled={!canReveal || state.revealed === 'best'}>
              <TargetIcon size={18} /> Show best
            </button>
            {state.paused && (
              <button type="button" className="btn btn-primary" onClick={game.resume} title="Let the bot reply (Space)">
                Reply
              </button>
            )}
          </div>
          <div className="practice-row practice-row-secondary">
            <label className="practice-toggle">
              <input type="checkbox" checked={showEval} onChange={(e) => setShowEval(e.target.checked)} /> Eval bar
            </label>
            <button type="button" className="btn btn-ghost btn-small" onClick={newGame}>
              New game
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function statusLine(game: PracticeGame): string {
  const { state, pos, reply } = game;
  if (pos.turn === state.human) return 'Your move';
  if (state.paused) return 'Paused. Press Reply (Space) when you’re ready.';
  if (game.grading) return 'Coach is thinking…';
  if (reply && reply.delayDone) return 'Bot is thinking…';
  return 'Bot is about to reply…';
}

function resultLine(counts: { B: number; W: number }, human: Player): string {
  const bot = opponent(human);
  const score = `${counts[human]}–${counts[bot]}`;
  if (counts[human] > counts[bot]) return `You win ${score}.`;
  if (counts[human] < counts[bot]) return `The bot wins ${score}.`;
  return `Draw, ${score}.`;
}

function GameOverCard({
  game,
  counts,
  onNewGame,
  color,
}: {
  game: PracticeGame;
  counts: { B: number; W: number };
  onNewGame: () => void;
  color: ColorChoice;
}) {
  const { state } = game;
  const human = state.human;
  const plies: PlyAnalysis[] = Object.values(state.grades);
  const s = summarize(plies)[human];
  const won = counts[human] > counts[opponent(human)];
  return (
    <div className="practice-over">
      <div className={`result-banner${won ? ' win' : ''}`}>
        <strong>{resultLine(counts, human)}</strong>
        <span>
          {BOT_LEVELS[state.level].label} bot · you played {colorName(human)}
        </span>
      </div>
      <div className="summary-card">
        <div className="accuracy">
          <span className="accuracy-num">{s.accuracy.toFixed(1)}</span>
          <span className="muted small">accuracy · avg loss {s.avgLoss.toFixed(1)}</span>
        </div>
        <ul className="class-counts">
          {CLASS_ORDER.map((c) => (
            <li key={c} className={s.counts[c] === 0 ? 'zero' : ''}>
              <span className={`class-dot cls-${c}`} />
              <span>{CLASS_LABEL[c]}</span>
              <span className="num">{s.counts[c]}</span>
            </li>
          ))}
        </ul>
        <p className="muted tiny">
          Take backs {state.stats.takebacks} · hints {state.stats.hintsUsed} · best moves shown {state.stats.bestShown}.
          Accuracy counts the moves you kept.
        </p>
      </div>
      <div className="practice-row">
        <button type="button" className="btn btn-primary" onClick={onNewGame}>
          New game
        </button>
        {LEVELS.filter((l) => l !== state.level).map((l) => (
          <Link key={l} to={`/practice?level=${l}&color=${color}`} className="btn">
            Try {BOT_LEVELS[l].label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusBubble({ headline, children }: { headline: string; children: ReactNode }) {
  return (
    <div className="coach">
      <CoachSeal />
      <div className="coach-bubble">
        <div className="coach-head">
          <strong>{headline}</strong>
        </div>
        <p>{children}</p>
      </div>
    </div>
  );
}

function ProgressRing({ ms, startedAt }: { ms: number; startedAt: number }) {
  // A negative delay resumes the animation where it is if React remounts the ring mid-countdown.
  const elapsed = Math.min(ms, performance.now() - startedAt);
  return (
    <svg className="progress-ring" width={18} height={18} viewBox="0 0 36 36" aria-hidden>
      <circle className="progress-ring-track" cx="18" cy="18" r="15" />
      <circle className="progress-ring-fill" cx="18" cy="18" r="15" pathLength={100} style={{ animationDuration: `${ms}ms`, animationDelay: `-${elapsed}ms` }} />
    </svg>
  );
}

/** Eval bar on/off, off by default, remembered per browser. Storage may be unavailable. */
function useEvalToggle(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(EVAL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(EVAL_KEY, v ? '1' : '0');
    } catch {
      // private mode / blocked storage: the toggle still works for this visit
    }
  };
  return [on, set];
}
