#!/usr/bin/env bash
# Run the Trivy image pinned in docker/trivy/Dockerfile on the working
# directory, which must hold trivy.yaml.  TRIVY_USERNAME and TRIVY_PASSWORD
# pass through for registry scans.
set -Eeuo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
image=$(sed -n 's/^FROM //p' "${root}/docker/trivy/Dockerfile")
cache=${TRIVY_HOST_CACHE:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/trivy-cache}
mkdir -p "$cache"

exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --env TRIVY_CACHE_DIR=/cache \
  --env TRIVY_USERNAME \
  --env TRIVY_PASSWORD \
  --volume "${cache}:/cache" \
  --volume "${PWD}:/work" \
  --workdir /work \
  "$image" "$@"
