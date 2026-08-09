import type { ActionConverter } from './types.js';
import type { WorkflowCloneOptions } from '../types.js';
import type { Step as GitHubStep } from '../../github/types.js';
import { toBoolean } from '../actions.js';

/**
 * Interpret a `fetch-depth` input as a non-negative integer. Returns
 * `undefined` for anything else.
 */
function toDepth(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return undefined;
  }
  const depth = Number(value);
  return Number.isInteger(depth) && depth >= 0 ? depth : undefined;
}

/**
 * Interpret a `submodules` input. GitHub accepts `true`, `false` or
 * `recursive`; `recursive` maps to a plain submodule clone.
 */
function toSubmodules(value: unknown): boolean | undefined {
  if (value === 'recursive') {
    return true;
  }
  return toBoolean(value);
}

/**
 * Map `actions/checkout` onto tangled `clone` options. Each recognised input
 * (`fetch-depth`, `submodules`, `fetch-tags`) populates its clone field;
 * unspecified inputs are left to the tangled defaults.
 */
export const convertCheckout: ActionConverter = (step: GitHubStep) => {
  const clone: WorkflowCloneOptions = {};

  const depth = toDepth(step.with?.['fetch-depth']);
  if (depth !== undefined) {
    clone.depth = depth;
  }

  const submodules = toSubmodules(step.with?.['submodules']);
  if (submodules !== undefined) {
    clone.submodules = submodules;
  }

  const tags = toBoolean(step.with?.['fetch-tags']);
  if (tags !== undefined) {
    clone.tags = tags;
  }

  return Object.keys(clone).length > 0 ? { clone } : {};
};
