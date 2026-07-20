import type { WorkflowCloneOptions } from '../types.js';
import type { Step as GitHubStep } from '../../github/types.js';

/**
 * Engine and workflow configuration contributed by a known `uses` action. The
 * fields are merged into the workflow being built rather than producing a step.
 */
export interface ActionConversion {
  /**
   * nixery packages to make available, keyed by registry.
   */
  dependencies?: Record<string, string[]>;

  /**
   * Clone behaviour for the workflow's checkout.
   */
  clone?: WorkflowCloneOptions;
}

/**
 * Converts a single `uses` step into the workflow configuration it implies.
 */
export type ActionConverter = (step: GitHubStep) => ActionConversion;
