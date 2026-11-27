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

- `deno task test` on loader generation/runtime, vocabulary, package tools,
  graph, reach and tools: 210 cases passed. Agent examples, release and Site
  workerd follow-up: 18 cases passed, including the real Site entrypoint.
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

## T-125931: Sandbox initialization belongs to its runtime entries

The existing awaited Sandbox import did evaluate the SDK at startup; the await
only moved it into a microtask. Unlike MCP, this needed a runtime change. The
synchronous exported `Sandbox` now exposes the binding's twelve RPC methods plus
`fetch`/`alarm`, forwarding with the real SDK object as receiver. Its
constructor loads the implementation inside the real state's
`blockConcurrencyWhile` and passes that same branded state to the SDK. SDK
storage initialization, container monitoring, alarms and lifecycle callbacks
remain the SDK's, not a copy. The real subclass keeps its `Sandbox` name, HTTPS
interception and old allowlist reset. No DO binding or migration name changes.

`ContainerProxy` is separately lazy: its fetch loads the same implementation
module before constructing the SDK proxy, so an isolate handling only outbound
traffic still registers the setter-based exact/wildcard handlers. Registering
only during DO construction would be wrong: the proxy can run in another
isolate. No Worker split, SDK upgrade or vocabulary change is involved.

The Docker-free manual integration probe is
`workers/yak/sandbox-entry-probe.ts`. It bundles the actual facade/runtime
sources and real installed SDK with only three test seams: a fake
`ctx.container` on the real branded state, an SDK observation subclass, and a
non-network outbound handler. It proves concurrent first RPC initializes once,
nested SDK input gates finish before RPC, proxy-only exact/wildcard dispatch,
actual alarm callback, stored configuration after runtime restart, and SDK fetch
reaching container start. It does **not** prove a real container starts or
executes a command; production sandbox calls must cover that separately. No
budget exception is added.

Emitted-bundle initializer markers show Sandbox/Containers/capnweb evaluation at
baseline startup and **none** at candidate startup. Literal dynamic imports stay
real deferred initializers in the single bundle; parsing/compilation can still
cost startup time. Evidence, raw builds, manual probes, scoped production calls
and CF startup records are under `/home/yaks/bench-T-125931/`.

A seven-pair alternating/reversed workerd run measured baseline/candidate ready
medians **1376.1 → 1316.8 ms**, median paired difference **-137.5 ms**, but only
**4/7** candidate observations were faster (wide shared-host ranges). This is
not strong evidence of a reproducible speedup and is not Cloudflare CPU time.
Production's own stored record is measured separately after landing.

### Deployed T-125931 result

Landed `a27df7e8f8e7a75bce25cb724c4ec4cddfcc4c46` with `yak land`. Cloudflare
version `556077b6-2205-4c27-990b-3c9c0b6e30be` was live at 100% at **12:24:15
UTC on October 16, 2026**. Its own stored startup record is **94 ms**, versus
immediate deployed parent `f5aad38b85`/`77d396b7` **224 ms**: **-130 ms**. These
are one stored scalar per version, with unknown internal repetitions; the
earlier `ef5e9a7c9` version had identical JS to `f5aad38b85` yet recorded 115
ms. The candidate record is lower, but the 130 ms difference is not a
repeatable-effect estimate. The local seven-pair comparison above is noisy.

The built candidate has six source-mapped SDK/Containers/capnweb initializer
markers; none runs at startup or after two actual kernel `/docs/code` responses
(200, 54,774 bytes each). This is a static page, not a Cloudflare cache HIT/MISS
or graph-backed homepage benchmark. The facade workerd probe passes and breaking
`getState` forwarding in an external copy makes it fail; production source was
never mutated for that check.

Production before/after probes ran in the throwaway `sdk125931` account/space,
not a person's sandbox: real shell command, file write/read, background-process
stop/wait, and HTTPS to both apex and space host pass. HTTPS status alone does
not prove every credential-swap case. The full 63-tool `tools/list` JSON,
including names, arguments and output schemas, and a successful `graph_schema`
reply compare identically over the scoped admin connector before and after.
`yak --host yaks.app app_errors` returns no open errors for `yourname/vale` and
`yourname/holdfast`; admin deploys confirms 100% and errors shows zero current
occurrences/bugs. Budget tests for the changed kernel/sandbox/MCP/Site paths,
including provider and Site workerd behavior, pass; types/lint/format pass.

## The split: T-133886

November 1, 2026. Three things changed, each deployed and measured from
production telemetry (span `time_to_first_byte_ms` minus `wall_time_ms`, 75 ms
or more counted as a wait, as in D-133933).

`yak-front` (`workers/yak/front/`, 11 KB, no secrets) holds the routes and
answers what Site's cache holds. A throwaway Worker bound to a callee of 3 MB
measured a hit through a service binding at 5-7 ms on a just-deployed callee
version, against 138-199 ms for running that callee cold; hits on the live
`Site` took 4-11 ms.

| From the box                      | Before |       After |
| --------------------------------- | -----: | ----------: |
| `GET /`, cold isolate, first byte | 479 ms | 67-122 ms\* |
| Requests that reach the kernel    |    all |        41%† |

\* One of eight probes took 439 ms, not explained. † 271 gateway spans beside
658 front spans in one 14-minute window, probes included.

The kernel's fetch handler then moved beside the directory
(`region = "aws:us-east-2"`). `mode = "smart"` was tried first and replaced: it
followed the tracker's minute probe to SEA, a directory read went from 57 to 110
ms, and a gateway answer from 57 ms to as much as 637 ms.

| Gateway, browsers and other non-probe clients |   n | Waited | Median wait | First byte p50 / p90 |
| --------------------------------------------- | --: | -----: | ----------: | -------------------: |
| 90 minutes before the move                    | 206 |    37% |      207 ms |         279 / 803 ms |
| 20 minutes with the region hint               |  63 |    19% |      293 ms |         103 / 439 ms |

These windows are short, their request mix differs, and another agent moved the
directory to ORD in between (T-134094), which accounts for part of the first
byte change. Telemetry reports the eyeball's colo, so `cf-placement` is what
shows the move: `remote-ORD` or `local-ORD` on every probe from IAD or ORD.

The kernel's own upload is unchanged at 3.7 MB. Splitting it by role measured:
gateway 2.85 MB, gateway without the connector 2.24 MB, connector 2.58 MB, Store
3.07 MB; the modules are shared in a long tail with no single import to cut. A
new Worker for any of these needs the kernel's 18 secrets, whose values only the
Worker itself can read. T-133988 holds that.

## The upload holds what its requests run: T-133988

November 6, 2026. workerd compiles every uploaded module when an isolate starts,
a dynamically imported chunk included: under load, the whole upload sent as Text
modules started in about half the time of the same bytes as ES modules. So the
cut is to what is uploaded, found by size:

| Commit      | Left the kernel's upload                                        |  KB |
| ----------- | --------------------------------------------------------------- | --: |
| `dabe2768f` | axe-core, browser code, to static assets (then to yak-browser)  | 656 |
| `08b1e4fe2` | `@anthropic-ai/sdk`: @yaks/anthropic speaks the API over fetch  | 381 |
| `a407a02eb` | puppeteer: draft rendering is the `yak-browser` sibling Worker  | 309 |
| `1efc2cbd7` | sucrase: yak-esbuild strips TypeScript over the ESBUILD binding | 224 |

