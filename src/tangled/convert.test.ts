import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parse, stringify } from 'yaml';
import { convertWorkflow } from './convert.js';
import type { HttpsJsonSchemastoreOrgGithubWorkflowJson as GitHubWorkflow } from '../github/types.js';

const fixturesDir = fileURLToPath(
  new URL('../../test/fixtures/to-tangled', import.meta.url),
);

const fixtures = (await readdir(fixturesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

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

  it('collapses jobs linked by needs into one ordered workflow', () => {
    expect(
      convertWorkflow(
        workflow({
          jobs: {
            build: { 'runs-on': 'ubuntu-latest', needs: ['lint'] },
            lint: {
              'runs-on': 'ubuntu-latest',
              steps: [{ run: 'npm run lint' }],
            },
          },
        }),
      ),
    ).toEqual([
      {
        engine: 'nixery',
        steps: [{ command: 'npm run lint', name: 'lint' }],
      },
    ]);
  });

  it('throws when jobs linked by needs run on different runners', () => {
    expect(() =>
      convertWorkflow(
        workflow({
          jobs: {
            lint: { 'runs-on': 'ubuntu-latest', steps: [] },
            build: { 'runs-on': 'macos-latest', needs: ['lint'] },
          },
        }),
      ),
    ).toThrow(
      'Jobs linked by `needs` run on different runners and cannot be combined: lint, build',
    );
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
  });

  it('validates its input before converting', () => {
    expect(() =>
      convertWorkflow(workflow({ permissions: { contents: 'write' } })),
    ).toThrow('Unsupported permissions in workflow: "contents: write"');
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

    it('applies clone config contributed by a checkout step', () => {
      expect(
        convertWorkflow(
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
      ).toEqual([{ engine: 'nixery', clone: { depth: 0 } }]);
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
    it.each(fixtures)('converts %s', async (name) => {
      const dir = `${fixturesDir}/${name}`;
      const input = parse(
        await readFile(`${dir}/input.yml`, 'utf8'),
      ) as GitHubWorkflow;

      let output: string;
      let target: string;
      try {
        output = stringify(convertWorkflow(input), {
          aliasDuplicateObjects: false,
        });
        target = `${dir}/output.yml`;
      } catch (error) {
        output = `${(error as Error).message}\n`;
        target = `${dir}/error.txt`;
      }

      await expect(output).toMatchFileSnapshot(target);
    });
  });
});
