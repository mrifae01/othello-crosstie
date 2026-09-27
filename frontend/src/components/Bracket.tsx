import { Link } from 'react-router-dom';
import { roundName, type Player, type TournamentDetail, type TournamentMatch, type TournamentPlayer } from '@othello/shared';

interface Props {
  tournament: TournamentDetail;
  /** The viewer's account id, or null for guests. */
  viewerId: string | null;
  isOrganizer: boolean;
  busy: boolean;
  onPlay(m: TournamentMatch): void;
  onForfeit(m: TournamentMatch, loser: Player): void;
}

/** One column per round; matches spread out vertically so each sits between its two feeders. */
export function Bracket({ tournament: t, viewerId, isOrganizer, busy, onPlay, onForfeit }: Props) {
  const seeds = new Map(t.entrants.map((e) => [e.accountId, e.seed]));
  const firstRoundSlots = 2 ** (t.rounds - 1);

  return (
    <div className="bracket" style={{ gridTemplateColumns: `repeat(${t.rounds}, minmax(200px, 1fr))` }}>
      {Array.from({ length: t.rounds }, (_, i) => i + 1).map((round) => (
        <div key={round} className="bracket-round">
          <h3>{roundName(round, t.rounds)}</h3>
          <div className="bracket-matches" style={{ gridTemplateRows: `repeat(${firstRoundSlots}, 1fr)` }}>
            {t.matches
              .filter((m) => m.round === round)
              .map((m) => (
                <div
                  key={m.slot}
                  className="bracket-cell"
                  // A round-r match spans the 2^(r-1) first-round rows it's fed from.
                  style={{ gridRow: `${m.slot * 2 ** (round - 1) + 1} / span ${2 ** (round - 1)}` }}
                >
                  <MatchCard
                    m={m}
                    seeds={seeds}
                    viewerId={viewerId}
                    isOrganizer={isOrganizer && t.status === 'active'}
                    busy={busy}
                    onPlay={onPlay}
                    onForfeit={onForfeit}
                  />
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchCard({
  m,
  seeds,
  viewerId,
  isOrganizer,
  busy,
  onPlay,
  onForfeit,
}: Omit<Props, 'tournament'> & { m: TournamentMatch; seeds: Map<string, number | null> }) {
  const bye = m.status === 'decided' && !m.gameId;
  const isPlayer = viewerId !== null && (m.black?.accountId === viewerId || m.white?.accountId === viewerId);

  const row = (p: TournamentPlayer | null, color: Player) => {
    const won = m.winner !== null && p !== null && m.winner.accountId === p.accountId;
    const lost = m.winner !== null && p !== null && !won;
    return (
      <div className={`bracket-player${won ? ' won' : ''}${lost ? ' lost' : ''}`}>
        <span className={`disc disc-${color} mini`} />
        <span className="bracket-name">
          {p ? `@${p.username}` : bye ? <span className="muted">bye</span> : <span className="muted">TBD</span>}
        </span>
        {p && seeds.get(p.accountId) != null && <span className="muted tiny-seed">#{seeds.get(p.accountId)}</span>}
      </div>
    );
  };

  return (
    <div className={`bracket-match match-${m.status}${isPlayer ? ' mine' : ''}`}>
      {row(m.black, 'B')}
      {row(m.white, 'W')}
      <div className="bracket-actions">
        {m.status === 'playing' && m.gameId && (
          <>
            {isPlayer ? (
              <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => onPlay(m)}>
                Play
              </button>
            ) : (
              <Link to={`/game/${m.gameId}`} className="btn btn-small">
                Watch
              </Link>
            )}
            {isOrganizer && (
              <details className="forfeit">
                <summary className="btn btn-small">Forfeit…</summary>
                <div className="forfeit-menu">
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => onForfeit(m, 'B')}>
                    @{m.black?.username} didn't show
                  </button>
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => onForfeit(m, 'W')}>
                    @{m.white?.username} didn't show
                  </button>
                </div>
              </details>
            )}
          </>
        )}
        {m.status === 'decided' && m.gameId && (
          <Link to={`/game/${m.gameId}/analysis`} className="btn btn-small">
            Review
          </Link>
        )}
        {m.status === 'pending' && <span className="muted small">Waiting on earlier matches</span>}
      </div>
    </div>
  );
}
