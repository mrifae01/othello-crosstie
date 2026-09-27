import type { ComponentType, MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLeave } from './LeaveGuard';
import { AccountMenu } from './AccountMenu';
import { HomeIcon, LearnIcon, PlayIcon, ReviewIcon, TrophyIcon } from './icons';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Whether this item owns the current path (a game page belongs to Play, its review to Review). */
  match(pathname: string): boolean;
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon, match: (p) => p === '/' },
  { to: '/play', label: 'Play', icon: PlayIcon, match: (p) => p === '/play' || (p.startsWith('/game/') && !p.endsWith('/analysis')) },
  { to: '/tournaments', label: 'Tournaments', icon: TrophyIcon, match: (p) => p.startsWith('/tournaments') },
  { to: '/learn', label: 'Learn', icon: LearnIcon, match: (p) => p.startsWith('/learn') },
  { to: '/review', label: 'Review', icon: ReviewIcon, match: (p) => p === '/review' || p.endsWith('/analysis') },
];

/**
 * App-wide navigation: a left rail on desktop, a bottom tab bar on phones (see styles.css).
 * Every link goes through the leave guard, so leaving a live game asks first.
 */
export function SideNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const leave = useLeave();

  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    leave(() => navigate(to));
  };

  return (
    <nav className="sidenav" aria-label="Main">
      <Link to="/" className="sidenav-brand" onClick={go('/')}>
        <span className="brand-mark" aria-hidden>
          <span className="disc disc-B" />
          <span className="disc disc-W" />
        </span>
        <span className="sidenav-label brand-text">
          Crosstie<span className="brand-sub">OTHELLO · オセロ</span>
        </span>
      </Link>

      <ul className="sidenav-items">
        {ITEMS.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={to}>
              <Link to={to} className={`sidenav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={go(to)}>
                <Icon size={24} />
                <span className="sidenav-label">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="sidenav-account">
        <AccountMenu />
      </div>
    </nav>
  );
}
