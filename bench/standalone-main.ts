/** A bench file run directly hands its suite to the shared runner, bench/run.ts.
 * This module imports nothing, because a bench file imports it at its top and
 * whatever it loaded would sit in the heap of every process that file measures:
 * the suite registry (./standalone.ts) loads every suite's fixtures, some 1,500
 * modules, and a heap that size makes each scavenge, and so any bench that
 * allocates, slower. */
export let standaloneMain = async (name: string): Promise<void> => {
  let child = await new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '-A',
      new URL('./run.ts', import.meta.url).pathname,
      name,
      ...(Deno.args.length ? ['--', ...Deno.args] : []),
    ],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn().status
  Deno.exit(child.code)
}
