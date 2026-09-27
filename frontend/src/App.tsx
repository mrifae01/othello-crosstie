import { Link, Route, Routes } from 'react-router-dom';
import { SideNav } from './components/SideNav';
import { HomePage } from './pages/HomePage';
import { PlayPage } from './pages/PlayPage';
import { GamePage } from './pages/GamePage';
import { ReviewPage } from './pages/ReviewPage';
import { ReviewListPage } from './pages/ReviewListPage';
import { LearnPage } from './pages/LearnPage';
import { TournamentsPage } from './pages/TournamentsPage';
import { TournamentPage } from './pages/TournamentPage';

export function App() {
  return (
    <div className="shell">
      <SideNav />
      <main className="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/game/:id/analysis" element={<ReviewPage />} />
          <Route path="/review" element={<ReviewListPage />} />
          <Route path="/learn" element={<LearnPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:id" element={<TournamentPage />} />
          <Route
            path="*"
            element={
              <div className="panel center">
                <h2>Page not found</h2>
                <Link to="/" className="btn">
                  Back to home
                </Link>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
