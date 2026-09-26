import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { GameState, Player, Square } from '@othello/shared';
import { useGameClient, useSeatToken } from '../data/ClientContext';
import { setSeatToken } from '../data/seatStorage';
import { useLiveGame } from '../data/useLiveGame';
import { Board } from '../components/Board';
import { MoveList } from '../components/MoveList';
import { NameForm } from '../components/NameForm';
import { PlayersCard } from '../components/PlayersCard';
import { AnalysisBar } from '../components/AnalysisBar';
import { useToasts } from '../components/Toasts';
import { useLeaveGuard } from '../components/LeaveGuard';
import { isGameClientError } from '../data/GameClient';
import { colorName, errorText, resultText } from '../format';

export function GamePage() {
  const { id = '' } = useParams();
  // Key by id so navigating between games starts from a clean slate.
  return <GameView key={id} gameId={id} />;
}

function GameView({ gameId }: { gameId: string }) {
  const client = useGameClient();
  const toasts = useToasts();
  const token = useSeatToken(gameId);
  const { state, you, seatKnown, notFound, error, progress, analysisReady } = useLiveGame(gameId, token);
  const [moving, setMoving] = useState(false);
  const [joining, setJoining] = useState(false);

  // Leaving a live game you're seated in (via the header) resigns it, behind a confirm.
  const seatedInLiveGame = state?.status === 'active' && you !== null && !!token;
  useLeaveGuard(
    seatedInLiveGame
      ? {
          title: 'Leave and resign?',
          body: 'Going back home will resign this game, and your opponent will be awarded the win.',
          confirmLabel: 'Resign and go home',
          cancelLabel: 'Stay in game',
          onConfirm: async () => {
            try {
              await client.resign(gameId, token!);
            } catch (e) {
              // Game already over (e.g. the opponent resigned meanwhile): nothing to resign, just leave.
              if (isGameClientError(e) && (e.code === 'GAME_NOT_ACTIVE' || e.code === 'GAME_NOT_FOUND')) return;
              toasts.error(errorText(e));
              throw e;
            }
          },
        }
      : null,
  );

  if (notFound) {
    return (
      <div className="panel center">
        <h2>Game not found</h2>
        <p className="muted">Check the invite link, or start a new game.</p>
        <Link to="/" className="btn">
          Back to home
        </Link>
      </div>
    );
  }
  if (!state) {
    return <div className="panel center muted">{error ?? 'Loading game…'}</div>;
  }

  const myTurn = state.status === 'active' && you !== null && state.turn === you;
  const lastMove = state.moves.length ? state.moves[state.moves.length - 1] : null;
  const lastPlaced = [...state.moves].reverse().find((m) => m.square !== null)?.square ?? null;

  async function play(square: Square) {
    if (!token || moving) return;
    setMoving(true);
    try {
      // No optimistic update: the board changes only when game:state arrives.
      await client.move(gameId, token, square);
    } catch (e) {
      toasts.error(errorText(e));
    } finally {
      setMoving(false);
    }
  }

  async function join(name: string) {
    setJoining(true);
    try {
      const seat = await client.joinGame(gameId, name);
      setSeatToken(gameId, seat.playerToken); // useSeatToken picks this up and re-subscribes with the seat.
    } catch (e) {
      toasts.error(errorText(e));
    } finally {
      setJoining(false);
    }
  }

  const showJoin = state.status === 'waiting' && seatKnown && you === null;

  return (
    <div className="game-layout">
      <section className="board-col">
        <Board
          board={state.board}
          legalMoves={myTurn ? state.legalMoves : []}
          hintPlayer={you}
          lastMove={lastPlaced}
          onSquareClick={play}
          disabled={state.status !== 'active' || you === null || !token || moving}
        />
      </section>

      <aside className="side-col">
        <PlayersCard game={state} turn={state.turn} you={you} />

        <div className="panel status-panel">
          {showJoin && (
            <>
              <h3>Join this game</h3>
              <p className="muted small">
                {state.players.B.name} is waiting. You'll play White.
              </p>
              <NameForm label="Your name" submitLabel="Join as White" busy={joining} prefill={false} onSubmit={join} />
            </>
          )}

          {state.status === 'waiting' && you === 'B' && <InviteBox gameId={gameId} />}

          {state.status === 'waiting' && seatKnown && you === 'W' && <p>Joining…</p>}

          {state.status === 'active' && (
            <TurnLine state={state} you={you} myTurn={myTurn} />
          )}

          {state.status !== 'finished' && lastMove?.square === null && (
            <p className="notice">
              {colorName(lastMove.player)} has no legal moves: pass. {state.turn && `${colorName(state.turn)} moves again.`}
            </p>
          )}

          {state.status === 'finished' && (
            <GameOver state={state} you={you} progress={progress} analysisReady={analysisReady} />
          )}

          {seatKnown && you === null && state.status !== 'waiting' && (
            <p className="muted small">You're watching as a spectator.</p>
          )}
          {error && <p className="error-text small">{error}</p>}
        </div>

        {state.status === 'active' && you !== null && token && <ResignControl gameId={gameId} token={token} />}

        <div className="panel">
          <h3>Moves</h3>
          <MoveList moves={state.moves} />
        </div>
      </aside>
    </div>
  );
}

