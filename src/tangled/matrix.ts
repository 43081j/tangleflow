import type { Configuration, NormalJob } from '../github/types.js';
import { normaliseNeeds } from './graph.js';

/**
 * Look up a matrix value by its path, such as `config.os`, and turn it into
 * the string GitHub would insert.
 */
function resolveMatrixPath(
  matrixContext: Record<string, Configuration>,
  path: string,
): string {
  let value: unknown = matrixContext;
  for (const key of path.split('.')) {
    value =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    // GitHub inserts the literal string "Object" for an object value
    return 'Object';
  }
  // GitHub evaluates a nonexistent property to an empty string
  return String(value ?? '');
}

/**
 * Interpolate matrix values into `${{ matrix.<key> }}` references
 */
function interpolateMatrixValues(
  input: unknown,
  matrixContext: Record<string, Configuration>,
): unknown {
  if (typeof input === 'string') {
    const interpolated = input.replace(
      /\$\{\{\s?matrix\.([\w-]+(?:\.[\w-]+)*)\s?\}\}/g,
      (_match, path: string) => resolveMatrixPath(matrixContext, path),
    );
    // Throw if any `matrix` usage is left that we couldn't replace
    for (const [expression] of interpolated.matchAll(/\$\{\{.*?\}\}/g)) {
      if (/(?<![\w.-])matrix\b/.test(expression)) {
        throw new Error(`Cannot convert matrix expression: ${expression}`);
      }
    }
    return interpolated;
  }
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = interpolateMatrixValues(value, matrixContext);
    }
    return result;
  }
  if (Array.isArray(input)) {
    return input.map((item) => interpolateMatrixValues(item, matrixContext));
  }
  // number, boolean, null, undefined
  return input;
}

/**
 * Whether a matrix value matches `pattern`, as GitHub matches `exclude`
 * entries: an object pattern only has to match the keys it names, and other
 * values are compared as strings.
 */
function matchesMatrixValue(
  pattern: Configuration,
  value: Configuration | undefined,
): boolean {
  if (typeof pattern === 'object' && !Array.isArray(pattern)) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    return Object.entries(pattern).every(([key, patternValue]) =>
      matchesMatrixValue(patternValue, value[key]),
    );
  }
  return String(value) === String(pattern);
}

/**
 * Replace each matrix job with one job per matrix combination, named
 * `matrix-<job>-1`, `matrix-<job>-2`, and so on. Throws if a matrix job is
 * linked by `needs`, or if its matrix uses expressions that can't be converted.
 */
export function expandMatrixJobs(
  jobs: Record<string, NormalJob>,
): Record<string, NormalJob> {
  const jobEntries = Object.entries(jobs);
  const matrixJobIds: string[] = [];

  // Find matrix jobs and check if they depend on anything (and throw if they do)
  for (const [jobId, job] of jobEntries) {
    if (job.strategy) {
      matrixJobIds.push(jobId);
      if (normaliseNeeds(job.needs).length > 0) {
        throw new Error(
          'A matrix job that depends on other jobs cannot be converted',
        );
      }
    }
  }

  if (matrixJobIds.length === 0) {
    return jobs;
  }

  // For any job that depends, if it depends on a matrix job then fail
  for (const [, job] of jobEntries) {
    for (const neededJob of normaliseNeeds(job.needs)) {
      if (matrixJobIds.includes(neededJob)) {
        throw new Error('A job depending on a matrix job cannot be converted');
      }
    }
  }

  const expandedJobs: Record<string, NormalJob> = {};

  for (const [jobId, job] of jobEntries) {
    const { strategy, ...rest } = job;
    if (!strategy) {
      expandedJobs[jobId] = job;
      continue;
    }

    let combinations: Record<string, Configuration>[] = [{}];

    if (typeof strategy.matrix === 'string') {
      throw new Error('Cannot convert templated matrix expression');
    }

    const originalKeys = Object.keys(strategy.matrix).filter(
      (key) => key !== 'include' && key !== 'exclude',
    );

    for (const matrixKey of originalKeys) {
      const matrixValues = strategy.matrix[matrixKey]!;
      if (typeof matrixValues === 'string') {
        throw new Error('Cannot convert templated matrix key');
      }

      combinations = combinations.flatMap((existingCombination) => {
        return matrixValues.map((matrixValue) => {
          return Object.assign({}, existingCombination, {
            [matrixKey]: matrixValue,
          });
        });
      });
    }

    // With no matrix keys, drop the empty starting combination so only the include entries run
    if (originalKeys.length === 0) {
      combinations = [];
    }

    const excludes = strategy.matrix.exclude ?? [];
    if (typeof excludes === 'string') {
      throw new Error('Cannot convert templated matrix exclude');
    }

    const combinationsAfterExclude = combinations.filter(
      (combination) =>
        !excludes.some((exclude) => matchesMatrixValue(exclude, combination)),
    );

    const includes = strategy.matrix.include ?? [];
    if (typeof includes === 'string') {
      throw new Error('Cannot convert templated matrix include');
    }

    // Later include entries never merge into these
    const combinationsFromInclude: Record<string, Configuration>[] = [];
    for (const include of includes as Record<string, Configuration>[]) {
      const matchingCombinations = combinationsAfterExclude.filter(
        (combination) =>
          Object.entries(include)
            .filter(([key]) => originalKeys.includes(key))
            .every(([key, value]) =>
              matchesMatrixValue(value, combination[key]),
            ),
      );

      for (const combination of matchingCombinations) {
        Object.assign(combination, include);
      }

      if (matchingCombinations.length === 0) {
        combinationsFromInclude.push(Object.assign({}, include));
      }
    }

    // convert combinations into individual jobs
    for (const [index, combination] of [
      ...combinationsAfterExclude,
      ...combinationsFromInclude,
    ].entries()) {
      const interpolated = interpolateMatrixValues(
        rest,
        combination,
      ) as NormalJob;

      expandedJobs[`matrix-${jobId}-${index + 1}`] = interpolated;
    }
  }

  return expandedJobs;
}
