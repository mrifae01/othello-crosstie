import { useCallback, useEffect, useState } from 'react';
import type { CoachDebrief, Player } from '@othello/shared';
import { useGameClient } from './ClientContext';
import { isGameClientError } from './GameClient';
import { useToasts } from '../components/Toasts';
import { errorText } from '../format';

export interface CoachDebriefState {
  /**
   * Whether the server can write new debriefs: null until it answers, false without an API key
   * or while the coach is paused after a failure (the review falls back to the engine's alone).
   */
  enabled: boolean | null;
  /** Some debrief (either player) is loaded: cached debriefs stay readable while the coach is off. */
  hasAny: boolean;
  /** The debrief for `player`: undefined while loading, null if none generated yet. */
  debrief: CoachDebrief | null | undefined;
  /** True while the coach is writing `player`'s debrief. */
  generating: boolean;
  error: string | null;
  generate(): void;
}

/**
 * One game's coach debriefs, for either player. Both sides are kept once loaded, so switching
 * between them is instant, and a debrief still being written survives a switch away and back.
 */
export function useCoachDebrief(gameId: string, player: Player): CoachDebriefState {
  const client = useGameClient();
  const toasts = useToasts();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [debriefs, setDebriefs] = useState<Partial<Record<Player, CoachDebrief | null>>>({});
  const [generating, setGenerating] = useState<Partial<Record<Player, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Player, string>>>({});

  const loaded = player in debriefs;
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    client
      .getCoachDebrief(gameId, player)
      .then((r) => {
        if (cancelled) return;
        setEnabled(r.enabled);
        setDebriefs((d) => ({ ...d, [player]: r.debrief }));
      })
      .catch((e) => !cancelled && setErrors((x) => ({ ...x, [player]: errorText(e) })));
    return () => {
      cancelled = true;
    };
  }, [client, gameId, player, loaded]);

  const generate = useCallback(() => {
    setGenerating((g) => ({ ...g, [player]: true }));
    setErrors((x) => ({ ...x, [player]: undefined }));
    client
      .requestCoachDebrief(gameId, player)
      .then((d) => setDebriefs((x) => ({ ...x, [player]: d })))
      .catch((e) => {
        if (isGameClientError(e) && e.code === 'COACH_UNAVAILABLE') {
          // Out of credit, timed out, overloaded…: fall back to the plain engine review.
          setEnabled(false);
          toasts.info("The AI coach isn't available right now. The engine's review below is still complete.");
        } else {
          setErrors((x) => ({ ...x, [player]: errorText(e) }));
        }
      })
      .finally(() => setGenerating((g) => ({ ...g, [player]: false })));
  }, [client, gameId, player, toasts]);

  return {
    enabled,
    hasAny: Object.values(debriefs).some((d) => d),
    debrief: debriefs[player],
    generating: generating[player] === true,
    error: errors[player] ?? null,
    generate,
  };
}
