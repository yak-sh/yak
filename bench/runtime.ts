/** The runtime cache a suite's `yak` commands launch from
 * (packages/cli/runtime.ts): one per suite process, which outlives each
 * collection (./standalone-worker.ts), and goes when the process ends. A
 * person's command starts from a slot an earlier one wrote, so a suite warms
 * it with one untimed command before timing any. A cache per collection timed
 * the slot's write (the tree, its patch and its install, about 4 s) as each
 * collection's first command. */
let cache: string | undefined

export let runtimeCache = (): string => {
  if (cache) return cache
  let made = cache = Deno.makeTempDirSync({ prefix: 'yak-bench-runtime-' })
  globalThis.addEventListener('unload', () => {
    try {
      Deno.removeSync(made, { recursive: true })
    } catch { /* A cache another cleanup removed is gone either way. */ }
  })
  return made
}
