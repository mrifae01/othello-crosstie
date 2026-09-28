import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BOT_LEVELS, type BotLevel } from '@othello/shared';

const COLORS = [
  ['B', 'Black'],
  ['W', 'White'],
  ['random', 'Random'],
] as const;
const LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

/** Pick a color, then a level: each level links straight into a coached practice game. */
export function PracticeLauncher() {
  const [color, setColor] = useState<'B' | 'W' | 'random'>('random');
  return (
    <>
      <div className="practice-colors" role="radiogroup" aria-label="Your color">
        {COLORS.map(([c, label]) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            className={`debrief-seat${color === c ? ' active' : ''}`}
            onClick={() => setColor(c)}
          >
            {c !== 'random' && <span className={`disc disc-${c} mini`} />}
            {label}
          </button>
        ))}
      </div>
      <div className="level-grid level-grid-3">
        {LEVELS.map((l) => (
          <Link key={l} to={`/practice?level=${l}&color=${color}`} className="btn">
            {BOT_LEVELS[l].label}
          </Link>
        ))}
      </div>
    </>
  );
}
