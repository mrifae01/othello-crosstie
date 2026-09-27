import { fmtEval } from '../format';

/** Same display clamp as the eval graph. */
const CLAMP = 32;

/**
 * Vertical advantage bar beside the review board. Black fills from the bottom,
 * matching the board orientation (Black's player bar sits under the board).
 */
export function EvalBar({ value }: { value: number }) {
  const clamped = Math.max(-CLAMP, Math.min(CLAMP, value));
  const blackShare = 50 + (clamped / CLAMP) * 50;
  const leader = value > 0 ? 'B' : value < 0 ? 'W' : null;

  return (
    <div className="eval-bar" role="img" aria-label={`Evaluation ${fmtEval(value)} discs from Black's view`}>
      <div className="eval-bar-black" style={{ height: `${blackShare}%` }} />
      <span className={`eval-bar-label ${leader === 'W' ? 'top' : 'bottom'}`}>{fmtEval(Math.abs(value)).replace('+', '')}</span>
    </div>
  );
}
