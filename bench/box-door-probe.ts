/** The explicit-door CLI, observed through its existing more/ask seams.
 * Requests include credential lookup, transport and response decoding;
 * preparation is the observed interval before fetch, not a credential estimate. */
let boot = performance.now()
let marks: Record<string, number> = { boot }
let requests: {
  method: string
  tool?: string
  start: number
  ms: number
  preparation: number
}[] = []
let began = 0, fetched = 0
let go = globalThis.fetch
globalThis.fetch = (...args: Parameters<typeof fetch>) => {
  fetched = performance.now()
  return go(...args)
}
let yak = await import('../packages/cli/yak.ts')
let { cli } = await import('../packages/cli/run.ts')
let { closeAccounts } = await import('../packages/cli/accounts.ts')
let held = await import('../packages/cli/held.ts')
marks.import = performance.now()
let more: typeof yak.YAK.more = async (c, o) => {
  marks.listStart = performance.now()
  let ask = c.ask
  c.ask = async (method, params) => {
    began = performance.now()
    fetched = began
    let response = await ask(method, params)
    requests.push({
      method,
      tool: (params as { name?: string })?.name,
      start: began,
      ms: performance.now() - began,
      preparation: fetched - began,
    })
    return response
  }
  let commands = await yak.YAK.more!(c, o)
  marks.list = performance.now()
  return commands.map((command) => ({
    ...command,
    run: async (args, context) => {
      marks.runStart = performance.now()
      let code = await command.run(args, context)
      marks.run = performance.now()
      return code
    },
  }))
}
let code = await cli(yak.TOOLS, { ...yak.YAK, more, argv: Deno.args })
marks.cli = performance.now()
await held.close(code)
await closeAccounts()
marks.close = performance.now()
await Deno.writeTextFile(
  Deno.env.get('BOX_PROBE_OUT')!,
  JSON.stringify({
    origin: performance.timeOrigin,
    marks,
    requests,
  }),
)
Deno.exit(code)
