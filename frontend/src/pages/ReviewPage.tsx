import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AnalysisResult, Player, PlayerAnalysisSummary, PlyAnalysis } from '@othello/shared';
import { countDiscs, lastPlacedSquare, squareToAlg } from '@othello/shared';
import { useAuth } from '../auth/AuthContext';
import { useGameClient } from '../data/ClientContext';
import { useCoachDebrief } from '../data/useCoachDebrief';
import { isGameClientError } from '../data/GameClient';
import { AccuracySummary } from '../components/AccuracySummary';
import { AnalysisBar } from '../components/AnalysisBar';
import { Board } from '../components/Board';
import { EvalGraph } from '../components/EvalGraph';
import { MoveList } from '../components/MoveList';
import { PlayerBar } from '../components/PlayerBar';
import { EvalBar } from '../components/EvalBar';
import { CoachBubble } from '../components/CoachBubble';
import { CoachDebriefCard } from '../components/CoachDebriefCard';
import { NotFound } from '../components/NotFound';
import { ChevronLeftIcon, ChevronRightIcon, FirstIcon, LastIcon, ReviewIcon } from '../components/icons';
import { CLASS_LABEL, MOTIF_LABEL, colorName, errorText, fmtEval, resultText } from '../format';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

export function ReviewPage() {
  const { id = '' } = useParams();
  return <ReviewLoader key={id} gameId={id} />;
}

/** Fetches the analysis; if it isn't done yet, spectates the game until `analysis:ready`, then refetches. */
function ReviewLoader({ gameId }: { gameId: string }) {
  const client = useGameClient();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await client.getAnalysis(gameId);
      setResult(r);
      if (r.progress) setProgress(r.progress);
      return r;
    } catch (e) {
      if (isGameClientError(e) && e.code === 'GAME_NOT_FOUND') setNotFound(true);
      else setError(errorText(e));
      return null;
    }
  }, [client, gameId]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const r = await load();
      if (cancelled || !r || r.status === 'done' || r.status === 'failed') return;
      try {
        const sub = await client.subscribe(gameId, undefined, {
          onState: (s) => {
            // Covers a missed ready event: any settled status triggers a refetch.
            if (s.analysisStatus === 'done' || s.analysisStatus === 'failed') void load();
            else setResult((prev) => (prev ? { ...prev, status: s.analysisStatus, game: s } : prev));
          },
          onAnalysisProgress: (p) => p.gameId === gameId && setProgress({ done: p.done, total: p.total }),
          onAnalysisReady: (p) => p.gameId === gameId && void load(),
        });
        if (cancelled) sub.unsubscribe();
        else unsubscribe = sub.unsubscribe;
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client, gameId, load]);

  if (notFound) return <NotFound title="Game not found" />;
  if (!result) return <div className="panel center muted">{error ?? 'Loading analysis…'}</div>;

  if (result.status !== 'done' || !result.summary) {
    return (
      <div className="panel center review-pending">
        <h2>
          <ReviewIcon size={22} /> Game Review
        </h2>
        <p>
          {result.game.players.B.name} vs {result.game.players.W?.name ?? '…'}
          {result.game.status === 'finished' && <> · {resultText(result.game)}</>}
        </p>
        {result.status === 'none' && (
          <p className="muted">
            {result.game.status === 'finished'
              ? 'This game has no analysis because no moves were played.'
              : 'Analysis starts automatically when the game ends.'}
          </p>
        )}
        {result.status === 'pending' && (
          <AnalysisBar label="Analysis in progress… This page updates by itself when the review is ready." />
        )}
        {result.status === 'running' && (
          <AnalysisBar
            label={progress ? `Analyzing move ${progress.done} of ${progress.total}…` : 'Analyzing…'}
            fraction={progress && progress.total > 0 ? progress.done / progress.total : undefined}
          />
        )}
        {result.status === 'failed' && <p className="error-text">Analysis failed for this game.</p>}
        {error && <p className="error-text small">{error}</p>}
        <Link to={`/game/${gameId}`} className="btn">
          {result.game.status === 'finished' ? 'View game' : 'Back to game'}
        </Link>
      </div>
    );
  }

  return <ReviewBody result={result} summary={result.summary} />;
}

