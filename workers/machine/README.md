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
- An agent-owned Git checkout at `/home/agent/workspace`. A shallow partial
  clone and sparse checkout omit only the bulky `logo-concepts*` and
  `homepage-concepts` design galleries, not code, tests or skills. Git can fetch
  those blobs when needed (`git sparse-checkout disable`). The workspace is
  writable, can commit, and retains its pinned origin and revision.

No Chrome, Chromium, compiler collection, Docker Engine, model-agent CLI,
provider supervisor or sign-in is preinstalled. The host runs the model; this
image supplies its commands and files. Install uncommon tools per machine
instead of charging every pull.

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
