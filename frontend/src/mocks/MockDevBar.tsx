import { useEffect, useState } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';
import type { Player } from '@othello/shared';
import type { MockClient } from '../data/mockClient';
import { useSeatToken } from '../data/ClientContext';
import { setSeatToken } from '../data/seatStorage';

/**
 * Mock-mode toolbar: jump to fixtures, and switch which seat this tab holds so one
 * tab can play both sides. It swaps the stored seat token; the Game page just sees
 * a token change and re-subscribes, exactly as it does after joining.
 */
export function MockDevBar({ client }: { client: MockClient }) {
  const location = useLocation();
  const match = matchPath('/game/:id', location.pathname);
  const gameId = match?.params.id ?? null;
  const [open, setOpen] = useState(true);

  return (
    <div className={`devbar ${open ? '' : 'devbar-closed'}`}>
      <button type="button" className="devbar-toggle" onClick={() => setOpen((o) => !o)}>
        MOCK DATA {open ? '▾' : '▸'}
      </button>
      {open && (
        <a href="/?mock=0" className="devbar-exit">
          Exit mock mode (use the real backend)
        </a>
      )}
      {open && (
        <>
          <div className="devbar-row">
            {client.fixtures.map((f) => (
              <Link key={f.id} to={f.id === 'demo-analyzed' ? `/game/${f.id}/analysis` : `/game/${f.id}`}>
                {f.label}
              </Link>
            ))}
          </div>
          {gameId && <SeatSwitcher client={client} gameId={gameId} />}
        </>
      )}
    </div>
  );
}

function SeatSwitcher({ client, gameId }: { client: MockClient; gameId: string }) {
  const token = useSeatToken(gameId);
  const [seats, setSeats] = useState(() => client.devSeats(gameId));
  const [follow, setFollow] = useState(true);
  const [turn, setTurn] = useState<Player | null>(null);

  // Watch the game as a spectator to learn whose turn it is (and when White joins).
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    client
      .subscribe(gameId, undefined, {
        onState: (s) => {
          setTurn(s.turn);
          setSeats(client.devSeats(gameId));
        },
        onAnalysisProgress: () => {},
        onAnalysisReady: () => {},
      })
      .then((sub) => {
        if (cancelled) return sub.unsubscribe();
        unsub = sub.unsubscribe;
        setTurn(sub.state.turn);
        setSeats(client.devSeats(gameId));
      })
      .catch(() => setSeats(null));
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [client, gameId]);

  const current: Player | null = seats && token ? (seats.B === token ? 'B' : seats.W === token ? 'W' : null) : null;

  // Hot-seat: hand the tab to whoever is to move, but only if this tab already holds a seat.
  useEffect(() => {
    if (!follow || !seats || !turn || current === null || current === turn) return;
    const t = seats[turn];
    if (t) setSeatToken(gameId, t);
  }, [follow, seats, turn, current, gameId]);

  if (!seats) return null;
  return (
    <div className="devbar-row">
      <span>Seat:</span>
      {(['B', 'W'] as const).map((p) => (
        <button
          key={p}
          type="button"
          className={current === p ? 'active' : ''}
          disabled={!seats[p]}
          onClick={() => setSeatToken(gameId, seats[p])}
        >
          {p === 'B' ? 'Black' : 'White'}
        </button>
      ))}
      <button type="button" className={current === null ? 'active' : ''} onClick={() => setSeatToken(gameId, undefined)}>
        Spectator
      </button>
      <label>
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow turn
      </label>
    </div>
  );
}
