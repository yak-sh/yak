# Page-cache miss investigation — T-125631

Measured October 15–16, 2026, from the box and Cloudflare Workers Observability.
**The requested cold-miss result is not achieved.** The improvements below
remove a directory round trip and a cacheability race; they do not explain or
eliminate the runtime's pre-handler delay.

## Repeatable measurement

Query strings do **not** force a page miss: `pageAt` keys the hostname, path,
mount and generation, deliberately discarding the visitor's query. Varying
fallback paths renders the same index but also misses Files, so it is not a
measurement of a page-only miss.

For exactly `https://yourname.yaks.app/recipes/`, repeat an unchanged title
write through the ordinary directory hook, then fetch the page. This calls the
existing Cache-Tag purge through Purger/Site, without deploying or changing the
app's content. It updates the row's modification stamp. Use the admin test
account, never the configured person's identity:

```sh
yak admin apply yak/platform '[{"entity":{"eid":"c364b639-95bf-483c-aede-22b3b4cda1be"},"doc":{"title":"Recipe Box"}}]' --as admin
curl -sS -o /dev/null -w '%{http_code} %{time_starttransfer} %header{server-timing} %header{cf-ray}\n' https://yourname.yaks.app/recipes/
```

Wait at least twelve seconds between repeated purges to respect the account's
purge token refill. Retain the actual cache status: an acknowledged purge is not
instantly visible everywhere. Never count a HIT as a MISS.

| Same path, tag purged               | Samples | page min / median / max |
| ----------------------------------- | ------: | ----------------------: |
| Before, `5e054f040`                 | 10 MISS |    149 / 163.5 / 603 ms |
| Loopback experiment, `d3e7213c3`    |  6 MISS |      152 / 192 / 866 ms |
| One directory snapshot, `fb0e887fb` | 10 MISS |      103 / 117 / 144 ms |
| Loopback removed, `d04a6b3b4`       |  8 MISS |     95 / 113.5 / 137 ms |

Final Site handler: 49–66 ms, comprising one authoritative routing read 43–50
ms, Files HIT 6–19 ms, rendering 0–5 ms. Before: Site 97–202 ms, with two
sequential directory reads around 44–49 ms each. Final page HITs were 10–48 ms.
A genuinely cold EXPIRED still took 1191 ms, including Site 196 ms and a large
delay outside the Site clock. This outlier is not excluded from the cold-path
finding merely because the purge series was warm.

Varying fallback paths before changes gave 15 uncached page responses, 462 / 747
/ 1567 ms min / median / max. Their Files misses usually read the release index
and then the content, approximately 100–150 ms each. The loopback experiment did
not improve these cold paths and was removed.

## Cloudflare records and history

Use the configured `cloudflare-api-yak` MCP's `execute` tool and
`cloudflare.request` to POST the account's
`workers/observability/telemetry/query` endpoint. This is a telemetry read.
Select the recorded time window and CF ray/request ID, then query each trace ID
to include child R2, asset and directory spans. Record actual
`$workers.scriptVersion.id`; requested overrides alone prove nothing. Serialize
compact result rows to avoid tool-output truncation.

Before, version `4ac33176-5d50-4be6-a558-2d79e4014215`:

| Invocation | Records | wall min / median / max | CPU min / median / max |
| ---------- | ------: | ----------------------: | ---------------------: |
| Gateway    |      13 |     504 / 749 / 1604 ms |          1 / 8 / 18 ms |
| Site       |      15 |     143 / 402 / 1183 ms |        12 / 16 / 25 ms |
| Files      |      15 |       48 / 233 / 861 ms |           1 / 4 / 7 ms |

These are the varying-fallback baseline, not the same-path purge series. Two
gateway records were absent, not zero.

Ray `a4b27d913f63846c`: Site starts 23:09:16.739Z; its first directory
subrequest begins 496 ms later. Files starts 23:09:17.298Z; its first R2 GET
begins 593 ms later. Index and content reads then take 201 and 116 ms. Files
span is 917 ms while invocation wall is 329 ms and CPU 5 ms. Low invocation CPU
does not establish the cost of isolate initialization, which may precede the
measured invocation.

Crucially, the phenomenon predates the suspects. Version
`f9579cb1-ca63-42b2-97ff-a69be782914e` (`89c895d98`, October 15 02:05Z) has Site
and Files samples at 02:08Z with 625 and 622 ms before their first recorded
child I/O. The first page-cache release was `ad282ef49` at 01:55Z. The 11.5 ms
median on T-124419 included HITs at 3–18 ms; it was not a repeated-MISS
baseline. T-124006 already recorded roughly 600 ms full misses.

Historical version overrides, quoted or unquoted, selected the live version in
actual invocation records; they were invalid comparisons and discarded. No
deployment was changed to force an old version to run.

## Findings, not suspects

- `c5404e964`: isolated historical bundle comparison found no large startup
  regression. Ten fresh V8 processes: compile+link+evaluation medians 281.5 ms
  before, 277.9 ms after; module evaluation 130.7 vs 133.8 ms. Local runtime
  measurement is not production attribution.
- `de111f37c`: npm resource serving, not this HTML route; no causal finding.
- `fecbcb1f5`: blob-rate exemption does not handle this HTML route.
- `8b0323a80`: reproduced a late-copy race. A copy GET started at the deadline
  can finish after authority won and still mark the door stale. A settlement
  guard fixes this independently of the runtime delay. The new regression test
  fails with the guard removed and passes restored.
- Page routing needlessly awaited the space eid before asking for apps.
  `directory.page` selects the space and addressed/home apps in one fresh query
  through `app.space.space.slug`. Privacy, release and setting fence scenarios
  still pass against the real directory/serving seam.

## Landed changes and remaining work

- `5e054f040`: Site/Files phase clocks, release-index/R2 waiting and render
  timing. HIT/UPDATING/STALE do not replay the original renderer's timings.
- `355eec66f`: late-copy settlement guard.
- `fb0e887fb`: one authoritative directory snapshot for anonymous routing.
- `d3e7213c3` experiment removed by `d04a6b3b4`: no established benefit.

Changed-path budget runs passed (64 directory/cache cases; other selected
file/timing cases also passed). The Site workerd smoke test passed its budget.
The formerly unlisted site-version-forwarding test was independently fixed by
`29e3a4c1a`; its post-rebase budget also passed. Types checked on changed
production and test files. Deploys confirmed `d04a6b3b4` live at 100% on October
16 00:04:40Z. Tracker inspection showed only the pre-existing gate bug
`42912c36`, not a new serving failure.

Remaining: distinguish runtime cache routing/scheduling from full-isolate
startup with explicit first-handler timestamps and a small cached-entrypoint
control. T-124087 already asks about splitting the kernel. Recommendation:
measure a slim Files/Site origin control, then move the cached serving path out
of the full kernel only if that experiment removes the delay. A split needs
deployment/binding/purge ownership designed together; do not weaken fresh
authority, extend stale authorization or silently remove native caching to
manufacture a faster measurement.

Raw local evidence, scripts, versions and trace records:
`/home/yaks/bench-T-125631/` (telemetry README and investigation report,
same-path-before/route/final series, independent-startup, module-init).
