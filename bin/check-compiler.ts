/** Native compiler hosts share CPU with the test runtime. Resolve and prepare
 * their independent projects together, then compile one at a time. Default
 * GOMAXPROCS=1 keeps Go's parallel work from competing with that runtime;
 * an inherited GOMAXPROCS keeps the caller's choice. */
export let compiler = <T>(
  run: (args: string[], env: Record<string, string>) => Promise<T>,
  inherited: Record<string, string> = {},
) => {
  let tail = Promise.resolve()
  return (args: string[]): Promise<T> => {
    let next = tail.then(() =>
      run(args, { ...inherited, GOMAXPROCS: inherited.GOMAXPROCS ?? '1' })
    )
    tail = next.then(() => {}, () => {})
    return next
  }
}
