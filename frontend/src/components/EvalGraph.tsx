import { useId, useRef, useState, type MouseEvent } from 'react';
import type { PlyAnalysis } from '@othello/shared';
import { squareToAlg } from '@othello/shared';
import { CLASS_LABEL, colorName, fmtEval } from '../format';

/** Display clamp (design-contract §6.2 task 5). Evals themselves range ±64. */
const CLAMP = 32;
const W = 640;
const H = 180;
const PAD_X = 10;
const PAD_Y = 12;

interface EvalGraphProps {
  plies: PlyAnalysis[];
  /** Cursor index into the points array: 0 = start position, i = after ply i. */
  cursor: number;
  onSelect(index: number): void;
}

/**
 * Hand-rolled SVG eval graph, Black's point of view (up = Black better).
 * Points are [plies[0].evalBefore, ...plies.map(p => p.evalAfter)].
 */
export function EvalGraph({ plies, cursor, onSelect }: EvalGraphProps) {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (plies.length === 0) return null;
  const points = [plies[0].evalBefore, ...plies.map((p) => p.evalAfter)];
  const n = points.length - 1;
  const mid = H / 2;

  const x = (i: number) => PAD_X + (n === 0 ? 0 : (i / n) * (W - 2 * PAD_X));
  const y = (v: number) => mid - (Math.max(-CLAMP, Math.min(CLAMP, v)) / CLAMP) * (mid - PAD_Y);

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n).toFixed(1)},${mid} L${x(0).toFixed(1)},${mid} Z`;

  const indexAt = (e: MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD_X) / (W - 2 * PAD_X)) * n);
    return Math.max(0, Math.min(n, i));
  };

  const marked = plies.filter((p) => p.classification === 'blunder' || p.classification === 'mistake');
  const tip = hover === null ? null : tooltip(plies, points, hover);

  return (
    <div className="eval-graph">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Evaluation graph from Black's point of view; click to jump to a move"
        onClick={(e) => onSelect(indexAt(e))}
        onMouseMove={(e) => setHover(indexAt(e))}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={`${clipId}-top`}>
            <rect x="0" y="0" width={W} height={mid} />
          </clipPath>
          <clipPath id={`${clipId}-bottom`}>
            <rect x="0" y={mid} width={W} height={H - mid} />
          </clipPath>
        </defs>
        <rect className="eg-bg" x="0" y="0" width={W} height={H} />
        {/* Black-better area above the axis, White-better below. */}
        <path className="eg-area-black" d={area} clipPath={`url(#${clipId}-top)`} />
        <path className="eg-area-white" d={area} clipPath={`url(#${clipId}-bottom)`} />
        <line className="eg-axis" x1="0" x2={W} y1={mid} y2={mid} />
        <path className="eg-line" d={line} vectorEffect="non-scaling-stroke" />
        {hover !== null && hover !== cursor && (
          <line className="eg-hover" x1={x(hover)} x2={x(hover)} y1="0" y2={H} vectorEffect="non-scaling-stroke" />
        )}
        <line className="eg-cursor" x1={x(cursor)} x2={x(cursor)} y1="0" y2={H} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Dots live in HTML so they stay round while the SVG stretches to the container width. */}
      <div className="eg-dots" aria-hidden>
        {marked.map((p) => (
          <button
            key={p.ply}
            type="button"
            tabIndex={-1}
            className={`eg-dot eg-dot-${p.classification}`}
            style={{ left: `${(x(p.ply) / W) * 100}%`, top: `${(y(p.evalAfter) / H) * 100}%` }}
            title={`Ply ${p.ply}: ${CLASS_LABEL[p.classification]}`}
            onClick={() => onSelect(p.ply - 1)}
            onMouseEnter={() => setHover(p.ply)}
          />
        ))}
      </div>
      {tip && (
        <div className="eg-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          {tip}
        </div>
      )}
      <div className="eg-scale" aria-hidden>
        <span>Black +{CLAMP}</span>
        <span>White +{CLAMP}</span>
      </div>
    </div>
  );
}

function tooltip(plies: PlyAnalysis[], points: number[], i: number): string {
  if (i === 0) return `Start · ${fmtEval(points[0])}`;
  const p = plies[i - 1];
  const move = p.square === null ? 'pass' : squareToAlg(p.square);
  return `${p.ply}. ${colorName(p.player)} ${move} · ${CLASS_LABEL[p.classification]} · ${fmtEval(p.evalAfter)}`;
}
