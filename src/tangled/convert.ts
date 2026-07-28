import type {
  NixeryWorkflow,
  Pipeline,
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
} from '../github/types.js';
import { convertAction } from './actions/convert.js';
import { groupJobsByNeeds, type JobGroup } from './graph.js';
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

  const result: WorkflowStep = { command: step.run };

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
 * Convert a GitHub Actions workflow into an equivalent tangled pipeline. Jobs
 * linked by `needs` collapse into a single workflow whose steps run in
 * dependency order.
 * Throws on any workflow, job, or step configuration that cannot be converted.
 */
export function convertWorkflow(workflow: GitHubWorkflow): Pipeline {
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

  return groupJobsByNeeds(jobs).map((group) => toWorkflow(group, jobs, shared));
}
