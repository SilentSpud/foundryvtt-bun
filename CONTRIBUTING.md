# Contributing

Thanks for considering a contribution. If you're unsure about anything, ask,
or open the issue or pull request anyway. The worst that can happen is a
polite request to change something.

Before contributing, read this guide, the [LICENSE](LICENSE), and the
[README](README.md).

## Issues

To report a bug or request a feature,
[open an issue](https://github.com/SilentSpud/foundryvtt-bun/issues). Search
existing issues, open and closed, first. If yours is already there, add a
comment to it instead.

## Pull requests

If you choose to [submit a pull
request](https://github.com/SilentSpud/foundryvtt-bun/pulls), you will
notice that CI runs a set of linters and syntax checkers. If your pull request
fails them, that's OK. You can leave it there and we'll make the fixes.

To fix them yourself, or if you plan to contribute regularly, set up the
development environment below. Its pre-commit hook runs the CI lint checks
locally before you write your commit message.

### Setting up a development environment

The container's utilities, tests, and tooling are written in TypeScript and
run with [Bun](https://bun.sh). Install Bun, then run:

```console
bun install
```

This installs the project dependencies and, through the `prepare` script,
the git pre-commit hook with [husky](https://typicode.github.io/husky/).

Common tasks:

| Command                   | Purpose                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| `bun run typecheck`       | Type-check the sources, tests, and tools with `bun check`.                   |
| `bun test tests/unit`     | Run the unit tests.                                                          |
| `bun run image`           | Build the container image with `docker buildx bake` (see `docker-bake.hcl`). |
| `bun run test:container`  | Run the container tests against the built image.                             |
| `bun run version`         | Print the container and Foundry versions.                                    |
| `bun run release <x.y.z>` | Set a new version in `package.json`; commit it and open a pull request.      |
| `bun run format`          | Format the TypeScript, YAML, JSON, and Markdown files with oxfmt.            |
| `bun run lint`            | Run the type check, oxlint, format check, and file checks, as CI does.       |

The container tests need Docker. They run without credentials using a fake
release archive; set `FOUNDRY_USERNAME` and `FOUNDRY_PASSWORD` to also
download and start a real release.

At this point `bun run lint` runs before every commit. The file checks read
staged content, so stage your changes before running them by hand.

## License

This project is released as open source under the [MIT license](LICENSE).

All contributions to this project will be released under the same MIT license.
By submitting a pull request, you are agreeing to comply with this waiver of
copyright interest.
