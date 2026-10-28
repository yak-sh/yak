# Deploy timing

Push to live is how long a push to main takes until yaks.app serves it. The
box's deploy catch-up times every deploy
([@yaks/admin](../packages/admin/README.md#the-deploy-catch-up)): wrangler's
deployments list says when a commit's first deployment went live, and GitHub's
first check suite on the commit says when the push arrived. Each deploy is kept
on its commit as `deployed{pushed, live}`. A median of the latest ten past two
minutes (`SLOW` in packages/admin/catchup.ts) is reported to the tracker as
`deploy slow:yak`, a bug of its own; a home page that does not answer once
main's head goes live is `deploy down:yak`. A push that never goes live is
`deploy missed:yak` or `deploy stuck:yak`, and a failed build is filed by
workers/yak/builds.ts.

```sh
yak graph query '.deployed .order=-deployed.live .limit=10'
yak admin deploys    # each version, when it went live, and its commit
```

Main's gate times none of it. Its `deploy time`, `deploy gate` and
`app deploy gate` steps did until T-132948, and in the two weeks before that
they turned 41 runs red with nothing wrong in the commit under test: a build
slower than the wait, a failed or overtaken Cloudflare build, a version never
seen answering, normal spread against a one-row floor. Only a push to main ran
them, so no agent could see or prevent any of it before landing.

## What a deploy's time is made of

Nearly all of it is Cloudflare's: the build waiting its turn behind other
pushes' builds (six run at once per account), then clone, cache restore, bundle
and upload, then the version reaching its first answer. It varied 27 to 97 s
from one push to the next between 2026-10-10 and 10-21, 63 s at the median, with
nothing in the repo changed (T-131399); on 2026-10-28 it was 56 to 96 s, 65 s at
the median. Dropping `deno task check` and the tests from the build moved
neither number (T-35253). The Workers Builds API, which would tell the queue
from the build, refuses the box's wrangler credential (HTTP 403, code 12004), so
a slower deploy is read in its build's own log, linked from the commit's
`Workers Builds: yak` check run. What made deploys slower before, and how each
was fixed, follows.

## Catalog dependency (T-65018)

The Workers Builds timeline for `1849b73bc` (build `6011a548`) isolates a serial
compiler upload: the build was created at 00:37:43 UTC, initialized at 00:37:50,
began cloning at 00:37:51, and restored dependencies at 00:38:10.
`bin/build-yak deploy` started at 00:38:11; the catalog and web assets were
ready by 00:38:14. The unchanged outbound Worker was skipped. The compiler
Worker uploaded from 00:38:18 to 00:38:30, before yak started. Yak reported its
upload at 00:38:47 and deployed triggers at 00:38:52. The gate's version probe
recorded 63.190 seconds from push to live.

The kernel captures the catalog and sends `{ask, catalog}` with each compiler
job. The compiler Worker streams that job to its container and imports no
catalog. Its dry-run bundle is 24.84 KiB (7.48 KiB gzip), and removing the local
catalog produces the same bundled module digest. Package changes therefore
change the kernel's catalog without uploading the compiler Worker. Sibling code
changes still upload before the kernel activates; a sibling failure prevents
kernel activation. The protocol was introduced with the old ask protocol still
accepted, then the fallback was removed after that kernel served in production
and staging.

Kernel-only rollback leaves the compiler serving its current contract. The
deployment history refuses kernels using the retired bare-ask protocol, or a
protocol it cannot read; the transitional catalog-sending kernels remain valid
targets. The protocol-1 floor also applies when main is reverted or its build
fails, since neither restores the compiler Worker.

| SHA         | gate run                                                              | push to live | observation                                                    |
| ----------- | --------------------------------------------------------------------- | -----------: | -------------------------------------------------------------- |
| `1849b73bc` | [38099071806](https://github.com/yak-sh/yak/actions/runs/38099071806) |      63.190s | package catalog caused a compiler upload                       |
| `e9770723f` | [38100287556](https://github.com/yak-sh/yak/actions/runs/38100287556) |      53.444s | protocol transition; compiler still carried a fallback catalog |
| `03673a8c9` | [38100519502](https://github.com/yak-sh/yak/actions/runs/38100519502) |      62.797s | removal of fallback; compiler code changed and uploaded        |
| `51acbc60e` | [38101111396](https://github.com/yak-sh/yak/actions/runs/38101111396) |      45.596s | package change with the compiler catalog carried by yak        |

The catalog-free package push took 17.594 seconds less than `1849b73bc`: its
upload was 45.596 seconds and propagation 0.000 seconds. One push says nothing
of queued builds.

These rows are observations, not evidence of a fixed Cloudflare setup time. The
supplied timelines put clone plus cache restore at 14–19 seconds, and one build
waited 50 seconds before initialization. Locally the tracked tree is 168.85 MiB,
including 143.06 MiB of logo concepts, and npm's cache is about 1.2 GiB,
including 420 MiB of historical npx installs. Those local sizes do not measure
Cloudflare's restored cache. No clone setting, stored artifact or cache policy
was changed without a remote measurement.

Dependencies, assets, sibling preparation, the deploy guard and kernel bundling
already overlap in `wrangler.ts`. Production and staging share generated assets
and image preparation, so launching their shell commands concurrently would race
those writes. A complete Build continues with image rollout and staging after
production is live and keeps its slot occupied. Cloudflare documents
[six concurrent builds per paid account](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).
A 50-second queue wait is most of a 63-second deploy. This change removed the
package catalog's serial upload; queue and restore latency stay unmeasured,
since the Builds API refuses the box's credential.

## Sandbox CLI delivery (T-65018)

The supplied build log for `6011a548` has the Worker live at 00:38:47 UTC and
the Build stopped at 00:41:41. Its sandbox image pulled the base for 17 seconds,
then installed the CLI from a 9.35 MB context. A following push, `3201d5d03`,
waited 51 seconds before starting. The sandbox work therefore occupied a Build
slot for nearly three minutes after production was live.

The sandbox deploy names the existing toolchain image by registry reference.
Worker assets carry a compressed, content-addressed CLI workspace and its
launcher. Each `yak` call reads the live descriptor; a changed workspace is
checksum-verified and installed into an immutable directory before running
`packages/cli/yak.ts`. An OS file lock serializes workspace installation and
module-cache filling across processes. A readiness marker is published only
after a successful fill; a second caller waits for the remaining work and reuses
it. The kernel releases a killed installer's lock, and the next caller removes
abandoned staging. The launcher retries a workspace retired between requests
rather than using an old fallback. The original lockfile is retained, with
Deno's npm lazy caching so unused workspace dependencies are not downloaded on
startup. CLI RPC uses `initialize`, `tools/list` and `tools/call`; the connector
supplies command schemas and grammar. Package views are loaded dynamically from
that workspace. This keeps one CLI implementation and removes sandbox Docker
work from all Worker deploys. Toolchain changes are provisioned separately
before their pin is landed.

Local measurements: 1,511 runtime/config files compress to 2,330,514 bytes;
generation takes 0.45–0.54 seconds. Concurrent verified installation takes 0.373
seconds; a cached descriptor lookup takes 0.001 seconds. A cold original CLI
with lazy npm caching takes 0.31 seconds for help, 0.385 seconds for a JSON
platform tool and 0.468 seconds for a rendered entity answer, with the lockfile
unchanged. These exclude remote transfer and container startup. Without lazy npm
caching, the same cold help takes 3.17 seconds and fills 283 MB of unrelated npm
cache. A separate CLI bundle failed on dynamic local-host dependencies; a source
workspace also preserves the server-declared package views.

The first rollout of this shape, `d058ad04e`, was observed at 75.655 seconds:
51.786 seconds to upload and 23.869 seconds to the version-confirmed response.
Its Build completed at 09:16:47 UTC, three seconds after the recorded live
probe, with no sandbox image build remaining behind it. The following pair
measures the steady state, including a push in the former image-build window.

A fresh throwaway sandbox had no `/opt/yaks-cli` workspace. Against the live
platform, its first `yak --help` exited 0 in 6.158 seconds, `yak about --json`
called the platform and exited 0 in 0.535 seconds, and warm help exited 0 in
0.269 seconds. The cold call adds 5.889 seconds over the warm call in this
observation, including source transfer, verification, disk writes and cold
module downloads. Container startup precedes these command timings.

T-122065 returns to warming `yak --help` in the background when lending a
sandbox. Ordinary commands can run immediately. A yak call during warm-up waits
for the existing workspace install and cache fill rather than repeating them.
The configured cache-filling child owns the lock, so killing its parent cannot
release it while downloads continue. Commands run outside the lock once ready.

| SHA         | Gate run                                                              | First ls | Immediate first help | First help after 8 s |
| ----------- | --------------------------------------------------------------------- | -------: | -------------------: | -------------------: |
| `934670c2c` | [38131865418](https://github.com/yak-sh/yak/actions/runs/38131865418) |   0.006s |               7.749s |               0.284s |

Each observation uses a fresh sandbox in its own `yak admin throwaway` account
and times the command inside the container, excluding startup and RPC. The live
version was `c4934ab3-317c-4e47-aca9-f0ae709e4a78`; the served launcher matched
the landed source. All three commands exited 0. The first `ls` finished before
the cache readiness marker appeared; its full lending/tool call took 6.100
seconds. Immediate help began before readiness and finished with the marker
present. The delayed help's eight-second pause is excluded from its command
timing. The probe spaces and containers were permanently erased.

Local multi-process probes confirmed one workspace download and one cache fill
for concurrent callers. Killing a downloader allowed retry and removed its
staging; killing a launcher parent retained its active child's lock. A killed or
failed cache fill left no readiness marker and retried using the installed
workspace. The lend test also proves ordinary commands run while warming.

| SHA         | Gate run                                                              | Push → live | Observation                                           |
| ----------- | --------------------------------------------------------------------- | ----------: | ----------------------------------------------------- |
| `d058ad04e` | [38127723976](https://github.com/yak-sh/yak/actions/runs/38127723976) |     75.655s | first registry-pin and CLI-assets rollout             |
| `0d87cecd1` | [38128661732](https://github.com/yak-sh/yak/actions/runs/38128661732) |     28.962s | first consecutive source push                         |
| `a85cd9d6b` | [38128761348](https://github.com/yak-sh/yak/actions/runs/38128761348) |     26.666s | next source push inside the former image-build window |

The consecutive pushes were 101 seconds apart. The second arrived 72.038 seconds
after the first went live, while the old image build would still have held the
Build slot. The first Build had completed at 09:32:07 UTC, 48 seconds before the
next push at 09:32:55; no sandbox image work remained to queue behind. The
second Build completed at 09:33:44. Both verified rows have zero recorded
propagation delay, without an estimated SHA match or a backfill. The
Markdown-only `91febea3a` started no Workers Build and is excluded from this
pair. The measured pushes change launcher source comments while keeping runtime
behavior fixed. Builds queue stamps remain unavailable with the current
credential; the removed Docker path and the preceding Build's completion
establish that the second push cannot wait behind its sandbox image build.
