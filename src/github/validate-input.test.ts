import { describe, it, expect } from 'vitest';
import { validateInput } from './validate-input.js';
import type { Workflow } from '../tangled/types.js';

function nixery(overrides: Partial<Workflow> = {}): Workflow {
  return { engine: 'nixery', ...overrides } as Workflow;
}

function microvm(overrides: Partial<Workflow> = {}): Workflow {
  return { engine: 'microvm', ...overrides } as Workflow;
}

describe('validateInput', () => {
  it('accepts a workflow using only convertible keys', () => {
    expect(() =>
      validateInput(
        nixery({
          when: [{ event: 'push', branch: 'main' }],
          environment: { CI: 'true' },
          dependencies: { nixpkgs: ['nodejs_20'] },
          steps: [{ command: 'make', name: 'build', environment: { A: 'b' } }],
        }),
      ),
    ).not.toThrow();
  });

  it('accepts a workflow with no steps', () => {
    expect(() => validateInput(nixery())).not.toThrow();
  });

  describe('workflow keys', () => {
    it('throws on an unknown workflow key rather than dropping it', () => {
      expect(() => validateInput(microvm({ image: 'debian' }))).toThrow(
        'Unsupported key "image" in workflow',
      );
    });

    it('throws on a microvm-only key with no GitHub equivalent', () => {
      expect(() => validateInput(microvm({ services: { db: {} } }))).toThrow(
        'Unsupported key "services" in workflow',
      );
    });

    it('throws on clone options, which GitHub checkout does not model here', () => {
      expect(() => validateInput(nixery({ clone: { skip: true } }))).toThrow(
        'Unsupported key "clone" in workflow',
      );
    });
  });

  describe('step keys', () => {
    it('throws on an unknown step key rather than dropping it', () => {
      expect(() =>
        validateInput(
          nixery({ steps: [{ command: 'make', shell: 'bash' } as never] }),
        ),
      ).toThrow('Unsupported key "shell" in step');
    });

    it('validates every step, not just the first', () => {
      expect(() =>
        validateInput(
          nixery({
            steps: [
              { command: 'make' },
              { command: 'test', when: [] } as never,
            ],
          }),
        ),
      ).toThrow('Unsupported key "when" in step');
    });
  });
});
