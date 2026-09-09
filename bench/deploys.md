# Deploy timing

Every push to main times its own deploy: the gate workflow's `deploy time` step
runs the recorder on `github.sha` before `deploy gate` judges (T-35336). It is
the workflow's FIRST step, right after the checkout, because `live` is the
recorder's own first successful probe — anything the job does before it is
measured as deploy latency (T-35426, below). The workflow runs on the box, so
the recorder reads the same GitHub and Wrangler logins under `$HOME` that a hand
run does; no Actions secret is added, and `deploy-gate` still makes no live
call. A pull request has no main push to time, so the step is push-only and a PR
judges the committed rows alone. A push that touches none of the Worker's build
watch paths deploys nothing at all: the recorder waits for the version, finds no
Cloudflare build check for the commit, says
`no Workers Build — nothing to time`, and the gate judges the rows already
recorded.

By hand — the same two commands, and what the workflow runs:

```sh
deno task deploy:time <full-pushed-sha>
deno task deploy:gate
```

Start the recorder alongside the push, or immediately after the build finishes.
Without a SHA it follows the newest main push in the gate workflow. It waits up
to two minutes for an upload, then up to two minutes for a verified response.
This command records observations; it never deploys, commits, or pushes.

Nothing in Actions pushes, and a bench-row commit on main would start another
Workers Build and another gate, so the row the workflow measures lives only in
that run's checkout — enough for the gate, which reads the latest row by upload
and therefore judges the commit under test. The run also prints the row to its
job summary; append it to `bench/deploys.jsonl` with the next change, the way
`bin/bench-gate.ts` asks for its baseline, and the floor ratchets on it. Before
T-35336 the file was the only source, so one unlucky Workers Builds row (39–71s
run to run, Cloudflare-side) stayed "the latest deploy" and failed every later
commit.

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
`(live - pushed) / 1000` — so it is an UPPER BOUND, and it is only as tight as
the recorder is prompt. A late start is indistinguishable from a slow deploy;
that is why the gate runs the recorder before its own tests. The probe requests
`https://yaks.app/` with
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

Every line that prints a total prints the split beside it: `upload` is
`uploaded - pushed`, Cloudflare's half — build queue, clone, cache restore,
bundle, version create — and `propagate` is `live - uploaded`, that version to
the first verified 200. `stages()` and `split()` in `bin/deploy-gate.ts` derive
both from the three stamps a row already carries, so a row written before the
split existed reads the same way as one written after; nothing derived is
stored. Splitting Cloudflare's queue back out of `upload` would take the
[Workers Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/),
which needs a user-scoped API token minted in the dashboard: the box's wrangler
OAuth login has no builds scope and every `/builds/` path answers 403, so the
build's own queued/started/finished stamps are not readable from here.

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

## What the 74.182s row was (2026-09-09, T-35253)

Not a repo regression. Push to upload — the Workers Builds half — is what
varies, and it varies run to run with the commit's content held irrelevant:
39.7s, 40.6s, 41.1s (09-07), 56.7s, 66.9s (09-08), 39s, 41s, 53s, 71s, 39s
(09-09, from each commit's Cloudflare check-suite `created_at` to its version's
`created_on`). 74.182s is 66.9s of that plus 7.2s of propagation — the slow tail
of that spread, banked as the only measured row and compared against the hard
60s ceiling.

Measured against it: a build that dropped `deno task check` and
`deno task test:workers` — ~94s of work on this box (30.21s and 64.28s warm on
2026-09-09) — moved neither number. Four deploys built that way uploaded in
40.3s, 42.0s, 40.4s and 42.6s, and their whole Builds run (build, production
deploy, staging deploy) spanned 3m06 and 3m21, inside the 3m01–3m34 of the five
built the old way that morning. The arithmetic leaves no room for those
commands: the deploy's cost is Cloudflare's queue, container, clone, cache
restore, bundle and upload. Whether the dashboard's build command runs
`bin/build-yak` at all is a question for the dashboard; it is not visible from
here, and the Builds API refuses the box's Wrangler OAuth token.

So the limit stands at the owner's 60s, and nothing in the repo is holding the
deploy back. The gate will read red whenever a recorded deploy lands in the slow
tail, because one recorded row is the whole sample. Recording every push, not
the occasional one, is what would make the ratchet mean anything.

## What the 175s rows were (2026-09-09, T-35426)

The gate timing itself. `deploy time` was the workflow's last step, so the
recorder did not reach its first probe until `deno task check`, `test` and
`test:workers` had run — about two and a half minutes after the push. By then
the version had been serving for a minute or more, the first probe succeeded
immediately, and that late observation was written as `live`:

| SHA        |  upload |     live | gate step ran |
| ---------- | ------: | -------: | ------------- |
| `d03e4fba` | 39.929s | 175.689s | push +2m48    |
| `d59bb215` | 55.790s | 180.670s | push +2m45    |
| `ef364c57` | 59.188s | 203.932s | push +3m12    |

Every `upload` is ordinary — the same 39–71s Cloudflare spread T-35253 measured.
The rest is the gate's own test suite, counted as propagation. Run 34359974213's
steps say it plainly: job started 7s after the push, `deploy
time` ran
13:56:01–13:56:06, five seconds for a version that had existed since 13:53:5x.
Three REGRESSIONs in a row, none of them a deploy.

The premise that a landing storm queues in Workers Builds does not survive the
numbers either: `d03e4fba` uploaded in 39.929s, the fastest of the night, in the
middle of fifteen landings in an hour. A storm slows the gate's own runner, not
Cloudflare's build queue — and a late recorder turns that into a deploy
regression.

Two changes: the recorder is now the first step after the checkout, so `live` is
the deploy's, and every verdict prints `upload` and `propagate` separately, so a
number that grows says which half grew. The 60s limit and the ratchet are
unchanged.
