import type { Workflow } from '../../tangled/types.js';
import type { Step as GitHubStep } from '../types.js';

/**
 * Converts one aspect of a tangled workflow into the leading `uses` steps that
 * provide it, in the order they must run. Returns an empty list when the
 * workflow needs none.
 */
export type ActionConverter = (workflow: Workflow) => GitHubStep[];
