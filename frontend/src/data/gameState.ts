import type { GameState } from '@othello/shared';

/**
 * The GameState.version rule (design-contract §2): ignore any state whose version
 * is strictly lower than the one held. Equal versions replace, because resign and
 * analysis-status changes re-broadcast at the same version.
 */
export function reduceGameState(current: GameState | null, incoming: GameState): GameState | null {
  if (current && current.gameId === incoming.gameId && incoming.version < current.version) return current;
  return incoming;
}
