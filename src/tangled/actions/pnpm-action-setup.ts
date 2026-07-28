import { parse } from 'yaml';
import type { ActionConversion, ActionConverter } from './types.js';
import type { Step as GitHubStep } from '../../github/types.js';
import type { WorkflowStep } from '../types.js';

interface RunInstall {
  recursive?: boolean;
  cwd?: string;
  args?: string[];
}

function isRunInstall(value: unknown): value is RunInstall {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract the leading major version number from a GitHub action input, e.g.
 * `11`, `11.x` and `v11.7.0` all yield `11`.
 */
function majorVersion(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const match = /^\s*v?(\d+)/.exec(String(value));
  return match ? match[1] : undefined;
}

/**
 * Parse a single install command given through the `run_install` input
 */
function toInstallCommand(run: RunInstall): string {
  return [
    'pnpm',
    'install',
    run.cwd && `--dir ${run.cwd}`,
    run.recursive && '--recursive',
    ...(run.args ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

/*
 * Takes https://github.com/pnpm/action-setup#run_install as input
 * and returns a list of install steps that the parameter would produce
 */
function toInstallSteps(value: unknown): WorkflowStep[] | undefined {
  const parsed = typeof value === 'string' ? parse(value) : value;

  if (!parsed) return undefined;
  if (parsed === true) {
    return [{ command: toInstallCommand({ recursive: true }) }];
  }

  const runs = Array.isArray(parsed) ? parsed : [parsed];

  return runs.map((run) => {
    if (!isRunInstall(run)) {
      throw new Error(`Unsupported run_install: ${JSON.stringify(run)}`);
    }
    return { command: toInstallCommand(run) };
  });
}

/**
 * Map `pnpm/action-setup` onto a `pnpm` nixpkgs dependency. A numeric
 * `version` selects the matching major package (e.g. `pnpm_11`);
 * anything else falls back to the default `pnpm`.
 */
export const convertPnpmActionSetup: ActionConverter = (step: GitHubStep) => {
  const major = majorVersion(step.with?.['version']);
  const pkg = major !== undefined ? `pnpm_${major}` : 'pnpm';
  const conversion: ActionConversion = { dependencies: { nixpkgs: [pkg] } };

  const installSteps = toInstallSteps(step.with?.['run_install']);
  if (installSteps !== undefined && installSteps.length > 0) {
    conversion.steps = installSteps;
  }

  return conversion;
};
