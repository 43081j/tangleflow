import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parse, stringify } from 'yaml';
import { convertWorkflow } from './convert.js';
import type { Workflow } from '../tangled/types.js';
import type { NormalJob } from './types.js';

const fixturesDir = fileURLToPath(
  new URL('../../test/fixtures/to-github', import.meta.url),
);

const fixtures = (await readdir(fixturesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function nixery(overrides: Partial<Workflow> = {}): Workflow {
  return { engine: 'nixery', ...overrides } as Workflow;
}

describe('convertWorkflow', () => {
  it('produces an empty jobs map and no triggers by default', () => {
    expect(convertWorkflow(nixery())).toEqual({ jobs: {}, on: {} });
  });

  describe('on', () => {
    it('maps tangled events to their GitHub equivalents', () => {
      const result = convertWorkflow(
        nixery({
          when: [
            { event: 'push' },
            { event: 'pull_request' },
            { event: 'manual' },
          ],
        }),
      );

      expect(result.on).toEqual({
        push: {},
        pull_request: {},
        workflow_dispatch: {},
      });
    });

    it('expands an array of events on a single constraint', () => {
      const result = convertWorkflow(
        nixery({ when: [{ event: ['push', 'pull_request'] }] }),
      );

      expect(result.on).toEqual({ push: {}, pull_request: {} });
    });

    it('drops constraints without an event', () => {
      const result = convertWorkflow(nixery({ when: [{ branch: 'main' }] }));

      expect(result.on).toEqual({});
    });

    it('maps branch, tag and paths filters to their GitHub keys', () => {
      const result = convertWorkflow(
        nixery({
          when: [
            {
              event: 'push',
              branch: 'main',
              tag: 'v1',
              paths: 'src/**',
            },
          ],
        }),
      );

      expect(result.on).toEqual({
        push: {
          branches: ['main'],
          tags: ['v1'],
          paths: ['src/**'],
        },
      });
    });

    it('preserves array filter values', () => {
      const result = convertWorkflow(
        nixery({
          when: [{ event: 'push', branch: ['main', 'dev'] }],
        }),
      );

      expect(result.on).toEqual({ push: { branches: ['main', 'dev'] } });
    });

    it('drops filters on events that do not accept them', () => {
      const result = convertWorkflow(
        nixery({
          when: [{ event: 'manual', branch: 'main', paths: 'src/**' }],
        }),
      );

      expect(result.on).toEqual({ workflow_dispatch: {} });
    });

    it('merges filters from multiple constraints targeting the same event', () => {
      const result = convertWorkflow(
        nixery({
          when: [
            { event: 'push', branch: 'main' },
            { event: 'push', branch: 'dev', tag: 'v1' },
          ],
        }),
      );

      expect(result.on).toEqual({
        push: {
          branches: ['main', 'dev'],
          tags: ['v1'],
        },
      });
    });

    it('deduplicates merged filter values', () => {
      const result = convertWorkflow(
        nixery({
          when: [
            { event: 'push', branch: ['main', 'dev'] },
            { event: 'push', branch: ['dev', 'release'] },
          ],
        }),
      );

      expect(result.on).toEqual({
        push: { branches: ['main', 'dev', 'release'] },
      });
    });
  });

  describe('env', () => {
    it('omits env when there is no environment', () => {
      expect(convertWorkflow(nixery())).not.toHaveProperty('env');
    });

    it('maps environment to workflow-level env', () => {
      const result = convertWorkflow(
        nixery({ environment: { FOO: 'bar', BAZ: 'qux' } }),
      );

      expect(result.env).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('copies the environment rather than referencing it', () => {
      const environment = { FOO: 'bar' };
      const result = convertWorkflow(nixery({ environment }));

      expect(result.env).not.toBe(environment);
    });
  });

  describe('steps', () => {
    it('produces an empty jobs map when there are no steps', () => {
      expect(convertWorkflow(nixery()).jobs).toEqual({});
      expect(convertWorkflow(nixery({ steps: [] })).jobs).toEqual({});
    });

    it('wraps steps in a single job on the default runner', () => {
      const result = convertWorkflow(nixery({ steps: [{ command: 'make' }] }));

      expect(result.jobs).toEqual({
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'make' }],
        },
      });
    });

    it('maps command, name and environment onto each step', () => {
      const result = convertWorkflow(
        nixery({
          steps: [
            { command: 'npm test', name: 'Test', environment: { CI: 'true' } },
          ],
        }),
      );

      expect((result.jobs.build as NormalJob).steps).toEqual([
        { run: 'npm test', name: 'Test', env: { CI: 'true' } },
      ]);
    });

    it('preserves step order', () => {
      const result = convertWorkflow(
        nixery({
          steps: [{ command: 'a' }, { command: 'b' }, { command: 'c' }],
        }),
      );

      expect((result.jobs.build as NormalJob).steps).toEqual([
        { run: 'a' },
        { run: 'b' },
        { run: 'c' },
      ]);
    });

    it('omits name and env when the step has neither', () => {
      const result = convertWorkflow(nixery({ steps: [{ command: 'make' }] }));
      const step = (result.jobs.build as NormalJob).steps![0];

      expect(step).not.toHaveProperty('name');
      expect(step).not.toHaveProperty('env');
    });

    it('copies step environment rather than referencing it', () => {
      const environment = { FOO: 'bar' };
      const result = convertWorkflow(
        nixery({ steps: [{ command: 'make', environment }] }),
      );
      const step = (result.jobs.build as NormalJob).steps![0];

      expect(step.env).not.toBe(environment);
    });
  });

  describe('job id', () => {
    const withJob = (path?: string) =>
      Object.keys(
        convertWorkflow(nixery({ steps: [{ command: 'make' }] }), path).jobs,
      );

    it('defaults to "build" when no path is given', () => {
      expect(withJob()).toEqual(['build']);
    });

    it('derives the id from the file basename without extension', () => {
      expect(withJob('.tangled/workflows/ci.yml')).toEqual(['ci']);
      expect(withJob('release.yaml')).toEqual(['release']);
    });

    it('keeps hyphens and underscores', () => {
      expect(withJob('build-and-test.yml')).toEqual(['build-and-test']);
      expect(withJob('_internal.yml')).toEqual(['_internal']);
    });

    it('replaces characters GitHub does not allow in a job id', () => {
      expect(withJob('deploy to prod.yml')).toEqual(['deploy-to-prod']);
    });

    it('prefixes an underscore when the id would not start with a letter', () => {
      expect(withJob('3d-render.yml')).toEqual(['_3d-render']);
    });

    it('falls back to the default when the basename has no usable characters', () => {
      expect(withJob('---.yml')).toEqual(['build']);
    });
  });

  describe('fixtures', () => {
    it.each(fixtures)('converts %s', async (name) => {
      const dir = `${fixturesDir}/${name}`;
      const input = parse(
        await readFile(`${dir}/input.yml`, 'utf8'),
      ) as Workflow;

      let output: string;
      let target: string;
      try {
        output = stringify(convertWorkflow(input, `${name}.yml`), {
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
