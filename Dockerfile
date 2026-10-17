# syntax=docker/dockerfile:1

ARG CONTAINER_VERSION
ARG FOUNDRY_RELEASE_URL
ARG FOUNDRY_VERSION
# Must match the Debian release the Bun image in patched-base is built on.
ARG DEBIAN_SUITE=trixie

# BuildKit revalidates remote ADDs every build, so patched-base rebuilds exactly
# when the security archives are republished instead of caching its upgrade
# forever.  The files are only bind-mounted, never committed to a layer.
FROM scratch AS archive-state
ARG DEBIAN_SUITE
ADD https://deb.debian.org/debian-security/dists/${DEBIAN_SUITE}-security/InRelease /security
ADD https://deb.debian.org/debian/dists/${DEBIAN_SUITE}-updates/InRelease /updates

# Debian, not Alpine: Foundry's LevelDB addon has no musl build for arm64.
# The upstream rootfs lacks <suite>-security fixes until a point release, so
# apply them here for every downstream stage.
FROM oven/bun:1.4.3-slim AS patched-base
RUN --mount=type=bind,from=archive-state,target=/run/archive-state \
  apt-get update \
  && apt-get upgrade -y --with-new-pkgs \
  && rm -rf /var/lib/apt/lists/*

FROM patched-base AS base

# yargs reports the version of the nearest package.json, which is this
# install manifest, so stamp the CLI's version into it.
FROM base AS fvtt-cli-stage
WORKDIR /usr/local/lib/foundryvtt-cli
COPY docker/fvtt-cli/package.json docker/fvtt-cli/bun.lock ./
RUN bun install --frozen-lockfile --production \
  && bun pm pkg set "version=$(bun -p 'require("@foundryvtt/foundryvtt-cli/package.json").version')" \
  && test -f node_modules/@foundryvtt/foundryvtt-cli/fvtt.mjs

# The bundles carry their dependencies, so the final image needs no node_modules.
FROM base AS build-stage

WORKDIR /root

COPY \
  package.json \
  bun.lock \
  tsconfig.json \
  ./
RUN bun install --frozen-lockfile
COPY /src/ src/
COPY /tools/build.ts tools/
RUN bun run build

FROM base AS optional-release-stage

# Produces an empty dist/ unless credentials or FOUNDRY_RELEASE_URL are given.

ARG FOUNDRY_RELEASE_URL
ARG FOUNDRY_VERSION

RUN test -n "${FOUNDRY_VERSION}" || { echo "ERROR: FOUNDRY_VERSION must be passed as --build-arg"; exit 1; }

ENV ARCHIVE="foundryvtt-${FOUNDRY_VERSION}.zip"

WORKDIR /root
COPY --from=build-stage \
  /root/dist/authenticate.js \
  /root/dist/get_release_url.js \
  ./
# .placeholder file to mitigate https://github.com/moby/moby/issues/37965
RUN mkdir dist && touch dist/.placeholder

RUN \
  --mount=type=secret,id=foundry_username,required=false \
  --mount=type=secret,id=foundry_password,required=false \
  if [ -f /run/secrets/foundry_username ] && [ -f /run/secrets/foundry_password ]; then \
  ./authenticate.js "$(cat /run/secrets/foundry_username)" "$(cat /run/secrets/foundry_password)" cookiejar.json && \
  presigned_url=$(./get_release_url.js --retry 5 cookiejar.json "${FOUNDRY_VERSION}") && \
  rm -f cookiejar.json && \
  DOWNLOAD_URL="${presigned_url}"; \
  elif [ -n "${FOUNDRY_RELEASE_URL}" ]; then \
  DOWNLOAD_URL="${FOUNDRY_RELEASE_URL}"; \
  else \
  echo "No valid credentials or pre-signed URL provided. Skipping pre-installation."; \
  fi && \
  if [ -n "${DOWNLOAD_URL}" ]; then \
  apt-get update && apt-get install -y --no-install-recommends curl unzip && \
  curl --fail --location --output "${ARCHIVE}" "${DOWNLOAD_URL}" && \
  mkdir -p "dist/resources/app" && \
  unzip -d "dist/resources/app" "${ARCHIVE}"; \
  fi

FROM base AS final-stage

ARG CONTAINER_VERSION
ARG FOUNDRY_VERSION
ARG TARGETPLATFORM

RUN test -n "${CONTAINER_VERSION}" || { echo "ERROR: CONTAINER_VERSION must be passed as --build-arg"; exit 1; } ; \
    test -n "${FOUNDRY_VERSION}" || { echo "ERROR: FOUNDRY_VERSION must be passed as --build-arg"; exit 1; }

LABEL com.foundryvtt.version=${FOUNDRY_VERSION}
LABEL org.opencontainers.image.authors="markf+github@geekpad.com"
LABEL org.opencontainers.image.vendor="Geekpad"

ENV FOUNDRY_VERSION=${FOUNDRY_VERSION}
# Historical path, kept so existing mounts and documentation stay valid.
ENV HOME=/home/node

WORKDIR $HOME

# Packages come before the application files so this layer stays cached
# across code changes.  The entrypoint extracts releases with unzip, runs
# patch scripts with bash, and reports mounts with findmnt; curl, jq, patch,
# and sed stay available to user patch scripts.
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  curl \
  jq \
  patch \
  sed \
  tzdata \
  unzip \
  util-linux \
  && rm -rf /var/lib/apt/lists/*

COPY --from=optional-release-stage /root/dist/ .
COPY --from=build-stage \
  /root/dist/authenticate.js \
  /root/dist/check_health.js \
  /root/dist/entrypoint.js \
  /root/dist/get_license.js \
  /root/dist/get_release_url.js \
  ./
# Log helpers for user patch scripts (CONTAINER_PATCHES, CONTAINER_PATCH_URLS).
COPY src/logging.sh ./
# After the COPYs, which can reset the mode of an existing resources/.
RUN mkdir -p resources /data \
  && chmod a+rx /home/node \
  && chmod a+rwx resources /data \
  && echo "${CONTAINER_VERSION}" > image_version.txt

# fvtt.js pins the CLI's configuration to a writable, persistent location.
COPY --from=fvtt-cli-stage /usr/local/lib/foundryvtt-cli /usr/local/lib/foundryvtt-cli
COPY --from=build-stage /root/dist/fvtt.js /usr/local/bin/fvtt

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
