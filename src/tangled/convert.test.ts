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

    expect(result).toEqual({
      lint: { engine: 'nixery', steps: [{ command: 'npm run lint' }] },
      test: { engine: 'nixery', steps: [{ command: 'npm test' }] },
    });
  });

  it('produces one bare nixery workflow per job by default', () => {
    expect(convertWorkflow(workflow())).toEqual({
      build: { engine: 'nixery' },
    });
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
    ).toEqual({
      build: {
        engine: 'nixery',
        steps: [
          { command: 'npm test', name: 'Test', environment: { CI: 'true' } },
        ],
      },
    });
  });

  describe('working-directory', () => {
    it('prefixes run command with cd into the directory', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  { run: 'npm test', 'working-directory': 'packages/app' },
                ],
              },
            },
          }),
        ),
      ).toEqual({
        build: {
          engine: 'nixery',
          steps: [{ command: `cd 'packages/app' || exit 1\nnpm test` }],
        },
      });
    });

    it('quotes a directory containing spaces', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [{ run: 'make', 'working-directory': 'my app' }],
              },
            },
          }),
        ),
      ).toEqual({
        build: {
          engine: 'nixery',
          steps: [{ command: `cd 'my app' || exit 1\nmake` }],
        },
      });
    });
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
    ).toEqual({
      lint: {
        engine: 'nixery',
        steps: [{ command: 'npm run lint', name: 'lint' }],
      },
    });
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
    ).toEqual({ build: { engine: 'nixery' } });
  });

  it('drops job-level concurrency', () => {
    expect(
      convertWorkflow(
        workflow({
          jobs: { build: { 'runs-on': 'x', concurrency: 'ci' } },
        }),
      ),
    ).toEqual({ build: { engine: 'nixery' } });
  });

  it('drops a job-level name', () => {
    expect(
      convertWorkflow(
        workflow({
          jobs: { build: { 'runs-on': 'x', name: 'Lint' } },
        }),
      ),
    ).toEqual({ build: { engine: 'nixery' } });
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
    ).toEqual({
      build: { engine: 'nixery', steps: [{ command: 'npm test' }] },
    });
  });

  describe('permissions', () => {
    it('drops workflow-level permissions with no tangled equivalent', () => {
      expect(
        convertWorkflow(workflow({ permissions: { issues: 'read' } })),
      ).toEqual({ build: { engine: 'nixery' } });
    });

    it('drops an empty permissions map', () => {
      expect(convertWorkflow(workflow({ permissions: {} }))).toEqual({
        build: { engine: 'nixery' },
      });
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
      ).toEqual({ build: { engine: 'nixery' } });
    });
  });

  it('validates its input before converting', () => {
    expect(() =>
      convertWorkflow(workflow({ permissions: { contents: 'write' } })),
    ).toThrow('Unsupported permissions in workflow: "contents: write"');
  });

  describe('when', () => {
    it('maps a string trigger to a single constraint', () => {
      expect(convertWorkflow(workflow({ on: 'push' }))).toEqual({
        build: { engine: 'nixery', when: [{ event: 'push' }] },
      });
    });

    it('maps workflow_dispatch to manual', () => {
      expect(convertWorkflow(workflow({ on: 'workflow_dispatch' }))).toEqual({
        build: { engine: 'nixery', when: [{ event: 'manual' }] },
      });
    });

    it('drops a string trigger tangled does not understand', () => {
      expect(convertWorkflow(workflow({ on: 'schedule' }))).toEqual({
        build: { engine: 'nixery' },
      });
    });

    it('maps an array of triggers, dropping unknown ones', () => {
      expect(
        convertWorkflow(
          workflow({ on: ['push', 'schedule', 'workflow_dispatch'] }),
        ),
      ).toEqual({
        build: {
          engine: 'nixery',
          when: [{ event: 'push' }, { event: 'manual' }],
        },
      });
    });

    it('maps an object trigger with no config to bare constraints', () => {
      expect(
        convertWorkflow(workflow({ on: { push: null, pull_request: null } })),
      ).toEqual({
        build: {
          engine: 'nixery',
          when: [{ event: 'push' }, { event: 'pull_request' }],
        },
      });
    });

    it('drops object-trigger events tangled does not understand', () => {
      expect(
        convertWorkflow(
          workflow({ on: { push: null, schedule: [{ cron: '0 0 * * *' }] } }),
        ),
      ).toEqual({ build: { engine: 'nixery', when: [{ event: 'push' }] } });
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
      ).toEqual({
        build: {
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
      });
    });

    it('ignores empty filter arrays', () => {
      expect(
        convertWorkflow(workflow({ on: { push: { branches: [] } } })),
      ).toEqual({ build: { engine: 'nixery', when: [{ event: 'push' }] } });
    });
  });

  describe('environment', () => {
    it('omits environment when env is absent', () => {
      expect(convertWorkflow(workflow())).toEqual({
        build: { engine: 'nixery' },
      });
    });

    it('maps env to environment', () => {
      expect(
        convertWorkflow(workflow({ env: { FOO: 'bar', BAZ: 'qux' } })),
      ).toEqual({
        build: { engine: 'nixery', environment: { FOO: 'bar', BAZ: 'qux' } },
      });
    });

    it('stringifies non-string env values', () => {
      expect(
        convertWorkflow(
          workflow({ env: { COUNT: 3, FLAG: true } as GitHubWorkflow['env'] }),
        ),
      ).toEqual({
        build: { engine: 'nixery', environment: { COUNT: '3', FLAG: 'true' } },
      });
    });

    it('drops a string env expression that cannot be represented as a map', () => {
      expect(
        convertWorkflow(workflow({ env: '${{ fromJSON(env.VARS) }}' })),
      ).toEqual({ build: { engine: 'nixery' } });
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
      ).toEqual({
        build: {
          engine: 'nixery',
          steps: [{ command: 'npm test' }],
          dependencies: { nixpkgs: ['nodejs'] },
        },
      });
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
      ).toEqual({ build: { engine: 'nixery', clone: { depth: 0 } } });
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
      ).toEqual({
        build: { engine: 'nixery', dependencies: { nixpkgs: ['nodejs'] } },
      });
    });

    it('inserts action-contributed steps at the position of their uses step', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              build: {
                steps: [
                  { run: 'echo before' },
                  { uses: 'actions/checkout@v4' },
                  {
                    uses: 'pnpm/action-setup@v6',
                    with: { version: 11, run_install: true },
                  },
                  { run: 'pnpm test' },
                ],
              },
            },
          }),
        ),
      ).toEqual({
        build: {
          engine: 'nixery',
          steps: [
            { command: 'echo before' },
            { command: 'pnpm install --recursive' },
            { command: 'pnpm test' },
          ],
          dependencies: { nixpkgs: ['pnpm_11'] },
        },
      });
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

  describe('strategy', () => {
    it('converts a matrix into individual workflows', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              test: {
                strategy: { matrix: { version: [1, 2] } },
                steps: [
                  {
                    name: 'run_with_version_${{ matrix.version }}',
                    'working-directory': 'projects/${{ matrix.version }}',
                    run: 'echo ${{matrix.version}}',
                    env: { version: '${{ matrix.version }}' },
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual({
        'matrix-test-1': {
          engine: 'nixery',
          steps: [
            {
              name: 'run_with_version_1',
              command: `cd 'projects/1' || exit 1\necho 1`,
              environment: { version: '1' },
            },
          ],
        },
        'matrix-test-2': {
          engine: 'nixery',
          steps: [
            {
              name: 'run_with_version_2',
              command: `cd 'projects/2' || exit 1\necho 2`,
              environment: { version: '2' },
            },
          ],
        },
      });
    });

    it('converts a matrix with an object value', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              test: {
                strategy: {
                  matrix: {
                    config: [
                      { name: 'project_one', language: 'js' },
                      { name: 'project_two', language: 'ts' },
                    ],
                  },
                },
                steps: [
                  {
                    name: 'echo',
                    run: 'echo ${{ matrix.config.name }}-${{ matrix.config.language }}',
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual({
        'matrix-test-1': {
          engine: 'nixery',
          steps: [{ name: 'echo', command: `echo project_one-js` }],
        },
        'matrix-test-2': {
          engine: 'nixery',
          steps: [{ name: 'echo', command: `echo project_two-ts` }],
        },
      });
    });

    it('converts a matrix with exclude', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              test: {
                strategy: {
                  matrix: {
                    os: ['linux', 'macos'],
                    version: [1, 2, 3],
                    exclude: [{ os: 'linux', version: 1 }, { os: 'macos' }],
                  },
                },
                steps: [
                  {
                    name: 'echo',
                    run: 'echo ${{ matrix.os }}-${{ matrix.version }}',
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual({
        'matrix-test-1': {
          engine: 'nixery',
          steps: [{ name: 'echo', command: 'echo linux-2' }],
        },
        'matrix-test-2': {
          engine: 'nixery',
          steps: [{ name: 'echo', command: 'echo linux-3' }],
        },
      });
    });

    it('converts a matrix that excludes object values', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              test: {
                strategy: {
                  matrix: {
                    config: [
                      { name: 'a', lang: 'js' },
                      { name: 'b', lang: 'ts' },
                      { name: 'c', lang: 'py' },
                    ],
                    exclude: [
                      { config: { name: 'a', lang: 'js' } },
                      { config: { name: 'b' } },
                    ],
                  },
                },
                steps: [{ run: 'echo ${{ matrix.config.name }}' }],
              },
            },
          }),
        ),
      ).toEqual({
        'matrix-test-1': {
          engine: 'nixery',
          steps: [{ command: 'echo c' }],
        },
      });
    });

    // it('converts a matrix with include', () => {
    //   expect(
    //     convertWorkflow(
    //       workflow({
    //         jobs: {
    //           test: {
    //             strategy: {
    //               matrix: {
    //                 config: [
    //                   { name: 'project_one', language: 'js' },
    //                   { name: 'project_two', language: 'ts' },
    //                 ],
    //                 include: {}
    //               },
    //             },
    //             steps: [
    //               {
    //                 name: 'echo',
    //                 run: 'echo ${{ matrix.config.name }}-${{ matrix.config.language }}',
    //               },
    //             ],
    //           },
    //         },
    //       }),
    //     ),
    //   ).toEqual([]);
    // });

    it('interpolates matrix values into action inputs', () => {
      expect(
        convertWorkflow(
          workflow({
            jobs: {
              test: {
                strategy: { matrix: { node: [20, 22] } },
                steps: [
                  {
                    uses: 'actions/setup-node@v4',
                    with: { 'node-version': '${{ matrix.node }}' },
                  },
                ],
              },
            },
          }),
        ),
      ).toEqual({
        'matrix-test-1': {
          engine: 'nixery',
          dependencies: { nixpkgs: ['nodejs_20'] },
        },
        'matrix-test-2': {
          engine: 'nixery',
          dependencies: { nixpkgs: ['nodejs_22'] },
        },
      });
    });

    // TODO: include/exclude

    it('throws when a job depends on a matrix job', () => {
      expect(() =>
        convertWorkflow(
          workflow({
            jobs: {
              'matrix-job': {
                strategy: {
                  matrix: { version: [1, 2] },
                },
                steps: [{ run: 'echo ${{matrix.version}}' }],
              },
              'depends-on-matrix': {
                needs: ['matrix-job'],
                steps: [{ run: 'echo "hello world"' }],
              },
            },
          }),
        ),
      ).toThrow('A job depending on a matrix job cannot be converted');
    });

    it('throws when a matrix job depends on another job', () => {
      expect(() =>
        convertWorkflow(
          workflow({
            jobs: {
              foo: {
                steps: [{ run: 'echo "hello world"' }],
              },
              'matrix-job': {
                needs: ['foo'],
                strategy: {
                  matrix: { version: [1, 2] },
                },
                steps: [{ run: 'echo ${{matrix.version}}' }],
              },
            },
          }),
        ),
      ).toThrow('A matrix job that depends on other jobs cannot be converted');
    });

    it('throws when a matrix is a template expression', () => {
      expect(() =>
        convertWorkflow(
          workflow({
            jobs: {
              'matrix-job': {
                strategy: {
                  matrix: '${{ fromJSON(vars.TEST_MATRIX) }}',
                },
                steps: [{ run: 'echo ${{matrix.version}}' }],
              },
            },
          }),
        ),
      ).toThrow('Cannot convert templated matrix expression');
    });

    it('throws when a matrix key is a template expression', () => {
      expect(() =>
        convertWorkflow(
          workflow({
            jobs: {
              'matrix-job': {
                strategy: {
                  matrix: {
                    version: '${{ fromJSON(vars.VERSIONS) }}',
                  },
                },
                steps: [{ run: 'echo ${{matrix.version}}' }],
              },
            },
          }),
        ),
      ).toThrow('Cannot convert templated matrix key');
    });

    it('throws on a matrix expression it cannot interpolate', () => {
      expect(() =>
        convertWorkflow(
          workflow({
            jobs: {
              test: {
                strategy: { matrix: { os: ['linux'] } },
                steps: [{ run: "echo ${{ matrix['os'] }}" }],
              },
            },
          }),
        ),
      ).toThrow("Cannot convert matrix expression: ${{ matrix['os'] }}");
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
