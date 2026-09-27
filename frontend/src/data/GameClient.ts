/**
 * The single data-access seam between the UI and the backend.
 *
 * Mirrors design-contract §3: REST for create/join/read, socket events for live
 * play. Pages and components only ever see this interface (via useGameClient()),
 * never a concrete implementation.
 */
import type {
  Account,
  AnalysisProgressPayload,
  AnalysisReadyPayload,
  AnalysisResult,
  ErrorCode,
  GameState,
  GameSummary,
  Player,
  SeatResponse,
  Square,
  TournamentDetail,
  TournamentStatus,
  TournamentSummary,
} from '@othello/shared';

/** Every failure from a GameClient is one of these, whether it came from REST (ApiError) or a socket ack. */
export class GameClientError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'GameClientError';
    this.code = code;
  }
}

export function isGameClientError(e: unknown): e is GameClientError {
  return e instanceof GameClientError;
}

/** Push events for one subscribed game. */
export interface GameEventHandlers {
  /** Whole-state `game:state`. May arrive with a lower version than one already held; callers apply the version rule. */
  onState(state: GameState): void;
  onAnalysisProgress(payload: AnalysisProgressPayload): void;
  onAnalysisReady(payload: AnalysisReadyPayload): void;
}

export interface GameSubscription {
  /** Seat the token maps to; null for spectators or an invalid/missing token. */
  you: Player | null;
  state: GameState;
  /** Stop delivering events to these handlers. Safe to call more than once. */
  unsubscribe(): void;
}

export interface GameClient {
  /** POST /api/games → color 'B'. Signed in with a username, the server seats the account and ignores `name`. */
  createGame(name: string): Promise<SeatResponse>;
  /** POST /api/games/:id/join → color 'W'. */
  joinGame(gameId: string, name: string): Promise<SeatResponse>;
  /** GET /api/games/:id */
  getGame(gameId: string): Promise<GameState>;
  /** GET /api/games?status=finished&limit=N, newest finishedAt first. */
  listFinishedGames(limit?: number): Promise<GameSummary[]>;
  /** GET /api/games/:id/analysis. Always resolves for an existing game; switch on `status`. */
  getAnalysis(gameId: string): Promise<AnalysisResult>;
  /**
   * `game:subscribe`. Omit the token to spectate. The implementation must keep the
   * subscription alive across reconnects (re-emitting subscribe and delivering the
   * fresh state through `onState`) until `unsubscribe()` is called.
   */
  subscribe(gameId: string, playerToken: string | undefined, handlers: GameEventHandlers): Promise<GameSubscription>;
  /** `game:move`. Resolves on `{ok:true}`; the new state arrives via onState, never optimistically. */
  move(gameId: string, playerToken: string, square: Square): Promise<void>;
  /** `game:resign`. */
  resign(gameId: string, playerToken: string): Promise<void>;

  // ---- Accounts (only called while signed in; see auth/AuthContext) ----

  /** GET /api/me. null = signed in but no username claimed yet. */
  getMe(): Promise<Account | null>;
  /** PUT /api/me. Fails with USERNAME_TAKEN. */
  claimUsername(username: string): Promise<Account>;
  /** GET /api/me/games: the signed-in account's finished games, newest first. */
  listMyGames(limit?: number): Promise<GameSummary[]>;

  // ---- Tournaments (reads work for guests; writes need a signed-in account) ----

  /** GET /api/tournaments?status=&limit=, newest first. */
  listTournaments(status?: TournamentStatus, limit?: number): Promise<TournamentSummary[]>;
  /** GET /api/tournaments/:id */
  getTournament(id: string): Promise<TournamentDetail>;
  /** POST /api/tournaments. The creator organizes; they play only if they also join. */
  createTournament(name: string, maxPlayers: number): Promise<TournamentDetail>;
  joinTournament(id: string): Promise<TournamentDetail>;
  leaveTournament(id: string): Promise<TournamentDetail>;
  /** Organizer only. */
  startTournament(id: string): Promise<TournamentDetail>;
  /** Organizer only: the `loser` seat forfeits the match's game. */
  forfeitMatch(id: string, round: number, slot: number, loser: Player): Promise<TournamentDetail>;
  /** POST /api/games/:id/seat: a seat token for the signed-in account's seat (tournament games). */
  claimSeat(gameId: string): Promise<SeatResponse>;
}
