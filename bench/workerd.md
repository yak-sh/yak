# Workerd probe runner

`deno task test:workerd` owns one Node host and one kernel workerd for the
entire run. Wrangler builds the production bundle once. Deno runs test modules
in parallel, including the MCP probes split by subject; no probes are removed.
The broad `TASKS_SLOW=1 deno task test` uses the same host. Direct `deno test`
still supports the standalone Wrangler path for individual probes.

The test-only entrypoint wraps real workerd DO/SQLite, KV and R2 bindings with
per-lease physical names. Tests can use identical logical space/app names,
independent secrets and different vars concurrently. Mail logs are per lease.
Releasing one lease does not stop another's kernel. No deployed worker imports
this wrapper. Two previously isolate-global caches now use store/entity
identity, not a shared map or a reusable slug.

There are two code exceptions, not config exceptions:

- `dispatch_test.ts`: links the uploaded shim, worker and compiled Wasm.
- `wrangler_workerd_test.ts`: runs uploaded local classes and app bindings.

Those `script()` probes each load their generated module set in a short-lived
Miniflare runtime. Thus the suite has **one kernel boot plus two script boots**,
not 105 Wrangler builds/boots. All var-configured kernels share the kernel host.

## Resources and cleanup

The default is at most four test jobs, further bounded by cores and available
memory (600 MiB/job); `DENO_JOBS` overrides it. Four jobs saturated the shared
kernel more efficiently than eight on the measured host.

On Linux, absent an explicit `TMPDIR`, the host prefers `/dev/shm` when at least
512 MiB is available. Otherwise it uses the normal temporary directory. These
are real SQLite files, not mocked storage: they need durability during a test,
not across suite runs. The measured suite used roughly 130 MiB of temp files;
that RAM-backed storage is additional to process RSS. Slow disks can push the
suite above the timing target. Set `TMPDIR=/tmp` to exercise the disk path.

The runner holds the host's stdin open as a lifetime lease. EOF disposes all
runtimes; a bounded fallback kills the process group. Miniflare's signal hook
reaps workerd, and a synchronous exit hook removes the enclosing temp tree.
Normal EOF and SIGTERM were exercised with live leases: both removed their
scratch tree and left no child processes. The runner preserves failing test exit
codes and does not retry failed requests.

## Measurement

Measure the **whole** `deno task test:workerd` command, including bundle/startup
and shutdown. Report wall time and the peak sum of RSS across its process tree
(including the detached host), not just `/usr/bin/time`'s largest single child.
The suite timer in `bench/suites.md` also records load-compensated observations.

The final post-rebase measurements passed all 852 tests: 88.51 s including a
dependency reinstall (2148.4 MiB peak process-tree RSS), then 85.56 s warm
(2167.9 MiB). An earlier warm iteration reached 56.44 s, but the final runs do
**not** establish a reliable sub-60-second result on this shared host. Relative
to the reported 551 s starting point, the final warm run is about 6.4 times
faster. The boot-count reduction is complete; the remaining wall-clock target
still needs work.
