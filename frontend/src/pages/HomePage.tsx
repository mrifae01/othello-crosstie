import { useEffect, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { countDiscs } from '@othello/shared';
import { Board } from '../components/Board';
import { CoachCard } from '../components/CoachBubble';
import { ComingSoon } from '../components/ComingSoon';
import { RecentGames } from '../components/RecentGames';
import { BotIcon, CheckIcon, LearnIcon, PlayIcon, PuzzleIcon, ReviewIcon, SparkleIcon, TrophyIcon } from '../components/icons';
import { FINAL, FIRST_MOVE, HERO, START, START_LEGAL } from '../content/diagrams';
import { useRecentGames } from '../data/useRecentGames';

const finalCounts = countDiscs(FINAL.board);

/** Dashboard: what Othello is, how to play it, and how we help you get better at it. */
export function HomePage() {
  const recent = useRecentGames(5);
  const { hash } = useLocation();

  // In-app links like /#rules (from Learn) don't scroll by themselves.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [hash]);

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-board">
          <Board board={HERO.board} lastMove={HERO.lastMove} coords={false} />
        </div>
        <div className="hero-copy">
          <span className="eyebrow">
            <SparkleIcon size={16} /> Othello with a coach in your corner
          </span>
          <h1>
            Play Othello.
            <br />
            <span className="accent-text">Get better every game.</span>
          </h1>
          <p className="lead">
            Challenge a friend in seconds. When the game ends, our engine reviews every move, and your AI coach
            turns that analysis into lessons, puzzles and practice built around <em>your</em> mistakes.
          </p>
          <div className="hero-ctas">
            <Link to="/play" className="btn btn-primary btn-xl">
              <PlayIcon size={24} /> Play now
            </Link>
            <Link to="/learn" className="btn btn-secondary btn-xl">
              <LearnIcon size={24} /> Start learning
            </Link>
          </div>
          <ul className="hero-points">
            <li>
              <CheckIcon size={18} /> Free, no account needed to play
            </li>
            <li>
              <CheckIcon size={18} /> Every finished game gets an engine review
            </li>
            <li>
              <CheckIcon size={18} /> Run knockout tournaments for your club
            </li>
          </ul>
        </div>
      </section>

      <section className="section" id="rules">
        <header className="section-head">
          <h2>How to play Othello</h2>
          <p className="muted">A minute to learn, a lifetime to master. Four rules cover the whole game.</p>
        </header>
        <div className="rules-grid">
          <RuleCard step={1} title="Start in the center" board={<Board board={START.board} coords={false} />}>
            Four discs start in the middle, two of each color. <strong>Black always moves first.</strong>
          </RuleCard>
          <RuleCard
            step={2}
            title="Outflank"
            board={<Board board={START.board} legalMoves={START_LEGAL} hintPlayer="B" coords={false} disabled />}
          >
            Place a disc so that one or more of your opponent's discs sit in a straight line between it and another of
            your discs: across, up and down, or diagonally. The dots show Black's four legal openings.
          </RuleCard>
          <RuleCard
            step={3}
            title="Flip"
            board={<Board board={FIRST_MOVE.board} lastMove={FIRST_MOVE.lastMove} highlighted={FIRST_MOVE.flipped} coords={false} />}
          >
            Every outflanked disc flips to your color. Here Black plays <strong>f5</strong> and flips e5. If you have no
            legal move, you pass.
          </RuleCard>
          <RuleCard step={4} title="Most discs wins" board={<Board board={FINAL.board} coords={false} />}>
            The game ends when neither player can move, usually with the board full. Count the discs: here Black wins{' '}
            <strong>
              {finalCounts.B}–{finalCounts.W}
            </strong>
            .
          </RuleCard>
        </div>
      </section>

      <section className="section coach-promo">
        <div className="coach-promo-copy">
          <span className="eyebrow">
            <SparkleIcon size={16} /> AI coaching
          </span>
          <h2>Your games are the curriculum</h2>
          <p className="lead">
            Other sites give you an engine score and leave you to work out the rest. Crosstie explains <em>why</em> a
            move lost, spots the patterns you keep repeating, and builds your training from them.
          </p>
          <ul className="feature-list">
            <Feature icon={ReviewIcon} title="Game Review" to="/review" available>
              Accuracy for both players, the eval graph, and the best move you missed, for every move.
            </Feature>
            <Feature icon={SparkleIcon} title="AI Coach" to="/review" available>
              Plain-English explanations of each mistake, plus a summary of what to work on next.
            </Feature>
            <Feature icon={BotIcon} title="Practice vs AI" to="/play" available>
              Play a bot at your level while the coach grades every move, with hints, take-backs and Explain why.
            </Feature>
            <Feature icon={PuzzleIcon} title="Puzzles from your games">
              Positions where you went wrong, turned into puzzles you can solve until the idea sticks.
            </Feature>
          </ul>
        </div>
        <ReviewPreview />
      </section>

      <section className="section dash-row">
        <div className="card">
          <header className="card-head">
            <h2>
              <ReviewIcon size={20} /> {recent.source === 'all' ? 'Recent games' : 'Your recent games'}
            </h2>
            <Link to="/review" className="card-link">
              All reviews →
            </Link>
          </header>
          <RecentGames data={recent} max={5} />
        </div>
        <div className="card card-accent">
          <header className="card-head">
            <h2>
              <TrophyIcon size={20} /> Tournaments
            </h2>
          </header>
          <p className="muted">
            Run a single-elimination bracket for your club in a couple of clicks. Every tournament game gets the same
            full review.
          </p>
          <Link to="/tournaments" className="btn btn-secondary">
            Browse tournaments
          </Link>
        </div>
      </section>
    </div>
  );
}