The upload went from 5.69 MB to 4.12 MB (Wrangler: 4,026 KiB, 1,329 KiB gzip),
deployed as `59912dc3` at 07:01 UTC. Neither new piece needs a secret, so the
kernel's 18 stayed where they are.

Local workerd, a fresh process per observation, 25 alternating rounds: ready
median 587.5 → 518.4 ms, paired −74.5 ms, faster 19 of 25; an empty Worker is
109 ms.

Production, kernel invocations, synthetic probes excluded, wait = first byte
minus wall time, 75 ms or more counted
(`/home/yaks/bench-T-133988/nov6/prod/measure.mjs`):

| Class         | 24 h before: n, waited, wait p50 / p90 | 1 h after: n, waited, wait p50 / p90 |
| ------------- | -------------------------------------: | -----------------------------------: |
| Home `GET /`  |                     88, 65%, 302 / 482 |                   13, 39%, 251 / 295 |
| App page      |                   1684, 41%, 343 / 614 |                  153, 20%, 220 / 370 |
| MCP handshake |                    287, 25%, 369 / 589 |                    13, 8%, 313 / 313 |

The after window is small, served 7 versions (the day before averaged 10 an
hour, and each deploy starts new isolates), and from 07:52 includes T-133898
moving stores beside the kernel. MCP's handshake is `server/discover`: no
`initialize` reached yaks.app in either window. Cloudflare's own
`startup_time_ms` stayed in its usual range (65 ms for `59912dc3`; 42–193 ms
over the day before). What is left is led by the MCP SDK with Zod (~385 KB) and
the Sandbox SDK (~307 KB).

## The connector speaks MCP itself: T-143191

November 6, 2026, `55c2f7b43`. `@modelcontextprotocol/server` and the Zod v4 it
brings left the kernel: `@yaks/mcp` answers both protocol eras itself
(`packages/mcp/protocol.ts`), on the JSON Schema checks @yaks/vocab already
makes. Zod v3 and `zod-to-json-schema` went with the last tool declaring its
arguments in Zod (`mail_list`).

| Left the kernel's upload                   |  KB |
| ------------------------------------------ | --: |
| `@modelcontextprotocol/server` and core    | 227 |
| Zod v4 and v3, `zod-to-json-schema`        | 197 |
| `@yaks/mcp`, grown by the protocol it owns | −12 |

`workers/yak/bundle.ts` output, every JS module: 4,123,795 → 3,705,082 bytes
(gzip 1,387,575 → 1,279,279).

Local workerd, a fresh process per observation, 25 alternating rounds
(`/home/yaks/bench-T-143191/pair25.jsonl`): ready median 599.4 → 559.1 ms,
paired −56.1 ms, faster 20 of 25; an empty Worker 134.6 ms in the same run.

`workers/yak/connector-capture.ts` sent the in-process connector 93 requests,
both eras, signed in and not, well formed and not. Before and after, 91 answers
are byte-identical, `tools/list` among them; `mail_list`'s refusal of a bad
argument is now the JSON Schema checker's sentence, like every other tool's.

Deployed with `7e48a0008` as `43ba65f4` at 08:52 UTC. Cloudflare's own
`startup_time_ms`, one stored value per version: 66 ms for the parent
`c3de200d`, 59 ms for `43ba65f4`
(`/home/yaks/bench-T-125212/cloudflare/captures/2026-11-06T08-53-1*-t143191`).
What is left of the gap to an empty Worker is the rest of the upload, led by the
Sandbox SDK (~307 KB).

## The sandbox is yak-sandbox's: T-143193

November 6, 2026, `f41211cfc`, `68759d703` and `3587a5ce1`. The SDK's Sandbox
Durable Object, as `Workbench`, and its container moved to `yak-sandbox`
(`workers/yak/sandbox/`), and the kernel binds it as `WORKBENCH`.
`@cloudflare/sandbox`, `@cloudflare/containers` and capnweb left the kernel with
the lazy facade (`sandbox-entry.ts`) that kept them from running at startup but
not from being compiled. The token swap stays in the kernel, which alone holds
the secret: the container's calls to the platform reach `SandboxOutbound` over
yak-sandbox's `KERNEL` binding.

| Left the kernel's upload                 |  KB |
| ---------------------------------------- | --: |
| `@cloudflare/sandbox`                    | 234 |
| capnweb                                  |  47 |
| `@cloudflare/containers`                 |  26 |
| `sandbox-entry.ts`, `sandbox-runtime.ts` |   2 |

`workers/yak/bundle.ts` output, every JS module: 3,713,116 → 3,396,245 bytes
(gzip 1,282,820 → 1,195,924). Wrangler's upload is 3,316.65 KiB, 1,141.82 KiB
gzip; yak-sandbox's is 320 KiB.

Two deploys were refused before the third went live. Migration v10 deletes the
kernel's old Sandbox class, and Cloudflare refuses that (code 10061) while a
binding keeps the name that held the class, `SANDBOX`, wherever it now points; a
throwaway pair of Workers showed the same refusal and its acceptance under a new
name. Renaming the class alone (`68759d703`) did not help.

Local workerd, a fresh process per observation, three runs of 25 alternating
rounds on a shared host (`/home/yaks/bench-T-143193/pair25{,b,c}.jsonl`):

| Run | Ready median, before → after |   Paired | After faster | Empty Worker |
| --- | ---------------------------: | -------: | -----------: | -----------: |
| a   |             515.7 → 546.5 ms | +24.4 ms |     10 of 25 |     105.9 ms |
| b   |             469.7 → 438.4 ms | −20.1 ms |     15 of 25 |     124.7 ms |
| c   |             368.5 → 357.7 ms | −11.5 ms |     15 of 25 |      67.4 ms |

None shows a difference the noise does not cover. Cloudflare's own
`startup_time_ms`, one stored value per version: 100 ms for the parent
`6b45bbd0`, 53 ms for `bd30ec4b` (live at 100% at 10:23:52 UTC).

The sandbox tool tests (`sandbox_test.ts`, `sandbox_isolation_test.ts`,
`sandbox-handoff_test.ts`), in-process calls on a scripted container, pass the
same 39 cases before and after. In production, `sandbox_exec` in `yourname`
wrote and read a file and reached `$YAKS_HOST/mcp` with its swapped token (200)
before the move and again on `bd30ec4b`; `app_errors` shows no open errors for
`yourname/vale` or `yourname/holdfast`.

What is left is a long tail. The largest third-party pieces are `yaml` (~102
KB), `@cloudflare/workers-oauth-provider` (~80 KB) and `postal-mime` (~75 KB);
the largest workspace package is `@yaks/session` (~139 KB), measured before
minification from esbuild's metafile.

## Most cold isolates are deploys: T-148604

November 7, 2026. Production, 24 hours of kernel invocations, synthetic probes
excluded, wait = first byte minus wall time, 75 ms or more counted (the T-133988
method, `.scratch` copies of its scripts). Bucketed by how long the invocation's
version had been serving:

| Class         | First 30 s: n, waited | 30 s–2 min |  2–10 min | Over 10 min | Wait p50 |
| ------------- | --------------------: | ---------: | --------: | ----------: | -------: |
| Space gateway |              853, 48% |  1839, 15% |  2438, 9% |    772, 11% |  ~290 ms |
| MCP gateway   |              354, 55% |   578, 21% |   587, 5% |     209, 5% |  ~260 ms |
| Site (a miss) |             1118, 88% |  1574, 52% | 2636, 30% |    666, 33% |  ~280 ms |

