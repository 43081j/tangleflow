import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { convertWorkflow } from './convert.js';
import type { HttpsJsonSchemastoreOrgGithubWorkflowJson as GitHubWorkflow } from '../github/types.js';

const fixturesDir = fileURLToPath(
  new URL('../../test/fixtures', import.meta.url),
);

function workflow(overrides: Record<string, unknown> = {}): GitHubWorkflow {
  return {
    on: {},
    jobs: { build: { 'runs-on': 'ubuntu-latest' } },
    ...overrides,
  } as GitHubWorkflow;
}

describe('convertWorkflow', () => {
  it('maps each job to its own workflow', () => {
    const result = convertWorkflow(
      workflow({
        jobs: {
          lint: { steps: [{ run: 'npm run lint' }] },
          test: { steps: [{ run: 'npm test' }] },
        },
      }),
    );

    expect(result).toEqual([
      { engine: 'nixery', steps: [{ command: 'npm run lint' }] },
      { engine: 'nixery', steps: [{ command: 'npm test' }] },
    ]);
  });

  it('produces one bare nixery workflow per job by default', () => {
    expect(convertWorkflow(workflow())).toEqual([{ engine: 'nixery' }]);
  });

  it('retains step names and environment', () => {
    expect(
      convertWorkflow(
        workflow({
          jobs: {
            build: {
              steps: [{ name: 'Test', run: 'npm test', env: { CI: 'true' } }],
            },
          },
        }),
      ),
    ).toEqual([
      {
        engine: 'nixery',
        steps: [
          { command: 'npm test', name: 'Test', environment: { CI: 'true' } },
        ],
      },
    ]);
  });

  it('throws on job dependencies, which have no tangled equivalent', () => {
    expect(() =>
      convertWorkflow(
        workflow({ jobs: { build: { needs: ['lint'], steps: [] } } }),
      ),
    ).toThrow('Unsupported job "build" key: needs');
  });

  it('drops workflow-level concurrency', () => {
    expect(
      convertWorkflow(
        workflow({
          concurrency: {
            group: 'ci-${{ github.ref }}',
            'cancel-in-progress': true,
          },
        }),
      ),
    ).toEqual([{ engine: 'nixery' }]);
  });

  it('drops job-level concurrency', () => {
    expect(
      convertWorkflow(
        workflow({
          jobs: { build: { 'runs-on': 'x', concurrency: 'ci' } },
        }),
      ),
    ).toEqual([{ engine: 'nixery' }]);
  });

  it('drops a job-level name', () => {
    expect(
      convertWorkflow(
        workflow({
          jobs: { build: { 'runs-on': 'x', name: 'Lint' } },
        }),
      ),
    ).toEqual([{ engine: 'nixery' }]);
  });

  it('drops timeout-minutes on jobs and steps', () => {
    expect(
      convertWorkflow(
        workflow({
          jobs: {
            build: {
              'runs-on': 'x',
              'timeout-minutes': 10,
              steps: [{ run: 'npm test', 'timeout-minutes': 5 }],
            },
          },
        }),
      ),
    ).toEqual([{ engine: 'nixery', steps: [{ command: 'npm test' }] }]);
  });

  describe('permissions', () => {
    it('drops workflow-level permissions with no tangled equivalent', () => {
      expect(
        convertWorkflow(workflow({ permissions: { issues: 'read' } })),
      ).toEqual([{ engine: 'nixery' }]);
    });

    it('drops an empty permissions map', () => {
      expect(convertWorkflow(workflow({ permissions: {} }))).toEqual([
        { engine: 'nixery' },
      ]);
    });

    it('drops job-level permissions with no tangled equivalent', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: { 'runs-on': 'x', permissions: { issues: 'read' } },
            },
          }),
        ),
      ).toEqual([{ engine: 'nixery' }]);
    });

    it('throws on contents: write', () => {
      expect(() =>
        convertWorkflow(workflow({ permissions: { contents: 'write' } })),
      ).toThrow('Unsupported workflow permissions: "contents: write"');
    });

    it('throws on id-token: write', () => {
      expect(() =>
        convertWorkflow(workflow({ permissions: { 'id-token': 'write' } })),
      ).toThrow('Unsupported workflow permissions: "id-token: write"');
    });

    it('throws on write-all', () => {
      expect(() =>
        convertWorkflow(workflow({ permissions: 'write-all' })),
      ).toThrow('Unsupported workflow permissions: write access');
    });

    it('throws on job-level write grants', () => {
      expect(() =>
        convertWorkflow(
          workflow({
            jobs: {
              build: { 'runs-on': 'x', permissions: { contents: 'write' } },
            },
          }),
        ),
      ).toThrow('Unsupported job "build" permissions: "contents: write"');
    });
  });

  describe('when', () => {
    it('maps a string trigger to a single constraint', () => {
      expect(convertWorkflow(workflow({ on: 'push' }))).toEqual([
        { engine: 'nixery', when: [{ event: 'push' }] },
      ]);
    });

    it('maps workflow_dispatch to manual', () => {
      expect(convertWorkflow(workflow({ on: 'workflow_dispatch' }))).toEqual([
        { engine: 'nixery', when: [{ event: 'manual' }] },
      ]);
    });

    it('drops a string trigger tangled does not understand', () => {
      expect(convertWorkflow(workflow({ on: 'schedule' }))).toEqual([
        { engine: 'nixery' },
      ]);
    });

    it('maps an array of triggers, dropping unknown ones', () => {
      expect(
        convertWorkflow(
          workflow({ on: ['push', 'schedule', 'workflow_dispatch'] }),
        ),
      ).toEqual([
        { engine: 'nixery', when: [{ event: 'push' }, { event: 'manual' }] },
      ]);
    });

    it('maps an object trigger with no config to bare constraints', () => {
      expect(
        convertWorkflow(workflow({ on: { push: null, pull_request: null } })),
      ).toEqual([
        {
          engine: 'nixery',
          when: [{ event: 'push' }, { event: 'pull_request' }],
        },
      ]);
    });

    it('drops object-trigger events tangled does not understand', () => {
      expect(
        convertWorkflow(
          workflow({ on: { push: null, schedule: [{ cron: '0 0 * * *' }] } }),
        ),
      ).toEqual([{ engine: 'nixery', when: [{ event: 'push' }] }]);
    });

    it('maps branches, tags and paths filters to tangled fields', () => {
      expect(
        convertWorkflow(
          workflow({
            on: {
              push: {
                branches: ['main'],
                tags: ['v1'],
                paths: ['src/**'],
              },
            },
          }),
        ),
      ).toEqual([
        {
          engine: 'nixery',
          when: [
            {
              event: 'push',
              branch: ['main'],
              tag: ['v1'],
              paths: ['src/**'],
            },
          ],
        },
      ]);
    });

    it('ignores empty filter arrays', () => {
      expect(
        convertWorkflow(workflow({ on: { push: { branches: [] } } })),
      ).toEqual([{ engine: 'nixery', when: [{ event: 'push' }] }]);
    });
  });

  describe('environment', () => {
    it('omits environment when env is absent', () => {
      expect(convertWorkflow(workflow())).toEqual([{ engine: 'nixery' }]);
    });

    it('maps env to environment', () => {
      expect(
        convertWorkflow(workflow({ env: { FOO: 'bar', BAZ: 'qux' } })),
      ).toEqual([
        { engine: 'nixery', environment: { FOO: 'bar', BAZ: 'qux' } },
      ]);
    });

    it('stringifies non-string env values', () => {
      expect(
        convertWorkflow(
          workflow({ env: { COUNT: 3, FLAG: true } as GitHubWorkflow['env'] }),
        ),
      ).toEqual([
        { engine: 'nixery', environment: { COUNT: '3', FLAG: 'true' } },
      ]);
    });

    it('drops a string env expression that cannot be represented as a map', () => {
      expect(
        convertWorkflow(workflow({ env: '${{ fromJSON(env.VARS) }}' })),
      ).toEqual([{ engine: 'nixery' }]);
    });
  });

  describe('uses', () => {
    it('converts actions/setup-node to a nodejs nixpkgs dependency', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: { build: { steps: [{ uses: 'actions/setup-node@v4' }] } },
          }),
        ),
      ).toEqual([{ engine: 'nixery', dependencies: { nixpkgs: ['nodejs'] } }]);
    });

    it('selects the matching nodejs major from node-version', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  {
                    uses: 'actions/setup-node@v4',
                    with: { 'node-version': 20 },
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual([
        { engine: 'nixery', dependencies: { nixpkgs: ['nodejs_20'] } },
      ]);
    });

    it('parses a major from a non-numeric node-version selector', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  {
                    uses: 'actions/setup-node@v4',
                    with: { 'node-version': '18.x' },
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual([
        { engine: 'nixery', dependencies: { nixpkgs: ['nodejs_18'] } },
      ]);
    });

    it('falls back to nodejs for an unparseable node-version', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  {
                    uses: 'actions/setup-node@v4',
                    with: { 'node-version': 'lts/*' },
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual([{ engine: 'nixery', dependencies: { nixpkgs: ['nodejs'] } }]);
    });

    it('keeps run steps alongside dependencies from uses steps', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [{ uses: 'actions/setup-node@v4' }, { run: 'npm test' }],
              },
            },
          }),
        ),
      ).toEqual([
        {
          engine: 'nixery',
          steps: [{ command: 'npm test' }],
          dependencies: { nixpkgs: ['nodejs'] },
        },
      ]);
    });

    it('deduplicates dependencies contributed by repeated actions', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  { uses: 'actions/setup-node@v4' },
                  { uses: 'actions/setup-node@v3' },
                ],
              },
            },
          }),
        ),
      ).toEqual([{ engine: 'nixery', dependencies: { nixpkgs: ['nodejs'] } }]);
    });

    it('converts actions/checkout with no inputs to no clone config', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: { build: { steps: [{ uses: 'actions/checkout@v4' }] } },
          }),
        ),
      ).toEqual([{ engine: 'nixery' }]);
    });

    it('maps checkout fetch-depth, submodules and fetch-tags to clone', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  {
                    uses: 'actions/checkout@v4',
                    with: {
                      'fetch-depth': 0,
                      submodules: true,
                      'fetch-tags': false,
                    },
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual([
        {
          engine: 'nixery',
          clone: { depth: 0, submodules: true, tags: false },
        },
      ]);
    });

    it('reads string-form checkout inputs', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  {
                    uses: 'actions/checkout@v4',
                    with: { 'fetch-depth': '1', submodules: 'false' },
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual([{ engine: 'nixery', clone: { depth: 1, submodules: false } }]);
    });

    it('treats recursive submodules as a submodule clone', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  {
                    uses: 'actions/checkout@v4',
                    with: { submodules: 'recursive' },
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual([{ engine: 'nixery', clone: { submodules: true } }]);
    });

    it('ignores unparseable checkout inputs', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  {
                    uses: 'actions/checkout@v4',
                    with: { 'fetch-depth': 'shallow' },
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual([{ engine: 'nixery' }]);
    });

    it('throws on an unknown action', () => {
      expect(() =>
        convertWorkflow(
          workflow({
            jobs: { build: { steps: [{ uses: 'some/unknown-action@v1' }] } },
          }),
        ),
      ).toThrow('Unsupported action: some/unknown-action@v1');
    });
  });

  describe('fixtures', () => {
    const fixtures = readdirSync(fixturesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    it.each(fixtures)('converts %s', (name) => {
      const source = readFileSync(`${fixturesDir}/${name}/github.yml`, 'utf8');
      const input = parse(source) as GitHubWorkflow;

      let result: unknown;
      try {
        result = convertWorkflow(input);
      } catch (error) {
        result = { error: (error as Error).message };
      }

      expect(result).toMatchSnapshot();
    });
  });
});
