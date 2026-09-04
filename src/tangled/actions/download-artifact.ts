import type { ActionConverter } from './types.js';

/**
 * Tangled currently (04.09.2026) doesn't offer functionality similar to GHA CI artifacts
 */
export const convertDownloadArtifact: ActionConverter = (step) => {
  throw new Error(
    `Unsupported action "${step.uses}": per-run artifacts have no tangled equivalent`,
  );
};
