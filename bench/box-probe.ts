/** One `yak` command, timed from inside (./box.ts): the CLI's own exported
 * pieces run in the order `yak` runs them, with a timestamp between each.
 * Every piece is the real one: the commands are listed by local.ts, the graph
 * is opened through local.ts's own cache (so the tool finds it open and does
 * not open it again), and the tool runs as `yak` runs it. Started by box.ts
 * like the CLI itself, without network permission:
 *
 *   BOX_PROBE_OUT=<out.json> deno run <PERMS> bench/box-probe.ts <mode> <yak argv...>
 *
 * `phases` runs the command and records when each phase ended, and the span
 * trees its graph produced after it was opened. `compose` stops after opening
 * the graph, opened instead by `compose()` directly with its config's channel
 * subscribed, and records the phases `compose()` itself names. */
let boot = performance.now()
let marks: Record<string, number> = { boot }
let mark = (name: string) => marks[name] = performance.now()

let yak = await import('../packages/cli/yak.ts')
let local = await import('../packages/cli/local.ts')
let { cli } = await import('../packages/cli/run.ts')
let { closeAccounts } = await import('../packages/cli/accounts.ts')
let { compose, facet, words } = await import('../packages/cli/host.ts')
let { read } = await import('../packages/cli/config.ts')
let { channel } = await import('@yaks/trace')
let { collector } = await import('./box-lib.ts')
type Command = import('../packages/cli/run.ts').Command
mark('import')

let [mode, ...argv] = Deno.args
let out = Deno.env.get('BOX_PROBE_OUT')
if (!out || !['phases', 'compose'].includes(mode)) {
  throw new Error('usage: BOX_PROBE_OUT=<file> box-probe.ts phases|compose …')
}
let spans = collector()
let waste = 0

// The commands `yak` lists for a config, each one opening its graph first
// where the probe can see the opening end, then running unchanged.
let more: typeof yak.YAK.more = async (c) => {
  mark('more')
  let listed = await local.commands(c)
  mark('commands')
  let start = performance.now()
  let pooled = !!(await words(read(c.config!))).vocab.comp('effect')
  waste += performance.now() - start
  return listed.map((command): Command => ({
    ...command,
    run: async (args, ctx) => {
      let roles = local.rolesOf(command, pooled)
      let readOnly = !!command.readOnly
      if (mode == 'compose') {
        let config = read(ctx.config!)
        let given = !ctx.duties || readOnly
          ? { ...config, duties: false }
          : config
        let stop = channel(given).subscribe(spans.add)
        let host = await compose(given, roles, facet, { readOnly })
        mark('compose')
        stop()
        await host.close()
        return 0
      }
      let host = await local.opened(ctx.config!, roles, ctx.duties, readOnly)
      mark('compose')
      channel(host.graph).subscribe(spans.add)
      let code = await command.run(args, ctx)
      mark('tool')
      return code
    },
  }))
}

let code = await cli([...yak.TOOLS], { ...yak.YAK, more, argv })
mark('cli')
await local.close(code)
await closeAccounts()
mark('close')
await Deno.writeTextFile(
  out,
  JSON.stringify({
    origin: performance.timeOrigin,
    marks,
    waste,
    code,
    spans: spans.take(),
  }),
)
Deno.exit(code)
