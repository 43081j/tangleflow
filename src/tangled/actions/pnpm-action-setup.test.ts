import { describe, it, expect } from 'vitest';
import { convertPnpmActionSetup } from './pnpm-action-setup.js';

describe('convertPnpmActionSetup', () => {
  it('converts to a pnpm nixpkgs dependency', () => {
    expect(convertPnpmActionSetup({})).toEqual({
      dependencies: { nixpkgs: ['pnpm'] },
    });
  });

  it('selects the matching pnpm major from version', () => {
    expect(convertPnpmActionSetup({ with: { version: 11 } })).toEqual({
      dependencies: { nixpkgs: ['pnpm_11'] },
    });
  });

  it('parses the major from an exact version string', () => {
    expect(convertPnpmActionSetup({ with: { version: '11.7.0' } })).toEqual({
      dependencies: { nixpkgs: ['pnpm_11'] },
    });
  });

  it('falls back to pnpm for an unparseable version', () => {
    expect(convertPnpmActionSetup({ with: { version: 'latest' } })).toEqual({
      dependencies: { nixpkgs: ['pnpm'] },
    });
  });

  it('maps run_install=true to a recursive pnpm install step', () => {
    expect(
      convertPnpmActionSetup({ with: { version: 11, run_install: true } }),
    ).toEqual({
      dependencies: { nixpkgs: ['pnpm_11'] },
      steps: [{ command: 'pnpm install --recursive' }],
    });
  });

  it('runs install in the given cwd for an object run_install', () => {
    expect(
      convertPnpmActionSetup({ with: { run_install: 'cwd: one' } }),
    ).toEqual({
      dependencies: { nixpkgs: ['pnpm'] },
      steps: [{ command: 'pnpm install --dir one' }],
    });
  });

  it('parses a run_install array as arg correctly', () => {
    expect(
      convertPnpmActionSetup({
        with: { run_install: '- cwd: one\n- cwd: two' },
      }),
    ).toEqual({
      dependencies: { nixpkgs: ['pnpm'] },
      steps: [
        { command: 'pnpm install --dir one' },
        { command: 'pnpm install --dir two' },
      ],
    });
  });

  it('appends run_install args after install', () => {
    expect(
      convertPnpmActionSetup({
        with: { run_install: 'args: [--ignore-scripts]' },
      }),
    ).toEqual({
      dependencies: { nixpkgs: ['pnpm'] },
      steps: [{ command: 'pnpm install --ignore-scripts' }],
    });
  });

  it('throws on unsupported run_install input', () => {
    expect(() =>
      convertPnpmActionSetup({
        with: { run_install: 'unsupported' },
      }),
    ).toThrow('Unsupported run_install: "unsupported"');
  });
});
