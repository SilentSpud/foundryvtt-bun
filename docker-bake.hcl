# Run through `bun run image [target]`, which derives CONTAINER_VERSION and
# FOUNDRY_VERSION from the package.json version.
#
# multiarch needs --push or another output: multi-platform images cannot be
# loaded into the classic docker image store.

variable "CONTAINER_VERSION" {
  default = ""
  validation {
    condition     = CONTAINER_VERSION != ""
    error_message = "CONTAINER_VERSION is required; build with `bun run image`."
  }
}

variable "FOUNDRY_VERSION" {
  default = ""
  validation {
    condition     = FOUNDRY_VERSION != ""
    error_message = "FOUNDRY_VERSION is required; build with `bun run image`."
  }
}

variable "IMAGE" {
  default = "ghcr.io/silentspud/foundryvtt-bun"
}

group "default" {
  targets = ["image"]
}

target "_common" {
  context    = "."
  dockerfile = "Dockerfile"
  args = {
    CONTAINER_VERSION = CONTAINER_VERSION
    FOUNDRY_VERSION   = FOUNDRY_VERSION
  }
}

target "image" {
  inherits = ["_common"]
  tags     = ["${IMAGE}:${CONTAINER_VERSION}"]
  output   = ["type=docker"]
}

target "multiarch" {
  inherits  = ["_common"]
  tags      = ["${IMAGE}:${CONTAINER_VERSION}"]
  platforms = ["linux/amd64", "linux/arm64"]
}
