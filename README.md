# 🪢 tangleflow

Converts [GitHub Actions](https://docs.github.com/actions) workflows into
[tangled](https://tangled.org) workflows and vice versa.

Use it as a command-line tool to convert the workflow files in a repository, or
as a library to convert parsed workflow objects in your own code.

## Usage

```sh
npx tangleflow --target=<tangled|gh> [file...]
```

| Option | Description |
| --- | --- |
| `--target=tangled` | Convert GitHub Actions workflows to tangled |
| `--target=gh`, `--target=github` | Convert tangled workflows to GitHub Actions |

If no files are given, every workflow in the source directory is converted:

- `--target=tangled` reads `.github/workflows/*.{yml,yaml}` and writes to
  `.tangled/workflows/`
- `--target=gh` reads `.tangled/workflows/*.{yml,yaml}` and writes to
  `.github/workflows/`

When converting to tangled, each job in a source workflow becomes its own
`.tangled/workflows/<job>.yml` file.

## Install (as a library)

```sh
npm install tangleflow
```

## API

### `convertWorkflowToTangled(workflow)`

Converts a parsed GitHub Actions workflow object into a tangled `Pipeline` (an
array of workflows, one per GitHub job).

### `convertWorkflowToGitHub(workflow, path)`

Converts a parsed tangled workflow object into a GitHub Actions workflow object.

## License

[MIT](./LICENSE)
