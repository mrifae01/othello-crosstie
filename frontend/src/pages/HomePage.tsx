import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GameSummary } from '@othello/shared';
import { useGameClient } from '../data/ClientContext';
import { setSeatToken } from '../data/seatStorage';
import { useToasts } from '../components/Toasts';
import { NameForm } from '../components/NameForm';
import { errorText, fmtDate, resultText } from '../format';

export function HomePage() {
  const client = useGameClient();
  const toasts = useToasts();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<GameSummary[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client
      .listFinishedGames(20)
      .then((games) => live && setRecent(games))
      .catch((e) => live && setRecentError(errorText(e)));
    return () => {
      live = false;
    };
  }, [client]);

  async function create(name: string) {
    setBusy(true);
    try {
      const seat = await client.createGame(name);
      setSeatToken(seat.gameId, seat.playerToken);
      navigate(`/game/${seat.gameId}`);
    } catch (e) {
      toasts.error(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <section className="panel hero">
        <h1>Play Othello with a friend</h1>
        <p className="muted">
          Start a game and send the invite link. When it ends, the engine reviews every move: where the game
          turned, what you should have played, and how accurate each player was.
        </p>
        <NameForm label="Your name" submitLabel="Create game" busy={busy} onSubmit={create} />
        <p className="muted small">You play Black and move first. Your opponent takes White from the link.</p>
      </section>

      <section className="panel recent">
        <h2>Recent games</h2>
        {recentError && <p className="error-text">{recentError}</p>}
        {!recent && !recentError && <p className="muted">Loading…</p>}
        {recent && recent.length === 0 && <p className="muted">No finished games yet.</p>}
        {recent && recent.length > 0 && (
          <ul className="game-list">
            {recent.map((g) => (
              <li key={g.gameId}>
                <Link to={`/game/${g.gameId}/analysis`} className="game-row">
                  <span className="game-row-players">
                    <span className="disc disc-B mini" /> {g.players.B.name}
                    <span className="vs">vs</span>
                    <span className="disc disc-W mini" /> {g.players.W?.name ?? '—'}
                  </span>
                  <span className="game-row-result" title={resultText(g)}>{shortResult(g)}</span>
                  <span className={`status-pill analysis-${g.analysisStatus}`}>{analysisPill(g)}</span>
                  <span className="muted small">{fmtDate(g.finishedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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
  if (!g.winner) return '';
  if (g.winner === 'draw') return `Draw ${g.counts.B}–${g.counts.W}`;
  const name = g.players[g.winner]?.name ?? (g.winner === 'B' ? 'Black' : 'White');
  if (g.endReason === 'resign') return `${name} won by resignation`;
  const loser = g.winner === 'B' ? 'W' : 'B';
  return `${name} won ${g.counts[g.winner]}–${g.counts[loser]}`;
}
