import { useEffect, useLayoutEffect, useRef } from 'react';

/** Keys are `KeyboardEvent.key` values ('ArrowLeft', ' ', 'Home'…). A missing entry is ignored. */
export type Shortcuts = Partial<Record<string, () => void>>;

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Page-wide keyboard shortcuts, ignored while the user is typing in a form field. Handled keys
 * don't scroll the page. The latest `shortcuts` are always used without re-binding the listener,
 * so callers can pass a fresh object every render.
 */
export function useKeyboardShortcuts(shortcuts: Shortcuts): void {
  const latest = useRef(shortcuts);
  useLayoutEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && TYPING_TAGS.has(t.tagName)) return;
      const run = latest.current[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
