# Kernel startup: T-125212

October 16, 2026. This measures the built kernel, not request duration, store
boot, or the gap before a trace's first I/O. T-125631's roughly 620 ms gap is
not explained by the package-vocabulary change. T-124087 remains Jeff's open
Worker-splitting decision; this investigation does not decide it.

## Cloudflare's own record

Read `result.startup_time_ms` from the official API:

```text
GET /accounts/{account}/workers/workers/yak/versions/{version_uuid}
```

The legacy `/workers/scripts/yak/versions/{uuid}` detail's
`resources.script_runtime` is runtime **configuration**, not this measurement.
Each row below is **one stored scalar per version**. Cloudflare does not expose
the repetitions, aggregation method or variance behind it; rereading a record is
not another cold-start sample.

| Build                | Git SHA                                    | Cloudflare version                     | Startup ms |
| -------------------- | ------------------------------------------ | -------------------------------------- | ---------: |
| Exact parent         | `f2532c4e81e0eccdc486309e509f478bbcbb72c5` | `618b5bc3-e010-4847-90e4-89aa778c6d50` |        119 |
| Eager package facets | `c5404e96480fcee5bbcf023ed7c8d28ea5cbeaa4` | `c70cc7c3-0523-4a61-b7fb-a48fd20ad48d` |        126 |
| Starting checkout    | `0b06fed8114f1af86017519449954a253fd62d48` | `c55b14dd-b654-4583-8782-4c737fc56cb9` |        160 |

Parent → suspect is +7 ms (5.9%), not hundreds of milliseconds. Another
concurrent deployment, `c5c0cf1cac189f47a677683c47786276bfc51466`, recorded 103
ms; it is not this task's candidate or a controlled comparison.

Raw requests, full MCP/API responses, version annotations, official schema and
documentation extracts, checksum manifest and the reusable read-only collector:
`/home/yaks/bench-T-125212/cloudflare/README.md`.

```sh
node /home/yaks/bench-T-125212/cloudflare/fetch-startup.mjs <landed-sha> candidate
```

## Local built-kernel workerd cold start

Pinned Wrangler 4.111.0's Miniflare/workerd, compatibility date 2025-05-08 and
the production compatibility flags, compiled-Wasm module rule, no persistent
storage. Each observation creates and disposes a new workerd process/isolate.
Variants alternate forward/reverse order. These are warm filesystem/dependency
cache, **cold isolate** observations on a shared host.

`direct.mjs` loads the unmodified built `index.js` as the entry and times
Miniflare construction through `ready`. It includes process launch, local module
discovery/parsing and compilation/evaluation; it is not Cloudflare's
isolate-only CPU measurement. An empty built entry supplies the harness control.
There is no handler request or application I/O in this measurement.

| Built entry            |  n |    Min / median / max ms |
| ---------------------- | -: | -----------------------: |
| `c5404e964^`           |  7 |  994.5 / 1148.6 / 1420.4 |
| `c5404e964`            |  7 | 1002.5 / 1167.6 / 1374.1 |
| Starting `0b06fed8114` |  7 | 1073.7 / 1191.4 / 1357.7 |
| Empty module           |  7 |       60.7 / 63.7 / 75.0 |

Historical local median difference +19.0 ms has widely overlapping ranges. It is
not a reliable estimate of a 19 ms production regression. The historical bundles
are those retained by T-125631's exact-parent comparison; git sources and build
outputs remain in its `independent-startup/` directory.

`cold.mjs` separately follows Wrangler's startup profiler technique: a tiny
entry dynamically imports the built kernel during its first request, after
`ready`, with the inspector profiler recording that import. This is an
**attribution control**, not the full cold start: the runtime has already
parsed/registered the module graph. The official Wrangler documentation warns
that local profile duration need not equal deployed startup time. The raw
profile's duration also includes idle/profiler protocol overhead, so it must not
be reported as CPU startup time.

Evidence and scripts: `/home/yaks/bench-T-125212/{direct,cold}.mjs`,
`direct.jsonl`, `local.jsonl`, `historical-local.jsonl`, and `profiles/`.

