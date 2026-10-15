# Mossvale compiler regression — T-125306 (2026-10-15)

This measures **the deploy's compiler door**, not `app_deploy`. The deploy probe
is `bin/app-deploy-time.ts`; `bench/app-deploy.ts` gates deploy data. Do not
substitute its deploy wall time for compiler work.

## Repeating the workload

`bin/app-compile-job.ts` captures the complete Ask and catalog from a pinned
checkout. Capture `2c4573c08` (the then-current main), `apps/vale`, with:

```sh
deno run -A bin/app-compile-job.ts /path/to/checkout apps/vale job.json
sha256sum job.json
# 3c1ca3ca6c458aec0276645a08cd35108414b817713724ce308df24412347632
```

205 source files, worker.js and six pages. The fixed Job is identical across
compiler versions. Historical stage jobs are captured from `a056150a4^` and
`a056150a4`; hashes are in `verified-stage.jsonl`. Their compiler is fixed to
`348bf5d407`. This separates the stage workload from compiler changes.

Private scratch Workers used the **existing historical registry images**, each
with a distinct Durable Object namespace/application, basic instance limits
(0.25 vCPU, 1 GiB), no public route, one instance. `images.json` records the
content-derived image tags and registry digests. `immutable-plan.json` records
source hashes checked on every successful compile. A loopback-only Wrangler
proxy binds remotely to these Workers. Its directory must be separate from
result writes: hot reload interrupts requests.

The entrypoint wraps the historical HTTP handler unchanged, measures
`compiler_request`, and sends SHA-256 of the actual `/compiler/compile.ts`. The
local proxy rejects a mismatching hash. No production compiler rollback,
production app push, or image replacement was performed. The scratch app was
`compile-t125306/vale`, copied from main, not `yourname/vale`.

```sh
COMPILER_URL=http://127.0.0.1:12536/0 COMPILER_TOKEN=loopback-only \
  deno run -A bin/app-compile-time.ts job.json <compiler-sha> 2c4573c08 4 results.jsonl
```

The token above is only a nonsecret placeholder at a loopback-only proxy. For an
exposed endpoint, authenticate it; never put a credential in records.

## Historical results

Four successful warm samples per boundary. Seconds; medians below use the
ordinary midpoint median (the raw JSONL is authoritative).

| Compiler                     | Warm handler median | Answer bytes |
| ---------------------------- | ------------------: | -----------: |
| before b26: `fcb106824`      |               8.895 |    4,416,587 |
| b26: `b26af52aa` / before ae |              17.519 |    3,956,670 |
| ae: `ae6e91c3c` / before 139 |              19.328 |   32,357,581 |
| trimming: `1397561b7`        |              24.387 |   32,172,066 |
| before de: `348bf5d407`      |              25.238 |   32,172,066 |
| npm homes: `de111f37c`       |              16.747 |    3,771,169 |
| then main image: `5ba6cb7de` |              18.989 |    3,771,169 |

Registry image digests establish **before ae = b26** and **before 139 = ae**;
those boundaries are represented by the same measured image, not guessed. Stage
pre/post are the same compiler image. Their historical workload handler medians
are **23.082 / 24.902 s** (answer31.57 /31.68 MB). These noisy samples alone do
not isolate a precise stage-only cost.

The first invocation is separate in each JSONL. First invocations are sometimes
_faster_ because of CPU bursting: do not call the difference a cold-start cost.
For example before-b26 first wall7.647s, own handler4.869s; the remaining2.778s
is startup/proxy/transport, not compiler work. Warm handler durations still
vary. The old handler duration includes body read/parse and serialization. It
does not include container startup or response transport. New compiler timings
split those phases explicitly; `compiler_total` is compilation alone.

Earlier attempts changing the image under one live application were discarded:
rollout was not complete when Wrangler returned. One immutable b26 run lost its
network connection; `b26-retry.jsonl` contains the complete replacement batch.
Do not classify these failures as OOM without exit-state evidence.

