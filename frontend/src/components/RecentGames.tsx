import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GameSummary } from '@othello/shared';
import { useAuth } from '../auth/AuthContext';
import type { RecentGames as RecentGamesData } from '../data/useRecentGames';
import { fmtDate, resultText } from '../format';
import { SignInDialog } from './AccountMenu';

interface Props {
  data: RecentGamesData;
  /** Rows to show; the rest are dropped (the Review page shows everything). */
  max?: number;
}

/** Finished games linking to their reviews, with the auth prompts that replace the list for guests. */
export function RecentGames({ data, max }: Props) {
  const { state: auth } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const { source, games, error, loading } = data;

  if (auth.status === 'guest') {
    return (
      <div className="empty-state">
        <p className="muted">Sign in to save your games and come back to their reviews any time.</p>
        <button type="button" className="btn btn-primary" onClick={() => setSigningIn(true)}>
          Sign in
        </button>
        {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
      </div>
    );
  }
  if (auth.status === 'needsUsername') return <p className="muted">Pick a username to start saving your games.</p>;
  if (auth.status === 'error') return <p className="error-text">{auth.message}</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (loading) return <p className="muted">Loading…</p>;
  if (!games || games.length === 0) {
    return (
      <div className="empty-state">
        <p className="muted">
          {source === 'mine' ? 'Finish a game and it shows up here with its review.' : 'No finished games yet.'}
        </p>
        <Link to="/play" className="btn btn-primary">
          Play a game
        </Link>
      </div>
    );
  }

  return (
    <ul className="game-list">
      {games.slice(0, max).map((g) => (
        <li key={g.gameId}>
          <Link to={`/game/${g.gameId}/analysis`} className="game-row">
            <span className="game-row-players">
              <span className="disc disc-B mini" /> {g.players.B.name}
              <span className="vs">vs</span>
              <span className="disc disc-W mini" /> {g.players.W?.name ?? '—'}
            </span>
            <span className="game-row-result" title={resultText(g)}>
              {shortResult(g)}
            </span>
            <span className={`status-pill analysis-${g.analysisStatus}`}>{analysisPill(g)}</span>
            <span className="muted small">{fmtDate(g.finishedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function analysisPill(g: GameSummary): string {
  switch (g.analysisStatus) {
    case 'done':
      return 'Review ready';
    case 'pending':
      return 'Analysis pending';
    case 'running':
      return 'Analyzing…';
    case 'failed':
      return 'Analysis failed';
    default:
      return 'No analysis';
  }
}

/** Compact one-line result for list rows; the discs next to the names already show colours. */
function shortResult(g: GameSummary): string {
  if (g.endReason === 'cancelled') return 'Tournament cancelled';
  if (!g.winner) return '';
  if (g.winner === 'draw') return `Draw ${g.counts.B}–${g.counts.W}`;
  const name = g.players[g.winner]?.name ?? (g.winner === 'B' ? 'Black' : 'White');
  if (g.endReason === 'resign') return `${name} won by resignation`;
  if (g.endReason === 'forfeit') return `${name} won by forfeit`;
  const loser = g.winner === 'B' ? 'W' : 'B';
  return `${name} won ${g.counts[g.winner]}–${g.counts[loser]}`;
}
