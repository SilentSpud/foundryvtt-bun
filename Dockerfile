# syntax=docker/dockerfile:1

ARG CONTAINER_VERSION
ARG FOUNDRY_RELEASE_URL
ARG FOUNDRY_VERSION
# DEBIAN_SUITE must match the Debian release the Bun image (the FROM line of
# patched-base) is built on; it selects the archives tracked by the
# archive-state stage.
ARG DEBIAN_SUITE=trixie
ARG FOUNDRYVTT_CLI_VERSION=3.0.5

# This stage exists solely to track the state of the Debian archives that carry
# security fixes.  BuildKit revalidates remote ADD sources on every build and
# derives their cache key from the fetched content, so patched-base below - and
# everything downstream of it - is invalidated exactly when these archives are
# republished.  Without this, the RUN in patched-base would be cached
# indefinitely and would silently stop applying new security updates.
#
# The InRelease files are architecture independent (~45 KB each) and are only
# bind-mounted, so nothing from this stage is committed to any image layer.
FROM scratch AS archive-state
ARG DEBIAN_SUITE
ADD https://deb.debian.org/debian-security/dists/${DEBIAN_SUITE}-security/InRelease /security
ADD https://deb.debian.org/debian/dists/${DEBIAN_SUITE}-updates/InRelease /updates

# Bun runs everything in this image: the container utilities (entrypoint,
# health check, account helpers, fvtt wrapper) and Foundry itself.  There is
# no Node.js.  The glibc-based (Debian) Bun image is used rather than Alpine
# because Foundry's LevelDB addon (classic-level) ships no musl build for
# arm64.  Bun is published for amd64 and arm64 only, which bounds this
# image's platforms.  Apply Debian security updates for every downstream
# stage, including those that handle credentials and untrusted downloads:
# the upstream rootfs is built from the main archive only, so fixes published
# to <suite>-security are absent until a point release folds them in.
FROM oven/bun:1.4.3-slim AS patched-base
RUN --mount=type=bind,from=archive-state,target=/run/archive-state \
  apt-get update \
  && apt-get upgrade -y --with-new-pkgs \
  && rm -rf /var/lib/apt/lists/*

FROM patched-base AS base

# Install the Foundry VTT CLI in an isolated stage.  The final stage copies
# only the installed package tree.  The CLI's argument parser (yargs) reports
# the version of the nearest package.json above its node_modules, which is
# this install directory's manifest, so the manifest carries the CLI's
# version.
FROM base AS fvtt-cli-stage
ARG FOUNDRYVTT_CLI_VERSION
WORKDIR /usr/local/lib/foundryvtt-cli
RUN printf '{"name":"foundryvtt-cli-install","private":true,"version":"%s"}\n' \
  "${FOUNDRYVTT_CLI_VERSION}" > package.json \
  && bun add --exact --production "@foundryvtt/foundryvtt-cli@${FOUNDRYVTT_CLI_VERSION}" \
  && test -f node_modules/@foundryvtt/foundryvtt-cli/fvtt.mjs

# Bundle each utility into a standalone script; the bundles carry their
# dependencies, so the final image needs no node_modules for them.
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

# This stage is optional and will only be executed if the FOUNDRY_RELEASE_URL or
# FOUNDRY_USERNAME and FOUNDRY_PASSWORD secrets are provided.  It will download
# and extract the Foundry VTT release for inclusion in the final stage.

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
# The home directory keeps its historical path so existing mounts and
# documentation stay valid.  It is owned by root and readable by the image's
# UID 1000 (bun) user, as before.
ENV HOME=/home/node

WORKDIR $HOME

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
# The entrypoint extracts releases with unzip, runs patch scripts with bash,
# and reports mounts with findmnt; curl, jq, patch, and sed stay available to
# user patch scripts.
RUN mkdir -p resources /data \
  && chmod a+rx /home/node \
  && chmod a+rwx resources /data \
  && apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  curl \
  jq \
  patch \
  sed \
  tzdata \
  unzip \
  util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && echo ${CONTAINER_VERSION} > image_version.txt

# The Foundry VTT CLI, wrapped by fvtt.js which pins its configuration to a
# writable, persistent location.  See the "Foundry VTT CLI" section of the
# README for usage.
COPY --from=fvtt-cli-stage /usr/local/lib/foundryvtt-cli /usr/local/lib/foundryvtt-cli
COPY --from=build-stage /root/dist/fvtt.js /usr/local/bin/fvtt

VOLUME ["/data"]
# HTTP Server
EXPOSE 30000/tcp
# TURN Server
# Not exposing TURN ports due to bug in Docker.
# See: https://github.com/moby/moby/issues/11185
# EXPOSE 33478/udp
# EXPOSE 49152-65535/udp

USER bun
ENTRYPOINT ["./entrypoint.js"]
CMD ["resources/app/main.mjs", "--port=30000", "--headless", "--noupdate",\
  "--dataPath=/data"]
HEALTHCHECK --start-period=3m --interval=30s --timeout=5s CMD ./check_health.js
