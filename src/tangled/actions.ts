/**
 * Interpret a GitHub action boolean input, which may be a real boolean or its
 * string form. Returns `undefined` for anything else.
 */
export function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}
