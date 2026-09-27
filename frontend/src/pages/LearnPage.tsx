import { useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Square } from '@othello/shared';
import { squareToAlg } from '@othello/shared';
import { Board } from '../components/Board';
import { ComingSoon } from '../components/ComingSoon';
import { BookIcon, BotIcon, CheckIcon, LearnIcon, LockIcon, PuzzleIcon, SparkleIcon, TargetIcon } from '../components/icons';
import { CORNER_PUZZLE, CORNER_PUZZLE_ANSWER, CORNER_PUZZLE_LEGAL } from '../content/diagrams';

/** Illustrative only: the coach plan is sample data until the AI coach ships. */
const SAMPLE_SKILLS: { name: string; score: number }[] = [
  { name: 'Corners', score: 78 },
  { name: 'Edges', score: 61 },
  { name: 'Mobility', score: 44 },
  { name: 'Parity', score: 52 },
  { name: 'Endgame', score: 70 },
];

const LESSONS: { title: string; blurb: string; to?: string }[] = [
  { title: 'The rules', blurb: 'Outflanking, flipping, passing and scoring.', to: '/#rules' },
  { title: 'Corners and X-squares', blurb: 'Why corners are permanent, and the squares that give them away.' },
  { title: 'Edges and C-squares', blurb: 'When to take an edge, and when it traps you.' },
  { title: 'Mobility', blurb: 'Win by leaving your opponent only bad moves.' },
  { title: 'Parity', blurb: 'Who moves last in each region decides the endgame.' },
  { title: 'Openings', blurb: 'The main lines after the first four moves.' },
];

export function LearnPage() {
  return (
    <div className="page learn">
      <header className="page-head">
        <h1>
          <LearnIcon size={30} /> Learn
        </h1>
        <p className="muted">Lessons, puzzles and practice, with your AI coach choosing what comes next.</p>
      </header>

      <section className="card coach-plan">
        <div className="coach-plan-copy">
          <span className="eyebrow">
            <SparkleIcon size={16} /> Your coach <ComingSoon />
          </span>
          <h2>A training plan built from your games</h2>
          <p className="muted">
            After a few reviewed games, your coach scores each part of your play and picks the lessons, puzzles and
            practice positions that will gain you the most.
          </p>
          <button type="button" className="btn btn-primary btn-lg" disabled>
            <SparkleIcon size={20} /> Build my plan
          </button>
        </div>
        <div className="skill-bars" aria-label="Sample skill profile">
          <span className="muted tiny">Sample profile</span>
          {SAMPLE_SKILLS.map((s) => (
            <div key={s.name} className="skill">
              <span>{s.name}</span>
              <span className="skill-track">
                <span className={`skill-fill${s.score < 50 ? ' weak' : ''}`} style={{ width: `${s.score}%` }} />
              </span>
              <span className="num">{s.score}</span>
            </div>
          ))}
          <p className="small skill-note">
            <TargetIcon size={16} /> Focus next: <strong>Mobility</strong>
          </p>
        </div>
      </section>

      <div className="learn-grid">
        <LearnCard icon={PuzzleIcon} title="Puzzles" badge={<span className="live-badge">Try one</span>}>
          <CornerPuzzle />
        </LearnCard>

        <LearnCard icon={BookIcon} title="Lessons">
          <ul className="lesson-list">
            {LESSONS.map((l) => (
              <li key={l.title}>
                {l.to ? (
                  <Link to={l.to} className="lesson">
                    <CheckIcon size={18} />
                    <span>
                      <strong>{l.title}</strong>
                      <span className="muted small">{l.blurb}</span>
                    </span>
                  </Link>
                ) : (
                  <div className="lesson locked">
                    <LockIcon size={18} />
                    <span>
                      <strong>{l.title}</strong>
                      <span className="muted small">{l.blurb}</span>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </LearnCard>

        <LearnCard icon={BotIcon} title="Practice vs AI" badge={<ComingSoon />}>
          <p className="muted">
            Play full games against the engine, or drill a single position from one of your reviews until you convert it.
          </p>
          <div className="level-grid">
            {['Beginner', 'Casual', 'Club', 'Expert'].map((l) => (
              <button key={l} type="button" className="btn" disabled>
                {l}
              </button>
            ))}
          </div>
        </LearnCard>
      </div>
    </div>
  );
}

function LearnCard({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: ComponentType<{ size?: number }>;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card learn-card">
      <header className="card-head">
        <h2>
          <Icon size={20} /> {title}
        </h2>
        {badge}
      </header>
      {children}
    </section>
  );
}

/**
 * One hand-picked puzzle so the page isn't all placeholders. The answer is fixed
 * content; generated puzzles from your own games will come from the backend.
 */
function CornerPuzzle() {
  const [tried, setTried] = useState<Square | null>(null);
  const solved = tried === CORNER_PUZZLE_ANSWER;

  return (
    <div className="puzzle">
      <Board
        board={CORNER_PUZZLE.board}
        lastMove={CORNER_PUZZLE.lastMove}
        legalMoves={solved ? [] : CORNER_PUZZLE_LEGAL}
        hintPlayer="B"
        bestSquare={solved ? CORNER_PUZZLE_ANSWER : null}
        onSquareClick={(sq) => CORNER_PUZZLE_LEGAL.includes(sq) && setTried(sq)}
        disabled={solved}
        coords={false}
      />
      <p className={`puzzle-status${solved ? ' solved' : tried !== null ? ' wrong' : ''}`}>
        {solved
          ? `Correct! ${squareToAlg(CORNER_PUZZLE_ANSWER)} takes the corner White just gave away with g7.`
          : tried !== null
            ? `${squareToAlg(tried)} isn't it. White just played next to an empty corner…`
            : 'Black to move. White just played g7. Find the best reply.'}
      </p>
    </div>
  );
}
