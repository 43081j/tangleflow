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

  // TODO: ranges?
  //(for free threaded builds the 'freethreaded' input has to be explicitly used if you want to use ranges)
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
