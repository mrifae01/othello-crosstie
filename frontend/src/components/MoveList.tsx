import { useEffect, useRef } from 'react';
import type { MoveClass, Player, Square } from '@othello/shared';
import { squareToAlg } from '@othello/shared';
import { CLASS_LABEL } from '../format';

export interface MoveListItem {
  ply: number;
  player: Player;
  square: Square | null;
  classification?: MoveClass;
}

interface MoveListProps {
  moves: MoveListItem[];
  /** Ply to highlight (1-based). */
  currentPly?: number | null;
  onSelect?: (ply: number) => void;
}

/**
 * Moves in algebraic notation, one row per Black/White pair. Passes are plies too,
 * so colours strictly alternate: odd plies are Black, even plies are White.
 */
export function MoveList({ moves, currentPly = null, onSelect }: MoveListProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const rows: [MoveListItem, MoveListItem | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);

  // Keep the current (or latest) move in view by scrolling the list only, never the page.
  // .move-list is position:relative, so offsetTop is relative to it.
  useEffect(() => {
    const list = listRef.current;
    const el = (list?.querySelector('.move-current') ?? list?.lastElementChild) as HTMLElement | null | undefined;
    if (!list || !el) return;
    const top = el.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }, [currentPly, moves.length]);

  if (moves.length === 0) return <p className="muted small">No moves yet.</p>;

  const cell = (m: MoveListItem | undefined) => {
    if (!m) return <span className="move-cell" />;
    const classes = ['move-cell'];
    if (m.ply === currentPly) classes.push('move-current');
    if (m.square === null) classes.push('move-pass');
    const content = (
      <>
        <span className="move-sq">{m.square === null ? 'pass' : squareToAlg(m.square)}</span>
        {m.classification && m.classification !== 'best' && (
          <span className={`class-badge small cls-${m.classification}`} title={CLASS_LABEL[m.classification]}>
            {classSymbol(m.classification)}
          </span>
        )}
      </>
    );
    return onSelect ? (
      <button type="button" className={classes.join(' ')} onClick={() => onSelect(m.ply)}>
        {content}
      </button>
    ) : (
      <span className={classes.join(' ')}>{content}</span>
    );
  };

  return (
    <ol className="move-list" ref={listRef}>
      {rows.map(([b, w], i) => (
        <li key={b.ply} className="move-row">
          <span className="move-num">{i + 1}.</span>
          {cell(b)}
          {cell(w)}
        </li>
      ))}
    </ol>
  );
}

function classSymbol(c: MoveClass): string {
  switch (c) {
    case 'good':
      return '✓';
    case 'inaccuracy':
      return '?!';
    case 'mistake':
      return '?';
    case 'blunder':
      return '??';
    case 'forced':
      return '□';
    default:
      return '';
  }
}
