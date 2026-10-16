# Agent machine image

The session machine's tool image (T-126524). Deployable images live under
`workers/`; this is separate from `workers/yak/sandbox/base`, the much larger
Cloudflare builder with its own control server. `packages/machine` owns the
portable machine contract and `packages/process` owns the host's provider.
Neither changes here. Provisioning, resource limits, grants, `sbx` installation,
KVM and Docker sign-in remain provider/host work (T-66643, C-66636).

## Build and check

From the repository root, on a Docker Engine host:

```sh
docker build --platform linux/amd64 -t yak-machine:local workers/machine
docker run --rm -it --cpus=1 --memory=2g yak-machine:local
docker run --rm -i --cpus=1 --memory=2g yak-machine:local bash -s < workers/machine/smoke.sh
```

With a remote Docker host, set `DOCKER_HOST=ssh://docker-build`. No daemon is
installed on the calling box. The context is only this directory;
`.dockerignore` allows only the Dockerfile and CLI shim. No host files,
credentials, environment, Docker socket or graph database are copied into the
image.

Linux amd64 only. Debian slim is pinned by manifest digest, Deno by version and
SHA-256, Debian packages by version, and transitive dependencies by dated Debian
and security snapshots. To update, advance the snapshot and package versions
together, verify the Deno archive checksum, build, and run the smoke twice.
`REPO_COMMIT` is a public immutable commit, overridable at build time with
another full commit SHA. The checkout records and verifies it; the image
revision label names it. Nothing fetches a branch tip or installs a floating CLI
release.

## What is inside

- Deno 2.9.1, Git, GitHub CLI, ripgrep, curl, jq, OpenSSH client, Python and
  process tools. `yak` runs the checked-out CLI with that checkout's import map
  and lock. Its first use downloads dependencies; network access is needed.
  Dependency caches and account credentials are intentionally not baked in.
- Chromium's headless shell, exposed as `google-chrome`, plus fonts. It executes
  browser JavaScript and supports CDP; it is not the full desktop Chrome UI. The
  smoke uses `--no-sandbox` for ordinary Docker's namespace/seccomp limits; that
  option is not built into the executable. Only use it inside an already
  isolated machine, never to disable a host browser's security boundary.
- An agent-owned Git checkout at `/home/agent/workspace`. A shallow partial
  clone and sparse checkout omit only the bulky `logo-concepts*` and
  `homepage-concepts` design galleries, not code, tests or skills. Git can fetch
  those blobs when needed (`git sparse-checkout disable`). The workspace is
  writable, can commit, and retains its pinned origin and revision.

No compiler collection, Docker Engine, model-agent CLI, provider supervisor or
sign-in is preinstalled. The host runs the model; this image supplies its
commands and files. Install uncommon tools per machine instead of charging every
pull.

## Docker Sandboxes contract

This is a shell image for `sbx create --template IMAGE ... shell`, not an image
for the built-in Claude/Codex agent. It supplies `agent` UID/GID 1000, its
passwd entry and writable `/home/agent`, `/bin/sh`, `/bin/bash`, curl, Git, CA
trust, passwordless sudo preserving proxy variables, and an existing
agent-writable `BASH_ENV=/etc/sandbox-persistent.sh`. `USER agent`, the absolute
workspace and `CMD ["/bin/bash"]` also work with ordinary Docker. There is no
entrypoint that interferes with a provider's command execution. A v3 workload
descriptor, if used, belongs to its integration, not this image.

Contract sources checked October 16, 2026:

```text
https://docs.docker.com/ai/sandboxes/customize/templates/
https://docs.docker.com/ai/sandboxes/customize/kits-v2/
```

## Measured October 16, 2026

Built and run on homelab VM `docker`, Docker Engine 29.5.2, through the existing
`docker-build` SSH alias. The caller has CLI 29.6.1 but no local engine/socket;
no host packages or KVM configuration were changed. This proves the Docker
image, not a Sandboxes microVM boot, which still needs the separate
host/provider work.

The first full shallow checkout occupied 337 MiB (154 MiB Git); partial/sparse
checkout reduced it to 52 MiB (12 MiB Git). Chromium occupies 289 MiB and Deno
102 MiB. The final image reports 384,313,854 bytes in
`docker image inspect .Size` (compressed content with this containerd-backed
Engine); `docker image ls` reports 1.39 GB including its unpacked snapshot. Do
not confuse the two figures.

Two fresh, removed-on-exit containers, each limited to one CPU and 2 GiB, passed
`smoke.sh`: non-root identity, writable clean checkout, proxy-preserving sudo,
Deno execution, Git commit, `yak --help`, and Chromium rendering JavaScript.
Wall times were 8.25 s and 17.79 s, including cold dependency downloads. They
are observations, not a benchmark: caller `uptime` loads were 4.98/6.46/6.70 and
21.83/14.81/10.09; the Docker host's were 0.02/0.11/0.17 and 0.03/0.06/0.12.
Both machines had been up 29 days, about 19 hours. Expected Chromium DBus/device
warnings did not affect the rendered result. No credentials were supplied.
