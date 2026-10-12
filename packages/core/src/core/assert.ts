/** Error type thrown for every engine-level failure: invalid data or misuse of the API. */
export class RowanError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RowanError';
  }
}

/** Throws a {@link RowanError} when `condition` is falsy. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new RowanError(message);
  }
}

/** Returns a readable message for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
