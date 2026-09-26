import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Lets a page veto in-app navigation away from it (e.g. leaving a live game) behind a
 * confirm dialog. The page registers a guard with useLeaveGuard(); navigation UI
 * outside the page (the header) asks through useLeave().
 */
export interface LeaveGuard {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Runs before leaving. Throw to stay on the page (the error has already been reported). */
  onConfirm(): Promise<void>;
}

interface LeaveGuardApi {
  setGuard(get: (() => LeaveGuard | null) | null): void;
  leave(go: () => void): void;
}

const Ctx = createContext<LeaveGuardApi | null>(null);

export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<(() => LeaveGuard | null) | null>(null);
  const [pending, setPending] = useState<{ guard: LeaveGuard; go: () => void } | null>(null);

  const api = useMemo<LeaveGuardApi>(
    () => ({
      setGuard: (g) => {
        guardRef.current = g;
      },
      leave: (go) => {
        // Snapshot at click time, so the dialog is unaffected if the page re-renders underneath it.
        const guard = guardRef.current?.() ?? null;
        if (guard) setPending({ guard, go });
        else go();
      },
    }),
    [],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {pending && (
        <ConfirmDialog
          guard={pending.guard}
          onCancel={() => setPending(null)}
          onConfirmed={() => {
            setPending(null);
            pending.go();
          }}
        />
      )}
    </Ctx.Provider>
  );
}

function ConfirmDialog({ guard, onCancel, onConfirmed }: { guard: LeaveGuard; onCancel(): void; onConfirmed(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  // Native modal dialog: focus trapping, Esc to close and a backdrop for free.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function confirm() {
    setBusy(true);
    try {
      await guard.onConfirm();
      onConfirmed();
    } catch {
      onCancel();
    }
  }

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="leave-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (e.target === ref.current && !busy) onCancel();
      }}
    >
      <h2 id="leave-title">{guard.title}</h2>
      <p className="muted">{guard.body}</p>
      <div className="modal-actions">
        {/* Safe choice first and focused by default. */}
        <button type="button" className="btn" onClick={onCancel} disabled={busy} autoFocus>
          {guard.cancelLabel}
        </button>
        <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>
          {busy ? 'Resigning…' : guard.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** Register `guard` while this component is mounted and `guard` is non-null. */
export function useLeaveGuard(guard: LeaveGuard | null) {
  const api = useContext(Ctx);
  if (!api) throw new Error('useLeaveGuard() must be used inside <LeaveGuardProvider>');
  // Keep the latest callbacks without re-registering on every render.
  const latest = useRef(guard);
  latest.current = guard;
  const active = guard !== null;
  useEffect(() => {
    if (!active) return;
    api.setGuard(() => latest.current);
    return () => api.setGuard(null);
  }, [api, active]);
}

/** Navigate away through the current guard, if any. */
export function useLeave(): (go: () => void) => void {
  const api = useContext(Ctx);
  if (!api) throw new Error('useLeave() must be used inside <LeaveGuardProvider>');
  return useCallback((go: () => void) => api.leave(go), [api]);
}
