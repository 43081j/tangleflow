import { it, expect, describe } from 'vitest';
import { convertSetupNode } from './setup-node.js';

describe('setup-node', () => {
  it('converts no inputs to a nodejs nixpkgs dependency', () => {
    expect(convertSetupNode({})).toEqual({
      dependencies: { nixpkgs: ['nodejs'] },
    });
  });

  it('selects the matching nodejs major from node-version', () => {
    expect(convertSetupNode({ with: { 'node-version': 20 } })).toEqual({
      dependencies: { nixpkgs: ['nodejs_20'] },
    });
  });

  it('parses a major from a non-numeric node-version selector', () => {
    expect(convertSetupNode({ with: { 'node-version': '18.x' } })).toEqual({
      dependencies: { nixpkgs: ['nodejs_18'] },
    });
  });

  it('falls back to nodejs for an unparseable node-version', () => {
    expect(convertSetupNode({ with: { 'node-version': 'lts/*' } })).toEqual({
      dependencies: { nixpkgs: ['nodejs'] },
    });
  });
});
