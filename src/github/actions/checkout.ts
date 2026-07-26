import type { ActionConverter } from './types.js';
import type { Step as GitHubStep, Env } from '../types.js';
import { ACTION_REFS } from './refs.js';

/**
 * The action providing the checkout every tangled workflow gets implicitly.
 */
const CHECKOUT_ACTION = ACTION_REFS['actions/checkout'];

/**
 * Map a tangled workflow's `clone` options onto an `actions/checkout` step.
 */
export const convertCheckout: ActionConverter = (workflow) => {
  const clone = workflow.clone;

  if (clone?.skip) {
    return [];
  }

  const step: GitHubStep = { uses: CHECKOUT_ACTION };
  const inputs: Env = {};

  if (clone?.depth !== undefined) {
    inputs['fetch-depth'] = clone.depth;
  }

  if (clone?.submodules !== undefined) {
    inputs['submodules'] = clone.submodules;
  }

  if (clone?.tags !== undefined) {
    inputs['fetch-tags'] = clone.tags;
  }

  if (Object.keys(inputs).length > 0) {
    step.with = inputs;
  }

  return [step];
};
