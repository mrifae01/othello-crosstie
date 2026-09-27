import { Link } from 'react-router-dom';
import { ComingSoon } from '../components/ComingSoon';
import { RecentGames } from '../components/RecentGames';
import { PuzzleIcon, ReviewIcon, SparkleIcon, TargetIcon } from '../components/icons';
import { useRecentGames } from '../data/useRecentGames';

/** Review hub: game history (each row opens its engine review) beside the coach report placeholder. */
export function ReviewListPage() {
  const recent = useRecentGames(50);

  return (
    <div className="page">
      <header className="page-head">
        <h1>
          <ReviewIcon size={30} /> Review
        </h1>
        <p className="muted">Every finished game gets a move-by-move engine review. Open one to see where it turned.</p>
      </header>

      <div className="review-hub">
        <section className="card">
          <header className="card-head">
            <h2>{recent.source === 'all' ? 'Recent games' : 'Your games'}</h2>
            <Link to="/play" className="card-link">
              New game →
            </Link>
          </header>
          <RecentGames data={recent} />
        </section>

        <aside className="card coach-report">
          <header className="card-head">
            <h2>
              <SparkleIcon size={20} /> Coach report
            </h2>
            <ComingSoon />
          </header>
          <p className="muted small">
            Your coach reads across all your reviews, not just one game. Here's what a report will look like:
          </p>
          <div className="insight">
            <span className="insight-label">Accuracy, last 10 games</span>
            <svg viewBox="0 0 200 50" className="insight-spark" preserveAspectRatio="none" aria-hidden>
              <path d="M0,38 L22,34 L44,40 L66,28 L88,30 L110,22 L132,26 L154,18 L176,14 L200,10" />
            </svg>
            <span className="insight-value">
              74.2 → <strong className="accent-text">81.6</strong>
            </span>
          </div>
          <div className="insight">
            <span className="insight-label">Most costly habit</span>
            <span className="insight-value">
              <span className="chip motif-x_square">X-squares</span> in 3 of your last 5 games
            </span>
          </div>
          <div className="insight">
            <span className="insight-label">Strongest phase</span>
            <span className="insight-value">Endgame: 88% accuracy after move 50</span>
          </div>
          <div className="coach-report-actions">
            <button type="button" className="btn btn-secondary" disabled>
              <PuzzleIcon size={18} /> Puzzles from my mistakes
            </button>
            <button type="button" className="btn btn-secondary" disabled>
              <TargetIcon size={18} /> Practice weak positions
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
