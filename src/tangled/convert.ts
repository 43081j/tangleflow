import type {
  NixeryWorkflow,
  Workflow,
  WorkflowBase,
  WorkflowConstraint,
  WorkflowEvent,
  WorkflowStep,
} from './types.js';
import type {
  HttpsJsonSchemastoreOrgGithubWorkflowJson as GitHubWorkflow,
  Event as GitHubEvent,
  NormalJob,
  Step as GitHubStep,
  Configuration,
} from '../github/types.js';
import { convertAction } from './actions/convert.js';
import { groupJobsByNeeds, normaliseNeeds, type JobGroup } from './graph.js';
import { validateInput } from './validate-input.js';

/**
 * GitHub event names that have a tangled equivalent, mapped to it. Events
 * without an entry here have no representation in a tangled workflow.
 */
const EVENT_MAP: Partial<Record<GitHubEvent, WorkflowEvent>> = {
  push: 'push',
  pull_request: 'pull_request',
  workflow_dispatch: 'manual',
};

/**
 * Filter keys on a GitHub event config, mapped to the tangled constraint field
 * they populate.
 */
const FILTER_MAP = {
  branches: 'branch',
  tags: 'tag',
  paths: 'paths',
} as const;

/**
 * Translate a GitHub `on` trigger into a list of tangled `when` constraints.
 * Events tangled does not understand are dropped.
 */
function toWhen(on: GitHubWorkflow['on']): WorkflowConstraint[] {
  if (typeof on === 'string') {
    const event = EVENT_MAP[on];
    return event ? [{ event }] : [];
  }

  if (Array.isArray(on)) {
    return on.flatMap((name) => {
      const event = EVENT_MAP[name];
      return event ? [{ event }] : [];
    });
  }

  const constraints: WorkflowConstraint[] = [];

  for (const [name, config] of Object.entries(on)) {
    const event = EVENT_MAP[name as GitHubEvent];
    if (!event) {
      continue;
    }

    const constraint: WorkflowConstraint = { event };

    if (config && typeof config === 'object') {
      const filters = config as Record<string, unknown>;
      for (const [ghKey, tangledKey] of Object.entries(FILTER_MAP)) {
        const value = filters[ghKey];
        if (Array.isArray(value) && value.length > 0) {
          constraint[tangledKey] = value as string[];
        }
      }
    }

    constraints.push(constraint);
  }

  return constraints;
}

/**
 * Translate a GitHub `env` map into tangled `environment`.
 */
function toEnvironment(
  env: GitHubWorkflow['env'],
): Record<string, string> | undefined {
  if (!env || typeof env !== 'object') {
    return undefined;
  }

  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    environment[key] = String(value);
  }
  return environment;
}

/**
 * Translate a single GitHub step into a tangled step. When `jobId` is given the
 * step's name is prefixed with it.
 */
function toStep(step: GitHubStep, jobId?: string): WorkflowStep {
  if (typeof step.run !== 'string') {
    throw new Error('Unsupported step: a `run` command is required');
  }

  const result: WorkflowStep = step['working-directory']
    ? { command: `cd '${step['working-directory']}' || exit 1\n${step.run}` }
    : { command: step.run };

  const name = jobId
    ? step.name
      ? `${jobId}: ${step.name}`
      : jobId
    : step.name;
  if (name !== undefined) {
    result.name = name;
  }

  const environment = toEnvironment(step.env);
  if (environment) {
    result.environment = environment;
  }

  return result;
}

/**
 * Merge `extra` nixery dependencies into `target`, appending packages per
 * registry without introducing duplicates.
 */
function mergeDependencies(
  target: Record<string, string[]>,
  extra: Record<string, string[]> | undefined,
): void {
  if (!extra) {
    return;
  }
  for (const [registry, packages] of Object.entries(extra)) {
    const existing = (target[registry] ??= []);
    for (const pkg of packages) {
      if (!existing.includes(pkg)) {
        existing.push(pkg);
      }
    }
  }
}

type ToStepsResult = Required<Pick<NixeryWorkflow, 'steps' | 'dependencies'>> &
  Pick<NixeryWorkflow, 'clone'>;

/**
 * Adds the steps from a GitHub job to a result.
 */
