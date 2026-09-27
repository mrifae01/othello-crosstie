import type { Board as BoardCells, MoveClass, Player, Square } from '@othello/shared';
import { squareToAlg } from '@othello/shared';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export interface BoardProps {
  board: BoardCells;
  /** Squares to mark with a legal-move dot. Pass only when the viewer may move (state.turn === you). */
  legalMoves?: Square[];
  /** Colour of the legal-move dots. */
  hintPlayer?: Player | null;
  /** Small marker on the most recently played square. */
  lastMove?: Square | null;
  /** Review: ring on the engine's best move. */
  bestSquare?: Square | null;
  /** Review: translucent disc on the square that was actually played, tinted by its classification. */
  ghost?: { square: Square; player: Player; tone?: MoveClass } | null;
  /** Extra squares to tint (e.g. discs flipped by the move under review). */
  highlighted?: Square[];
  /**
   * Called for any empty square, legal or not: the server is the rule authority and
   * rejects illegal or out-of-turn moves with an error the page shows as a toast.
   */
  onSquareClick?: (square: Square) => void;
  disabled?: boolean;
  /** File/rank labels around the board. Off for small illustrative diagrams. */
  coords?: boolean;
}

export function Board({
  board,
  legalMoves = [],
  hintPlayer = null,
  lastMove = null,
  bestSquare = null,
  ghost = null,
  highlighted = [],
  onSquareClick,
  disabled = false,
  coords = true,
}: BoardProps) {
  const legal = new Set(legalMoves);
  const hl = new Set(highlighted);

  return (
    <div className={`board-frame${coords ? '' : ' board-frame-plain'}`}>
      {coords && (
        <>
          <div className="board-files" aria-hidden>
            {FILES.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
          <div className="board-ranks" aria-hidden>
            {RANKS.map((r) => (
              <span key={r}>{r}</span>
            ))}
          </div>
        </>
      )}
      <div className="board" role="grid" aria-label="Othello board">
        {board.map((cell, sq) => {
          const isLegal = legal.has(sq);
          const clickable = cell === null && !disabled && !!onSquareClick;
          const classes = ['cell'];
          if (clickable && isLegal) classes.push('cell-legal');
          if (hl.has(sq)) classes.push('cell-highlight');
          const label = `${squareToAlg(sq)}${cell ? (cell === 'B' ? ' black' : ' white') : isLegal ? ' legal move' : ''}`;
          return (
            <button
              key={sq}
              type="button"
              className={classes.join(' ')}
              aria-label={label}
              tabIndex={clickable && isLegal ? 0 : -1}
              onClick={clickable ? () => onSquareClick!(sq) : undefined}
              disabled={!clickable}
            >
              {cell && <span className={`disc disc-${cell}`} />}
              {!cell && isLegal && <span className={`hint hint-${hintPlayer ?? 'B'}`} />}
              {ghost && ghost.square === sq && (
                <span className={`disc disc-${ghost.player} disc-ghost ${ghost.tone ? `tone-${ghost.tone}` : ''}`} />
              )}
              {bestSquare === sq && <span className="best-ring" />}
              {lastMove === sq && <span className="last-move" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
