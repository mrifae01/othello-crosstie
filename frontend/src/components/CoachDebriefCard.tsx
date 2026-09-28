import type { AnalysisResult, Player } from '@othello/shared';
import { squareToAlg } from '@othello/shared';
import type { CoachDebriefState } from '../data/useCoachDebrief';
import { colorName } from '../format';
import { AnalysisBar } from './AnalysisBar';
import { CheckIcon, SparkleIcon, TargetIcon } from './icons';

interface Props {
  result: AnalysisResult;
  player: Player;
  onPlayerChange(p: Player): void;
  coach: CoachDebriefState;
  /** Jump the review to a ply (1-based). */
  onSelectPly(ply: number): void;
  currentPly: number | null;
}

/** The AI coach's written debrief for one player, with its key moments as jump links. */
export function CoachDebriefCard({ result, player, onPlayerChange, coach, onSelectPly, currentPly }: Props) {
  const { debrief, generating, error, enabled } = coach;
  const name = (p: Player) => result.game.players[p]?.name ?? colorName(p);

  return (
    <section className="panel-card debrief">
      <header className="debrief-head">
        <span className="debrief-title">
          <SparkleIcon size={18} /> Coach's debrief
        </span>
        <div className="debrief-seats" role="group" aria-label="Whose play to review">
          {(['B', 'W'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`debrief-seat${p === player ? ' active' : ''}`}
              aria-pressed={p === player}
              onClick={() => onPlayerChange(p)}
            >
              <span className={`disc disc-${p} mini`} />
              {name(p)}
            </button>
          ))}
        </div>
      </header>

      {debrief === undefined && !error && <p className="muted small">Loading…</p>}

      {debrief === null && !generating && !enabled && (
        <p className="muted small">
          The AI coach isn't available right now, and there's no saved debrief for {name(player)}. The engine's review
          below is still complete.
        </p>
      )}

      {debrief === null && !generating && enabled && (
        <div className="debrief-empty">
          <p className="muted small">
            Your coach reads the engine's analysis of {name(player)}'s moves and explains the turning points in plain
            language.
          </p>
          <button type="button" className="btn btn-primary" onClick={coach.generate}>
            <SparkleIcon size={18} /> Get {name(player)}'s debrief
          </button>
        </div>
      )}

      {generating && <AnalysisBar label="Your coach is reviewing the game…" />}
      {error && <p className="error-text small">{error}</p>}

      {debrief && (
        <div className="debrief-body">
          <h3 className="debrief-headline">{debrief.headline}</h3>
          <p>{debrief.overview}</p>
          <div className="debrief-callout debrief-callout-strength">
            <h4 className="debrief-callout-head">
              <CheckIcon size={18} /> What went well
            </h4>
            <p>{debrief.strength}</p>
          </div>

          {debrief.moments.length > 0 && (
            <>
              <h4 className="section-label">Key moments</h4>
              <ol className="debrief-moments">
                {debrief.moments.map((m) => {
                  const ply = result.plies[m.ply - 1];
                  return (
                    <li key={m.ply}>
                      <button
                        type="button"
                        className={`debrief-moment${currentPly === m.ply ? ' active' : ''}`}
                        onClick={() => onSelectPly(m.ply)}
                      >
                        <span className={`class-badge small cls-${ply.classification}`}>
                          {m.ply}. {ply.square === null ? 'pass' : squareToAlg(ply.square)}
                        </span>
                        <span>{m.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          <div className="debrief-callout debrief-callout-next">
            <h4 className="debrief-callout-head">
              <TargetIcon size={18} /> Work on next
            </h4>
            <p>{debrief.takeaway}</p>
          </div>
        </div>
      )}
    </section>
  );
}
