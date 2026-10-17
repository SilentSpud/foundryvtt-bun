# Welcome

We're so glad you're thinking about contributing to this open source
project! If you're unsure or afraid of anything, just ask or submit
the issue or pull request anyway. The worst that can happen is that
you'll be politely asked to change something. We appreciate any sort
of contribution, and don't want a wall of rules to get in the way of
that.

Before contributing, we encourage you to read our CONTRIBUTING policy
(you are here), our [LICENSE](LICENSE), and our [README](README.md),
all of which should be in this repository.

## Issues

If you want to report a bug or request a new feature, the most direct
method is to [create an
issue](https://github.com/felddy/foundryvtt-docker/issues) in this
repository. We recommend that you first search through existing
issues (both open and closed) to check if your particular issue has
already been reported. If it has then you might want to add a comment
to the existing issue. If it hasn't then feel free to create a new
one.

## Pull requests

If you choose to [submit a pull
request](https://github.com/felddy/foundryvtt-docker/pulls), you will
notice that our continuous integration (CI) system runs a fairly
extensive set of linters and syntax checkers. Your pull request may
fail these checks, and that's OK. If you want you can stop there and
wait for us to make the necessary corrections to ensure your code
passes the CI checks.

If you want to make the changes yourself, or if you want to become a
regular contributor, then you will want to set up
[pre-commit](https://pre-commit.com/) on your local machine. Once you
do that, the CI checks will run locally before you even write your
commit message. This speeds up your development cycle considerably.

### Setting up a development environment

The container's utilities, tests, and tooling are written in TypeScript and
run with [Bun](https://bun.sh). Install Bun, then run:

```console
bun run setup
```

This installs the project dependencies, installs the git pre-commit hooks
(when [pre-commit](https://pre-commit.com/) is available, for example via
`pipx install pre-commit` or `brew install pre-commit`), and configures
the git remotes for upstream "lineage" repositories.

Common tasks:

| Command                   | Purpose                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| `bun check`               | Type-check the sources, tests, and tools.                                    |
| `bun test tests/unit`     | Run the unit tests.                                                          |
| `bun run image`           | Build the container image with `docker buildx bake` (see `docker-bake.hcl`). |
| `bun run test:container`  | Run the container tests against the built image.                             |
| `bun run version`         | Print the container and Foundry versions.                                    |
| `bun run release <x.y.z>` | Set a new version and commit it.                                             |
| `bun run lint`            | Type-check, lint with oxlint, and check formatting with oxfmt.               |
| `bun run format`          | Format the TypeScript, Markdown, and YAML files with oxfmt.                  |

The container tests need Docker. They run without credentials using a fake
release archive; set `FOUNDRY_USERNAME` and `FOUNDRY_PASSWORD` to also
download and start a real release.

At this point the pre-commit checks will run against any files that you
attempt to commit. If you want to run the checks against the entire repo,
just execute `pre-commit run --all-files`.

## License

This project is released as open source under the [MIT license](LICENSE).

All contributions to this project will be released under the same MIT license.
By submitting a pull request, you are agreeing to comply with this waiver of
copyright interest.
