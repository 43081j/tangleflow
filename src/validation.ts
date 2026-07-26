/**
 * Helpers shared by the per-format input validators.
 */

/**
 * Throw if `value` has any key not listed in `known`. `context` labels the
 * offending location in the error message.
 */
export function assertKnownKeys<T extends object>(
  value: T,
  known: Set<keyof T>,
  context: string,
): void {
  for (const key of Object.keys(value)) {
    if (!known.has(key as keyof T)) {
      throw new Error(`Unsupported ${context} key: ${key}`);
    }
  }
}
