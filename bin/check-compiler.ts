/** How a native compiler's Go runtime runs here, beneath what the caller's
 * environment sets. One thread (GOMAXPROCS=1) keeps Go's parallel work from
 * competing with the test runtime: Go's own threads spend a third more CPU
 * for the same check. A compiler's heap is nearly all live (the parsed
 * program), so collecting at every doubling (Go's GOGC=100) spends a third of
 * a check's CPU finding little garbage: GOGC=400 collects at five times the
 * live heap, and GOMEMLIMIT collects sooner past 3 GiB. */
export let GO = { GOMAXPROCS: '1', GOGC: '400', GOMEMLIMIT: '3GiB' }

/** Native compiler hosts, each under `GO` unless the caller's environment
 * says otherwise. Independent programs compile at once, a thread each: one
 * after another, a change reaching both waits for the sum of their checks,
 * and on a busy box, where each thread gets a share of a core, that sum is
 * most of a run's wall clock. */
export let compiler = <T>(
  run: (args: string[], env: Record<string, string>) => Promise<T>,
  inherited: Record<string, string> = {},
) =>
(args: string[]): Promise<T> => run(args, { ...GO, ...inherited })
