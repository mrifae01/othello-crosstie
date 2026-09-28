import type { CoachMoment, Motif, PlyAnalysis } from '@othello/shared';
import { squareToAlg } from '@othello/shared';
import { colorName } from '../format';
import { ComingSoon } from './ComingSoon';

const MOTIF_TIP: Record<Motif, string> = {
  took_corner: 'Corners are permanent: a corner disc can never be flipped.',
  missed_corner: 'A corner was available here, and taking it was the strongest option.',
  allowed_corner: 'This move opens up a corner for the opponent.',
  x_square: 'An X-square next to an empty corner usually hands that corner away.',
  c_square: 'A C-square next to an empty corner is risky: it can give the opponent a way onto the edge.',
};

interface Props {
  ply: PlyAnalysis | null;
  summary: string;
  /** The AI coach's explanation of this ply, when it is one of the debrief's key moments. */
  moment?: CoachMoment | null;
  /** Whether the server's AI coach is on; off, the template is labelled as a preview of it. */
  aiEnabled?: boolean;
}

/**
 * The coach's voice in Game Review. On a key moment of an AI debrief it speaks the debrief's
 * explanation; everywhere else it's a template over the engine's classification and motifs.
 */
export function CoachBubble({ ply, summary, moment, aiEnabled = false }: Props) {
  const { headline, body } = moment
    ? { headline: moment.title, body: moment.explanation }
    : ply
      ? coachLine(ply)
      : { headline: 'Game over', body: summary };
  return (
    <div className="coach">
      <CoachSeal />
      <div className="coach-bubble">
        <div className="coach-head">
          <strong>{headline}</strong>
          {moment ? <span className="live-badge">AI coach</span> : !aiEnabled && <ComingSoon label="AI coach preview" />}
        </div>
        <p>{body}</p>
        {moment && <p className="coach-lesson">{moment.lesson}</p>}
      </div>
    </div>
  );
}

/** The coach's avatar: a hanko-style seal stamped 師 ("teacher"). */
export function CoachSeal() {
  return (
    <div className="coach-avatar" aria-hidden title="Coach">
      師
    </div>
  );
}

function coachLine(p: PlyAnalysis): { headline: string; body: string } {
  if (p.square === null) {
    return { headline: `${colorName(p.player)} passes`, body: `${colorName(p.player)} had no legal moves, so the turn passed.` };
  }
  const played = squareToAlg(p.square);
  const best = p.bestSquare === null ? null : squareToAlg(p.bestSquare);
  const tips = p.motifs.map((m) => MOTIF_TIP[m]).join(' ');
  const loss = p.loss >= 1 ? `about ${p.loss.toFixed(0)} disc${p.loss >= 1.5 ? 's' : ''}` : 'a little';

  switch (p.classification) {
    case 'best':
      return {
        headline: `${played} is best`,
        body: `${best && best !== played ? `As strong as the engine's top choice, ${best}.` : 'The strongest move in the position.'} ${tips}`.trim(),
      };
    case 'good':
      return { headline: `${played} is good`, body: `A solid choice${best ? `; ${best} was slightly stronger` : ''}. ${tips}`.trim() };
    case 'forced':
      return { headline: `${played} was forced`, body: `The only sensible option here. ${tips}`.trim() };
    default: {
      const label = p.classification === 'inaccuracy' ? 'an inaccuracy' : `a ${p.classification}`;
      return {
        headline: `${played} is ${label}`,
        body: `This gives away ${loss}${best ? `. ${best} was best` : ''}. ${tips}`.trim(),
      };
    }
  }
}