## Lazy optional vocabulary control

The candidate keeps the store configurations' vocabulary synchronous and bundles
optional facets as literal dynamic imports. Only a declaration that names an
optional package prepares it. The existing synchronous composer then uses the
loaded facet; an unprepared optional facet throws rather than silently omitting
its words. Preparation happens outside storage transactions; clash refusal, kept
words and release selection remain inside their existing transactions.

A separate alternating 15-pair run of starting `0b06fed8114` versus the lazy
prototype measured built-entry `ready` medians **1346.2 → 1295.9 ms**. The
median paired difference was -47.2 ms, with the candidate faster in 9/15 pairs.
This is modest and noisy. The deferred-import control medians were **141.5 →
136.4 ms**, but paired difference +1.0 ms (candidate faster in only 7/15): **no
consistent evaluation improvement**. Do not claim that these imports explain
T-125631.

Raw runs: `lazy-direct.jsonl`, `lazy-local.jsonl`; build logs and both bundles
are retained alongside them. Final deployed record and follow-up item costs are
recorded below after verification.

## Other startup dependencies: filed, not changed

Frozen starting kernel, seven rounds per boundary, same direct-entry and
Wrangler-style deferred-import workerd methods. Source-map/AST bundle ablations
substitute nonfunctional placeholders and prune unreachable closure; they are
**not deployable fixes**. A no-cut transformed bundle controls the transform.
The run was slower/noisier than the earlier vocabulary run: direct-ready medians
2060 ms untouched, 2019 ms transformed. Use within-round differences, not
differences between investigations.

| Boundary / follow-up under P-45601          | Removed JS | Median paired direct-ready saving | Median paired deferred-import saving |
| ------------------------------------------- | ---------: | --------------------------------: | -----------------------------------: |
| MCP SDK/module closure, T-125930            |     477 KB |               303 ms (6/7 faster) |                                17 ms |
| Sandbox SDK/container RPC closure, T-125931 |     309 KB |               102 ms (5/7 faster) |                                12 ms |
| Connector tool roster, T-125932             |     107 KB |     **not established** (-129 ms) |                   19 ms (6/7 faster) |

MCP+tools union: 355 ms direct-ready saving, 418 ms deferred ready+first. All
tested cuts union: 571 ms direct-ready (7/7 positive), 596 ms deferred
ready+first. **Do not add individual costs**: shared dependencies and unions
overlap. SDK closure cost is not SDK-exclusive cost. A public page HIT/MISS
never constructs connector schemas/rosters or uses a container; correctness of a
future lazy boundary still needs proof.

OAuth, Builder, Wire, Store and inference controls did not establish a
reproducible sizeable independent saving in this pass. Builder/Wire/Store union
retains shared graph/API/vocabulary reachable through other modules; its small
delta does not say that the entire shared graph stack is cheap. Icons are
actually needed to render page-cache misses and do not qualify. These are not
silently removed or turned into speculative performance tasks.

Exact boundaries, frozen bundle hashes, transformed bundles, all scripts,
profiles, raw runs, paired ranges and limitations:
`/home/yaks/bench-T-125212/ablations/REPORT.md`.

## Behavior verification

- `deno task test:budget` on loader generation/runtime, vocabulary, package
  tools, graph, reach and tools: 210 cases passed. Agent examples, release and
  Site workerd follow-up: 18 cases passed, including the real Site entrypoint.
- The emitted-loader test bundles the generated loader as one minified module
  and observes which facet initializers actually run. Making its optional
  imports eager makes the test fail; the lazy fixture was restored.
- `deno run -A bin/scratch.ts deno run -A workers/yak/package-vocab-probe.ts`
  checks real Store deploy, clear clash refusal without persistence, fresh
  remembered-package wake, retained dependency rollback and another wake. This
  is explicitly a manual integration probe, not a slow new budget case.
- Changed TypeScript, including tests and the probe, passes `deno check`, lint
  and formatting; generated content is current. No budget allowance added.
