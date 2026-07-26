import type { Workflow, WorkflowStep } from '../tangled/types.js';
import { assertKnownKeys } from '../validation.js';

/**
 * Tangled workflow keys with a GitHub representation.
 */
const WORKFLOW_KEYS = new Set<keyof Workflow>([
  'engine',
  'when',
  'environment',
  'steps',
  'dependencies',
]);

/**
 * Tangled step keys with a GitHub representation.
 */
const STEP_KEYS = new Set<keyof WorkflowStep>([
  'command',
  'name',
  'environment',
]);

/**
 * Throw if any part of a tangled workflow cannot be converted, rather than
 * dropping it silently.
 */
export function validateInput(workflow: Workflow): void {
  assertKnownKeys(workflow, WORKFLOW_KEYS, 'workflow');

  for (const step of workflow.steps ?? []) {
    assertKnownKeys(step, STEP_KEYS, 'step');
  }
}
