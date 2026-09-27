import type { Player, PlayerInfo } from '@othello/shared';
import { colorName } from '../format';

interface PlayerBarProps {
  color: Player;
  /** null while the seat is empty. */
  info: PlayerInfo | null;
  count: number;
  /** Highlight as the side to move. */
  toMove?: boolean;
  isYou?: boolean;
}

/** One seat, shown above or below the board: avatar, name, tags, disc count. */
export function PlayerBar({ color, info, count, toMove = false, isYou = false }: PlayerBarProps) {
  return (
    <div className={`player-bar${toMove ? ' to-move' : ''}`}>
      <span className={`player-avatar avatar-${color}`} aria-hidden>
        <span className={`disc disc-${color}`} />
      </span>
      <span className="player-bar-name">
        {info ? (
          <>
            <strong>{info.name}</strong>
            {!info.accountId && <span className="guest-tag">guest</span>}
            {isYou && <span className="you-tag">you</span>}
          </>
        ) : (
          <span className="muted">Waiting for opponent…</span>
        )}
        <span className="player-bar-color">{colorName(color)}</span>
      </span>
      {toMove && <span className="to-move-pill">To move</span>}
      <span className={`disc-count count-${color}`} title={`${count} ${colorName(color).toLowerCase()} discs`}>
        {count}
      </span>
    </div>
  );
}
