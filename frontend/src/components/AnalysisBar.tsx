/** Progress bar for engine analysis; indeterminate when no fraction is known yet. */
export function AnalysisBar({ label, fraction }: { label: string; fraction?: number }) {
  return (
    <div className="analysis-bar">
      <div className="muted small">{label}</div>
      <div className={`bar ${fraction === undefined ? 'bar-indeterminate' : ''}`}>
        <div className="bar-fill" style={fraction === undefined ? undefined : { width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </div>
  );
}