function RuleCard({ step, title, board, children }: { step: number; title: string; board: ReactNode; children: ReactNode }) {
  return (
    <article className="rule-card">
      <div className="rule-board">{board}</div>
      <div className="rule-body">
        <h3>
          <span className="rule-step">{step}</span> {title}
        </h3>
        <p>{children}</p>
      </div>
    </article>
  );
}

interface FeatureProps {
  icon: ComponentType<{ size?: number }>;
  title: string;
  to?: string;
  available?: boolean;
  children: ReactNode;
}

function Feature({ icon: Icon, title, to, available = false, children }: FeatureProps) {
  const head = (
    <>
      <span className="feature-icon">
        <Icon size={22} />
      </span>
      <span className="feature-text">
        <strong>
          {title} {!available && <ComingSoon />}
        </strong>
        <span className="muted">{children}</span>
      </span>
    </>
  );
  return <li>{to ? <Link to={to} className="feature">{head}</Link> : <div className="feature">{head}</div>}</li>;
}

/** Illustration of the review + coach experience; static, not wired to a game. */
function ReviewPreview() {
  return (
    <div className="review-preview" aria-label="Example game review">
      <div className="rp-head">
        <ReviewIcon size={18} /> Game Review
      </div>
      <div className="rp-accuracy">
        <div>
          <span className="disc disc-B mini" /> <span className="rp-num">87.4</span>
          <span className="muted small">Black accuracy</span>
        </div>
        <div>
          <span className="disc disc-W mini" /> <span className="rp-num">71.9</span>
          <span className="muted small">White accuracy</span>
        </div>
      </div>
      <svg className="rp-graph" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden>
        <rect width="300" height="80" className="rp-graph-bg" />
        <path
          className="rp-graph-area"
          d="M0,40 L20,38 L40,42 L60,36 L80,44 L100,40 L120,52 L140,55 L160,50 L180,58 L200,20 L220,16 L240,22 L260,18 L280,14 L300,12 L300,40 Z"
        />
        <path
          className="rp-graph-line"
          d="M0,40 L20,38 L40,42 L60,36 L80,44 L100,40 L120,52 L140,55 L160,50 L180,58 L200,20 L220,16 L240,22 L260,18 L280,14 L300,12"
        />
        <circle cx="200" cy="20" r="5" className="rp-graph-dot" />
      </svg>
      <CoachCard
        headline={
          <>
            38. g7 is a blunder <span className="class-badge small cls-blunder">??</span>
          </>
        }
      >
        <p>
          White played next to an empty corner, and Black takes h8 next. You've done this in 3 of your last 5 games.
          Want a puzzle on it?
        </p>
      </CoachCard>
    </div>
  );
}
