#!/usr/bin/env node
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { convertWorkflowToGitHub, convertWorkflowToTangled } from './main.js';
import type { HttpsJsonSchemastoreOrgGithubWorkflowJson as GitHubWorkflow } from './github/types.js';
import type { Workflow } from './tangled/types.js';

const GITHUB_DIR = '.github/workflows';
const TANGLED_DIR = '.tangled/workflows';
const YAML_EXTENSIONS = ['.yml', '.yaml'] as const;
const BIN_NAME = 'tangleflow';
const USAGE = `🪢 tangleflow

Usage: ${BIN_NAME} --target=<tangled|gh> [file...]

Convert workflows between GitHub Actions and tangled.

Options:
  --target=tangled       Convert GitHub Actions workflows to tangled
  --target=gh, --target=github
                         Convert tangled workflows to GitHub Actions

If no file is given, every workflow in the source directory is converted:
  --target=tangled  reads ${GITHUB_DIR}/*.{yml,yaml}
  --target=gh       reads ${TANGLED_DIR}/*.{yml,yaml}
`;

/**
 * Load the optional `yaml` peer dependency, throwing a helpful error if it is
 * not installed.
 */
async function loadYaml(): Promise<typeof import('yaml')> {
  try {
    return await import('yaml');
  } catch {
    throw new Error(
      'The "yaml" package is required to convert workflow files. Install it with `npm install yaml`.',
    );
  }
}

/**
 * List the YAML files in `dir`. A missing directory yields an empty list.
 */
async function findWorkflows(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  return entries
    .filter((entry) => YAML_EXTENSIONS.some((ext) => entry.endsWith(ext)))
    .map((entry) => join(dir, entry));
}

/**
 * Strip the YAML extension from a file's basename.
 */
function stripExtension(path: string): string {
  if (YAML_EXTENSIONS.some((ext) => path.endsWith(ext))) {
    const bn = basename(path);
    return bn.slice(0, bn.lastIndexOf('.'));
  }
  return basename(path);
}

/**
 * Convert GitHub Actions workflows into tangled workflows. Each job in a source
 * workflow becomes its own `.tangled/workflows/<job>.yml` file.
 */
async function convertToTangled(files: string[]): Promise<void> {
  const { parse, stringify } = await loadYaml();
  await mkdir(TANGLED_DIR, { recursive: true });

  await Promise.all(
    files.map(async (file) => {
      const workflow = parse(await readFile(file, 'utf8')) as GitHubWorkflow;
      const pipeline = convertWorkflowToTangled(workflow);
      const jobIds = Object.keys(workflow.jobs ?? {});

      await Promise.all(
        pipeline.map(async (converted, index) => {
          const name = jobIds[index] ?? stripExtension(file);
          const out = join(TANGLED_DIR, `${name}.yml`);
          await writeFile(out, stringify(converted), 'utf8');
          console.log(`wrote ${out}`);
        }),
      );
    }),
  );
}

/**
 * Convert tangled workflows into GitHub Actions workflows. Each source file
 * becomes a `.github/workflows/<name>.yml` file.
 */
async function convertToGitHub(files: string[]): Promise<void> {
  const { parse, stringify } = await loadYaml();
  await mkdir(GITHUB_DIR, { recursive: true });

  await Promise.all(
    files.map(async (file) => {
      const workflow = parse(await readFile(file, 'utf8')) as Workflow;
      const converted = convertWorkflowToGitHub(workflow, file);
      const out = join(GITHUB_DIR, `${stripExtension(file)}.yml`);
      await writeFile(out, stringify(converted), 'utf8');
      console.log(`wrote ${out}`);
    }),
  );
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      target: { type: 'string' },
    },
    allowPositionals: true,
  });

  if (values.target === undefined) {
    if (positionals.length > 0) {
      throw new Error('Missing required option `--target`.');
    }
    process.stdout.write(USAGE);
    return;
  }

  switch (values.target) {
    case 'tangled': {
      const files = positionals.length
        ? positionals
        : await findWorkflows(GITHUB_DIR);
      await convertToTangled(files);
      break;
    }
    case 'gh':
    case 'github': {
      const files = positionals.length
        ? positionals
        : await findWorkflows(TANGLED_DIR);
      await convertToGitHub(files);
      break;
    }
    default:
      throw new Error(
        `Unknown target "${values.target}". Expected "tangled", "gh" or "github".`,
      );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
