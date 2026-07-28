# Compatibility

Tracks what tangleflow can currently convert in each direction.

## GitHub → tangled

One of the major hurdles of translating github workflows to tangled CI is the extensive use of custom github actions that don't have a direct Tangled equivalent. Each action has to be translated individually. We track compatibility with popular actions in the table below. Feel free to open a PR if there's a particular action you need supported.

| Action                                                                            | Status | Notes                                                                          |
| --------------------------------------------------------------------------------- | :----: | ------------------------------------------------------------------------------ |
| [actions/checkout](https://github.com/actions/checkout)                           |   ✅   | Maps to `clone` options; `ref` and `path` are ignored                          |
| [actions/setup-node](https://github.com/actions/setup-node)                       |   🚧   | Becomes a `nixpkgs` dependency; `cache` input ignored                          |
| [Azure/static-web-apps-deploy](https://github.com/Azure/static-web-apps-deploy)   |   ❌   |                                                                                |
| [actions/upload-artifact](https://github.com/actions/upload-artifact)             |   ❌   |                                                                                |
| [actions/setup-python](https://github.com/actions/setup-python)                   |   ❌   |                                                                                |
| [actions/cache](https://github.com/actions/cache)                                 |   ❌   | May be unnecessary — dependencies come from the Nix store                      |
| [actions/deploy-pages](https://github.com/actions/deploy-pages)                   |   ❌   |                                                                                |
| [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact) |   ❌   |                                                                                |
| [actions/configure-pages](https://github.com/actions/configure-pages)             |   ❌   |                                                                                |
| [actions/setup-java](https://github.com/actions/setup-java)                       |   ❌   |                                                                                |
| [docker/login-action](https://github.com/docker/login-action)                     |   ❌   |                                                                                |
| [actions/download-artifact](https://github.com/actions/download-artifact)         |   ❌   |                                                                                |
| [docker/build-push-action](https://github.com/docker/build-push-action)           |   ❌   |                                                                                |
| [docker/setup-buildx-action](https://github.com/docker/setup-buildx-action)       |   ❌   |                                                                                |
| [actions/setup-go](https://github.com/actions/setup-go)                           |   ❌   |                                                                                |
| [docker/metadata-action](https://github.com/docker/metadata-action)               |   ❌   |                                                                                |
| [actions/github-script](https://github.com/actions/github-script)                 |   ❌   |                                                                                |
| [docker/setup-qemu-action](https://github.com/docker/setup-qemu-action)           |   ❌   |                                                                                |
| [codecov/codecov-action](https://github.com/codecov/codecov-action)               |   ❌   |                                                                                |
| [actions/setup-dotnet](https://github.com/actions/setup-dotnet)                   |   ❌   |                                                                                |
| [pnpm/action-setup](https://github.com/pnpm/action-setup)                         |   ✅   | Becomes a `nixpkgs` dependency; `run_install: true` adds a `pnpm install` step |

## tangled → GitHub

TBD.
