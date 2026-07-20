import type {
  NixeryWorkflow,
  Workflow,
  WorkflowBase,
  WorkflowCloneOptions,
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
import { convertAction } from './actions/index.js';

/**
 * Workflow-level keys with a tangled representation.
 */
const WORKFLOW_KEYS = new Set<keyof GitHubWorkflow>(['on', 'env', 'jobs']);

/**
 * GitHub job keys with a tangled representation.
 */
const JOB_KEYS = new Set<keyof NormalJob>(['runs-on', 'steps']);

/**
 * GitHub step keys with a tangled representation.
 */
const STEP_KEYS = new Set<keyof GitHubStep>(['run', 'name', 'env']);

/**
 * Throw if `value` has any key not listed in `known`. `context` labels the
 * offending location in the error message.
 */
function assertKnownKeys<T extends object>(
  value: T,
  known: Set<keyof T>,
  context: string,
): void {
  for (const key of Object.keys(value)) {
    if (!known.has(key as keyof T)) {
      throw new Error(`Unsupported ${context} key: ${key}`);
    }
  }
}

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
 * Translate a single GitHub step into a tangled step.
 */
function toStep(step: GitHubStep): WorkflowStep {
  assertKnownKeys(step, STEP_KEYS, 'step');

  if (typeof step.run !== 'string') {
    throw new Error('Unsupported step: a `run` command is required');
  }

  const result: WorkflowStep = { command: step.run };

  if (step.name !== undefined) {
    result.name = step.name;
  }

  const environment = toEnvironment(step.env);
  if (environment) {
    result.environment = environment;
  }

  return result;
}

/**
 * The result of translating a GitHub `jobs` map: the tangled steps plus any
 * engine and workflow configuration contributed by known `uses` actions.
 */
type JobsConversion = Required<Pick<NixeryWorkflow, 'steps' | 'dependencies'>> &
  Pick<NixeryWorkflow, 'clone'>;

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

/**
 * Translate a GitHub `jobs` map into tangled steps and the workflow
 * configuration implied by its `uses` steps. A `run` step becomes a tangled
 * step; a known `uses` step contributes engine or clone configuration; an
 * unknown `uses` step throws rather than being silently dropped.
 */
function toJobs(jobs: GitHubWorkflow['jobs']): JobsConversion {
  const steps: WorkflowStep[] = [];
  const dependencies: Record<string, string[]> = {};
  let clone: WorkflowCloneOptions | undefined;

  for (const [id, job] of Object.entries(jobs)) {
    if ('uses' in job) {
      throw new Error(
        `Unsupported job "${id}": reusable workflow calls have no tangled equivalent`,
      );
    }

    assertKnownKeys(job, JOB_KEYS, `job "${id}"`);

    for (const step of job.steps ?? []) {
      if (typeof step.uses === 'string') {
        const conversion = convertAction(step.uses, step);
        if (!conversion) {
          throw new Error(`Unsupported action: ${step.uses}`);
        }
        mergeDependencies(dependencies, conversion.dependencies);
        if (conversion.clone) {
          clone = conversion.clone;
        }
        continue;
      }

      steps.push(toStep(step));
    }
  }

  const result: JobsConversion = { steps, dependencies };
  if (clone) {
    result.clone = clone;
  }
  return result;
}

/**
 * Convert the engine-agnostic fields of a GitHub Actions workflow into a
 * tangled workflow base. Engine-specific configuration is handled elsewhere.
 */
function toTangledBase(
  workflow: GitHubWorkflow,
  jobs: JobsConversion,
): WorkflowBase {
  const base: WorkflowBase = {};

  const when = toWhen(workflow.on);
  if (when.length > 0) {
    base.when = when;
  }

  const environment = toEnvironment(workflow.env);
  if (environment) {
    base.environment = environment;
  }

  if (jobs.steps.length > 0) {
    base.steps = jobs.steps;
  }

  if (jobs.clone) {
    base.clone = jobs.clone;
  }

  return base;
}

/**
 * Convert a GitHub Actions workflow into an equivalent tangled workflow. Throws
 * on any workflow, job, or step configuration that has no tangled
 * representation, rather than silently dropping it.
 */
export function toTangled(workflow: GitHubWorkflow): Workflow {
  assertKnownKeys(workflow, WORKFLOW_KEYS, 'workflow');

  const jobs = toJobs(workflow.jobs);
  const base = toTangledBase(workflow, jobs);

  const result: NixeryWorkflow = {
    engine: 'nixery',
    ...base,
  };

  if (Object.keys(jobs.dependencies).length > 0) {
    result.dependencies = jobs.dependencies;
  }

  return result;
}
