import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  title: string;
  /** Optional hint under the title. */
  children?: ReactNode;
  /** Where the button goes, and what it says. */
  to?: string;
  linkLabel?: string;
}

/** Full-panel "nothing here" state: unknown routes, games and tournaments. */
export function NotFound({ title, children, to = '/', linkLabel = 'Back to home' }: Props) {
  return (
    <div className="panel center">
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      <Link to={to} className="btn">
        {linkLabel}
      </Link>
    </div>
  );
}
