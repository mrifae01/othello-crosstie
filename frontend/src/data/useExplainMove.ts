import { useCallback, useEffect, useState } from 'react';
import type { CoachMoment } from '@othello/shared';
import { positionKey } from '@othello/shared';
import { useGameClient } from './ClientContext';
import { isGameClientError } from './GameClient';
import { useToasts } from '../components/Toasts';
import { errorText } from '../format';
import type { PracticeGame } from './usePracticeGame';

type Explanation = { status: 'loading' } | { status: 'done'; moment: CoachMoment } | { status: 'error'; message: string };

export interface ExplainMove {
  /** Whether the server's AI coach is on: null until it answers, false without an API key or while paused. */
  enabled: boolean | null;
  /** The explanation of the graded move in the coach bubble, if one was asked for. */
  current: Explanation | null;
  /** Asks the coach to explain the graded move. Pauses a pending bot reply, like Hint. */
  explain: () => void;
}

/**
 * Practice's "Explain why": the one part of Practice that talks to the server. Explanations are
 * keyed by the line up to the explained move, so a take back hides one and replaying the same
 * move brings it back. The server grades the move itself; if its grade differs from the
 * browser's (a time-budgeted search can reach a different depth), its grade replaces ours so
 * the bubble and the explanation agree.
 */
export function useExplainMove(game: PracticeGame): ExplainMove {
  const client = useGameClient();
  const toasts = useToasts();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [byKey, setByKey] = useState<Record<string, Explanation>>({});

  useEffect(() => {
    let cancelled = false;
    client
      .getCoachStatus()
      .then((r) => !cancelled && setEnabled(r.enabled))
      .catch(() => !cancelled && setEnabled(false));
    return () => {
      cancelled = true;
    };
  }, [client]);

  const { grade, state, pause, acceptGrade } = game;
  const key = grade ? positionKey(state.moves.slice(0, grade.ply)) : null;

  const explain = useCallback(() => {
    if (!grade || !key || grade.square === null) return;
    if (byKey[key]?.status === 'loading' || byKey[key]?.status === 'done') return;
    pause();
    setByKey((x) => ({ ...x, [key]: { status: 'loading' } }));
    client
      .explainMove({ moves: state.moves.slice(0, grade.ply), ply: grade.ply })
      .then((r) => {
        setByKey((x) => ({ ...x, [key]: { status: 'done', moment: r.explanation } }));
        if (r.grade.classification !== grade.classification || r.grade.loss !== grade.loss) acceptGrade(key, r.grade);
      })
      .catch((e) => {
        if (isGameClientError(e) && e.code === 'COACH_UNAVAILABLE') {
          setEnabled(false);
          toasts.info("The AI coach isn't available right now. The engine's grade still stands.");
          setByKey((x) => {
            const { [key]: _drop, ...rest } = x;
            return rest;
          });
        } else {
          setByKey((x) => ({ ...x, [key]: { status: 'error', message: errorText(e) } }));
        }
      });
  }, [grade, key, byKey, pause, acceptGrade, client, state.moves, toasts]);

  return { enabled, current: key ? (byKey[key] ?? null) : null, explain };
}
