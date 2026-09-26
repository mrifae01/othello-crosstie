import { useState, type FormEvent } from 'react';

const MAX = 24;

interface NameFormProps {
  label: string;
  submitLabel: string;
  busy?: boolean;
  /** Pre-fill with the last name used in this browser. Off for joining, where the last name is usually the opponent's (two tabs, one browser). */
  prefill?: boolean;
  onSubmit(name: string): void;
}

/** Display-name form. Mirrors the server's rule (trimmed, 1..24 chars) so obvious mistakes never round-trip. */
export function NameForm({ label, submitLabel, busy = false, prefill = true, onSubmit }: NameFormProps) {
  const [name, setName] = useState(() => (prefill ? localName() : ''));
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= MAX;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    rememberName(trimmed);
    onSubmit(trimmed);
  }

  return (
    <form className="name-form" onSubmit={submit}>
      <label>
        <span>{label}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX}
          placeholder="e.g. Ada"
          autoFocus
          autoComplete="nickname"
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
        {busy ? 'Working…' : submitLabel}
      </button>
    </form>
  );
}

// Pre-fill convenience only; never used for identity.
const NAME_KEY = 'othello:name';
function localName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}
