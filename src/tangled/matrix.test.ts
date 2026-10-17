import { describe, it, expect } from 'vitest';
import { expandMatrixJobs } from './matrix.js';
import type { NormalJob } from '../github/types.js';

const baseJob: NormalJob = { 'runs-on': 'ubuntu-latest' };

describe('expandMatrixJobs', () => {
  it('converts a matrix with an object value', () => {
    expect(
      expandMatrixJobs({
        test: {
          ...baseJob,
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
      }),
    ).toEqual({
      'matrix-test-1': {
        ...baseJob,
        steps: [{ name: 'echo', run: 'echo project_one-js' }],
      },
      'matrix-test-2': {
        ...baseJob,
        steps: [{ name: 'echo', run: 'echo project_two-ts' }],
      },
    });
  });

  it('converts a matrix with exclude', () => {
    expect(
      expandMatrixJobs({
        test: {
          ...baseJob,
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
      }),
    ).toEqual({
      'matrix-test-1': {
        ...baseJob,
        steps: [{ name: 'echo', run: 'echo linux-2' }],
      },
      'matrix-test-2': {
        ...baseJob,
        steps: [{ name: 'echo', run: 'echo linux-3' }],
      },
    });
  });

  it('converts a matrix that excludes object values', () => {
    expect(
      expandMatrixJobs({
        test: {
          ...baseJob,
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
      }),
    ).toEqual({
      'matrix-test-1': { ...baseJob, steps: [{ run: 'echo c' }] },
    });
  });

  it('converts a matrix with include', () => {
    // Example from https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations#expanding-or-adding-matrix-configurations
    expect(
      expandMatrixJobs({
        test: {
          ...baseJob,
          strategy: {
            matrix: {
              fruit: ['apple', 'pear'],
              animal: ['cat', 'dog'],
              include: [
                { color: 'green' },
                { color: 'pink', animal: 'cat' },
                { fruit: 'apple', shape: 'circle' },
                { fruit: 'banana' },
                { fruit: 'banana', animal: 'cat' },
              ],
            },
          },
          steps: [
            {
              run: 'echo fruit=${{ matrix.fruit }} animal=${{ matrix.animal }} color=${{ matrix.color }} shape=${{ matrix.shape }}',
            },
          ],
        },
      }),
    ).toEqual({
      'matrix-test-1': {
        ...baseJob,
        steps: [{ run: 'echo fruit=apple animal=cat color=pink shape=circle' }],
      },
      'matrix-test-2': {
        ...baseJob,
        steps: [
          { run: 'echo fruit=apple animal=dog color=green shape=circle' },
        ],
      },
      'matrix-test-3': {
        ...baseJob,
        steps: [{ run: 'echo fruit=pear animal=cat color=pink shape=' }],
      },
      'matrix-test-4': {
        ...baseJob,
        steps: [{ run: 'echo fruit=pear animal=dog color=green shape=' }],
      },
      'matrix-test-5': {
        ...baseJob,
        steps: [{ run: 'echo fruit=banana animal= color= shape=' }],
      },
      'matrix-test-6': {
        ...baseJob,
        steps: [{ run: 'echo fruit=banana animal=cat color= shape=' }],
      },
    });
  });

  it('converts a matrix with only include', () => {
    expect(
      expandMatrixJobs({
        test: {
          ...baseJob,
          strategy: {
            matrix: {
              include: [{ os: 'linux' }, { os: 'macos' }],
            },
          },
          steps: [{ run: 'echo ${{ matrix.os }}' }],
        },
      }),
    ).toEqual({
      'matrix-test-1': { ...baseJob, steps: [{ run: 'echo linux' }] },
      'matrix-test-2': { ...baseJob, steps: [{ run: 'echo macos' }] },
    });
  });

  it('throws when a job depends on a matrix job', () => {
    expect(() =>
      expandMatrixJobs({
        'matrix-job': {
          ...baseJob,
          strategy: {
            matrix: { version: [1, 2] },
          },
          steps: [{ run: 'echo ${{matrix.version}}' }],
        },
        'depends-on-matrix': {
          ...baseJob,
          needs: ['matrix-job'],
          steps: [{ run: 'echo "hello world"' }],
        },
      }),
    ).toThrow('A job depending on a matrix job cannot be converted');
  });

  it('throws when a matrix job depends on another job', () => {
    expect(() =>
      expandMatrixJobs({
        foo: {
          ...baseJob,
          steps: [{ run: 'echo "hello world"' }],
        },
        'matrix-job': {
          ...baseJob,
          needs: ['foo'],
          strategy: {
            matrix: { version: [1, 2] },
          },
          steps: [{ run: 'echo ${{matrix.version}}' }],
        },
      }),
    ).toThrow('A matrix job that depends on other jobs cannot be converted');
  });

  it('throws when a matrix is a template expression', () => {
    expect(() =>
      expandMatrixJobs({
        'matrix-job': {
          ...baseJob,
          strategy: {
            matrix: '${{ fromJSON(vars.TEST_MATRIX) }}',
          },
          steps: [{ run: 'echo ${{matrix.version}}' }],
        },
      }),
    ).toThrow('Cannot convert templated matrix expression');
  });

  it('throws when a matrix key is a template expression', () => {
    expect(() =>
      expandMatrixJobs({
        'matrix-job': {
          ...baseJob,
          strategy: {
            matrix: {
              version: '${{ fromJSON(vars.VERSIONS) }}',
            },
          },
          steps: [{ run: 'echo ${{matrix.version}}' }],
        },
      }),
    ).toThrow('Cannot convert templated matrix key');
  });

  it('throws on a matrix expression it cannot interpolate', () => {
    expect(() =>
      expandMatrixJobs({
        test: {
          ...baseJob,
          strategy: { matrix: { os: ['linux'] } },
          steps: [{ run: "echo ${{ matrix['os'] }}" }],
        },
      }),
    ).toThrow("Cannot convert matrix expression: ${{ matrix['os'] }}");
  });
});
