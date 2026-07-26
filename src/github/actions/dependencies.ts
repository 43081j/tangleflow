import type { ActionConverter } from './types.js';
import type { Step as GitHubStep } from '../types.js';
import { convertNodejs } from './setup-node.js';

type PackageConverter = (
  registry: string,
  pkg: string,
) => GitHubStep | undefined;

const DEFAULT_REGISTRY = 'nixpkgs';
const PACKAGE_CONVERTERS: PackageConverter[] = [convertNodejs];

/**
 * Convert a single package into the `uses` step that provides it. Throws when no
 * converter recognises it, rather than dropping it silently.
 */
function convertPackage(registry: string, pkg: string): GitHubStep {
  for (const convert of PACKAGE_CONVERTERS) {
    const step = convert(registry, pkg);
    if (step) {
      return step;
    }
  }

  throw new Error(
    `Unsupported dependency: ${registry} package "${pkg}" has no GitHub equivalent`,
  );
}

/**
 * Convert a nixery `dependencies` map into the `uses` steps that provide its
 * packages, in registry then declaration order.
 */
function convertNixeryDependencies(
  dependencies: Record<string, string[]> | undefined,
): GitHubStep[] {
  const steps: GitHubStep[] = [];
  for (const [registry, packages] of Object.entries(dependencies ?? {})) {
    for (const pkg of packages) {
      steps.push(convertPackage(registry, pkg));
    }
  }
  return steps;
}

/**
 * Convert a microvm `dependencies` list into the `uses` steps that provide its
 * packages, in order. A microvm's packages carry no registry, so they are
 * resolved against nixpkgs.
 */
function convertMicrovmDependencies(
  dependencies: string[] | undefined,
): GitHubStep[] {
  return (dependencies ?? []).map((pkg) =>
    convertPackage(DEFAULT_REGISTRY, pkg),
  );
}

/**
 * Map a tangled workflow's dependencies onto the `uses` steps that provide
 * them, resolving each package against the engine that declared it.
 */
export const convertDependencies: ActionConverter = (workflow) =>
  workflow.engine === 'nixery'
    ? convertNixeryDependencies(workflow.dependencies)
    : convertMicrovmDependencies(workflow.dependencies);
