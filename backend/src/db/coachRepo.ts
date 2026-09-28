import type { CoachDebrief, CoachMoment, Player } from '@othello/shared';
import { pool } from './pool';

/** What the coach wrote; the rest of a CoachDebrief comes from the row's key columns. */
export type DebriefContent = Pick<CoachDebrief, 'headline' | 'overview' | 'strength' | 'moments' | 'takeaway'>;

interface DebriefRow {
  game_id: string;
  player: Player;
  model: string;
  content: DebriefContent & { moments: CoachMoment[] };
  created_at: Date;
}

export async function loadDebrief(gameId: string, player: Player, promptVersion: number): Promise<CoachDebrief | null> {
  const { rows } = await pool.query<DebriefRow>(
    `SELECT game_id, player, model, content, created_at FROM coach_debriefs
      WHERE game_id = $1 AND player = $2 AND prompt_version = $3`,
    [gameId, player, promptVersion],
  );
  const r = rows[0];
  if (!r) return null;
  return { gameId: r.game_id, player: r.player, model: r.model, createdAt: r.created_at.toISOString(), ...r.content };
}

/** Insert-or-keep: if two requests raced, the first one written wins and is returned. */
export async function saveDebrief(input: {
  gameId: string;
  player: Player;
  promptVersion: number;
  model: string;
  content: DebriefContent;
  usage: { inputTokens: number; outputTokens: number };
}): Promise<CoachDebrief> {
  await pool.query(
    `INSERT INTO coach_debriefs (game_id, player, prompt_version, model, content, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (game_id, player, prompt_version) DO NOTHING`,
    [input.gameId, input.player, input.promptVersion, input.model, JSON.stringify(input.content),
     input.usage.inputTokens, input.usage.outputTokens],
  );
  return (await loadDebrief(input.gameId, input.player, input.promptVersion))!;
}
