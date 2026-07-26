import { basename } from 'node:path';
import type {
  Pipeline,
  Workflow,
  WorkflowConstraint,
  WorkflowEvent,
  WorkflowStep,
} from '../tangled/types.js';
import type {
  HttpsJsonSchemastoreOrgGithubWorkflowJson as GitHubWorkflow,
  Event as GitHubEvent,
  Step as GitHubStep,
} from './types.js';
import {
  convertMicrovmDependencies,
  convertNixeryDependencies,
} from './dependencies/convert.js';
import { validateInput } from './validate-input.js';

/**
 * Tangled event names mapped to their GitHub equivalent.
 */
const EVENT_MAP: Record<WorkflowEvent, GitHubEvent> = {
  push: 'push',
  pull_request: 'pull_request',
  manual: 'workflow_dispatch',
};

/**
 * Tangled constraint filter fields, mapped to the GitHub event-config key they
 * populate.
 */
const FILTER_MAP = {
  branch: 'branches',
  tag: 'tags',
  paths: 'paths',
} as const;

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Translate tangled `when` constraints into a GitHub `on` trigger map.
 * Constraints without an event are dropped, as are branch/tag/paths filters on
 * events that don't accept them (e.g. `workflow_dispatch`). Filters from
 * multiple constraints targeting the same event are merged.
 */
function toOn(when: WorkflowConstraint[] | undefined): GitHubWorkflow['on'] {
  const on: GitHubWorkflow['on'] = {};

  for (const constraint of when ?? []) {
    for (const event of toArray(constraint.event)) {
      const ghEvent = EVENT_MAP[event];
      const config = (on[ghEvent] ??= {});

      if (ghEvent !== 'push' && ghEvent !== 'pull_request') {
        continue;
      }

      for (const [tangledKey, ghKey] of Object.entries(FILTER_MAP)) {
        const values = toArray(
          constraint[tangledKey as keyof typeof FILTER_MAP],
        );
        if (values.length > 0) {
          config[ghKey] = [
            ...new Set([...(config[ghKey] ?? []), ...values]),
          ] as [string, ...string[]];
        }
      }
    }
  }

  return on;
}

/**
 * Translate tangled `environment` into GitHub workflow-level `env`.
 */
function toEnv(
  environment: Record<string, string> | undefined,
): GitHubWorkflow['env'] {
  if (!environment) {
    return undefined;
  }
  return { ...environment };
}

/**
 * Job id used when no workflow path is provided, or a path yields no valid id.
 */
const DEFAULT_JOB_ID = 'build';

/**
 * The runner used for the generated job. Tangled selects its environment via
 * the engine rather than a runner label, so a GitHub default is used.
 */
const RUNNER = 'ubuntu-latest';

/**
 * Derive a GitHub job id from a tangled workflow's file path.
 */
function toJobId(path: string | undefined): string {
  if (!path) {
    return DEFAULT_JOB_ID;
  }

  const name = basename(path).replace(/\.ya?ml$/i, '');

  let id = name.replace(/[^A-Za-z0-9_-]/g, '-');
  if (!/^[A-Za-z_]/.test(id)) {
    id = `_${id}`;
  }

  return /[A-Za-z0-9]/.test(id) ? id : DEFAULT_JOB_ID;
}

/**
 * Translate a single tangled step into a GitHub step.
 */
function toStep(step: WorkflowStep): GitHubStep {
  const result: GitHubStep = { run: step.command };

  if (step.name) {
    result.name = step.name;
  }

  if (step.environment) {
    result.env = { ...step.environment };
  }

  return result;
}

/**
 * Wrap a list of GitHub steps in a single job, whose id is derived from `path`.
 * An empty list yields an empty jobs map.
 */
function toJobs(
  steps: GitHubStep[],
  path: string | undefined,
): GitHubWorkflow['jobs'] {
  if (steps.length === 0) {
    return {};
  }

  return {
    [toJobId(path)]: {
      'runs-on': RUNNER,
      steps: steps as [GitHubStep, ...GitHubStep[]],
    },
  };
}

/**
 * Translate a tangled workflow's dependencies into the leading `uses` steps
 * that provide them.
 */
function toDependencySteps(workflow: Workflow): GitHubStep[] {
  return workflow.engine === 'nixery'
    ? convertNixeryDependencies(workflow.dependencies)
    : convertMicrovmDependencies(workflow.dependencies);
}

/**
 * Convert the engine-agnostic fields of a tangled workflow into a GitHub
 * workflow base. Steps and jobs are handled elsewhere.
 */
function toGitHubBase(
  workflow: Workflow,
): Pick<GitHubWorkflow, 'on'> & Partial<Pick<GitHubWorkflow, 'env'>> {
  const base: Pick<GitHubWorkflow, 'on'> &
    Partial<Pick<GitHubWorkflow, 'env'>> = {
    on: toOn(workflow.when),
  };

  const env = toEnv(workflow.environment);
  if (env) {
    base.env = env;
  }

  return base;
}

/**
 * Convert a tangled workflow into an equivalent GitHub Actions workflow.
 */
export function convertWorkflow(
  workflow: Workflow,
  path?: string,
): GitHubWorkflow {
  validateInput(workflow);

  const steps = [
    ...toDependencySteps(workflow),
    ...(workflow.steps ?? []).map(toStep),
  ];

  return {
    jobs: toJobs(steps, path),
    ...toGitHubBase(workflow),
  };
}

export function convertPipeline(
  pipeline: Pipeline,
  path?: string,
): GitHubWorkflow[] {
  return pipeline.map((workflow) => convertWorkflow(workflow, path));
}
