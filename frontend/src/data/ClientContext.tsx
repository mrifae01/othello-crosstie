import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { GameClient } from './GameClient';
import { getSeatToken, onSeatTokenChange } from './seatStorage';

const ClientContext = createContext<GameClient | null>(null);

export function GameClientProvider({ client, children }: { client: GameClient; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useGameClient(): GameClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useGameClient() must be used inside <GameClientProvider>');
  return client;
}

/** The stored seat token for a game, kept in sync with setSeatToken() calls in this tab. */
export function useSeatToken(gameId: string): string | undefined {
  const [token, setToken] = useState(() => getSeatToken(gameId));
  useEffect(() => {
    setToken(getSeatToken(gameId));
    return onSeatTokenChange((changed) => {
      if (changed === gameId) setToken(getSeatToken(gameId));
    });
  }, [gameId]);
  return token;
}
