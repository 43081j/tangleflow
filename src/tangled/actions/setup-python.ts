import type { ActionConverter } from './types.js';
import type { Step as GitHubStep } from '../../github/types.js';
import { toBoolean } from './inputs.js';

/**
 * Map a `python-version` input, pinned or a range, onto a nixpkgs package.
 * Handles builds (pypy, graalpy), freethreading and ranges.
 */
function toNixPackage(
  pythonVersion: unknown,
  freethreaded: boolean | undefined,
): string {
  if (typeof pythonVersion !== 'string' && typeof pythonVersion !== 'number') {
    return 'python';
  }

  const pythonVersionString = String(pythonVersion);

  const implementation = /^(?<name>graalpy|pypy)-?(?<version>.*)$/.exec(
    pythonVersionString,
  )?.groups;

  // nixpkgs ships just a single graalpy package
  if (implementation?.name === 'graalpy') {
    return 'graalvmPackages.graalpy';
  }

  // pypy does not ship freethreading builds
  if (implementation?.name === 'pypy') {
    const match = /^(?<major>\d+)(?:\.(?<minor>\d+))?/.exec(
      implementation.version ?? '',
    );
    if (match?.groups) {
      const { major, minor = '' } = match.groups;
      return `pypy${major}${minor}`;
    }
    return 'python';
  }

  if (/[<>=~^|*]| - |\.x/.test(pythonVersionString)) {
    // * -> python
    if (pythonVersionString === '*') {
      return 'python';
    }

    // 3.x -> python3
    const wildcardMinor = /^(?<major>\d+)\.[x*]/.exec(pythonVersionString);
    if (wildcardMinor?.groups) {
      const { major } = wildcardMinor.groups;
      return `python${major}`;
    }

    // 3.12.x -> python312
    const wildcardPatch = /^(?<major>\d+)\.(?<minor>\d+)\.[x*]/.exec(
      pythonVersionString,
    );
    if (wildcardPatch?.groups) {
      const { major, minor } = wildcardPatch.groups;
      return `python${major}${minor}`;
    }

    // ^3.12.1 -> python3
    const caret = /^\^(?<major>\d+)/.exec(pythonVersionString);
    if (caret?.groups) {
      const { major } = caret.groups;
      return `python${major}`;
    }

    // ~3.12.2 -> python312
    const tilde = /^~(?<major>\d+)\.(?<minor>\d+)/.exec(pythonVersionString);
    if (tilde?.groups) {
      const { major, minor } = tilde.groups;
      return `python${major}${minor}`;
    }

    // >=3.9 <3.14 -> python313
    const upperBound = /<\s*(?<major>\d+)\.(?<minor>[1-9]\d*)/.exec(
      pythonVersionString,
    );
    if (upperBound?.groups) {
      const { major, minor } = upperBound.groups;
      return `python${major}${Number(minor) - 1}`;
    }

    // >=3.9 -> python
    if (
      /^>=?\s*\d/.test(pythonVersionString) &&
      !pythonVersionString.includes('<')
    ) {
      return 'python';
    }

    throw new Error(
      `Unsupported python-version range: "${pythonVersionString}"`,
    );
  }

  // pinned tags
  const match =
    /^(?<major>\d+)(?:\.(?<minor>\d+)(?:\.\d+)?(?<tSuffix>t)?)?/.exec(
      pythonVersionString,
    );
  if (match?.groups) {
    const { major, minor = '', tSuffix } = match.groups;
    const isFreeThreading = tSuffix !== undefined || freethreaded;
    return `python${major}${minor}${isFreeThreading ? 'FreeThreading' : ''}`;
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
