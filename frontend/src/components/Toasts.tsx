import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  error(text: string): void;
  info(text: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);
const TTL_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextId.current++;
      // Keep at most 3 on screen.
      setToasts((ts) => [...ts.slice(-2), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), TTL_MS);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ error: (t) => push('error', t), info: (t) => push('info', t) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} title="Dismiss">
            {t.text}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToasts() must be used inside <ToastProvider>');
  return api;
}
