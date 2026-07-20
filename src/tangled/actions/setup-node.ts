import type { ActionConverter } from './types.js';
import type { Step as GitHubStep } from '../../github/types.js';

/**
 * Extract the leading major version number from a GitHub action input, e.g.
 * `20`, `20.x` and `v20.1.0` all yield `20`. Non-numeric selectors such as
 * `lts/*` or `>=18` yield `undefined`.
 */
function majorVersion(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const match = /^\s*v?(\d+)/.exec(String(value));
  return match ? match[1] : undefined;
}

/**
 * Map `actions/setup-node` onto a `nodejs` nixpkgs dependency. A numeric
 * `node-version` selects the matching major package (e.g. `nodejs_20`);
 * anything else falls back to the default `nodejs`.
 */
export const convertSetupNode: ActionConverter = (step: GitHubStep) => {
  const major = majorVersion(step.with?.['node-version']);
  const pkg = major !== undefined ? `nodejs_${major}` : 'nodejs';
  return { dependencies: { nixpkgs: [pkg] } };
};
