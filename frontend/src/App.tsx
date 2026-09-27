import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useLeave } from './components/LeaveGuard';
import { AccountMenu } from './components/AccountMenu';
import { HomePage } from './pages/HomePage';
import { GamePage } from './pages/GamePage';
import { ReviewPage } from './pages/ReviewPage';
import { TournamentsPage } from './pages/TournamentsPage';
import { TournamentPage } from './pages/TournamentPage';

export function App() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const leave = useLeave();
  // Every way home goes through the leave guard, so leaving a live game asks first.
  const goHome = () => leave(() => navigate('/'));

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-side">
          {pathname !== '/' && (
            <button type="button" className="btn" onClick={goHome}>
              ← Back home
            </button>
          )}
        </div>
        <div className="topbar-center">
          <Link
            to="/"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              goHome();
            }}
          >
            <span className="brand-mark" aria-hidden>
              <span className="disc disc-B" />
              <span className="disc disc-W" />
            </span>
            Othello Crosstie
          </Link>
          <span className="tagline">Play a friend, then see where the game turned.</span>
        </div>
        <div className="topbar-side topbar-right">
          {pathname !== '/tournaments' && (
            <button type="button" className="btn" onClick={() => leave(() => navigate('/tournaments'))}>
              Tournaments
            </button>
          )}
          <AccountMenu />
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/game/:id/analysis" element={<ReviewPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:id" element={<TournamentPage />} />
          <Route
            path="*"
            element={
              <div className="panel center">
                <h2>Page not found</h2>
                <Link to="/">Back to home</Link>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
