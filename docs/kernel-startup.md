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

Reverted in ef5e9a7c9: every package's `./vocab` is eager again. `appDoc`
composes the packages a manifest names whenever it declares a `permit`, before
any caller could prepare them, so requests to yourname/vale's store failed
(`@yaks/game/vocab has not been loaded`). With no startup gain to keep, the lazy
loader and its probe were removed rather than reordered. What follows records
the candidate as measured.

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

## Landed result: no demonstrated total-startup improvement

Landed code **448d3d43b5a9406a5fbae397c99a4c270c465ceb** with `yak land`.
Cloudflare version **e17c9d76-aa72-4aec-ba86-3e85557a36d1** was live at 100% at
11:34:26 UTC on October 16, 2026. Its own startup record is **128 ms**. The
immediate pre-land parent `8c80d25178d2395ba02a224042740e936e8fd508` (version
`94b4fd41-e11b-4848-8844-e91cbd66b738`) records **102 ms**: **+26 ms, not an
improvement**. Against this task's starting `0b06fed8114` record of 160 ms it is
-32 ms, but intervening documentation/content deploys make that an uncontrolled
comparison. These are n=1 stored records, not statistically comparable medians.

The final built-entry local run, alternating exact immediate parent versus
landed code for 15 fresh workerd instances each, measured:

| Build                        | Min / median / max ready ms |
| ---------------------------- | --------------------------: |
| Immediate parent `8c80d2517` |    1092.2 / 1286.9 / 1877.7 |
| Landed `448d3d43b`           |    1130.5 / 1274.2 / 1711.3 |

Median paired candidate-minus-parent was **+29.6 ms**; candidate faster only
5/15 times. Therefore the 12.7 ms difference of medians is **not evidence of a
speedup**. A separate seven-round final-versus-starting-checkout run also showed
no benefit (1182.3 → 1205.3 ms direct-ready; deferred import 130.3 → 131.2 ms).
The earlier prototype's apparent saving did not reproduce.

The useful delivered guarantee is demand-driven optional-facet evaluation,
proved in a real single bundle, without weakening clash/rollback behavior;
**this task has not made the kernel materially faster**. Most optional facets
are small JSON declarations and their dependencies can remain reachable through
other imports. Keep the measured follow-ups separate, and do not treat this as
resolving T-125631's cold miss or deciding T-124087's split.

Raw final evidence: `final-{direct,local}.jsonl`, `land-paired-direct.jsonl`,
`cloudflare/captures/*-candidate/` and `*-baseline-parent/`,
`deploys-after.txt`, `errors-after.txt`, under `/home/yaks/bench-T-125212/`.
Admin checks showed 0 current occurrences/bugs and 0 unresolved tracker bugs.
After rebase, the combined budget rerun passed 214 Deno cases plus the Site
workerd case; generated content still checked clean.

## T-125930: MCP evaluation was already deferred

Rechecked after rebasing onto `ef5e9a7c97d3584d163d04a9ee015a4069a23d43`, which
reverts `448d3d43b`: its lazy vocabulary change broke Mossvale with
`@yaks/game/vocab has not been loaded`. Do not restore that change as part of
these SDK investigations. The earlier landed-result section records the
historical measurement, not a currently retained optimization.

The ablation above removed code, not just initializer execution. It therefore
identified a bundle closure cost, **not an eager MCP evaluation bug**. The
router already imports `mcp.ts` dynamically (T-37977). Builder imports
`agent.ts`/Zod only downstream of `build.ts`'s dynamic `builder.ts` import.
`stream.ts` imports only the pure `@yaks/mcp/roster` helper. The genuinely eager
`@cfworker/json-schema` validator is shared by graph admission and tool argument
checks; moving it behind the MCP door would break another door.

A manual emitted-bundle probe marks source-mapped module initializer bodies in
an external copy of the production build, then loads it in fresh workerd.
Against the rebuilt reverted baseline, startup runs only the roster helper; none
of 126 SDK/Zod/MCP server/schema initializers runs. A positive control invokes
the existing MCP initializer and observes all 127 marked bodies. This proves
module evaluation, not actual page-cache HIT/MISS requests, network latency, or
elimination of parse/compile cost. No import rewrite is warranted.

Reproduction and raw evidence:
`/home/yaks/bench-T-125930/runtime-marker/{probe.cjs,REPORT.md,rebased/result.json}`.
The probe accepts a built `index.js`/map directory, a checkout with the pinned
Worker dependencies installed, and an output directory; run it with Node's
`--expose-internals` for its Acorn parser. It changes only that external copy.
The unmodified built-entry workerd baseline has seven fresh observations, median
1431.0 ms (1196.3–2279.9 ms); this is local ready time, not Cloudflare CPU.

Cloudflare's stored baseline for the revert is **115 ms**, version
`77f1985d-38f5-4797-94e5-014b821ad599`, live at 100% on October 16, 2026. The
scoped admin connector's full 63-tool `tools/list` response (including all
names, input and output schemas) and a successful `graph_schema` call compare
identically before and after the revert. Raw captures, local runs, admin checks
and subsequent landing measurements live in `/home/yaks/bench-T-125930/`. There
is **no demonstrated MCP startup speedup**: this task retains the existing lazy
boundary rather than claiming a no-op import change improved it.
