import { Link, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { GamePage } from './pages/GamePage';
import { ReviewPage } from './pages/ReviewPage';

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden>
            <span className="disc disc-B" />
            <span className="disc disc-W" />
          </span>
          Othello Crosstie
        </Link>
        <span className="tagline">Play a friend, then see where the game turned.</span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/game/:id/analysis" element={<ReviewPage />} />
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
