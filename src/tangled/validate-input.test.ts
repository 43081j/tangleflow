import { describe, it, expect } from 'vitest';
import { validateInput } from './validate-input.js';
import type { HttpsJsonSchemastoreOrgGithubWorkflowJson as GitHubWorkflow } from '../github/types.js';

function workflow(overrides: Record<string, unknown> = {}): GitHubWorkflow {
  return {
    on: {},
    jobs: { build: { 'runs-on': 'ubuntu-latest' } },
    ...overrides,
  } as GitHubWorkflow;
}

describe('validateInput', () => {
  it('accepts a workflow using only convertible keys', () => {
    expect(() =>
      validateInput(
        workflow({
          name: 'CI',
          on: { push: { branches: ['main'] } },
          env: { CI: 'true' },
          permissions: { contents: 'read' },
          concurrency: { group: 'ci' },
          jobs: {
            build: {
              name: 'Build',
              'runs-on': 'ubuntu-latest',
              needs: ['lint'],
              'timeout-minutes': 10,
              steps: [
                { uses: 'actions/checkout@v4' },
                { run: 'make', name: 'Build', env: { A: 'b' } },
              ],
            },
          },
        }),
      ),
    ).not.toThrow();
  });

  it('accepts a job with no steps', () => {
    expect(() => validateInput(workflow())).not.toThrow();
  });

  describe('workflow keys', () => {
    it('throws on an unknown workflow key rather than dropping it', () => {
      expect(() => validateInput(workflow({ defaults: {} }))).toThrow(
        'Unsupported key "defaults" in workflow',
      );
    });
  });

  describe('job keys', () => {
    it('throws on an unknown job key rather than dropping it', () => {
      expect(() =>
        validateInput(
          workflow({ jobs: { build: { 'runs-on': 'x', outputs: {} } } }),
        ),
      ).toThrow('Unsupported key "outputs" in job "build"');
    });

    it('names the offending job', () => {
      expect(() =>
        validateInput(
          workflow({
            jobs: {
              lint: { 'runs-on': 'x' },
              test: { 'runs-on': 'x', strategy: { matrix: {} } },
            },
          }),
        ),
      ).toThrow('Unsupported key "strategy" in job "test"');
    });

    it('throws on a reusable workflow call', () => {
      expect(() =>
        validateInput(
          workflow({ jobs: { build: { uses: './.github/workflows/re.yml' } } }),
        ),
      ).toThrow(
        'Unsupported job "build": reusable workflow calls have no tangled equivalent',
      );
    });
  });

  describe('permissions', () => {
    it('accepts read grants', () => {
      expect(() =>
        validateInput(workflow({ permissions: { contents: 'read' } })),
      ).not.toThrow();
    });

    it('accepts an empty permissions map', () => {
      expect(() => validateInput(workflow({ permissions: {} }))).not.toThrow();
    });

    it('throws on contents: write', () => {
      expect(() =>
        validateInput(workflow({ permissions: { contents: 'write' } })),
      ).toThrow('Unsupported permissions in workflow: "contents: write"');
    });

    it('throws on id-token: write', () => {
      expect(() =>
        validateInput(workflow({ permissions: { 'id-token': 'write' } })),
      ).toThrow('Unsupported permissions in workflow: "id-token: write"');
    });

    it('throws on write-all', () => {
      expect(() =>
        validateInput(workflow({ permissions: 'write-all' })),
      ).toThrow('Unsupported permissions in workflow: write access');
    });

    it('throws on job-level write grants', () => {
      expect(() =>
        validateInput(
          workflow({
            jobs: {
              build: { 'runs-on': 'x', permissions: { contents: 'write' } },
            },
          }),
        ),
      ).toThrow('Unsupported permissions in job "build": "contents: write"');
    });
  });

  describe('steps', () => {
    it('throws on an unknown step key rather than dropping it', () => {
      expect(() =>
        validateInput(
          workflow({
            jobs: { build: { steps: [{ run: 'make', shell: 'bash' }] } },
          }),
        ),
      ).toThrow('Unsupported key "shell" in step');
    });

    it('throws on a step with no run command', () => {
      expect(() =>
        validateInput(
          workflow({ jobs: { build: { steps: [{ name: 'x' }] } } }),
        ),
      ).toThrow('Unsupported step: a `run` command is required');
    });

    it('leaves uses steps to their action converter', () => {
      expect(() =>
        validateInput(
          workflow({
            jobs: {
              build: {
                steps: [
                  { uses: 'actions/checkout@v4', with: { 'fetch-depth': 0 } },
                ],
              },
            },
          }),
        ),
      ).not.toThrow();
    });

    it('validates the steps of every job', () => {
      expect(() =>
        validateInput(
          workflow({
            jobs: {
              lint: { steps: [{ run: 'npm run lint' }] },
              test: { steps: [{ run: 'npm test', 'working-directory': '.' }] },
            },
          }),
        ),
      ).toThrow('Unsupported key "working-directory" in step');
    });
  });
});
