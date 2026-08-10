import { describe, it, expect } from 'vitest';
import { convertSetupPython } from './setup-python.js';

describe('convertSetupPython', () => {
  it('converts to a python nixpkgs dependency', () => {
    expect(convertSetupPython({})).toEqual({
      dependencies: { nixpkgs: ['python'] },
    });
  });

  it('python-version only major', () => {
    expect(convertSetupPython({ with: { 'python-version': 3 } })).toEqual({
      dependencies: { nixpkgs: ['python3'] },
    });
  });

  it('converts to a pinned python nixpkgs dependency', () => {
    expect(convertSetupPython({ with: { 'python-version': 3.12 } })).toEqual({
      dependencies: { nixpkgs: ['python312'] },
    });
  });

  it('pinned python version with pre-release suffic', () => {
    expect(
      convertSetupPython({ with: { 'python-version': '3.12-dev' } }),
    ).toEqual({
      dependencies: { nixpkgs: ['python312'] },
    });
  });

  it('pypy version', () => {
    expect(
      convertSetupPython({ with: { 'python-version': 'pypy3.11' } }),
    ).toEqual({
      dependencies: { nixpkgs: ['pypy311'] },
    });
  });

  it('graalpy version', () => {
    expect(
      convertSetupPython({ with: { 'python-version': 'graalpy-24.0' } }),
    ).toEqual({
      dependencies: { nixpkgs: ['graalvmPackages.graalpy'] },
    });
  });

  it('freethreaded input', () => {
    expect(
      convertSetupPython({
        with: { 'python-version': '3.14', freethreaded: true },
      }),
    ).toEqual({ dependencies: { nixpkgs: ['python314FreeThreading'] } });
  });

  it("freethreaded semver'ish notation", () => {
    expect(
      convertSetupPython({
        with: { 'python-version': '3.14t' },
      }),
    ).toEqual({ dependencies: { nixpkgs: ['python314FreeThreading'] } });
  });

  it('maps a wildcard version to the floating python package', () => {
    expect(convertSetupPython({ with: { 'python-version': '3.x' } })).toEqual({
      dependencies: { nixpkgs: ['python3'] },
    });
  });

  it('maps a minor wildcard to the pinned minor', () => {
    expect(
      convertSetupPython({ with: { 'python-version': '3.12.x' } }),
    ).toEqual({ dependencies: { nixpkgs: ['python312'] } });
  });

  it('maps a caret range to the major package', () => {
    expect(
      convertSetupPython({ with: { 'python-version': '^3.12.1' } }),
    ).toEqual({ dependencies: { nixpkgs: ['python3'] } });
  });

  it('maps a tilde range to the pinned minor', () => {
    expect(
      convertSetupPython({ with: { 'python-version': '~3.12.2' } }),
    ).toEqual({ dependencies: { nixpkgs: ['python312'] } });
  });

  it('maps an unbounded range to the default python', () => {
    expect(
      convertSetupPython({ with: { 'python-version': '>= 3.9' } }),
    ).toEqual({ dependencies: { nixpkgs: ['python'] } });
  });

  it('maps a bounded range to the newest minor below the exclusive bound', () => {
    expect(
      convertSetupPython({ with: { 'python-version': '>=3.9 <3.14' } }),
    ).toEqual({ dependencies: { nixpkgs: ['python313'] } });
    expect(
      convertSetupPython({ with: { 'python-version': '>= 3.0 < 3.14' } }),
    ).toEqual({ dependencies: { nixpkgs: ['python313'] } });
  });

  it('throws on a hyphen range version', () => {
    expect(() =>
      convertSetupPython({
        with: { 'python-version': '3.13.0-alpha - 3.13.0' },
      }),
    ).toThrow('Unsupported python-version range: "3.13.0-alpha - 3.13.0"');
  });

  it.skip('python-version-file', () => {
    // TODO
  });

  it.skip('check-latest', () => {});

  it.skip('id', () => {});

  it.skip('update-environment', () => {});

  it.skip('allow-prereleases', () => {});

  it.skip('pip-version', () => {
    // pip-version (not availble w. PyPy or GraalPy)
  });

  it.skip('cache', () => {
    // "Registering problem matchers for error output" ?
  });
});