68% of the 4,320 waits came within 2 minutes of a new version, and a wait is the
same size whenever it comes. 394 kernel versions served 291 commits that day:
100 commits were uploaded twice, 1 to 119 s apart, with byte-identical scripts
(one etag), once by Workers Builds and once by the box's deploy. The deploy door
refused only a newer commit live; it now also leaves its own commit live when
another build put it there (`superseded`, wrangler.ts).

What a cold isolate itself runs, measured in Node over the built kernel with
`cloudflare:workers` stubbed (`node --cpu-prof`, a fresh process each): compile
about 160 ms and top-level evaluation about 90 ms on this box, against
Cloudflare's own 53–65 ms `startup_time_ms`. The eager chunk is 3.31 MB of the
3.82 MB of modules. No top-level statement stands out:

- The largest, `Intl` formatters built at module level (html.ts, 22 ms), cost
  that once per process for ICU's data: a second isolate in the same process
  builds the same formatters in 0.2 ms, so deferring them saves nothing in
  workerd.
- The 368 KB of JSON (the vocab.json files) shipped as `JSON.parse` strings
  instead of object literals: compile 157 → 155 ms, evaluation 90 → 94 ms over 8
  alternating rounds, so it was not kept.
- What is left is spread thin: esbuild's `__name` for `keepNames` 7 ms, marked's
  rules 6 ms, the rest under 4 ms each.

The handler itself is quick on a cold isolate (`gateway;dur=16`), so most of a
cold request's 200–450 ms comes before our code runs. What the platform does in
that time is not measured here; how often a new version starts every isolate is
what this repository decides.

## A cold isolate compiles what its class runs: T-148770

November 7, 2026, `d05627b60`, live as `89eb6e5b` at 16:57 UTC. workerd's module
registry compiled every uploaded module when an isolate started, dynamically
imported chunks included, so T-133988 cut what was uploaded.
`new_module_registry` (wrangler.toml; not experimental, the default for
compatibility dates from 2026-11-17) compiles a module when it is first
imported. Local workerd 2026-11-04, a fresh process each, ready to the first
answer:

| Upload                                    | Ready ms |
| ----------------------------------------- | -------: |
| An empty Worker                           |       25 |
| The whole kernel uploaded, never imported |      188 |
| The same, `new_module_registry`           |       65 |

So `index.ts` now imports none of the code it runs. Each Durable Object is a
`deferred` class (deferred.ts) that makes its object from its module on the
first call, and each entrypoint, the gateway's `fetch`, `email` and `queue`
among them, imports its module and the tracker's boundary inside the call. The
who-is-asking helpers moved from identity.ts to asking.ts, which loads the OAuth
provider only for an agent's token. The entry's static chunk is 9 KB.

Compile and top-level evaluation in Node 26 (`vm.SourceTextModule` over the
built kernel, `cloudflare:workers` stubbed, a fresh process each, medians of 8
alternating rounds). Before, the registry compiled every module whatever woke
the isolate:

| Isolate woken for       | Modules | Compiled | Compile ms | Evaluate ms |
| ----------------------- | ------: | -------: | ---------: | ----------: |
| Anything, before        |     122 |  3.83 MB |        173 |          86 |
| The gateway (kernel.ts) |      89 |  2.99 MB |        122 |          72 |
| A Store (graph.ts)      |      80 |  2.57 MB |        110 |          53 |
| Site (site.ts)          |      85 |  2.96 MB |        125 |          67 |

Local workerd, a fresh process per observation, 25 alternating rounds:

| To the first answer        | Before → after, median |   Paired | After faster |
| -------------------------- | ---------------------: | -------: | -----------: |
| Gateway, `GET /robots.txt` |       274.8 → 249.6 ms | −20.1 ms |     21 of 25 |
| A Store's first `fetch`    |       276.1 → 224.9 ms | −46.8 ms |     25 of 25 |

The gateway's share is the smallest because kernel.ts's static closure is most
of the kernel: `apps.ts` holds both a space's serving and the dashboard, and
reaches `load.ts`, `tools.ts`, admin, libphonenumber and yaml in two or three
imports. T-148886 holds that.

Production, kernel spans, probes included (T-133988's `measure.mjs`). The 6
hours before the deploy against its first 46 minutes, which served 7 versions,
each of them starting every isolate cold. Compiling now happens inside the first
call, so a cold request no longer shows as first byte minus wall time: before, a
cold request is one that waited 75 ms or more; after, one that spent 150 ms or
more of CPU, which only the first request of an isolate does (warm requests
after it take 5–20 ms):

| Class         | Before: cold n, first byte p50 / p90 | After: cold n, first byte p50 / p90 |
| ------------- | -----------------------------------: | ----------------------------------: |
| Space gateway |                   287, 480 / 1564 ms |                   26, 189 / 2377 ms |
| Site          |                    696, 428 / 747 ms |                    40, 260 / 915 ms |
| MCP gateway   |                   113, 442 / 1099 ms |                   11, 127 / 1073 ms |

The after window is small and nearly all probes, and the two windows tell a cold
request by different signs, so these medians are a direction rather than a
measurement. Cloudflare's own `startup_time_ms` across the versions: 48–116 ms,
median 60, over the 73 before; 7–16 ms, median 7, over the 7 after.

## A space's page compiles what serves it: T-148886

November 7, 2026. With T-148770 a cold gateway isolate compiled kernel.ts's
static closure, which held the apex, the dashboard, the tool roster and their
words as well as a space's pages. The modules that tied them together are cut,
each at the boundary of what it serves:

- kernel.ts routes; the apex's pages and doors are apex.ts, loaded on the first
  request to the apex (the home page's misses, sign-in, `/manage`, admin, money,
  phones), and drop.ts on its one `POST /deploy`.
- apps.ts serves a space; the dashboard is manage.ts, loaded on the first
  `/manage` request. An app's platform doors under `/api/` (`stats`,
  `connections`, `env`, `fetch`, `tunneled`, `documents`, `ai`, `speech`, `rtc`,
  `notices`) are loaded by the first segment of their path (apps.ts `DOORS`),
  and a release's recovery, a lens's words, a draft's files and borrowed words
  (reach.ts) are loaded where they are asked for.
- pages.ts keeps the pages a space serves and the shell; the identity door's
  pages are signin-pages.ts (the sign-in's phone numbers, the connector's words)
  and the dashboard's are desk-pages.ts.
- A tool row wears its words through tool-words.ts `worded`, not tool.ts, whose
  refusals every door uses; connections.ts's and views.ts's rows are
  connection-tools.ts and views-tools.ts. So the generated content.ts and yaml
  leave the page.
- gallery-row.ts is where an app stands in the gallery, what a space's index and
  badge read; gallery.ts reaches admin.ts only for its review.
- `VERSION` is running.ts's, beside the deploy version it stands in for; `seedy`
  is files.ts's; @yaks/data-editor owns `titleOf` and `readOnly`; post.ts,
  payments.ts and phones.ts load lent.ts (and with it every package's
  vocabulary) when they first lend.

