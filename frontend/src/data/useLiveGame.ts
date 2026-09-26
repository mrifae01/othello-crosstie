import { useEffect, useReducer, useState } from 'react';
import type { AnalysisReadyPayload, GameState, Player } from '@othello/shared';
import { useGameClient } from './ClientContext';
import { isGameClientError, type GameEventHandlers } from './GameClient';
import { reduceGameState } from './gameState';
import { errorText } from '../format';

export interface LiveGame {
  state: GameState | null;
  /** Seat for the current token; null = spectator. Meaningless until `seatKnown`. */
  you: Player | null;
  seatKnown: boolean;
  notFound: boolean;
  error: string | null;
  progress: { done: number; total: number } | null;
  analysisReady: AnalysisReadyPayload['status'] | null;
}

/**
 * Loads a game (GET), then subscribes with the given token (or as a spectator) and
 * keeps the state current. Re-subscribes when the token changes, e.g. right after
 * joining, without blanking the board in between.
 */
export function useLiveGame(gameId: string, token: string | undefined): LiveGame {
  const client = useGameClient();
  const [state, dispatch] = useReducer(reduceGameState, null);
  const [you, setYou] = useState<Player | null>(null);
  const [seatKnown, setSeatKnown] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LiveGame['progress']>(null);
  const [analysisReady, setAnalysisReady] = useState<LiveGame['analysisReady']>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    setSeatKnown(false);

    const handlers: GameEventHandlers = {
      onState: (s) => !cancelled && s.gameId === gameId && dispatch(s),
      onAnalysisProgress: (p) => !cancelled && p.gameId === gameId && setProgress({ done: p.done, total: p.total }),
      onAnalysisReady: (p) => !cancelled && p.gameId === gameId && setAnalysisReady(p.status),
    };

    (async () => {
      try {
        const initial = await client.getGame(gameId);
        if (cancelled) return;
        dispatch(initial);
        const sub = await client.subscribe(gameId, token, handlers);
        if (cancelled) {
          sub.unsubscribe();
          return;
        }
        unsubscribe = sub.unsubscribe;
        dispatch(sub.state);
        setYou(sub.you);
        setSeatKnown(true);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        if (isGameClientError(e) && e.code === 'GAME_NOT_FOUND') setNotFound(true);
        else setError(errorText(e));
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client, gameId, token]);

  return { state, you, seatKnown, notFound, error, progress, analysisReady };
}
