<div align="center">

<img width="460"
  src="https://raw.githubusercontent.com/SilentSpud/foundryvtt-bun/main/assets/logo.png"
  alt="Docker whale logo carrying the FoundryVTT icosahedron logo while floating
  in water.">
</div>

# foundryvtt-bun

[![Build](https://github.com/SilentSpud/foundryvtt-bun/actions/workflows/build.yml/badge.svg)](https://github.com/SilentSpud/foundryvtt-bun/actions/workflows/build.yml)

[![FoundryVTT Release Version: v14.369](https://img.shields.io/badge/release-v14.369-brightgreen?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAAXNSR0IArs4c6QAAAIRlWElmTU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAA6gAwAEAAAAAQAAAA4AAAAATspU+QAAAAlwSFlzAAALEwAACxMBAJqcGAAAAVlpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDUuNC4wIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6dGlmZj0iaHR0cDovL25zLmFkb2JlLmNvbS90aWZmLzEuMC8iPgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KTMInWQAAAiFJREFUKBVVks1rE1EUxc+d5tO0prZVSZsUhSBIPyC02ooWurJ0I7rQlRvdC/4N4h9gt7pyoRTswpWgILgQBIOIiC340VhbpC0Ek85MGmPmXc+baWpNGJg77/7uOffeB+z9FHB0FrH9eLwwqpOF0f34KrpsTicW+6L8KE8QhO/n8n1IOgtQHYZA+a/Ai9+Wd6v1g7liq5A2OjKSQNa9hkO4hAzOIylf6CHALk6hoWXsylPkfjyyApaJhVCxmERy5zLSuI7D8h1H5BWht1aBhS6wdI3pN7GabyuyS4JPrchzujmNjDxAVrrRL2PoxRSGxOfjssgEjkkJvVJBWu6h5M7YenvDoOO0OgicD4TPIKWbBG6xvwTaKCMwSU7hKxK6gt8mbsFIMaF5iDyjUg6iPnqc58higCr9fD4iTvWMziAmK2g73f/AADVWX0YXrlChirgOcqL3WXYBYpTfUuxzjkW30dI1C0ZW1RnjMopo4C56MIs6CgQrMER2cJoz9zjdO2iz17g2yZUjqzHWbuA4/ugiEz7DVRe/aLxmcvDQ5Cq+oWGWeDbAgiETXgArrVOFGzR0EkclxrVMcpfLgFThY5roe2yz95ZZkzcbj22+w2VG8Pz6Q/b5Gr6uM9mw04uo6ll4tOlhE8a8xNzGYihCJoT+u3I4kUIp6OM0X9CHHds8frbqsrXlh9CB62nj8L5a9Y4DHR/K68TgcHhoz607Qp34L72X0rdSdM+vAAAAAElFTkSuQmCC)](https://foundryvtt.com/releases/14.369)
[![Platforms](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-blue)](https://github.com/SilentSpud/foundryvtt-bun/pkgs/container/foundryvtt-bun)

This image runs a [Foundry Virtual Tabletop](https://foundryvtt.com) server on
[Bun](https://bun.sh). All it needs from you is your foundryvtt.com credentials,
or a download URL, so it can install and license Foundry on first start.

This README is the reference for the image: its
[tags](#image-tags), [volumes](#volumes), [ports](#ports),
[environment variables](#environment-variables), and [secrets](#secrets). For
step-by-step setups on a particular platform, see the
[deployment guides](#deployment-guides).

## Prerequisites

- An OCI-compatible container runtime such as [Kubernetes](https://kubernetes.io/),
  [Podman](https://podman.io/), or [Docker](https://docs.docker.com/get-docker/).
- A [FoundryVTT.com](https://foundryvtt.com/auth/register/) account with a purchased
  software license.

## Quick start

To try it out, run one command. The container uses your
[foundryvtt.com](https://foundryvtt.com) credentials to install and license the
server:

```console
docker run \
  --env FOUNDRY_USERNAME='<your_username>' \
  --env FOUNDRY_PASSWORD='<your_password>' \
  --hostname my_foundry_host \
  --publish 30000:30000/tcp \
  --volume <your_data_dir>:/data \
  ghcr.io/silentspud/foundryvtt-bun:14
```

Then open [http://localhost:30000](http://localhost:30000).

> [!TIP]
> Don't want to share your password with the container? Acquire a temporary
> download URL from the [Purchased Software Licenses
> page](https://foundryvtt.com/me/licenses) (set `Operating System` to
> `Node.js`, then use the `🔗 Timed URL` button) and pass it as
> `FOUNDRY_RELEASE_URL` instead of your username and password. Sensitive values
> can also be supplied as [secrets](#using-secrets).

For a server you plan to keep, follow one of the
[deployment guides](#deployment-guides) below.

## Configuration

[Configuration options](https://foundryvtt.com/article/configuration/) are
supplied through [environment variables](#environment-variables). Each time the
container starts, it generates the configuration files Foundry needs from the
values of those variables, so **changes made in Foundry's configuration screen
are lost when the container restarts**. Set configuration in your
`compose.yaml`, Kubernetes manifest, or equivalent instead. To stop the
container from regenerating these files, set `CONTAINER_PRESERVE_CONFIG` to
`true`.

> [!IMPORTANT]
> Always set a stable hostname for the container (`hostname:` in a `compose.yaml`
> file, `--hostname` for `docker`/`podman`, or `hostname:` in a pod spec).
> Foundry binds its software license to the container hostname. If no hostname
> is set, the runtime assigns a random container ID on each start, causing
> license verification to fail after every restart.

## Using secrets

Your credentials, admin key, and license key can be supplied through a secret
file instead of environment variables. The file may have any
name, but it must be presented to the container as `config.json`. See the
[secrets](#secrets) reference below for the full list of supported keys, and the
[deployment guides](#deployment-guides) for how to wire up a secret on your
runtime.

## Deployment guides

The [deployment guides](docs/deployment/README.md) walk through each runtime
and include worked networking examples.

| Guide                                                                     | Description                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Kubernetes](docs/deployment/kubernetes/README.md)                        | Cluster deployment, including running multiple Foundry instances.                |
| [Podman](docs/deployment/podman.md)                                       | Daemonless and rootless, optionally managed by `systemd`.                        |
| [Docker Compose](docs/deployment/docker-compose.md)                       | Single-host setup with the image, configuration, storage, and ports in one file. |
| [Reverse proxy with Caddy](docs/deployment/reverse-proxy-caddy/README.md) | Automatic HTTPS in front of the server.                                          |
| [Reverse proxy with nginx](docs/deployment/reverse-proxy-nginx/README.md) | TLS termination with certificates you already have.                              |
| [Cloudflare Tunnel](docs/deployment/cloudflare-tunnel/README.md)          | Public access without port forwarding or NAT.                                    |

## Updating

The Foundry "Update Software" tab is disabled by default in this container. To
upgrade to a new version of Foundry, pull an updated image and recreate the
container. Because the recommended `:14` tag tracks the latest release for that
major version, pulling it fetches the newest version compatible with your data. Your [deployment guide](#deployment-guides) lists the exact
commands for your runtime.

## Image tags

The images of this container are tagged with [semantic
versions](https://semver.org) that align with the [version and build of Foundry
Virtual Tabletop](https://foundryvtt.com/article/versioning/) that they support.
The major and minor numbers always match the Foundry release: `14.369` runs
Foundry version 14, build 369. Patch numbers mark fixes to this image for that
same Foundry release, so `14.369.0` and `14.369.1` run the same build of
Foundry.

> [!TIP]
> Use the major version tag, `:14`. It ensures that you receive the most recent
> version of the software that is compatible with your saved data, and prevents
> inadvertent upgrades to a new major version.

| Image:tag                                    | Description                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ghcr.io/silentspud/foundryvtt-bun:14`       | The most recent image matching the major version number. Most users will use this tag.                                                                                |
| `ghcr.io/silentspud/foundryvtt-bun:14.369`   | The most recent image matching the major and minor version numbers.                                                                                                   |
| `ghcr.io/silentspud/foundryvtt-bun:14.369.0` | An exact image version.                                                                                                                                               |
| `ghcr.io/silentspud/foundryvtt-bun:release`  | The most recent image from the `stable` channel. These images are considered stable and well tested. The `latest` tag always points to the same version as `release`. |
| `ghcr.io/silentspud/foundryvtt-bun:latest`   | Same as the `release` tag. [Why does `latest` == `release`?](https://vsupalov.com/docker-latest-tag/)                                                                 |

See the [packages page](https://github.com/SilentSpud/foundryvtt-bun/pkgs/container/foundryvtt-bun)
for a complete list of available tags.

> [!NOTE]
> Stable releases are also mirrored to [Docker
> Hub](https://hub.docker.com/r/silentspud/foundryvtt-bun) and can be
> referenced using the full registry path: `docker.io/silentspud/foundryvtt-bun:14`

## Volumes

| Mount point | Purpose                               |
| ----------- | ------------------------------------- |
| `/data`     | Configuration, data, and log storage. |

## Ports

The following ports are exposed by this container:

| Port    | Purpose                                       |
| ------- | --------------------------------------------- |
| `30000` | Foundry Virtual Tabletop server web interface |

## Environment variables

### Required variable combinations

One of the three combinations of environment variables listed below must be set
in order for the container to locate and install a Foundry Virtual Tabletop
distribution. Although all variables may be specified together, they are
evaluated in the following order of precedence:

1.  `FOUNDRY_RELEASE_URL`, _or_
1.  `FOUNDRY_USERNAME` and `FOUNDRY_PASSWORD`, _or_
1.  `CONTAINER_CACHE`

#### Credentials variables

| Name               | Purpose                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `FOUNDRY_PASSWORD` | Account password for foundryvtt.com. Required for downloading an application distribution.                  |
| `FOUNDRY_USERNAME` | Account username or email address for foundryvtt.com. Required for downloading an application distribution. |

_**Note:**_ `FOUNDRY_USERNAME` and `FOUNDRY_PASSWORD` may be set [using
secrets](#using-secrets) instead of environment variables.

#### Presigned URL variable

| Name                  | Purpose                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `FOUNDRY_RELEASE_URL` | The presigned URL generated from the user's profile. Required for downloading an application distribution. |

### Common variables

The variables most deployments set are listed below. Every variable, including
proxy, SSL, logging, and runtime settings, is documented in the
[environment variables reference](docs/environment-variables.md).

| Name                        | Purpose                                                                                                                                    | Default                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `CONTAINER_CACHE`           | Path for caching downloaded Foundry archives, which speeds up later startups. Keep it on a persistent mount. Set to `""` to disable.       | `/data/container_cache` |
| `CONTAINER_PRESERVE_CONFIG` | Set to `true` to keep existing `options.json` and `admin.txt` files instead of regenerating them at each startup.                          | `false`                 |
| `FOUNDRY_ADMIN_KEY`         | Admin password applied at startup. If omitted, the admin password is cleared. May be set [using secrets](#using-secrets).                  |                         |
| `FOUNDRY_LICENSE_KEY`       | The license key to install. If unset, one is fetched from your account when using credentials. May be set [using secrets](#using-secrets). |                         |
| `FOUNDRY_HOSTNAME`          | Public hostname shown in invitation links in place of the host's public IP address, e.g. behind a reverse proxy.                           |                         |
| `FOUNDRY_PROXY_PORT`        | The external port when running behind a reverse proxy, so invitation links use it.                                                         |                         |
| `FOUNDRY_PROXY_SSL`         | Set to `true` when a reverse proxy terminates SSL, so invitation links and A/V work over HTTPS.                                            | `false`                 |
| `FOUNDRY_TELEMETRY`         | Set to `true` or `false` to choose whether Foundry sends anonymous usage data. If unset, Foundry prompts on every launch.                  | _(prompt)_              |
| `FOUNDRY_WORLD`             | The directory name of the world to launch at startup.                                                                                      |                         |
| `TZ`                        | Container [TZ database name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones#List).                                           | `UTC`                   |

## Secrets

| Filename      | Key                     | Purpose                                                 |
| ------------- | ----------------------- | ------------------------------------------------------- |
| `config.json` | `foundry_admin_key`     | Overrides `FOUNDRY_ADMIN_KEY` environment variable.     |
| `config.json` | `foundry_license_key`   | Overrides `FOUNDRY_LICENSE_KEY` environment variable.   |
| `config.json` | `foundry_password`      | Overrides `FOUNDRY_PASSWORD` environment variable.      |
| `config.json` | `foundry_password_salt` | Overrides `FOUNDRY_PASSWORD_SALT` environment variable. |
| `config.json` | `foundry_service_key`   | Overrides `FOUNDRY_SERVICE_KEY` environment variable.   |
| `config.json` | `foundry_username`      | Overrides `FOUNDRY_USERNAME` environment variable.      |

## Foundry VTT CLI

The image bundles the official [Foundry VTT
CLI](https://github.com/foundryvtt/foundryvtt-cli) as the `fvtt` command. It
comes pre-configured with the container's installation and data paths, so
package development tasks, such as packing and unpacking compendium databases,
work in a running container without any setup:

```console
docker exec --interactive --tty <container_name> fvtt package workon "my-module"
docker exec --interactive --tty <container_name> fvtt package unpack "my-pack"
```

The CLI stores its configuration in `$XDG_DATA_HOME/.fvttrc.yml`, which
defaults to `/data/.local/share/.fvttrc.yml` in this image so that the
configuration persists in the data volume and remains writable for any UID the
container runs as. Set `XDG_DATA_HOME` to change the location.

## Building

Most users should pull a published image. If you want to build the image
yourself (from source or for another architecture), see the
[building guide](docs/building.md).

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for
details.

## License

This project is released as open source under the [MIT license](LICENSE).

All contributions to this project will be released under the same MIT license.
By submitting a pull request, you are agreeing to comply with this waiver of
copyright interest.