interface ReviewBodyProps {
  result: AnalysisResult;
  summary: { B: PlayerAnalysisSummary; W: PlayerAnalysisSummary };
}

function ReviewBody({ result, summary }: ReviewBodyProps) {
  const { plies, game } = result;
  const n = plies.length;
  /** 0..n. cursor < n shows the position before ply cursor+1; cursor === n is the final position. */
  const [cursor, setCursor] = useState(0);
  const go = useCallback((c: number) => setCursor(Math.max(0, Math.min(n, c))), [n]);

  useKeyboardShortcuts({
    ArrowLeft: () => go(cursor - 1),
    ArrowRight: () => go(cursor + 1),
    Home: () => go(0),
    End: () => go(n),
  });

  const ply: PlyAnalysis | null = cursor < n ? plies[cursor] : null;
  const board = ply ? ply.boardBefore : plies[n - 1].boardAfter;
  const prevPlaced = lastPlacedSquare(plies.slice(0, cursor));

  const counts = countDiscs(board);
  const evalNow = ply ? ply.evalBefore : plies[n - 1].evalAfter;

  // Coach the signed-in player's own seat by default; otherwise start with Black.
  const { account } = useAuth();
  const [coached, setCoached] = useState<Player>(() => (account && game.players.W?.accountId === account.id ? 'W' : 'B'));
  const coach = useCoachDebrief(game.gameId, coached);
  const moment = (ply && coach.debrief?.moments.find((m) => m.ply === ply.ply)) ?? null;

  return (
    <div className="stage stage-review">
      <section className="stage-board">
        <PlayerBar color="W" info={game.players.W} count={counts.W} toMove={ply?.player === 'W'} />
        <div className="board-with-eval">
          <EvalBar value={evalNow} />
          <Board
            board={board}
            lastMove={prevPlaced}
            bestSquare={ply?.bestSquare ?? null}
            ghost={ply && ply.square !== null ? { square: ply.square, player: ply.player, tone: ply.classification } : null}
          />
        </div>
        <PlayerBar color="B" info={game.players.B} count={counts.B} toMove={ply?.player === 'B'} />
      </section>

      <aside className="stage-panel">
        <header className="panel-head">
          <ReviewIcon size={22} /> Game Review
          <Link to={`/game/${game.gameId}`} className="btn btn-ghost btn-small panel-head-action">
            View game
          </Link>
        </header>

        <div className="panel-body">
          <p className="muted small review-result">{resultText(game)}</p>
          <CoachBubble
            ply={ply}
            moment={moment}
            aiEnabled={coach.enabled === true}
            summary={`${resultText(game)}. Step back through the moves to see where it turned.`}
          />

          {(coach.enabled || coach.hasAny) && (
            <CoachDebriefCard
              result={result}
              player={coached}
              onPlayerChange={setCoached}
              coach={coach}
              onSelectPly={(p) => go(p - 1)}
              currentPly={ply ? ply.ply : null}
            />
          )}

          <div className="summary-cards">
            <SummaryCard result={result} player="B" s={summary.B} />
            <SummaryCard result={result} player="W" s={summary.W} />
          </div>

          <EvalGraph plies={plies} cursor={cursor} onSelect={go} />

          <div className="panel-card">{ply ? <PlyCard ply={ply} result={result} /> : <FinalCard result={result} />}</div>

          <div>
            <h3 className="section-label">Moves</h3>
            <MoveList moves={plies} currentPly={ply ? ply.ply : null} onSelect={(p) => go(p - 1)} />
          </div>
        </div>

        <footer className="panel-foot stepper">
          <button type="button" className="btn" onClick={() => go(0)} disabled={cursor === 0} title="Start (Home)" aria-label="Start">
            <FirstIcon />
          </button>
          <button type="button" className="btn" onClick={() => go(cursor - 1)} disabled={cursor === 0} title="Previous (←)" aria-label="Previous">
            <ChevronLeftIcon />
          </button>
          <span className="stepper-pos">
            {cursor === 0 ? 'Start' : `Ply ${cursor}`} <span className="muted">/ {n}</span>
          </span>
          <button type="button" className="btn" onClick={() => go(cursor + 1)} disabled={cursor === n} title="Next (→)" aria-label="Next">
            <ChevronRightIcon />
          </button>
          <button type="button" className="btn" onClick={() => go(n)} disabled={cursor === n} title="End (End)" aria-label="End">
            <LastIcon />
          </button>
        </footer>
      </aside>
    </div>
  );
}

