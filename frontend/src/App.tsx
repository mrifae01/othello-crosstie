import { Route, Routes } from 'react-router-dom';
import { NotFound } from './components/NotFound';
import { SideNav } from './components/SideNav';
import { HomePage } from './pages/HomePage';
import { PlayPage } from './pages/PlayPage';
import { GamePage } from './pages/GamePage';
import { ReviewPage } from './pages/ReviewPage';
import { ReviewListPage } from './pages/ReviewListPage';
import { LearnPage } from './pages/LearnPage';
import { PracticePage } from './pages/PracticePage';
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
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:id" element={<TournamentPage />} />
          <Route path="*" element={<NotFound title="Page not found" />} />
        </Routes>
      </main>
    </div>
  );
}
