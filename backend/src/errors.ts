import type { ErrorCode } from '@othello/shared';

/**
 * An expected failure that maps directly onto an `ErrorCode`: REST turns it into an ApiError
 * with the code's HTTP status, the socket layer into a `{ ok: false }` ack. Anything else thrown
 * is a bug and surfaces as INTERNAL.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
