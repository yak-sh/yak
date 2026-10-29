/** The explicit-door CLI, observed through its existing more/ask seams.
 * Requests include credential lookup, transport and response decoding;
 * preparation is the observed interval before fetch, not a credential estimate. */
let { cputime } = await import('@yaks/benchmark')
let boot = performance.now()
let marks: Record<string, number> = { boot }
let cpus: Record<string, number> = { boot: cputime()! }
let mark = (name: string) => {
  marks[name] = performance.now()
  cpus[name] = cputime()!
}
let requests: {
  method: string
  tool?: string
  start: number
  ms: number
  preparation: number
  cpu: number
  preparationCpu: number
}[] = []
let began = 0, fetched = 0, cpuBegan = 0, cpuFetched = 0
let go = globalThis.fetch
globalThis.fetch = (...args: Parameters<typeof fetch>) => {
  fetched = performance.now()
  cpuFetched = cputime()!
  return go(...args)
}
let yak = await import('../packages/cli/yak.ts')
let { cli } = await import('../packages/cli/run.ts')
let { closeAccounts } = await import('../packages/cli/accounts.ts')
let held = await import('../packages/cli/held.ts')
mark('import')
let more: typeof yak.YAK.more = async (c, o) => {
  mark('listStart')
  let ask = c.ask
  c.ask = async (method, params) => {
    began = performance.now()
    cpuBegan = cputime()!
    fetched = began
    cpuFetched = cpuBegan
    let response = await ask(method, params)
    requests.push({
      method,
      tool: (params as { name?: string })?.name,
      start: began,
      ms: performance.now() - began,
      preparation: fetched - began,
      cpu: cputime()! - cpuBegan,
      preparationCpu: cpuFetched - cpuBegan,
    })
    return response
  }
  let commands = await yak.YAK.more!(c, o)
  mark('list')
  return commands.map((command) => ({
    ...command,
    run: async (args, context) => {
      mark('runStart')
      let code = await command.run(args, context)
      mark('run')
      return code
    },
  }))
}
let code = await cli(yak.TOOLS, { ...yak.YAK, more, argv: Deno.args })
mark('cli')
await held.close(code)
await closeAccounts()
mark('close')
await Deno.writeTextFile(
  Deno.env.get('BOX_PROBE_OUT')!,
  JSON.stringify({
    origin: performance.timeOrigin,
    marks,
    cpus,
    requests,
  }),
)
Deno.exit(code)
