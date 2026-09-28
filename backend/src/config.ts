import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// One root .env serves the API and the web client. Never overrides variables already set.
try {
  process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'));
} catch {
  // No .env: defaults below.
}

export const PORT = Number(process.env.PORT ?? 3001);
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://othello:othello@localhost:5433/othello';
/** CA certificate (PEM, or a path to one) for TLS to hosted Postgres. Unset for local Docker. */
export const DATABASE_CA_CERT = process.env.DATABASE_CA_CERT ?? '';

/**
 * Browser origins allowed to call the API cross-origin (comma-separated), e.g. the deployed web app.
 * Unset locally: the Vite dev server proxies /api and /socket.io, so everything is same-origin.
 */
export const WEB_ORIGINS = (process.env.WEB_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

/**
 * Supabase Auth. Unset = accounts disabled and everyone plays as a guest.
 * Falls back to the web client's variable so a single value in .env configures both.
 */
export const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
/** Only for projects still on the legacy shared HS256 secret; asymmetric keys are verified via JWKS. */
export const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

/**
 * The AI coach (Claude). Unset = coach disabled: reviews keep the template coach, nothing else changes.
 * Server-side only; never exposed to the web client.
 */
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
/**
 * Sonnet, thinking off: the engine and the fact sheet do the reasoning, so the coach only has to
 * explain them faithfully. Haiku was cheaper but misread comparisons in the facts.
 */
export const COACH_MODEL = 'claude-sonnet-5';
