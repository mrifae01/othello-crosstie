import type { PlayerAnalysisSummary } from '@othello/shared';
import { CLASS_LABEL, CLASS_ORDER } from '../format';

/** One player's accuracy, average loss and move-class counts (Review's summary cards, Practice's game over). */
export function AccuracySummary({ s }: { s: PlayerAnalysisSummary }) {
  return (
    <>
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
    </>
  );
}
