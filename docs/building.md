# Building the image

Most users should pull a published tag as described in the
[project README](../README.md). This guide is for contributors, and for the
occasional case where you need a locally built image.

## Building from source

Build the image using this git repository as the
[build context](https://docs.docker.com/build/concepts/context/#git-repositories):

```console
docker build \
  --build-arg CONTAINER_VERSION=14.369.0 \
  --build-arg FOUNDRY_VERSION=14.369 \
  --tag ghcr.io/silentspud/foundryvtt-bun:14.369.0 \
  https://github.com/SilentSpud/foundryvtt-bun.git#main
```

## Building from a clone

The image builds are defined in [`docker-bake.hcl`](../docker-bake.hcl) and
run with [Bun](https://bun.sh), which supplies the versions from the
`version` field in `package.json`:

```console
git clone https://github.com/SilentSpud/foundryvtt-bun.git
cd foundryvtt-bun
bun run image                    # the image for your platform
bun run image multiarch --push   # every published platform
```

Arguments after `bun run image` are passed to `docker buildx bake`.

## Cross-platform builds

The image supports `linux/amd64` and `linux/arm64`, the platforms
[Bun](https://bun.sh) is published for. To build for a platform other than your
own, use Docker's
[multi-platform builds](https://docs.docker.com/build/building/multi-platform/):

1. Clone the project:

   ```console
   git clone https://github.com/SilentSpud/foundryvtt-bun.git
   cd foundryvtt-bun
   ```

1. Build with `buildx`, selecting the target platform:

   ```console
   docker buildx build \
     --platform linux/amd64 \
     --build-arg CONTAINER_VERSION=14.369.0 \
     --build-arg FOUNDRY_VERSION=14.369 \
     --output type=docker \
     --tag ghcr.io/silentspud/foundryvtt-bun:14.369.0 .
   ```
