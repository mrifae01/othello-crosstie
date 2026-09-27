import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MAX_TOURNAMENT_PLAYERS, MIN_TOURNAMENT_PLAYERS, type TournamentSummary } from '@othello/shared';
import { useAuth } from '../auth/AuthContext';
import { useGameClient } from '../data/ClientContext';
import { useToasts } from '../components/Toasts';
import { SignInDialog } from '../components/AccountMenu';
import { errorText, fmtDate } from '../format';

const PLAYER_OPTIONS = Array.from(
  { length: MAX_TOURNAMENT_PLAYERS - MIN_TOURNAMENT_PLAYERS + 1 },
  (_, i) => MIN_TOURNAMENT_PLAYERS + i,
);

export function TournamentsPage() {
  const client = useGameClient();
  const [list, setList] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client
      .listTournaments()
      .then((t) => live && setList(t))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [client]);

  const groups: { title: string; empty: string; items: TournamentSummary[] }[] = list
    ? [
        { title: 'Open for entry', empty: 'Nothing open right now. Create one!', items: list.filter((t) => t.status === 'registering') },
        { title: 'In progress', empty: 'No tournaments in progress.', items: list.filter((t) => t.status === 'active') },
        { title: 'Finished', empty: 'No finished tournaments yet.', items: list.filter((t) => t.status === 'finished') },
      ]
    : [];

  return (
    <div className="tournaments">
      <CreateTournamentPanel />
      <section className="panel tournament-lists">
        <h2>Tournaments</h2>
        {error && <p className="error-text">{error}</p>}
        {!list && !error && <p className="muted">Loading…</p>}
        {groups.map((g) => (
          <div key={g.title} className="tournament-group">
            <h3>{g.title}</h3>
            {g.items.length === 0 ? (
              <p className="muted small">{g.empty}</p>
            ) : (
              <ul className="game-list">
                {g.items.map((t) => (
                  <li key={t.tournamentId}>
                    <TournamentRow t={t} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function TournamentRow({ t }: { t: TournamentSummary }) {
  const detail =
    t.status === 'finished' && t.winner
      ? `Won by @${t.winner.username}`
      : t.status === 'registering'
        ? `${t.entrantCount}/${t.maxPlayers} players`
        : `${t.entrantCount} players`;
  return (
    <Link to={`/tournaments/${t.tournamentId}`} className="game-row">
      <span className="game-row-players">{t.name}</span>
      <span className={`status-pill tournament-${t.status}`}>{detail}</span>
      <span className="game-row-result">Organized by @{t.organizer.username}</span>
      <span className="muted small">{fmtDate(t.finishedAt ?? t.startedAt ?? t.createdAt)}</span>
    </Link>
  );
}

function CreateTournamentPanel() {
  const client = useGameClient();
  const auth = useAuth();
  const toasts = useToasts();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(MAX_TOURNAMENT_PLAYERS);
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const trimmed = name.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    setBusy(true);
    try {
      const t = await client.createTournament(trimmed, maxPlayers);
      navigate(`/tournaments/${t.tournamentId}`);
    } catch (err) {
      toasts.error(errorText(err));
      setBusy(false);
    }
  }

  return (
    <section className="panel tournament-create">
      <h1>Run a tournament</h1>
      <p className="muted">
        Single elimination for 2–{MAX_TOURNAMENT_PLAYERS} players. You organize: start it when enough players have
        joined, and forfeit anyone who doesn't show. Join your own tournament if you want to play in it too.
      </p>
      {auth.account ? (
        <form className="stack-form" onSubmit={submit}>
          <label>
            <span>Tournament name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Friday knockout" />
          </label>
          <label>
            <span>Player cap</span>
            <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
              {PLAYER_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} players
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={!trimmed || busy}>
            {busy ? 'Creating…' : 'Create tournament'}
          </button>
        </form>
      ) : auth.state.status === 'disabled' ? (
        <p className="notice">Tournaments need accounts, and accounts aren't enabled on this server.</p>
      ) : auth.state.status === 'needsUsername' ? (
        <p className="notice">Pick a username to create or join tournaments.</p>
      ) : (
        <div className="recent-prompt">
          <p className="muted">Sign in to create or join a tournament. Anyone can follow along.</p>
          <button type="button" className="btn btn-primary" onClick={() => setSigningIn(true)}>
            Sign in
          </button>
          {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
        </div>
      )}
    </section>
  );
}
