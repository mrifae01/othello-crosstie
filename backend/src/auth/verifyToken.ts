import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyOptions } from 'jose';
import { SUPABASE_JWT_SECRET, SUPABASE_URL } from '../config';

/** The authenticated caller, as asserted by a verified Supabase access token. */
export interface AuthUser {
  userId: string;
  email: string | null;
}

export const authEnabled = SUPABASE_URL !== '' || SUPABASE_JWT_SECRET !== '';

// Supabase signs with asymmetric keys published at the JWKS endpoint (fetched once, cached,
// refreshed on unknown `kid`), so verification is local: no round trip to Supabase per request.
const jwks = SUPABASE_URL ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)) : null;
const legacySecret = SUPABASE_JWT_SECRET ? new TextEncoder().encode(SUPABASE_JWT_SECRET) : null;

const options: JWTVerifyOptions = {
  audience: 'authenticated',
  ...(SUPABASE_URL ? { issuer: `${SUPABASE_URL}/auth/v1` } : {}),
};

/** Returns the user for a valid access token, or null for anything invalid, expired or unverifiable. */
export async function verifyAccessToken(token: string): Promise<AuthUser | null> {
  try {
    const isLegacy = decodeProtectedHeader(token).alg === 'HS256';
    let payload;
    if (isLegacy && legacySecret) ({ payload } = await jwtVerify(token, legacySecret, options));
    else if (!isLegacy && jwks) ({ payload } = await jwtVerify(token, jwks, options));
    else return null;
    if (typeof payload.sub !== 'string') return null;
    return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
  } catch {
    return null;
  }
}