Compile and top-level evaluation as above (Node 26, `vm.SourceTextModule`, a
fresh process each, medians of 8 alternating rounds, Site's of 4), main at
`db80df3cf` against this change:

| Isolate woken for                | Modules |       Compiled | Compile ms | Evaluate ms |
| -------------------------------- | ------: | -------------: | ---------: | ----------: |
| A space's page (kernel.ts)       | 87 → 64 | 2.99 → 1.46 MB |   122 → 68 |     70 → 36 |
| The apex (kernel.ts and apex.ts) |     128 |        2.94 MB |        127 |          66 |
| The dashboard (and manage.ts)    |     129 |        2.96 MB |        132 |          63 |
| Site (site.ts)                   | 84 → 78 | 2.96 → 2.16 MB |   117 → 93 |     65 → 48 |

An apex request compiles what it did before, and the dashboard only 18 KB more.
What is left of a space's page is led by libphonenumber (142 KB), which
directory.ts reaches through signin.ts `nameOf`: its `canon` spells a typed
number in E.164 for every caller, though the directory's rows name a person by
an email address. Then `@yaks/sql` and `@yaks/sqlite` (240 KB together, through
defects.ts and @yaks/durable-object) and `@yaks/graph`'s errors (76 KB).

Deployed with `fe4978f3c` at 17:53 UTC. Production, kernel spans, probes
included (T-133988's `measure.mjs`, its copy and `cold.mjs` in
`/home/yaks/bench-T-148886/prod/`), a cold request being one of 100 ms of CPU or
more, which only an isolate's first request spends:

| Space gateway                      | Requests | Cold | Cold CPU p50 | Cold first byte p50 / p90 |
| ---------------------------------- | -------: | ---: | -----------: | ------------------------: |
| 16:58–17:52, T-148770's 7 versions |      158 |   28 |       250 ms |             182 / 2377 ms |
| 17:53–18:18, 4 versions with this  |       88 |    5 |       202 ms |             500 / 2263 ms |

Five cold requests say nothing about their first byte; the CPU they spent is the
direction the Node measure gives. The saving in compile holds only under
`new_module_registry`, which compiles a module on its first import: the legacy
registry compiles every uploaded module at startup, so without it what this
leaves out of a page's isolate is its evaluation (70 → 36 ms), not its compile.
T-148980, below, measured otherwise and went back to the legacy registry.

## The legacy registry loads a first call cheaper: T-148980

November 7, 2026, `9d548420a`, live as `c545e78c` at 18:01 UTC. T-148770's
`new_module_registry` cut Cloudflare's `startup_time_ms` to 7, but whatever a
new isolate took first paid for loading its modules inside the call, at far more
than the legacy registry's load. Workers observability, every Store call of 100
ms of CPU or more (a cold isolate's first call), median CPU / wall:

| Window (UTC)                                | Registry | Store calls n | CPU ms | Wall ms | Directory probe | App store probe |
| ------------------------------------------- | -------- | ------------: | -----: | ------: | --------------: | --------------: |
| 15:57–16:57, before T-148770                | legacy   |           151 |    185 |     273 |             277 |             135 |
| 16:57–17:58, T-148770 and T-148886          | new      |           176 |    448 |     602 |             599 |             322 |
| 18:01–18:22, this change (deferred classes) | legacy   |            57 |    152 |     309 |             296 |             129 |

The probes are the tracker's minute probe of the directory (5b23bd26, n 13,
31, 7) and of an app store's `.recipe&.limit=1` (5b139ccf), CPU only.
`startup_time_ms` with the legacy registry and the 9 KB entry is 0-1 ms. So the
deferred classes stay: a Store's isolate still evaluates none of the router's
code, and its first call costs less than it did before T-148770. Local workerd
timed the opposite (T-148770's 188 → 65 ms ready); production is the measure. A
compatibility date from 2026-11-17 brings the new registry back unless
`legacy_module_registry` is added.

Live, the app store's door (`/recipes/api/query?.recipe&.limit=1`) asked every
100 s from 18:04 to 18:19: 7 of 10 found a new isolate, `store_wait` 416–730 ms
(median 498) against 36–63 warm. Its invocations in the same minutes ran 223–261
ms of wall, so about half of a cold wait is the object starting before any of
our code runs (yaks-app skill, "A new object takes 150 to 500 ms to start").

## The Operator's read loads what answers it: T-150377

November 7, 2026. A chat page's first visit wakes the space's Builder object,
whose read of the Operator (build.ts `#stored`, operator-host.ts
`operatorRequest`) loaded build.ts, operator-store.ts and operator-host.ts with
their static closures. Each tie to what the read never runs is cut where it is
made:

- operator-store.ts takes the providers' words from provider-vocab.ts, which
  gen.ts writes with only config.ts `providing`'s `./vocab` facets, not from
  providers.ts, which held load.ts and every package's vocabulary.
- names.ts is what to call a person (`chose`, `nameOf`, over a stored email
  address), so directory.ts no longer reaches libphonenumber through signin.ts.
- build-door.ts loads pages.ts in `posting`, the gateway's, and every door to
  the Builder imports its words from build-door.ts rather than build.ts.
- The conversation's root is operator-root.ts; operator-host.ts and
  operator-updates.ts load operator-channels.ts with the words a person sends.
- Narrower facets: `@yaks/session/transcript`, `@yaks/session/vocab` and
  `/graph`, `@yaks/session/status`; `@yaks/tools/errors` `refused`;
  `@yaks/durable-object/sql`, `/store` and `/resets` without its sockets;
  `@yaks/connections/integrations`; `@yaks/api/refuse`.

Compile and top-level evaluation in Node 26 as above (a fresh process each,
medians of 8 alternating rounds), main at `2052f6b4c` against this change:

| Isolate woken for                   |   Modules |       Compiled | Compile ms | Evaluate ms |
| ----------------------------------- | --------: | -------------: | ---------: | ----------: |
| The Operator's read (and its entry) |   76 → 59 | 1.98 → 1.13 MB |    87 → 55 |     55 → 41 |
| The Builder's class alone           |   20 → 13 | 1.14 → 0.57 MB |    52 → 30 |      18 → 5 |
| A space's page (kernel.ts)          |   61 → 72 | 1.46 → 1.31 MB |    69 → 64 |     19 → 19 |
| A Store (graph.ts)                  | 105 → 120 | 2.35 → 2.20 MB |   104 → 98 |     31 → 27 |

## Cold Operator Updates read (T-3613)

A fresh Deno process drove the emitted Builder's `/operator/updates` door
against a copy of the checks Operator store. The loader hook counted the emitted
chunks that the read opened, including any dynamic imports it ran. Uncached load
time is the median of five fresh processes importing those chunks with Deno's
code cache disabled.

| Cumulative change                                                         | Chunks loaded | Emitted MB | Load ms |
| ------------------------------------------------------------------------- | ------------: | ---------: | ------: |
| Starting checkout, `f27059922`                                            |           274 |       4.82 |     608 |
| Defer mail, chat, vector providers and subscription work                  |           199 |       3.65 |     389 |
| Separate Operator settings data and defer persona code                    |           190 |       2.75 |     373 |
| Separate file migration marks                                             |           191 |       2.75 |     362 |
| Separate attachment keys                                                  |           189 |       2.70 |     380 |
| Defer room and walkthrough code and narrow the directory's persona import |           170 |       2.39 |     305 |

The starting and final reads returned identical Updates JSON. These are
module-load timings in Deno. The previous 59-chunk count in `d6e29ff9f` covered
a narrower set of entry points.

The eager edges returned with these changes:

- `cc0835f68` imported the persona module for the settings overlay. `1adffdce6`
  also brought it in through the settings socket read.
- `1ad52d4f7` imported the file migration mark into store boot and the
  attachment door into conversation reads. `c17a72711` added the intake mark.
- `3a9183953`, `eddc03fd8`, `6bffb71a4` and `564bb8b70` loaded the mail sender,
  vector provider, chatters and subscription scheduler during boot. `2c4caf692`
  kept the mail import when it added unmetered platform letters.
- `c894bb65e` and `bf81e7ffb` added the room code and jq-backed result reads to
  the conversation host. `be295fa43` imported the persona package into directory
  reads for naming helpers.

Every kernel build prints the static closure from the Updates entry points,
including the Operator store's graph and effect facets. For the exact emitted
path, run the probe below from the repository root. The first command that runs
the probe records the modules opened by the read. The second replays only those
imports in a new process.

```sh
mkdir -p .scratch/operator-read
deno run -A workers/yak/gen.ts
deno run -A workers/yak/assets.ts
deno run -A workers/yak/bundle.ts .scratch/operator-read/out .scratch/operator-read/meta.json
deno run -A --no-check --no-code-cache bench/operator-read.ts \
  .scratch/operator-read/out .scratch/operator-read/meta.json.modules.json \
  > .scratch/operator-read/read.json
deno run -A --no-check --no-code-cache bench/operator-read.ts \
  .scratch/operator-read/out .scratch/operator-read/read.json --load
```

On yaks.app, `operator_boot_wait` identifies the Builder request that started
the store. Its duration is inside `operator_wait`, which can sum overlapping
calls.

### Production observations

Three browser visits to `/checks/updates` returned HTTP 200. Cloudflare recorded
Builder startup on the page's trace for both cold visits.

| Kernel commit             | Builder      | Server-Timing total |   Builder Updates event |
| ------------------------- | ------------ | ------------------: | ----------------------: |
| `4719601a2` before T-3613 | Cold         |            2,670 ms | 1,303 ms wall, 0 ms CPU |
| `8098eba39`               | Already open |              633 ms | 170 ms wall, 163 ms CPU |
| `970535164` with T-3613   | Cold         |            3,553 ms | 1,895 ms wall, 0 ms CPU |

The cold visits overlapped a Builder wake and a conversation read. Their
directory and Builder waits varied. These samples measure what the page waited
for, and the Deno replay isolates the change in module loading. The deployed
`/updates` page also returned HTTP 200 with 455 ms of server time.

## Operator and admin cold-browser opens (T-3644)

November 25, 2026. Desktop opens used a fresh browser cache and service worker
state at 1280 × 800. The Operator paths used the checks account and admin used
the platform admin bot. The measured routes were `/updates`, `/checks/updates`,
`/checks` and `/admin/people`. The `cold` Server-Timing marker identifies the
subset that also started a gateway isolate. On the new code, the presence of
`operator_boot_wait` identifies a page request that started a Builder store.

| Route                            | Successful opens, before → after | Gateway median, ms | Browser wait median, ms | First contentful paint median, ms |
| -------------------------------- | -------------------------------: | -----------------: | ----------------------: | --------------------------------: |
| All Updates, `/updates`          |                          12 → 12 |          616 → 568 |               808 → 839 |                     1,490 → 1,386 |
| Space Updates, `/checks/updates` |                          12 → 12 |          776 → 532 |             1,026 → 787 |                     1,430 → 1,196 |
| Operator chat, `/checks`         |                          11 → 12 |          481 → 390 |               705 → 602 |                     1,388 → 1,216 |
| Admin People, `/admin/people`    |                          12 → 12 |          209 → 200 |               440 → 430 |                         784 → 810 |

One baseline chat returned HTTP 500 and is excluded from the successful-open
medians. The after series includes kernel `24aab372f8` with the server change
and `125a09ee24` with both changes. Other changes deployed during the series.
The after series includes two gateway-cold All Updates opens and one each for
Space Updates, chat and Admin People. Two after requests started a Builder
store. The samples characterize cold browser opens and give a smaller subset for
cold gateway and Builder behavior.

### Server

The slowest baseline space Updates open measured 4,210 ms at the gateway. Its
Builder Updates fetch took 2,736 ms and its conversation fetch took 3,947 ms
while they overlapped. Its Builder wake began 51 ms before the Updates fetch.
The wake first entered the object's handler about 613 ms after the caller sent
it. Cloudflare attributed 1,751 ms of CPU to the conversation invocation. This
was also a directory stall window. The admin open in that round spent 3,290 ms
at the gateway, with sequential directory waits near one second each.

Several baseline traces also showed up to eight speculative app store wakes
starting at the same time as the Builder wake. The page now sends the needed
Operator read alongside the sidebar. This read opens the Builder and its answer
allows the Builder to resume owed work. The app named in the chat URL starts
alongside the read. The roster starts once the page has been drawn. Updates
still includes the adjacent chat and shares its listings read. The admin and
Operator paths load their page modules at their own routes.

The page's Server-Timing names its module load, directory waits, sidebar,
render, and, on a Builder boot, the Builder's store modules and store open. The
Worker clock advances on I/O. Pure JavaScript and synchronous SQLite work can
therefore show 0 ms. Pair the caller's fetch span with the first child
invocation to estimate pre-handler time including transport and queueing.
Cloudflare reports invocation CPU as a whole. Its spans cannot identify the
exact breakdown between isolate startup, module evaluation and SQLite CPU. The
waits of calls made in parallel overlap.

After the change, median directory wait was 249 ms for All Updates, 110 ms for
Space Updates, 58 ms for chat, and 170 ms for Admin People. The Admin People
census read took a median of 184 ms. The Builder's module and store-open marks
both read 0 ms on the two confirmed Builder boots. The gateway's render marks
also read 0 ms. The child spans began 24 and 49 ms after the caller sent the
Updates fetches on those boots.

Four after opens through the `/admin` redirect painted in 872–1,968 ms. The
original admin report, `1250404f81`, recorded 625 ms from request to first byte
within 2,756 ms to paint. Its record lacks timings for the browser resources and
rendering that followed. The report stays open because the historical cause has
yet to be verified. Two paired desktop replays showed styled admin content in
102–133 ms with the old loading screen and 119–149 ms with the new one, measured
from when the replay began parsing the HTML.

### Phone

Phone probes use 390 × 844, 4× CPU throttling and the browser's fast 4G preset.
The baseline chat loaded 39 JavaScript files, with median 335 KB transferred. In
two instrumented replays of the live checks HTML, the span from the first script
request to the last script response was 1,847 and 2,559 ms. Scripts reported in
long animation frames accounted for 496 and 845 ms. In the replay with app phase
marks, the transcript mounted in 131 ms, the composer mounted in 28 ms and the
draft setup took 14 ms. Those mounts are part of the script work, and the script
fetch span includes overlapping transfers. Startup trace entries and first-paint
marks can include the loading screen.

The chat document preloads the main script, its words, the shared page client
and nine static chunks. The loading screen releases once the HTML is parsed and
the stylesheets are present. The chat continues to mark itself usable after the
composer and transcript are mounted.

| Phone chat, ten per build | Before, median ms | After, median ms |
| ------------------------- | ----------------: | ---------------: |
| Browser wait              |               577 |              392 |
| Stylesheet finished       |               979 |              924 |
| Last JavaScript response  |             2,737 |            2,222 |
| First contentful paint    |             1,790 |            1,430 |
| Chat usable               |             3,532 |            2,485 |

In two paired client replays of the deployed chat HTML, the control restored the
old loading screen and removed the module preloads. Median script fetch span
fell from 3,431 to 1,611 ms and median time to styled content visible from 683
to 441 ms. Live after paint ranged from 1,056 to 1,928 ms, below the unchanged
2,200 ms budget. This verified the fix for `0bbca111f4`. The chat and Space
Updates still switched in place without a fetch.

### Send confirmation

A browser posted the chat form directly as the checks account, without first
opening a chat page. The form used the draft-aware send and each response
confirmed the submitted id. Three sends before the send change took a median of
168 ms at the gateway. The one confirmed Builder boot took 279 ms at the gateway
and 232 ms at the Builder door. The child invocation reported 142 ms of CPU,
compared with 29 and 30 ms on the two warm requests.

A chat's intake commits the request and draft changes together and registers the
owed effect before the Operator's model and tools are loaded. Its commit used to
start loading them in the same invocation that confirmed the send. Cold sends
now retain an alarm and let the caller wake the Operator as soon as the caller
has the receipt. A running Operator still takes a new send beside its current
step. The Builder also reports intake and alarm arming waits on the send
response.

All three after sends on kernel `031c8fa7` confirmed their request id. Median
gateway time was 327 ms and median browser receipt time was 1,115 ms, compared
with 168 and 430 ms before. The sole confirmed Builder-cold send in the after
series took 1,086 ms of gateway time and 1,052 ms at the Builder door.
Cloudflare's Builder handler span began about 535 ms after the caller sent the
request, compared with about 35 ms on the sole before boot. The after invocation
reported 290 ms of CPU, and the app's intake and alarm I/O clocks read 0 ms. The
live comparison did not establish a latency reduction. The Builder test confirms
that the cold receipt is sent before model work and that the caller's wake
carries out the request.

## App query Worker acquisition (T-3762)

The Tokyo Recipes query in ray `a6048b319a2cdeb3` took 1,323 ms to first byte.
The gateway GET span lasted 1,103 ms and Cloudflare reported 255 ms inside the
invocation, leaving 848 ms outside it. The gateway's own timer measured 210 ms.
The difference between the span and invocation includes dispatch, transport and
response delivery. Cloudflare's trace gives no independent compile timer.

The November 26 UTC experiment tested whether a smaller upload reduced this gap.
A probe Worker without a placement hint served the same fixed `GET` for
`yourname.yaks.app/recipes/api/query?.recipe&.limit=1` through a service binding
to each of the production kernel and two binding-only Workers. The two uploads
used the kernel's `aws:us-east-2` placement hint and 2025-05-08 compatibility
date. Cloudflare compiles all uploaded modules under that date's legacy module
registry.
[Cloudflare's module registry implementation](https://blog.cloudflare.com/workers-module-registry-nodejs/)

Both comparison Workers ran byte-identical JavaScript for the request. They
called `kernel.ts`'s `wrap` and `atSpace` with the production directory, Store
and rate limit bindings. The small build used `bundle.ts`'s esbuild options and
replaced dynamic imports outside the measured route with modules that throw on
import. It retained the vocabulary and lens modules required by the Recipes
query. The larger build added every module from an `index.ts` build at the same
revision under `control/`, unreferenced by the query entry. This isolates an
upload-size difference while holding the code that answers the request constant.

| Build                   | JavaScript modules | Raw bytes | Gzip bytes | Brotli bytes |
| ----------------------- | -----------------: | --------: | ---------: | -----------: |
| Small comparison Worker |                134 | 1,639,478 |    532,156 |      484,143 |
| Kernel reference build  |                826 | 7,897,854 |  2,522,662 |    2,183,648 |
| Large comparison Worker |                960 | 9,537,332 |  3,055,793 |    2,569,094 |

Raw sizes sum the JavaScript files. Compressed sizes use concatenated modules
with gzip level 9 and Brotli quality 6. The reference build uses the kernel's
esbuild options before production's Rollup grouping pass, at `1ccb6576b`.

The probe admitted only the fixed anonymous query. It returned 404 to requests
with cookies or authorization headers, dropped `Set-Cookie` from the answer, and
set `Cache-Control: private, no-store`. The comparison Workers took no session
secret, so this measures the public read with anonymous standing.

### Tokyo trace results

All 34 requests returned 200 at NRT with the same response body hash. The
gateway's `cold` timing marker identifies an isolate's first request. The
outside-invocation column takes the median of each trace's GET span duration
minus its invocation wall time. Small negative warm values reflect the trace
timers' different scope. All timings are milliseconds.

| Worker      | Isolate | Requests | First byte | Binding | GET span | Invocation wall | Outside invocation | Gateway | Store wait |
| ----------- | ------- | -------: | ---------: | ------: | -------: | --------------: | -----------------: | ------: | ---------: |
| Large       | Cold    |        7 |        707 |     677 |      509 |              83 |                421 |      49 |         39 |
| Small       | Cold    |        9 |        398 |     368 |      205 |              93 |                104 |      55 |         44 |
| Large       | Warm    |        7 |        232 |     199 |       43 |              50 |                 −4 |      43 |         33 |
| Small       | Warm    |        5 |        237 |     205 |       48 |              54 |                 −6 |      48 |         36 |
| Live kernel | Warm    |        6 |      272.5 |     218 |     68.5 |              76 |                 −8 |    54.5 |         43 |

The smaller upload reduced median cold time outside the invocation by 317 ms.
The large upload's cold gap ranged from 322 to 697 ms, and the small upload's
ranged from 88 to 159 ms. The median warm first byte differed by 5 ms. The
matched uploads establish a size effect on acquisition for this query. The
larger control carried 1.64 MB more than the kernel reference build. The traces
leave the attribution between compilation and the rest of Cloudflare's
acquisition path unresolved.

Representative NRT rays are `a60501f0f942980b` and `a60500ef0837592c` for the
large Worker, and `a60500d8ea9aca08` and `a60502119e7f6506` for the small
Worker, in cold and warm order. `a60500fd4b08c170` is a warm request through the
probe's live kernel binding. Direct production requests `a604faa9691c6468` and
`a604fabd4a1c354b` took 1,321 and 326 ms to first byte with outside-invocation
gaps of 358 and −13 ms and Store waits of 683 and 66 ms.

The small Worker's cold ray `a60501d4abc82623` still took 961 ms to first byte,
including 627 ms of Store wait and a 104 ms acquisition gap. T-151187 tracks the
Store Durable Object and page-triggered wakes. T-126130 measured the separate
Site and Files page-serving path. Production app queries continued through the
existing kernel, which returned 401 to a request with an invalid bearer token.
The three probe Workers were deleted after collecting the traces.

### Production query Worker

`yak-front` sends query reads on space hostnames to `yak-query` through a
service binding. The query Worker uses the kernel's directory routing, session
and access checks, and Store namespace. The kernel continues to serve custom
domains, draft previews, and requests the query Worker hands back.

The production and staging configurations each upload one JavaScript module. The
final upload dry run measured about 1.78 MB of JavaScript and 567 KB gzip. The
earlier matched Tokyo comparison used 1.64 MB for its small Worker and 7.90 MB
for its kernel reference. The production Worker also handles authenticated
callers, sandbox page tokens, and query features that the comparison probe did
not exercise.

Production query version `fd781aad-1bdd-4df2-8d0a-658a89bdebd5` began serving
with the existing session signer at 01:50:24 UTC. Live checks covered public and
private reads, invalid-bearer refusal, foreign-origin credential stripping, and
both sandbox page-token forms. The public query returned 200 with
`Cache-Control: private, no-store` (ray `a60540086e3cc6d7`). The private cookie
and OAuth bearer read the same protected row (rays `a605400c3b16b1eb` and
`a605400dd9aab1eb`). The sandbox token path with an opaque origin and the
sandbox bearer both read the protected row. A cookie alone returned 401 and a
token from the wrong app returned 404 (rays `a6054018f960b1eb`,
`a605401a8e03b1eb`, `a605401b88f1b1eb`, and `a605401c1aa6b1eb`).

#### Tokyo production GET traces

On November 26 UTC, two direct NRT probes on the same Tokyo Oracle network read
`/recipes/api/query?.recipe&.limit=1` through query Worker
`e00f351e-70f1-475f-a536-215231f39f21`. The first response carried `cold;dur=1`.
Both returned identical 200 bodies with `Cache-Control: private, no-store`. All
timings below are milliseconds.

| Worker and isolate  | Ray                | First byte | GET span | Invocation wall | Outside invocation | Gateway | Store wait |
| ------------------- | ------------------ | ---------: | -------: | --------------: | -----------------: | ------: | ---------: |
| Earlier kernel cold | `a604faa9691c6468` |      1,321 |    1,117 |             759 |                358 |       — |        683 |
| Earlier kernel warm | `a604fabd4a1c354b` |        326 |      105 |             118 |                −13 |       — |         66 |
| Query Worker cold   | `a60543696fc735ab` |        920 |      740 |             616 |                124 |     562 |        547 |
| Query Worker warm   | `a605437dd8371b46` |        256 |       65 |              73 |                 −8 |      53 |         42 |

The observed increase outside the invocation from warm to cold fell from 371 ms
to 132 ms. Each production path has one direct cold/warm pair. The matched
uploads above provide the controlled size comparison. Eight subsequent GETs with
both Worker and Store warm took 223–302 ms to first byte, with a 264.5 ms
median. The cold Query Worker request still spent 547 ms waiting for the Store,
which T-151187 tracks separately.

All 12 live access checks passed again on `e00f351e`, including private cookie
and OAuth authorization (rays `a60544675c27cf83` and `a6054468ee31cf83`),
sandbox token in the path and as a bearer (`a60544743b89cf83` and
`a60544759d57cf83`), and the wrong-app token refusal (`a6054476deebcf83`).

## Store acquisition on an authorized app page (T-151187)

In production trace `9b6463d362afc5a08f539195f4ba2bfa` at 01:43:30 UTC on
November 26, 2026, the kernel sent Township's `GET /wake` at the start of app
dispatch. Both began at 01:43:30.517. The Store handler started 926 ms later and
returned 204. This wake goes straight to `yak:Store` after app authorization.
The smaller query Worker reaches the same namespace. The `Uses.wake` RPC belongs
to the separate path for pages kept at the edge.

### Isolated Store upload

Using `9941f5418`, a temporary caller Worker exercised two private Workers
through cross-Worker Durable Object bindings. Each bound a freshly provisioned
SQLite namespace with class name `Store`. The full upload used the kernel's
normal esbuild and Rollup production build. The Store-only entry used the same
deferred Store methods, Store implementation, tracker instrumentation and
`FILE_CACHE` adapter, built with the kernel's esbuild options and dynamic
imports. Its upload includes all transitive modules the entry can reach,
including deferred directory and app facets. Both Workers used the kernel's
compatibility flags, legacy registry and ENAM object location hint.

For each upload the caller alternated between new object names and repeated each
request immediately. All 64 requests returned a 204 wake and a 200 query with
the same empty result. Wake times measure the binding round trip. The trace
residual subtracts the Store response span from the caller's fetch span and
includes dispatch, transport and response delivery. These samples cover new,
empty SQLite objects across five US colos.

| Upload      | JS modules |  JS bytes | First wake median (range), ms | First wake trace residual median, ms | Repeat wake median, ms |
| ----------- | ---------: | --------: | ----------------------------: | -----------------------------------: | ---------------------: |
| Full kernel |        702 | 7,968,341 |               637 (162–1,104) |                                  506 |                   31.5 |
| Store only  |        631 | 6,795,028 |               683 (510–1,139) |                                  554 |                     37 |

Each row has 16 first wakes and 16 repeats. Representative cold IAD rays are
`a6055817df641011` and `a605581f5a1b1011`, respectively. The smaller upload
saved 14.7% of the JavaScript bytes. The measured wakes showed no reduction.

### In-place bundle changes

A second comparison used the same kernel build with Rollup's
`hoistTransitiveImports: false`, and a one-module esbuild build. The Rollup
variant removed 2,921 redundant direct imports and kept every module's
transitive dependencies, exports and dynamic imports. The esbuild variant
replaced the local-only MCP filesystem reader with a throwing stub for this
experiment. All 72 timed requests returned 204 then 200 with matching empty
query results.

| Upload                    | JS modules |  JS bytes | First wake median (range), ms | Repeat wake median, ms |
| ------------------------- | ---------: | --------: | ----------------------------: | ---------------------: |
| Full kernel               |        702 | 7,968,341 |               654 (561–1,281) |                   26.5 |
| Removed redundant imports |        702 | 7,869,952 |               816 (534–1,191) |                   29.5 |
| One module                |          1 | 6,977,182 |               880 (744–1,887) |                   19.5 |

Each row has 12 first wakes and 12 repeats. Representative cold IAD rays are
`a6055b5bfb8ada52`, `a6055b55c9ddda52` and `a6055b615b46da52`. Both build
changes can use the existing Worker and class names. The measured wakes showed
no improvement. A measurement on an evicted, populated Store remains open.

### Binding and authorization

The isolated caller bound `class_name = "Store"` with the temporary owning
Worker as `script_name`. The owning Worker used a local `STORE` binding and a
fresh SQLite class declaration. Cloudflare accepted both uploads and the
cross-Worker bindings. All temporary Workers were removed after the probes.

A production split would keep authorization in the existing kernel, Site and
query entrypoints. Public route and publication checks, session and OAuth
standing, sandbox page tokens, and the app worker's visitor and app grants would
still control which requests reach the Store. Only trusted platform Workers
would bind its namespace and supply the existing internal headers. The Store
needs its directory and peer-Store calls, lifecycle bindings, and alarm and
hibernating socket handlers. The directory (`yak/platform`) and `yak/git` share
the same Store class as the apps. Moving ownership therefore requires
coordinating the whole namespace and distinguishing the sibling Workers' release
IDs from the Store's deployment-skew lineage.
[Cloudflare Durable Object class transfers](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

The experiment used its own namespaces. Production continues to serve the same
authorization paths and Store namespace. The 926 ms Township gap remains open.

## A sleeping Store waits on the registry's compile (T-151187)

November 27, 2026. The comparisons above timed new, empty objects, where an
object's creation hides an upload's cost. These time existing SQLite objects
that had slept, through cross-Worker bindings from a caller placed at
`aws:us-east-2`, each object hinted `enam`. Every object Worker ran the same
11-line class (one `select count(*)` per call); the large ones also uploaded the
kernel's 721 modules (8.37 MB, built at `cc546ac69`) beside it. The "import"
builds load the Store's module (graph.ts's chunk and its 3.9 MB static closure)
on their first call without running it. Each object was seeded once, then woken
after 2–6 minutes asleep or straight after a new version of its Worker. The
class reported whether its isolate and its object were new.

Caller's round trip of an object's first call, milliseconds:

| Upload                  | Registry | New isolate: n, median (range) | Isolate warm: n, median |
| ----------------------- | -------- | -----------------------------: | ----------------------: |
| Class only (1 KB)       | legacy   |                 15, 51 (43–84) |                   3, 62 |
| With the kernel's 8 MB  | legacy   |              15, 330 (295–921) |                   3, 54 |
| With the kernel's 8 MB  | new      |                14, 90 (75–139) |                   4, 63 |
| 8 MB, imports the Store | legacy   |               9, 423 (392–791) |                   3, 60 |
| 8 MB, imports the Store | new      |               5, 341 (287–465) |                   7, 54 |

Three of four first calls found a new isolate. Repeat calls took 4–21 ms. New
objects (the seeding call) took 180 ms for the class only, 397 with the 8 MB
under the legacy registry and 194 under the new one.

So the 205–532 ms before a sleeping Store's code ran was the legacy registry
compiling the whole upload, not Cloudflare's own start, which is about 50 ms.
T-148980's revert compared the first call's CPU and wall under each registry,
which leaves out the legacy registry's compile before the call. Under
`new_module_registry` the upload's unimported modules cost 40 ms, and the
Store's static closure (3.9 MB, 381 chunks: directory.ts, chat.ts, models.ts
with @yaks/session and marked, signup.ts with libphonenumber, load.ts with every
package's vocabulary) costs about 250 ms. The kernel takes `new_module_registry`
again; what the Store's first call imports is the next cost to cut.

### Live, November 27

`3ac093885` (the registry) went live at 13:29:48 UTC and `b02adb21b` at
13:38:04. `b02adb21b` cut graph.ts's static closure from 4.06 to 3.21 MB
(esbuild output bytes): request-only doors load where they are asked, and
`planting`, the space-mail door, `recognized` and the build keys moved out of
the modules that brought @yaks/session, the builder, dispatch and pages, and
libphonenumber with them.

From the box (ORD), one `/api/query?q=.doc .limit=1` per yourname app, the
server's `store_wait`, milliseconds, for the 11 apps asleep in the first round:

| Round            | Code                          | Median | Range     | Faster than legacy |
| ---------------- | ----------------------------- | -----: | --------- | -----------------: |
| 13:27            | legacy registry               |    783 | 626–1,485 |                  — |
| 13:32            | new registry                  |    768 | 532–1,263 |            9 of 11 |
| 13:44            | new registry, smaller closure |    552 | 465–1,191 |           11 of 11 |
| 13:48, no deploy | same                          |    482 | 432–1,072 |           11 of 11 |

A warm second read took 15–57 ms throughout. In the 13:44 round the caller's
wait less the Store invocation's wall was 56–131 ms, which is the object's start
now; the Store's first call spent 359–723 ms of CPU, against 418–449 ms at 13:32
and 163–279 ms under the legacy registry (T-149696), where the compile happened
before the call. Reads with no deploy since the store's last wake skip the
schema fit and still spent 310–902 ms of CPU, so the Store's boot is the
remaining cost. `Uses` calls in a new isolate show their own load now: 16 of
1,116 in 13:30–13:44 spent 50 ms of CPU or more (median 54.5 CPU, 68.5 wall),
where under the legacy registry none did and the task measured 160–726 ms before
such calls began.

## What a Store's first read runs, and what it only compiles (T-149696)

November 27, 2026, over `admin copy` stores of yourname, on a loaded box (load
average 7), so read these figures as comparisons with each other.

- **Vocabularies.** The 851 KB of JSON in graph.ts's closure (load.ts's
  vocabularies among it) costs 25 ms in Node to compile and evaluate as object
  literals, 16 ms as `JSON.parse` strings and 5 ms as strings never parsed,
  against about 218 ms for the closure's 2.2 MB of code. Making the vocabulary
  facets lazy is worth at most about 10 ms.
- **The privacy readiness check** (personal.ts `stored`) is 43 ms of the first
  read's profile. Skipping it leaves the first read just as slow: the compile it
  pays is shared with the read that follows.
- **Boot and read in process** (Deno, facets loaded beforehand): about 230 ms of
  CPU, then 15–20 ms for the next read. Most of the difference is V8 compiling
  functions the first time they run: the SQL binder and renderer, the plugins'
  binding, and the app's words.
- **Code a read never runs.** 1.2 MB of the closure's 2.2 MB of code had no
  sample during boot and read: yaml (103 KB), @yaks/ui (79), connections (73),
  openai and workers-ai (54), the browser client and sync (47), es-module-lexer
  (28), croner (28) and others.

The cuts made here take 274 KB of code out of graph.ts's static closure, 3.06 →
2.79 MB (esbuild input bytes), without changing what a read runs:

| Edge cut                              | Brought                       | KB |
| ------------------------------------- | ----------------------------- | -: |
| graph.ts → providers.ts               | connections, lending, secrets | 99 |
| app-canvas.ts → page-graph.ts (REACH) | @yaks/client, @yaks/sync      | 49 |
| vocab.ts → @yaks/esbuild              | the module graph, lexer       | 34 |
| declaration.ts → files.ts, objects.ts | Files' door, release, lexer   | 54 |
| browser-sessions.ts → signed-in.ts    | ua-parser-js                  | 20 |
| graph.ts → unseen.ts                  | the tracker's reads           | 19 |

Importing the graph.ts chunk in a fresh Node process, 12 alternating rounds: 466
→ 405 ms of CPU (median), faster in 10 of 12, median paired difference 45 ms.
Left in the closure: yaml through @yaks/platform/manifest (103 KB; a manifest is
read synchronously), the provider facets that `planting` asks for their names
(104 KB), chat.ts (43 KB, lent synchronously at bind) and croner (28 KB).

## The new registry's compile is billed CPU (T-1180)

November 27, 2026. The kernel served `new_module_registry` from version
`103994a9` (`b4cc460dc`, first request 13:29Z). Cloudflare's
`workersInvocationsAdaptive` for the yak Worker, by version, 12:00Z to 15:10Z:
the seven versions before it averaged 7–10 ms of CPU a request, every version
after it 20–44 ms. By the hour, p50 stayed about 5 ms while p99 went from about
40 ms to 276–374 ms, and the hour's CPU from 420–520 s to 1,638, 2,570 and 2,328
s. The legacy registry's compile of the upload happens at the isolate's start,
outside any request's `cpuTimeUs`; the new one compiles inside the first call
that imports. The wall time the new registry saved a Store's first call (423 to
341 ms above) does not pay for tripling what the Worker is billed, so the legacy
registry stays and shrinking the upload is the lever for a wake.
