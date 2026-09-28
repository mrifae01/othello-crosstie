import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MIN_TOURNAMENT_PLAYERS, type Player, type TournamentDetail, type TournamentMatch } from '@othello/shared';
import { useAuth } from '../auth/AuthContext';
import { useGameClient } from '../data/ClientContext';
import { getSeatToken, setSeatToken } from '../data/seatStorage';
import { useToasts } from '../components/Toasts';
import { SignInDialog } from '../components/AccountMenu';
import { Bracket } from '../components/Bracket';
import { NotFound } from '../components/NotFound';
import { errorText, fmtDate } from '../format';

const STATUS_LABEL: Record<TournamentDetail['status'], (t: TournamentDetail) => string> = {
  registering: (t) => `Open · ${t.entrantCount}/${t.maxPlayers}`,
  active: () => 'In progress',
  finished: () => 'Finished',
  cancelled: () => 'Cancelled',
};

/** No tournament socket room yet: poll while games can still change the bracket. */
const POLL_MS = 5000;

export function TournamentPage() {
  const { id = '' } = useParams();
  const client = useGameClient();
  const auth = useAuth();
  const toasts = useToasts();
  const navigate = useNavigate();
  const [t, setT] = useState<TournamentDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const refresh = useCallback(
    () =>
      client.getTournament(id).then(
        (next) => {
          setT(next);
          setLoadError(null);
        },
        (e) => setLoadError(errorText(e)),
      ),
    [client, id],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const over = t?.status === 'finished' || t?.status === 'cancelled';
  useEffect(() => {
    if (over) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, over]);

  /** Runs a write that returns the fresh tournament. */
  async function act(fn: () => Promise<TournamentDetail>) {
    setBusy(true);
    try {
      setT(await fn());
    } catch (e) {
      toasts.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function play(m: TournamentMatch) {
    const gameId = m.gameId!;
    // Already seated from this browser: go straight in (claiming again would rotate the token).
    if (getSeatToken(gameId)) return navigate(`/game/${gameId}`);
    setBusy(true);
    try {
      const seat = await client.claimSeat(gameId);
      setSeatToken(gameId, seat.playerToken);
      navigate(`/game/${gameId}`);
    } catch (e) {
      toasts.error(errorText(e));
      setBusy(false);
    }
  }

  function forfeit(m: TournamentMatch, loser: Player) {
    const who = (loser === 'B' ? m.black : m.white)?.username;
    if (!window.confirm(`Forfeit the game against @${who}? Their opponent advances.`)) return;
    void act(() => client.forfeitMatch(id, m.round, m.slot, loser));
  }

  function endTournament(current: TournamentDetail) {
    const playing = current.matches.filter((m) => m.status === 'playing').length;
    const question =
      current.status === 'registering'
        ? 'Cancel this tournament? Registration closes and no games will be played.'
        : `End the tournament now? No champion will be declared${
            playing > 0 ? `, and ${playing} game${playing === 1 ? '' : 's'} in progress will be stopped` : ''
          }.`;
    if (window.confirm(question)) void act(() => client.cancelTournament(id));
  }

  if (loadError && !t) return <NotFound title={loadError} to="/tournaments" linkLabel="All tournaments" />;
  if (!t) return <p className="muted center page">Loading…</p>;

  const me = auth.account;
  const isOrganizer = me?.id === t.organizer.accountId;
  const entered = !!me && t.entrants.some((e) => e.accountId === me.id);
  const full = t.entrantCount >= t.maxPlayers;

  return (
    <div className="page tournament">
      <section className="panel tournament-head">
        <div>
          <h1>{t.name}</h1>
          <p className="muted small">
            Organized by @{t.organizer.username}
            {isOrganizer && ' (you)'} · Single elimination · Created {fmtDate(t.createdAt)}
          </p>
        </div>
        <div className="tournament-head-side">
          <span className={`status-pill tournament-${t.status}`}>
            {STATUS_LABEL[t.status](t)}
          </span>
          {isOrganizer && (t.status === 'registering' || t.status === 'active') && (
            <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => endTournament(t)}>
              {t.status === 'registering' ? 'Cancel tournament' : 'End tournament'}
            </button>
          )}
        </div>
      </section>

      {t.status === 'cancelled' && (
        <div className="result-banner cancelled">
          <strong>Cancelled by the organizer</strong>
          <span className="small">
            {t.startedAt ? 'The bracket is frozen as it stood. ' : ''}Ended {fmtDate(t.finishedAt)}
          </span>
        </div>
      )}

      {t.status === 'finished' && t.winner && (
        <div className="result-banner champion">
          <strong>🏆 @{t.winner.username} wins {t.name}</strong>
          <span className="small">Finished {fmtDate(t.finishedAt)}</span>
        </div>
      )}

      {t.status === 'cancelled' && !t.startedAt ? null : t.status === 'registering' ? (
        <section className="panel">
          <h2>
            Players ({t.entrantCount}/{t.maxPlayers})
          </h2>
          {t.entrants.length === 0 ? (
            <p className="muted">No one has joined yet.</p>
          ) : (
            <ol className="entrant-list">
              {t.entrants.map((e) => (
                <li key={e.accountId}>
                  @{e.username}
                  {e.accountId === me?.id && <span className="you-tag">You</span>}
                </li>
              ))}
            </ol>
          )}
          <p className="muted small">Seeds are drawn at random when the organizer starts the tournament.</p>

          <div className="tournament-actions">
            {me ? (
              entered ? (
                <button type="button" className="btn" disabled={busy} onClick={() => act(() => client.leaveTournament(id))}>
                  Leave tournament
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || full}
                  onClick={() => act(() => client.joinTournament(id))}
                >
                  {full ? 'Tournament full' : 'Join tournament'}
                </button>
              )
            ) : auth.state.status === 'needsUsername' ? (
              <p className="notice">Pick a username to join.</p>
            ) : auth.state.status !== 'disabled' ? (
              <>
                <button type="button" className="btn btn-primary" onClick={() => setSigningIn(true)}>
                  Sign in to join
                </button>
                {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
              </>
            ) : null}
            {isOrganizer && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || t.entrantCount < MIN_TOURNAMENT_PLAYERS}
                title={t.entrantCount < MIN_TOURNAMENT_PLAYERS ? `Needs at least ${MIN_TOURNAMENT_PLAYERS} players` : undefined}
                onClick={() => {
                  if (window.confirm(`Start with ${t.entrantCount} players? Registration closes.`)) {
                    void act(() => client.startTournament(id));
                  }
                }}
              >
                Start tournament
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="panel">
          <Bracket tournament={t} viewerId={me?.id ?? null} isOrganizer={isOrganizer} busy={busy} onPlay={play} onForfeit={forfeit} />
          <p className="muted small">The upper player in each match plays Black. A drawn game goes to White.</p>
        </section>
      )}
    </div>
  );
}
