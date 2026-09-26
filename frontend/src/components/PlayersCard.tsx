import type { GameSummary, Player } from '@othello/shared';

interface PlayersCardProps {
  game: GameSummary;
  turn: Player | null;
  you?: Player | null;
}

/** Both seats with disc counts; the side to move is highlighted. */
export function PlayersCard({ game, turn, you = null }: PlayersCardProps) {
  return (
    <div className="panel players">
      {(['B', 'W'] as const).map((p) => {
        const info = game.players[p];
        return (
          <div key={p} className={`player-row ${turn === p ? 'to-move' : ''}`}>
            <span className={`disc disc-${p} mini`} />
            <span className="player-name">
              {info ? info.name : <span className="muted">Waiting for player…</span>}
              {you === p && <span className="you-tag">you</span>}
            </span>
            <span className="player-count">{game.counts[p]}</span>
          </div>
        );
      })}
    </div>
  );
}
