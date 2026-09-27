import { useAuth } from '../auth/AuthContext';
import { NameForm } from './NameForm';

interface SeatFormProps {
  submitLabel: string;
  busy?: boolean;
  /** Forwarded to NameForm for guests. */
  prefill?: boolean;
  onSubmit(name: string): void;
}

/**
 * How a player takes a seat. Signed in: they play as their username (the server enforces
 * this too). Otherwise: the guest name form.
 */
export function SeatForm({ submitLabel, busy = false, prefill, onSubmit }: SeatFormProps) {
  const { account, state } = useAuth();

  if (account) {
    return (
      <div className="name-form">
        <p className="seat-as">
          Playing as <strong>@{account.username}</strong>
        </p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSubmit(account.username)}>
          {busy ? 'Working…' : submitLabel}
        </button>
      </div>
    );
  }

  return (
    <>
      <NameForm label="Your name" submitLabel={submitLabel} busy={busy} prefill={prefill} onSubmit={onSubmit} />
      {state.status === 'guest' && (
        <p className="muted tiny">Playing as a guest. Sign in to keep this game on your profile.</p>
      )}
    </>
  );
}
