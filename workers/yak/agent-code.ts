import { listing, type Options } from '@yaks/mcp'
import { registry, runner } from '@yaks/tools'
import { tool as codeMode } from '@yaks/code-mode'
import { reaching, searching } from './agent.ts'
import { inReach } from './declared.ts'
import { ledger } from './ledger.ts'
import { type Ctx, refuse } from './tool.ts'

// Both agent doors offer short executions over the connector's tools. Each
// nested call reads the caller's reach anew, including apps just deployed.
export let coded = <T extends Options>(opts: T, ctx: Ctx) => {
  let catalog = registry([{ name: 'yaks', tools: listing(opts) }])
  let run = runner(opts.calls ?? opts.graph, {
    tools: catalog,
    host: opts.graph,
    report: opts.report,
  })
  let code = codeMode(
    catalog,
    run,
    ctx.env.CODE_MODE ?? (() => {
      throw refuse('unavailable', 'code mode is unavailable on this kernel')
    }),
    ctx.env.CLOCK,
    async () => {
      let now = { ...ctx, dir: ctx.reopen?.() ?? ctx.dir }
      let reach = await inReach(now)
      let graph = await reaching(now, reach)
      let catalog = registry([{
        name: 'yaks',
        tools: listing({ ...opts, graph, search: searching(now, reach) }),
      }])
      return runner(ledger(graph, opts.calls), {
        tools: catalog,
        host: graph,
        report: opts.report,
      })
    },
  )
  catalog.replace('code', [code])
  return { ...opts, registry: catalog, runner: run }
}
