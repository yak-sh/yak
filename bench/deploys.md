# Deploy timing

Run on the box using its existing GitHub and Wrangler logins:

```sh
deno task deploy:time <full-pushed-sha>
deno task deploy:gate
```

Start the recorder alongside the push, or immediately after the build finishes.
Without a SHA it follows the newest main push in the gate workflow. It waits up
to two minutes for an upload, then up to two minutes for a verified response.
This command records observations; it never deploys, commits, or pushes. Commit
the appended `bench/deploys.jsonl` with the next change so the Actions gate can
read it. The gate checks the last recorded deploy, not the build racing the
current workflow. Neither the recorder nor the gate adds an Actions secret.

`bin/yak-watch` runs every five minutes. Using it would add up to five minutes
of observation delay to a sub-minute metric, so timing remains a separate box
command. An unattended caller must start it on each push; this change does not
install a new cron or change the box's configuration. Late observations include
that delay. Use `deno task deploy:time --backfill 3` for historical uploads.

The record's `pushed` comes from the matching main PushEvent (`pushed_at`, or
the event's `created_at`), then the earliest main check-suite creation, then the
original push-triggered gate run's `created_at`. A commit's committer date is
never used. `pushSource` names the source; suites and workflow creation are
proxies for the push, not timestamps of the commit's creation.

`uploaded` is Wrangler's `metadata.created_on`. The version is matched against
the SHA in `annotations["workers/message"]`. Older unannotated versions use the
nearest upload after the push and carry `estimated: true`; another SHA's
annotation is never treated as a match.

`live` is the first successful probe observed by the recorder, and `seconds` is
`(live - pushed) / 1000`. The probe requests `https://yaks.app/` with
`Cloudflare-Workers-Version-Overrides: yak="<version id>"`. A 200 must also
carry the matching `x-yak-version` response header, taken from the Worker's
existing `CF_VERSION_METADATA` binding. Cloudflare can silently ignore an
override for a version outside the current deployment, so an ordinary 200 does
not prove which version answered. See
[version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/).

Unknown live times are `null`, never upload timestamps substituted for live. A
failed prospective probe fails the recorder and the gate. A later successful
retry appends its completion; the gate counts that deploy once. Repeating a
successful record keeps its first observation. Historical probes either cannot
verify the version or yield a late upper bound; `backfill: true` excludes both
from the ratchet.

The floor is the minimum recorded prospective live time, so recomputing it from
the append-only history only moves it down. Like `bin/bench-gate.ts`, the margin
is 25%, configurable through `BENCH_TOL`. The limit is the smaller of
`floor * (1 + margin)` and 60 seconds; exactly 60 seconds fails. No data and the
first measured deploy pass with an explicit bootstrap message. Corrupt records
fail instead of resetting the floor. A prospective estimated SHA match
participates but remains labeled; requiring annotations before banking a floor
is a possible stricter policy.

## Initial observations

Collected on 2026-09-07. All three version messages were absent, so the SHA
matches are estimated. Each override probe returned 200 without a version
header; none establishes the time that version first served a 200.

| SHA                                        | GitHub push source        | Push to upload | Verified push to live |
| ------------------------------------------ | ------------------------- | -------------: | --------------------- |
| `754d0863e5de1956a471efc6685384babb684854` | PushEvent, 19:30:39 UTC   |        41.120s | unknown               |
| `04c960265029ee56a85751bd9f8156fe60e85eb8` | check-suite, 19:32:17 UTC |        40.628s | unknown               |
| `13c6432b818e4f8cbd585ae9e9404eb92c29d61b` | check-suite, 19:49:19 UTC |        39.719s | unknown               |

The live floor is unset until the first prospective, version-confirmed probe.
The maximum comparison limit is 60s. No deployment was made to seed a baseline.

## Build path and local profile

Workers Builds clones the repository and restores its build cache. The
dashboard's Build cache must be enabled for persistence; its setting was not
changed or verified here. Cloudflare documents an npm cache but no Deno cache,
so `bin/build-yak` defaults `DENO_INSTALL` and `DENO_DIR` to directories inside
`npm config get cache`, while respecting explicit overrides. See
[Workers build caching](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/).

The build and deploy commands now do these steps:

1. Restore Deno's path; install Deno only if its executable is absent. Download
   and extraction were not measured locally because Deno is already installed.
2. Run `deno task check`: formatting, lint, byte hygiene, type checks, generated
   content checks, and package tests. The warm run took 21.68s; the first run
   with an isolated cache took 71.21s. Both passed 918 package tests. These are
   local durations, not Cloudflare build timings.
3. Run `deno task test:workers` for kernel and tail (28.52s locally, 575 tests
   passed). Its probes call `ready()`. The build wrapper already had no extra
   npm install to remove.
4. The separate `bin/build-yak deploy` restores the same Deno/cache paths and
   calls `deno task deploy:yak`. `ready()` reuses the probe's `node_modules`
   (0.000058s locally). When required, the lockfile install prefers cached
   packages and skips the audit/funding requests (1.963s into an empty tree from
   a warm package cache).
5. Read the SHA and subject for the version annotation (0.00332s), then run
   pinned Wrangler with `--prefer-offline`. Wrangler startup, bundling and
   assets took 2.142s locally; upload and Cloudflare propagation were not
   measured by the dry run.

`time deno task deploy:yak --dry-run` took 19.14s with cold npm dependencies and
exited 1: Wrangler still tried to build the configured container and Docker is
unavailable on this box. With the existing documented
`--containers-rollout=none` option, the warm dry run passed in 2.36s (2.53s
before the cache options). It bundled 3008.12 KiB, gzip 667.63 KiB, and read 46
asset files. These are single samples; the difference is not evidence of a
reliable speedup. The container build and remote upload remain unmeasured.

No incremental build or skipped correctness check was introduced.
