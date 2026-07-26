import type { ActionConverter } from './types.js';
import type { Workflow } from '../../tangled/types.js';
import type { Step as GitHubStep } from '../types.js';
import { convertCheckout } from './checkout.js';
import { convertDependencies } from './dependencies.js';

export type { ActionConverter } from './types.js';

/**
 * The converters contributing setup steps to a job, in the order those steps
 * run: the checkout first, then the tools the workflow's own steps need.
 */
const ACTION_CONVERTERS: ActionConverter[] = [
  convertCheckout,
  convertDependencies,
];

/**
 * Convert the parts of a tangled workflow that GitHub models as actions into
 * the leading `uses` steps of its job.
 */
export function convertActions(workflow: Workflow): GitHubStep[] {
  return ACTION_CONVERTERS.flatMap((convert) => convert(workflow));
}
