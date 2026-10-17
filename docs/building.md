# Building the image #

Most users never need to build the image — pull a published tag as described in
the [project README](../README.md).  This guide is for contributors and for the
rare case where a locally built or pre-loaded image is useful.

## Building from source ##

Build the image using this git repository as the
[build context](https://docs.docker.com/engine/reference/commandline/build/#git-repositories):

```console
docker build \
  --build-arg CONTAINER_VERSION=14.369.0 \
  --build-arg FOUNDRY_VERSION=14.369 \
  --tag ghcr.io/felddy/foundryvtt:14.369.0 \
  https://github.com/felddy/foundryvtt-docker.git#develop
```

## Building from a clone ##

The image builds are defined in [`docker-bake.hcl`](../docker-bake.hcl) and
run with [Bun](https://bun.sh), which supplies the versions from
`src/version.txt`:

```console
git clone https://github.com/felddy/foundryvtt-docker.git
cd foundryvtt-docker
bun run image                    # the image for your platform
bun run image multiarch --push   # every published platform
```

Arguments after `bun run image` are passed to `docker buildx bake`.  For a
pre-installed build from a clone, set `FOUNDRY_USERNAME` and
`FOUNDRY_PASSWORD` (or `FOUNDRY_RELEASE_URL`) in the environment and run
`bun run image preinstall`.

## Cross-platform builds ##

The image supports the `linux/amd64` and `linux/arm64` platforms, the
architectures for which [Bun](https://bun.sh), which runs Foundry and the
container's utilities, is published.  To build for a platform other than
your own, use Docker's
[`buildx`](https://docs.docker.com/buildx/working-with-buildx/) feature:

1. Clone the project:

    ```console
    git clone https://github.com/felddy/foundryvtt-docker.git
    cd foundryvtt-docker
    ```

1. Build with `buildx`, selecting the target platform:

    ```console
    docker buildx build \
      --platform linux/amd64 \
      --build-arg CONTAINER_VERSION=14.369.0 \
      --build-arg FOUNDRY_VERSION=14.369 \
      --output type=docker \
      --tag ghcr.io/felddy/foundryvtt:14.369.0 .
    ```

## Pre-installed distribution builds ##

A Foundry Virtual Tabletop distribution can be installed into the image at
build time.  The resulting image is significantly larger, but it starts faster
because nothing is downloaded at startup, and authentication happens at build
time rather than at run time.

### Build with credentials ###

> [!NOTE]
> Credentials are only used to fetch a distribution; they are not stored in the
> resulting image.

```console
docker build \
  --build-arg CONTAINER_VERSION=14.369.0 \
  --build-arg FOUNDRY_VERSION=14.369 \
  --secret id=foundry_username,src=<(echo "<your_username>") \
  --secret id=foundry_password,src=<(echo "<your_password>") \
  --tag ghcr.io/felddy/foundryvtt:14.369.0 \
  https://github.com/felddy/foundryvtt-docker.git#develop
```

> [!TIP]
> If your credentials are stored in a json file, as described in the
> [secrets](../README.md#secrets) reference, extract and pass them as build
> secrets:
>
> ```console
> docker build \
>   --build-arg CONTAINER_VERSION=14.369.0 \
>   --build-arg FOUNDRY_VERSION=14.369 \
>   --secret id=foundry_username,src=<(jq -r '.foundry_username' path/to/credentials.json) \
>   --secret id=foundry_password,src=<(jq -r '.foundry_password' path/to/credentials.json) \
>   --tag ghcr.io/felddy/foundryvtt:14.369.0 \
>   https://github.com/felddy/foundryvtt-docker.git#develop
> ```

More information about Docker build secrets is in the
[Docker documentation](https://docs.docker.com/build/building/secrets/).

### Build with a temporary URL ###

```console
docker build \
  --build-arg CONTAINER_VERSION=14.369.0 \
  --build-arg FOUNDRY_VERSION=14.369 \
  --build-arg FOUNDRY_RELEASE_URL='<temporary_url>' \
  --tag ghcr.io/felddy/foundryvtt:14.369.0 \
  https://github.com/felddy/foundryvtt-docker.git#develop
```
