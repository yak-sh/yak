/** How a native compiler's Go runtime runs here, beneath what the caller's
 * environment sets. One thread (GOMAXPROCS=1) keeps Go's parallel work from
 * competing with the test runtime. A compiler's heap is nearly all live
 * (the parsed program), so collecting at every doubling (Go's GOGC=100)
 * spends a third of a check's CPU finding little garbage: GOGC=400 collects
 * at five times the live heap, and GOMEMLIMIT collects sooner past 3 GiB. */
export let GO = { GOMAXPROCS: '1', GOGC: '400', GOMEMLIMIT: '3GiB' }

/** Native compiler hosts share CPU with the test runtime. Resolve and prepare
 * their independent projects together, then compile one at a time, under
 * `GO` unless the caller's environment says otherwise. */
export let compiler = <T>(
  run: (args: string[], env: Record<string, string>) => Promise<T>,
  inherited: Record<string, string> = {},
) => {
  let tail = Promise.resolve()
  return (args: string[]): Promise<T> => {
    let next = tail.then(() => run(args, { ...GO, ...inherited }))
    tail = next.then(() => {}, () => {})
    return next
  }
}
