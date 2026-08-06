import type { ActionConverter } from './types.js';
import type { Step as GitHubStep } from '../../github/types.js';
import { toBoolean } from './inputs.js';

/**
 * Map a `python-version` input onto a nixpkgs package, e.g. `3.12` yields
 * `python312`, `pypy3.11` yields `pypy311` and `3.14t` yields
 * `python314FreeThreading`. GraalPy maps to `graalvmPackages.graalpy`;
 */
function toNixPackage(
  value: unknown,
  freethreaded: boolean | undefined,
): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return 'python';
  }

  const asString = String(value);

  if (asString.includes('graalpy')) {
    return 'graalvmPackages.graalpy';
  }

  const match =
    /^(?:(?<implementation>pypy)-?)?(?<major>\d+)(?:\.(?<minor>\d+)(?:\.\d+)?(?<tSuffix>t)?)?/.exec(
      asString,
    );

  // pinned tags
  if (match?.groups) {
    const {
      implementation = 'python',
      major,
      minor = '',
      tSuffix,
    } = match.groups;
    // Free threading builds are only cpython
    const isFreeThreading =
      implementation === 'python' && (tSuffix !== undefined || freethreaded);
    return `${implementation}${major}${minor}${isFreeThreading ? 'FreeThreading' : ''}`;
  }

  return 'python';
}

/**
 * Map `actions/setup-python` onto a `python` nixpkgs dependency. A pinned
 * `python-version` selects the matching interpreter package; anything else
 * falls back to the default `python`.
 */
export const convertSetupPython: ActionConverter = (step: GitHubStep) => {
  const pkg = toNixPackage(
    step.with?.['python-version'],
    toBoolean(step.with?.['freethreaded']),
  );
  return { dependencies: { nixpkgs: [pkg] } };
};
