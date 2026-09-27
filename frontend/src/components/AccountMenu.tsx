import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { errorText } from '../format';
import { useToasts } from './Toasts';

/** Top-bar account control. Renders nothing when accounts are disabled. */
export function AccountMenu() {
  const auth = useAuth();
  const toasts = useToasts();
  const [signingIn, setSigningIn] = useState(false);
  const { state } = auth;

  const signOut = () => auth.signOut().catch((e) => toasts.error(errorText(e)));

  switch (state.status) {
    case 'disabled':
      return null;
    case 'loading':
      return <span className="muted small account-loading">…</span>;
    case 'guest':
      return (
        <>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setSigningIn(true)}>
            Sign in
          </button>
          {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
        </>
      );
    case 'needsUsername':
      return (
        <>
          <button type="button" className="btn btn-block" onClick={signOut}>
            Sign out
          </button>
          <UsernameDialog email={state.email} onSignOut={signOut} />
        </>
      );
    case 'signedIn':
      return (
        <div className="account-chip">
          <span className="avatar" aria-hidden>
            {state.account.username[0].toUpperCase()}
          </span>
          <span className="account-name" title={state.email ?? undefined}>
            {state.account.username}
          </span>
          <button type="button" className="btn btn-ghost btn-small account-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      );
    case 'error':
      return (
        <div className="account-chip">
          <span className="error-text small" title={state.message}>
            Account unavailable
          </span>
          <button type="button" className="btn" onClick={auth.retry}>
            Retry
          </button>
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      );
  }
}

/** Native modal <dialog>: focus trap, Esc and backdrop for free. */
function Modal({ labelId, onClose, children }: { labelId: string; onClose?: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={labelId}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose?.();
      }}
    >
      {children}
    </dialog>
  );
}

export function SignInDialog({ onClose }: { onClose(): void }) {
  const auth = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signIn') {
        await auth.signIn(email.trim(), password);
        onClose();
      } else {
        const { needsConfirmation } = await auth.signUp(email.trim(), password);
        if (needsConfirmation) setConfirmSent(true);
        else onClose();
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (confirmSent) {
    return (
      <Modal labelId="auth-title" onClose={onClose}>
        <h2 id="auth-title">Check your email</h2>
        <p className="muted">
          We sent a confirmation link to <strong>{email.trim()}</strong>. Open it, then sign in here.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
            OK
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal labelId="auth-title" onClose={busy ? undefined : onClose}>
      <h2 id="auth-title">{mode === 'signIn' ? 'Sign in' : 'Create an account'}</h2>
      <p className="muted small">
        Optional. An account keeps every game and its review under your name, so your progress adds up across
        games. Guests can still play and review any game.
      </p>
      <form className="stack-form" onSubmit={submit}>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </label>
        {error && <p className="error-text small">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setMode(mode === 'signIn' ? 'signUp' : 'signIn');
              setError(null);
            }}
          >
            {mode === 'signIn' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Working…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** Shown until a signed-in user claims a username; it's their name in every game. */
function UsernameDialog({ email, onSignOut }: { email: string | null; onSignOut(): void }) {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = USERNAME_RE.test(username.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await auth.claimUsername(username.trim());
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal labelId="username-title">
      <h2 id="username-title">Pick a username</h2>
      <p className="muted small">
        {email ? <>Signed in as {email}. </> : null}This is the name opponents and spectators see in your games.
      </p>
      <form className="stack-form" onSubmit={submit}>
        <label>
          <span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} autoFocus autoComplete="username" />
          <span className="muted tiny">3–20 letters, digits or underscores.</span>
        </label>
        {error && <p className="error-text small">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onSignOut} disabled={busy}>
            Sign out
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
            {busy ? 'Saving…' : 'Save username'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
