import type {
  HttpsJsonSchemastoreOrgGithubWorkflowJson as GitHubWorkflow,
  NormalJob,
  Permissions,
  Step as GitHubStep,
} from '../github/types.js';
import { assertKnownKeys } from '../validation.js';

/**
 * Workflow-level keys with a tangled representation.
 */
const WORKFLOW_KEYS = new Set<keyof GitHubWorkflow>([
  'name',
  'on',
  'env',
  'jobs',
  'permissions',
  'concurrency',
]);

/**
 * GitHub job keys with a tangled representation.
 */
const JOB_KEYS = new Set<keyof NormalJob>([
  'name',
  'runs-on',
  'needs',
  'steps',
  'permissions',
  'concurrency',
  'timeout-minutes',
]);

/**
 * GitHub step keys with a tangled representation.
 */
const STEP_KEYS = new Set<keyof GitHubStep>([
  'run',
  'name',
  'env',
  'timeout-minutes',
]);

/**
 * Permission scopes whose `write` grant a workflow relies on and tangled cannot
 * provide, since it has no token to push to the repository or publish packages.
 */
const WRITE_DEPENDENT_SCOPES = ['contents', 'id-token'] as const;

/**
 * Throw if `permissions` grants write access tangled cannot honour. Any other
 * permission configuration has no tangled representation and is dropped.
 */
function assertPermissions(
  permissions: Permissions | undefined,
  context: string,
): void {
  if (permissions === 'write-all') {
    throw new Error(
      `Unsupported ${context} permissions: write access has no tangled equivalent`,
    );
  }

  if (permissions && typeof permissions === 'object') {
    for (const scope of WRITE_DEPENDENT_SCOPES) {
      if (permissions[scope] === 'write') {
        throw new Error(
          `Unsupported ${context} permissions: "${scope}: write" has no tangled equivalent`,
        );
      }
    }
  }
}

/**
 * Throw if a step has no tangled equivalent. `uses` steps are left alone, since
 * whether they convert depends on the action they reference.
 */
function assertStep(step: GitHubStep): void {
  if (typeof step.uses === 'string') {
    return;
  }

  assertKnownKeys(step, STEP_KEYS, 'step');

  if (typeof step.run !== 'string') {
    throw new Error('Unsupported step: a `run` command is required');
  }
}

/**
 * Throw if a job, or any of its steps, has no tangled equivalent.
 */
function assertJob(job: GitHubWorkflow['jobs'][string], id: string): void {
  if ('uses' in job) {
    throw new Error(
      `Unsupported job "${id}": reusable workflow calls have no tangled equivalent`,
    );
  }

  assertKnownKeys(job, JOB_KEYS, `job "${id}"`);
  assertPermissions(job.permissions, `job "${id}"`);

  for (const step of job.steps ?? []) {
    assertStep(step);
  }
}

/**
 * Throw if any part of a GitHub workflow cannot be converted, rather than
 * dropping it silently. Configuration tangled has no concept of at all (such as
 * `concurrency`) is allowed through, to be dropped by the conversion.
 */
export function validateInput(workflow: GitHubWorkflow): void {
  assertKnownKeys(workflow, WORKFLOW_KEYS, 'workflow');
  assertPermissions(workflow.permissions, 'workflow');

  for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
    assertJob(job, id);
  }
}