## What moved, and the fix

`b26af52aa` added the consumer graph pass **before** the shared-output cache.
`1397561b7` added export discovery and the marked used-export pass. Therefore a
warm shared-group hit still rebuilt three large analysis graphs. npm source
reads also repeated gzip inflation: on this Job, **38 gzip walks,64,818,883
expanded bytes per job**, with25.9MB from Three source reads beyond indexing.
The lazy inflation predates these changes but amplifies the extra passes.
`ae6e91c3c` carried whole npm resources; `de111f37c` removed those bytes but did
not remove repeated analysis or inflation. Stage/voxel expose the Three-heavy
shared dependency graph.

The fix lives in the compiler:

- npm:16MiB LRU of immutable tarball indexes and lazily decoded text. Local
  mutations stay local; replacing a package clears old paths. Still fetch
  metadata/bytes normally, so ranges and registry failures are not hidden.
- shared analysis:4MiB LRU validates **every read, including missing paths**.
  App edits, newly resolved files, deletions and changed npm source invalidate
  it. Failed analyses are not retained. Remaining warm builds:7, down from10.
- Native compiler phase durations and server parse/serialization durations are
  returned and forwarded through the deploy's Server-Timing header.

Same Job, same instance limits, instrumented source overlays before landing:

| Order / four warm samples   | Baseline compiler median | Fixed compiler median |
| --------------------------- | -----------------------: | --------------------: |
| baseline, then fixed        |                 19.071 s |               6.107 s |
| fixed, then baseline repeat |                 16.925 s |               5.750 s |

Baseline `e7155012e`; fixed `dab2f864f`. Overlay identities are recorded
separately from immutable historical image identities (`overlay-plan.json`). The
final cache seam extraction changes no intended behavior and has its own tests.
Warm fixed:29 shared-group hits; `carried=used=0`. Baseline approximately 4.4s
graph+5.5s trimming despite29group hits. Two fixed requests spent7.6–7.8s
reading the job; their compiler_total remained6.2s. This is why wall alone is
not enough. All samples, not just the fastest, are retained.

Canonical baseline/fixed answers after removing timing are identical:
`500b6709f5c8a35451b738d49d0b5f1d4eeca313019d632d81db34c6ad8a15f1`. Installed
versions and identity comparison are in `output-comparison.json`.

Local unrestricted warm:1.42/1.53s →0.477/0.511s. Controlled25% CPU baseline:
16.90/16.21s →5.81/6.09s. Cold23.20→23.60s: no cold improvement demonstrated,
and this noise is not evidence of a cold regression. No budgets were widened.

## Lifecycle

Scratch infrastructure inventory and exact deployment/cleanup scripts were
retained with the task's reproducibility artifact. Delete only its recorded
`t125306-*` Workers/container applications/namespaces, not registry images. Stop
local Wrangler proxies first. Delete the scratch app and space as well. T-125362
tracks the platform's missing supported historical-compiler probe.

## Production verification after landing

`ef1b151c6` reached100% live at2026-10-15T21:31:54Z. The actual production
`yak-esbuild` service binding, same fixed Job, then returned five warm
`compiler_total` samples **9.623/10.692/12.442/10.807/9.110s** (median10.692s).
Full-body walls **11.234/11.586/13.358/12.039/10.325s** (median11.586s). First
invocation wall24.902s; compile22.345s; parse0.146s, serialize0.091s,
handler22.584s. Do not attribute the entire first invocation to startup. All
five warm runs had29group hits, no carried/used work, and no errors. Production
load differs from the isolated container; these do not replace the controlled
before/after comparison. Raw rows are `production.jsonl`.

All10scratch compiler Workers, their container applications and namespaces were
deleted; post-cleanup inventories contain none of their IDs. The503-file scratch
app was erased forever, followed by its space (`space_delete` with
`forever:true`). All three loopback proxies were stopped. No registry images
were deleted. Production deploy/error inspection was performed after landing.
