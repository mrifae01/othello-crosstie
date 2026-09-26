/**
 * Per-game seat tokens in sessionStorage (design-contract §0b): a refresh keeps
 * the seat, a new tab is a different player.
 */

const key = (gameId: string) => `othello:seat:${gameId}`;
const CHANGE_EVENT = 'othello:seat-change';

export function getSeatToken(gameId: string): string | undefined {
  try {
    return sessionStorage.getItem(key(gameId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setSeatToken(gameId: string, token: string | undefined): void {
  try {
    if (token === undefined) sessionStorage.removeItem(key(gameId));
    else sessionStorage.setItem(key(gameId), token);
  } catch {
    // Storage unavailable (private mode etc.): the seat just won't survive a refresh.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: gameId }));
}

/** Notifies when a seat token is set or cleared in this tab. */
export function onSeatTokenChange(listener: (gameId: string) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<string>).detail);
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