function PlyCard({ ply, result }: { ply: PlyAnalysis; result: AnalysisResult }) {
  const name = result.game.players[ply.player]?.name ?? colorName(ply.player);
  const played = ply.square === null ? null : squareToAlg(ply.square);
  const isBest = ply.square !== null && ply.square === ply.bestSquare;

  return (
    <div className="ply-card">
      <div className="ply-card-head">
        <span className={`disc disc-${ply.player} mini`} />
        <strong>
          {ply.ply}. {name} {played ? `played ${played}` : 'passed'}
        </strong>
        <span className={`class-badge cls-${ply.classification}`}>{CLASS_LABEL[ply.classification]}</span>
      </div>

      {ply.square === null ? (
        <p className="muted">{colorName(ply.player)} had no legal moves, so the turn passed automatically.</p>
      ) : (
        <dl className="ply-stats">
          <div>
            <dt>Best move</dt>
            <dd>{ply.bestSquare === null ? '—' : squareToAlg(ply.bestSquare)}{isBest && ' ✓'}</dd>
          </div>
          <div>
            <dt>Loss</dt>
            <dd>{ply.loss > 0 ? `${ply.loss.toFixed(1)} discs` : '0'}</dd>
          </div>
          <div>
            <dt>Eval</dt>
            <dd>
              {fmtEval(ply.evalBefore)} → {fmtEval(ply.evalAfter)}
            </dd>
          </div>
        </dl>
      )}

      {ply.motifs.length > 0 && (
        <div className="chips">
          {ply.motifs.map((m) => (
            <span key={m} className={`chip motif-${m}`}>
              {MOTIF_LABEL[m]}
            </span>
          ))}
        </div>
      )}

      {ply.candidates.length > 0 && (
        <table className="candidates">
          <thead>
            <tr>
              <th>Engine line</th>
              <th className="num">Eval</th>
            </tr>
          </thead>
          <tbody>
            {ply.candidates.map((c, i) => (
              <tr key={c.square} className={c.square === ply.square ? 'played' : ''}>
                <td>
                  {i + 1}. {squareToAlg(c.square)}
                  {c.square === ply.square && <span className="muted small"> (played)</span>}
                </td>
                <td className="num">{fmtEval(c.eval)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted tiny">
        Evals in discs from Black's view · depth {ply.depth}
        {ply.exact ? ' · exact' : ''}
      </p>
    </div>
  );
}

function FinalCard({ result }: { result: AnalysisResult }) {
  return (
    <div className="ply-card">
      <div className="ply-card-head">
        <strong>Final position</strong>
      </div>
      <p>{resultText(result.game)}</p>
      <p className="muted small">
        {result.game.counts.B} Black · {result.game.counts.W} White
      </p>
    </div>
  );
}

function SummaryCard({ result, player, s }: { result: AnalysisResult; player: Player; s: PlayerAnalysisSummary }) {
  const name = result.game.players[player]?.name ?? colorName(player);
  return (
    <div className="summary-card">
      <div className="summary-head">
        <span className={`disc disc-${player} mini`} />
        <span className="player-name">{name}</span>
      </div>
      <AccuracySummary s={s} />
    </div>
  );
}
