import type { ActionConversion, ActionConverter } from './types.js';
import type { Step as GitHubStep } from '../../github/types.js';
import { convertSetupNode } from './setup-node.js';

export type { ActionConversion, ActionConverter } from './types.js';

/**
 * Known `uses` actions, keyed by their reference with any version ref stripped.
 */
const ACTION_CONVERTERS: Record<string, ActionConverter> = {
  'actions/setup-node': convertSetupNode,
};

/**
 * Convert a `uses` step into the workflow configuration it implies. `uses` is
 * the raw action reference (e.g. `actions/setup-node@v4`); its version ref is
 * ignored. Returns `undefined` when the action has no known conversion.
 */
export function convertAction(
  uses: string,
  step: GitHubStep,
): ActionConversion | undefined {
  const at = uses.indexOf('@');
  const name = at === -1 ? uses : uses.slice(0, at);
  return ACTION_CONVERTERS[name]?.(step);
}
