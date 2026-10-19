# syntax=docker/dockerfile:1

ARG BUN_IMAGE=oven/bun:1.4.3-slim
# Must match the Debian release BUN_IMAGE is built on.
ARG DEBIAN_SUITE=trixie

# BuildKit revalidates remote ADDs every build, so the upgrade layer rebuilds
# exactly when the security archives are republished instead of caching
# forever.  The files are only bind-mounted, never committed to a layer.
FROM scratch AS archive-state
ARG DEBIAN_SUITE
ADD https://deb.debian.org/debian-security/dists/${DEBIAN_SUITE}-security/InRelease /security
ADD https://deb.debian.org/debian/dists/${DEBIAN_SUITE}-updates/InRelease /updates

# The bundles are plain JavaScript that carry their dependencies, so build
# them natively on the build host (no emulation for foreign platforms) and
# leave node_modules behind.  Kept as a stage so the final image's COPYs are
# keyed on each bundle's content, not on every source change.
FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS build-stage
WORKDIR /root
COPY package.json bun.lock tsconfig.json ./
# Bun.build needs only the runtime dependencies; skipping scripts keeps the
# husky prepare hook (and any dependency hooks) out of the build.
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --production --ignore-scripts
COPY src/ src/
COPY tools/build.ts tools/
RUN bun run build

# Debian, not Alpine: Foundry's LevelDB addon has no musl build for arm64.
FROM ${BUN_IMAGE} AS final-stage

ARG CONTAINER_VERSION
ARG FOUNDRY_VERSION

RUN test -n "${CONTAINER_VERSION}" || { echo "ERROR: CONTAINER_VERSION must be passed as --build-arg"; exit 1; } ; \
    test -n "${FOUNDRY_VERSION}" || { echo "ERROR: FOUNDRY_VERSION must be passed as --build-arg"; exit 1; }

LABEL com.foundryvtt.version=${FOUNDRY_VERSION}
LABEL org.opencontainers.image.authors="1478389+SilentSpud@users.noreply.github.com"
LABEL org.opencontainers.image.vendor="SilentSpud"

# The upstream rootfs lacks <suite>-security fixes until a point release, so
# apply them in the same layer as the packages.  The entrypoint extracts
# releases with unzip; curl, jq, and patch are for user patch scripts.  bash,
# sed, and findmnt (util-linux) are Essential in Debian.
RUN --mount=type=bind,from=archive-state,target=/run/archive-state \
  apt-get update \
  && apt-get upgrade -y --with-new-pkgs \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    jq \
    patch \
    tzdata \
    unzip \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/log/apt /var/log/dpkg.log

# Installed straight from its lockfile, which a bare `bun add --global` would
# ignore.  yargs reports the version of the nearest package.json, which is
# this install manifest, so stamp the CLI's version into it.  fvtt.js pins the
# CLI's configuration to a writable, persistent location.
WORKDIR /usr/local/lib/foundryvtt-cli
RUN --mount=type=bind,source=docker/fvtt-cli,target=/run/fvtt-cli \
  --mount=type=cache,target=/root/.bun/install/cache \
  cp /run/fvtt-cli/package.json /run/fvtt-cli/bun.lock ./ \
  && bun install --frozen-lockfile --production --backend=copyfile \
  && bun pm pkg set "version=$(bun -p 'require("@foundryvtt/foundryvtt-cli/package.json").version')" \
  && test -f node_modules/@foundryvtt/foundryvtt-cli/fvtt.mjs
COPY --from=build-stage /root/dist/fvtt.js /usr/local/bin/fvtt

ENV FOUNDRY_VERSION=${FOUNDRY_VERSION}
# Historical path, kept so existing mounts and documentation stay valid.
ENV HOME=/home/node
WORKDIR $HOME

COPY --from=build-stage \
  /root/dist/authenticate.js \
  /root/dist/check_health.js \
  /root/dist/entrypoint.js \
  /root/dist/get_license.js \
  /root/dist/get_release_url.js \
  ./
# Log helpers for user patch scripts (CONTAINER_PATCHES, CONTAINER_PATCH_URLS).
COPY src/logging.sh ./
RUN mkdir -p resources /data \
  && chmod a+rx /home/node \
  && chmod a+rwx resources /data \
  && echo "${CONTAINER_VERSION}" > image_version.txt

VOLUME ["/data"]
EXPOSE 30000/tcp
# TURN ports are not exposed: https://github.com/moby/moby/issues/11185
# EXPOSE 33478/udp
# EXPOSE 49152-65535/udp

USER bun
ENTRYPOINT ["./entrypoint.js"]
CMD ["resources/app/main.mjs", "--port=30000", "--headless", "--noupdate",\
  "--dataPath=/data"]
HEALTHCHECK --start-period=3m --interval=30s --timeout=5s CMD ./check_health.js