function addSteps(
  result: ToStepsResult,
  steps: readonly GitHubStep[],
  jobId?: string,
): void {
  for (const step of steps) {
    if (typeof step.uses === 'string') {
      const conversion = convertAction(step.uses, step);
      if (!conversion) {
        throw new Error(`Unsupported action: ${step.uses}`);
      }
      mergeDependencies(result.dependencies, conversion.dependencies);
      if (conversion.clone) {
        result.clone = conversion.clone;
      }
      if (conversion.steps) {
        result.steps.push(...conversion.steps);
      }
      continue;
    }

    result.steps.push(toStep(step, jobId));
  }
}

/**
 * A comparable key for a job's `runs-on`, so jobs combined into one workflow can
 * be checked for running on the same runner.
 */
function runnerKey(job: NormalJob): string {
  return JSON.stringify(job['runs-on'] ?? null);
}

/**
 * Translate a group of GitHub jobs into a single tangled workflow.
 * A group is one or more jobs linked by `needs`. Their steps run in dependency
 * order on one runner, so they must agree on `runs-on`.
 */
function toWorkflow(
  group: JobGroup,
  jobs: Record<string, NormalJob>,
  shared: WorkflowBase,
): Workflow {
  const combined = group.ids.length > 1;
  const result: ToStepsResult = { steps: [], dependencies: {} };
  let runner: string | undefined;

  for (const id of group.ids) {
    const job = jobs[id]!;

    const key = runnerKey(job);
    if (runner === undefined) {
      runner = key;
    } else if (key !== runner) {
      throw new Error(
        `Jobs linked by \`needs\` run on different runners and cannot be combined: ${group.ids.join(', ')}`,
      );
    }

    addSteps(result, job.steps ?? [], combined ? id : undefined);
  }

  const { steps, dependencies, clone } = result;
  const workflow: NixeryWorkflow = { engine: 'nixery' };

  if (shared.when) {
    workflow.when = shared.when;
  }
  if (clone) {
    workflow.clone = clone;
  }
  if (steps.length > 0) {
    workflow.steps = steps;
  }
  if (shared.environment) {
    workflow.environment = shared.environment;
  }
  if (Object.keys(dependencies).length > 0) {
    workflow.dependencies = dependencies;
  }

  return workflow;
}

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

function expandMatrixJobs(
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

    let matrixCombinations: Record<string, Configuration>[] = [{}];

    if (typeof strategy.matrix === 'string') {
      throw new Error('Cannot convert templated matrix expression');
    }

    for (const [matrixKey, matrixValues] of Object.entries(strategy.matrix)) {
      if (matrixKey === 'exclude' || matrixKey === 'include') continue;
      if (typeof matrixValues === 'string') {
        throw new Error('Cannot convert templated matrix key');
      }

      matrixCombinations = matrixCombinations.flatMap((existingCombination) => {
        return matrixValues.map((matrixValue) => {
          return Object.assign({}, existingCombination, {
            [matrixKey]: matrixValue,
          });
        });
      });
    }

    const excludes = strategy.matrix.exclude ?? [];
    if (typeof excludes === 'string') {
      throw new Error('Cannot convert templated matrix exclude');
    }

    const matrixCombinationsWithoutExcluded = matrixCombinations.filter(
      (combination) =>
        !excludes.some((exclude) => matchesMatrixValue(exclude, combination)),
    );

    // convert combinations into individual jobs
    for (const [
      index,
      combination,
    ] of matrixCombinationsWithoutExcluded.entries()) {
      const interpolated = interpolateMatrixValues(
        rest,
        combination,
      ) as NormalJob;

      expandedJobs[`matrix-${jobId}-${index + 1}`] = interpolated;
    }
  }

  return expandedJobs;
}

/**
 * Convert a GitHub Actions workflow into equivalent tangled workflows.
 * Jobs linked by `needs` collapse into a single workflow whose steps run
 * in dependency order.
 * Throws on any workflow, job, or step configuration that cannot be converted.
 */
export function convertWorkflow(
  workflow: GitHubWorkflow,
): Record<string, Workflow> {
  validateInput(workflow);

  const shared: WorkflowBase = {};

  const when = toWhen(workflow.on);
  if (when.length > 0) {
    shared.when = when;
  }

  const environment = toEnvironment(workflow.env);
  if (environment) {
    shared.environment = environment;
  }

  const jobs = workflow.jobs as Record<string, NormalJob>;
  const expandedJobs = expandMatrixJobs(jobs);

  const workflows: Record<string, Workflow> = {};
  for (const group of groupJobsByNeeds(expandedJobs)) {
    const [firstJobId] = group.ids;
    workflows[firstJobId!] = toWorkflow(group, expandedJobs, shared);
  }
  return workflows;
}
