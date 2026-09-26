import { useState, type FormEvent } from 'react';

const MAX = 24;

interface NameFormProps {
  label: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit(name: string): void;
}

/** Display-name form. Mirrors the server's rule (trimmed, 1..24 chars) so obvious mistakes never round-trip. */
export function NameForm({ label, submitLabel, busy = false, onSubmit }: NameFormProps) {
  const [name, setName] = useState(() => localName());
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
