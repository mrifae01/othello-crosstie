import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AnalysisResult, Player, PlayerAnalysisSummary, PlyAnalysis } from '@othello/shared';
import { squareToAlg } from '@othello/shared';
import { useGameClient } from '../data/ClientContext';
import { isGameClientError } from '../data/GameClient';
import { AnalysisBar } from '../components/AnalysisBar';
import { Board } from '../components/Board';
import { EvalGraph } from '../components/EvalGraph';
import { MoveList } from '../components/MoveList';
import { CLASS_LABEL, CLASS_ORDER, MOTIF_LABEL, colorName, errorText, fmtEval, resultText } from '../format';

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

  if (notFound) {
    return (
      <div className="panel center">
        <h2>Game not found</h2>
        <Link to="/" className="btn">
          Back to home
        </Link>
      </div>
    );
  }
  if (!result) return <div className="panel center muted">{error ?? 'Loading analysis…'}</div>;

  if (result.status !== 'done' || !result.summary) {
    return (
      <div className="panel center review-pending">
        <h2>Game review</h2>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, c - 1));
      else if (e.key === 'ArrowRight') setCursor((c) => Math.min(n, c + 1));
      else if (e.key === 'Home') setCursor(0);
      else if (e.key === 'End') setCursor(n);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n]);

  const ply: PlyAnalysis | null = cursor < n ? plies[cursor] : null;
  const board = ply ? ply.boardBefore : plies[n - 1].boardAfter;
  const prevPlaced = [...plies.slice(0, cursor)].reverse().find((p) => p.square !== null)?.square ?? null;

  return (
    <div className="review">
      <header className="review-head panel">
        <div>
          <h2>Game review</h2>
          <p className="muted">
            {game.players.B.name} (Black) vs {game.players.W?.name ?? '?'} (White) · {resultText(game)}
          </p>
        </div>
        <Link to={`/game/${game.gameId}`} className="btn">
          View game
        </Link>
      </header>

      <div className="review-layout">
        <section className="board-col">
          <Board
            board={board}
            lastMove={prevPlaced}
            bestSquare={ply?.bestSquare ?? null}
            ghost={ply && ply.square !== null ? { square: ply.square, player: ply.player, tone: ply.classification } : null}
          />
          <div className="stepper">
            <button type="button" className="btn" onClick={() => go(0)} disabled={cursor === 0} title="Start (Home)">
              ⏮
            </button>
            <button type="button" className="btn" onClick={() => go(cursor - 1)} disabled={cursor === 0} title="Previous (←)">
              ◀
            </button>
            <span className="stepper-pos">
              {cursor === 0 ? 'Start' : `After ply ${cursor}`} <span className="muted">/ {n}</span>
            </span>
            <button type="button" className="btn" onClick={() => go(cursor + 1)} disabled={cursor === n} title="Next (→)">
              ▶
            </button>
            <button type="button" className="btn" onClick={() => go(n)} disabled={cursor === n} title="End (End)">
              ⏭
            </button>
          </div>
          <p className="muted small center">Use ← / → to step. The ring marks the engine's best move.</p>
        </section>

        <aside className="side-col">
          <div className="panel">
            <EvalGraph plies={plies} cursor={cursor} onSelect={go} />
          </div>
          <div className="panel">{ply ? <PlyCard ply={ply} result={result} /> : <FinalCard result={result} />}</div>
          <div className="summary-cards">
            <SummaryCard result={result} player="B" s={summary.B} />
            <SummaryCard result={result} player="W" s={summary.W} />
          </div>
          <div className="panel">
            <h3>Moves</h3>
            <MoveList moves={plies} currentPly={ply ? ply.ply : null} onSelect={(p) => go(p - 1)} />
          </div>
        </aside>
      </div>
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
    <div className="panel summary-card">
      <div className="summary-head">
        <span className={`disc disc-${player} mini`} />
        <span className="player-name">{name}</span>
      </div>
      <div className="accuracy">
        <span className="accuracy-num">{s.accuracy.toFixed(1)}</span>
        <span className="muted small">accuracy · avg loss {s.avgLoss.toFixed(1)}</span>
      </div>
      <ul className="class-counts">
        {CLASS_ORDER.map((c) => (
          <li key={c} className={s.counts[c] === 0 ? 'zero' : ''}>
            <span className={`class-dot cls-${c}`} />
            <span>{CLASS_LABEL[c]}</span>
            <span className="num">{s.counts[c]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
