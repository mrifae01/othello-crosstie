/**
 * Optional accounts. Supabase owns the session (sign-up, sign-in, token refresh); our API
 * owns the Account (username). Guests never need any of this: every page works with
 * `status: 'guest'` or `'disabled'`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Account } from '@othello/shared';
import { useGameClient } from '../data/ClientContext';
import { errorText } from '../format';

export type AuthState =
  /** No Supabase configured: guest-only. */
  | { status: 'disabled' }
  | { status: 'loading' }
  | { status: 'guest' }
  /** Signed in, but no username claimed yet; plays as a guest until they pick one. */
  | { status: 'needsUsername'; email: string | null }
  | { status: 'signedIn'; email: string | null; account: Account }
  /** Signed in, but our API couldn't load the account (API down or misconfigured). */
  | { status: 'error'; message: string };

interface AuthApi {
  state: AuthState;
  /** The account when fully signed in, else null. */
  account: Account | null;
  signIn(email: string, password: string): Promise<void>;
  /** Resolves `needsConfirmation: true` when the project requires email confirmation first. */
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  claimUsername(username: string): Promise<void>;
  /** Re-fetch the account after an `error`. */
  retry(): void;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ supabase, children }: { supabase: SupabaseClient | null; children: ReactNode }) {
  const client = useGameClient();
  const [state, setState] = useState<AuthState>(supabase ? { status: 'loading' } : { status: 'disabled' });
  // Whose account we're showing; guards against a slow getMe() landing after a sign-out.
  const userRef = useRef<{ id: string; email: string | null } | null>(null);

  const loadAccount = useCallback(
    (user: { id: string; email: string | null }) => {
      setState({ status: 'loading' });
      client
        .getMe()
        .then((account) => {
          if (userRef.current?.id !== user.id) return;
          setState(account ? { status: 'signedIn', email: user.email, account } : { status: 'needsUsername', email: user.email });
        })
        .catch((e) => {
          if (userRef.current?.id === user.id) setState({ status: 'error', message: errorText(e) });
        });
    },
    [client],
  );

  useEffect(() => {
    if (!supabase) return;
    let initial = true;
    // Fires INITIAL_SESSION on subscribe, then on every sign-in/out and token refresh.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ? { id: session.user.id, email: session.user.email ?? null } : null;
      if (!initial && user?.id === userRef.current?.id) return; // token refresh: same user, nothing to reload
      initial = false;
      userRef.current = user;
      if (!user) return setState({ status: 'guest' });
      // Deferred: supabase-js holds its auth lock during this callback, and getMe() reads the session.
      setTimeout(() => loadAccount(user), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, loadAccount]);

  const api = useMemo<AuthApi>(() => {
    const need = () => {
      if (!supabase) throw new Error('Accounts are not enabled');
      return supabase;
    };
    return {
      state,
      account: state.status === 'signedIn' ? state.account : null,
      async signIn(email, password) {
        const { error } = await need().auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      },
      async signUp(email, password) {
        const { data, error } = await need().auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw new Error(error.message);
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        await need().auth.signOut();
      },
      async claimUsername(username) {
        const account = await client.claimUsername(username);
        const user = userRef.current;
        if (user) setState({ status: 'signedIn', email: user.email, account });
      },
      retry() {
        if (userRef.current) loadAccount(userRef.current);
      },
    };
  }, [state, supabase, client, loadAccount]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth() must be used inside <AuthProvider>');
  return auth;
}