function TurnLine({ state, you, myTurn }: { state: GameState; you: Player | null; myTurn: boolean }) {
  if (!state.turn) return null;
  if (myTurn) return <p className="turn-line your-turn">Your turn: {state.legalMoves.length} legal moves</p>;
  const mover = state.players[state.turn]?.name ?? colorName(state.turn);
  return (
    <p className="turn-line">
      {you ? 'Waiting for ' : ''}
      {mover} ({colorName(state.turn)}){you ? '…' : ' to move'}
    </p>
  );
}

function InviteBox({ gameId }: { gameId: string }) {
  const toasts = useToasts();
  const url = `${window.location.origin}/game/${gameId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toasts.info('Invite link copied');
    } catch {
      toasts.error('Could not copy. Select the link and copy it manually.');
    }
  }

  return (
    <div className="invite">
      <h3>Waiting for opponent…</h3>
      <p className="muted small">Send this link to your opponent. They'll join as White.</p>
      <div className="invite-row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
        <button type="button" className="btn btn-primary" onClick={copy}>
          Copy invite link
        </button>
      </div>
    </div>
  );
}

function ResignControl({ gameId, token }: { gameId: string; token: string }) {
  const client = useGameClient();
  const toasts = useToasts();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function resign() {
    setBusy(true);
    try {
      await client.resign(gameId, token);
    } catch (e) {
      toasts.error(errorText(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="resign">
      {confirming ? (
        <>
          <span>Resign this game?</span>
          <button type="button" className="btn btn-danger" onClick={resign} disabled={busy}>
            Yes, resign
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-resign" onClick={() => setConfirming(true)}>
          Resign…
        </button>
      )}
    </div>
  );
}

interface GameOverProps {
  state: GameState;
  you: Player | null;
  progress: { done: number; total: number } | null;
  analysisReady: 'done' | 'failed' | null;
}

function GameOver({ state, you, progress, analysisReady }: GameOverProps) {
  const navigate = useNavigate();
  const outcome =
    you && state.winner ? (state.winner === 'draw' ? 'Draw' : state.winner === you ? 'You won!' : 'You lost') : 'Game over';

  // Either signal is enough: the ready event live, or the persisted status after a refresh.
  const status = analysisReady ?? state.analysisStatus;
  const done = status === 'done';

  return (
    <div className="game-over">
      <div className={`result-banner ${you && state.winner === you ? 'win' : ''}`}>
        <strong>{outcome}</strong>
        <span>{resultText(state)}</span>
      </div>

      {status === 'none' && <p className="muted small">No analysis for this game: no moves were played.</p>}
      {status === 'pending' && (
        <AnalysisBar label="Analysis in progress… The review unlocks when it's ready. You can leave and come back later." />
      )}
      {status === 'running' && (
        <AnalysisBar
          label={progress ? `Analyzing move ${progress.done} of ${progress.total}…` : 'Analyzing…'}
          fraction={progress && progress.total > 0 ? progress.done / progress.total : undefined}
        />
      )}
      {status === 'failed' && <p className="error-text small">Analysis failed. The game is saved, but no review is available.</p>}

      <button
        type="button"
        className="btn btn-primary btn-wide"
        disabled={!done}
        onClick={() => navigate(`/game/${state.gameId}/analysis`)}
      >
        Review game
      </button>
    </div>
  );
}
