import type { Step as GitHubStep } from '../types.js';

/**
 * Map a `nodejs` nixpkgs package onto an `actions/setup-node` step.
 */
export function convertNodejs(
  registry: string,
  pkg: string,
): GitHubStep | undefined {
  if (registry !== 'nixpkgs') {
    return undefined;
  }

  const match = /^nodejs(?:_(\d+))?$/.exec(pkg);
  if (!match) {
    return undefined;
  }

  const step: GitHubStep = { uses: 'actions/setup-node@v4' };
  if (match[1] !== undefined) {
    step.with = { 'node-version': match[1] };
  }
  return step;
}
