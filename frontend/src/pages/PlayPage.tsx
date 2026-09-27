import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useGameClient } from '../data/ClientContext';
import { setSeatToken } from '../data/seatStorage';
import { Board } from '../components/Board';
import { ComingSoon } from '../components/ComingSoon';
import { PlayerBar } from '../components/PlayerBar';
import { SeatForm } from '../components/SeatForm';
import { useToasts } from '../components/Toasts';
import { BotIcon, ChevronRightIcon, PlayIcon, TargetIcon, TrophyIcon, UsersIcon } from '../components/icons';
import { START } from '../content/diagrams';
import { errorText } from '../format';

/** Game lobby: the starting board on the left, ways to play on the right. */
export function PlayPage() {
  const client = useGameClient();
  const toasts = useToasts();
  const navigate = useNavigate();
  const { account } = useAuth();
  const [busy, setBusy] = useState(false);

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
    <div className="stage">
      <div className="stage-board">
        <PlayerBar color="W" info={null} count={2} />
        <Board board={START.board} />
        <PlayerBar color="B" info={{ name: account?.username ?? 'You', accountId: account?.id ?? null }} count={2} isYou />
      </div>

      <aside className="stage-panel">
        <header className="panel-head">
          <PlayIcon size={22} /> Play Othello
        </header>
        <div className="panel-body">
          <section className="play-option play-option-main">
            <div className="play-option-title">
              <span className="play-option-icon">
                <UsersIcon size={26} />
              </span>
              <span>
                <strong>Play a friend</strong>
                <span className="muted small">Create a game and send them the invite link.</span>
              </span>
            </div>
            <SeatForm submitLabel="Create game" busy={busy} onSubmit={create} />
            <p className="muted tiny">You play Black and move first. Your friend takes White from the link.</p>
          </section>

          <div className="play-option" aria-disabled>
            <div className="play-option-title">
              <span className="play-option-icon">
                <BotIcon size={26} />
              </span>
              <span>
                <strong>
                  Play the AI coach <ComingSoon />
                </strong>
                <span className="muted small">An engine opponent that adapts to your level and explains its moves.</span>
              </span>
            </div>
          </div>

          <div className="play-option" aria-disabled>
            <div className="play-option-title">
              <span className="play-option-icon">
                <TargetIcon size={26} />
              </span>
              <span>
                <strong>
                  Practice a position <ComingSoon />
                </strong>
                <span className="muted small">Replay the moments you went wrong in past games until you get them right.</span>
              </span>
            </div>
          </div>

          <Link to="/tournaments" className="play-option play-option-link">
            <div className="play-option-title">
              <span className="play-option-icon">
                <TrophyIcon size={26} />
              </span>
              <span>
                <strong>Tournaments</strong>
                <span className="muted small">Join a knockout bracket or run one for your club.</span>
              </span>
              <ChevronRightIcon size={20} className="play-option-chevron" />
            </div>
          </Link>
        </div>
      </aside>
    </div>
  );
}
