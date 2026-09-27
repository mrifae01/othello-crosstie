import { useEffect, useState } from 'react';
import type { GameSummary } from '@othello/shared';
import { useAuth } from '../auth/AuthContext';
import { useGameClient } from './ClientContext';
import { errorText } from '../format';

export interface RecentGames {
  /**
   * Whose games: 'mine' when signed in; 'all' when accounts aren't configured at all
   * (zero-config run, mock mode) so lists aren't empty; null in any other auth state,
   * where callers show a prompt instead of a list.
   */
  source: 'mine' | 'all' | null;
  games: GameSummary[] | null;
  error: string | null;
  loading: boolean;
}

export function useRecentGames(limit = 20): RecentGames {
  const client = useGameClient();
  const { state: auth, account } = useAuth();
  const source = account ? 'mine' : auth.status === 'disabled' ? 'all' : null;
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGames(null);
    setError(null);
    if (!source) return;
    let live = true;
    (source === 'mine' ? client.listMyGames(limit) : client.listFinishedGames(limit))
      .then((g) => live && setGames(g))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [client, source, account?.id, limit]);

  return { source, games, error, loading: auth.status === 'loading' || (!!source && !games && !error) };
}
