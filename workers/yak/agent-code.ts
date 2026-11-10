import { listing, type Options } from '@yaks/mcp'
import { registry, runner } from '@yaks/tools'
import { tool as codeMode } from '@yaks/code-mode'
import { reaching, searching } from './agent.ts'
import { inReach } from './declared.ts'
import { stripping } from './esbuild.ts'
import { ledger } from './ledger.ts'
import { argsOf } from '@yaks/graph'
import { type Ctx, refuse, SPACE } from './tool.ts'
import { type ResultHost, resultStore, resultTools } from './result-tools.ts'
import type { Tool } from '@yaks/graph'
// Both agent doors offer short executions over the connector's tools. Each
// nested call reads the caller's reach anew, including apps just deployed.
export let coded = <T extends Options>(
  opts: T,
  ctx: Ctx,
  local?: ResultHost,
  remote: Tool[] | (() => Promise<Tool[]>) = [],
) => {
  let catalog = registry([{
    name: 'yaks',
    tools: [
      ...listing(opts),
      ...resultTools(ctx, local),
    ],
  }])
  let remoteTools = typeof remote == 'function' ? [] : remote
  let codeCatalog = registry([
    { name: 'yaks', tools: catalog.list() },
    { name: 'mcp', tools: remoteTools },
  ])
  let run = runner(opts.calls ?? opts.graph, {
    tools: catalog,
    host: opts.graph,
    report: opts.report,
    refused: opts.refused,
  })
  let codeRun = runner(opts.calls ?? opts.graph, {
    tools: codeCatalog,
    host: opts.graph,
    report: opts.report,
    refused: opts.refused,
  })
  let unavailable = () => {
    throw refuse('unavailable', 'code mode is unavailable on this kernel')
  }
  let offered = (args = {}) =>
    codeMode(
      codeCatalog,
      codeRun,
      ctx.env.CODE_MODE ?? unavailable,
      ctx.env.ESBUILD ? stripping(ctx.env) : unavailable,
      {
        clock: ctx.env.CLOCK,
        report: opts.report,
        refused: opts.refused,
        current: async () => {
          let now = { ...ctx, dir: ctx.reopen?.() ?? ctx.dir }
          let reach = await inReach(now)
          let graph = await reaching(now, reach)
          let catalog = registry([{
            name: 'yaks',
            tools: [
              ...listing({ ...opts, graph, search: searching(now, reach) }),
              ...resultTools(now, local),
            ],
          }, { name: 'mcp', tools: remoteTools }])
          return runner(ledger(graph, opts.calls), {
            tools: catalog,
            host: graph,
            report: opts.report,
            refused: opts.refused,
          })
        },
        kept: resultStore(ctx, args, local),
      },
    )
  let base = offered()
  let code = {
    ...base,
    inputSchema: {
      ...base.inputSchema,
      properties: {
        ...(base.inputSchema as { properties: Record<string, unknown> })
          .properties,
        space: SPACE,
      },
    },
    run: async (
      call: Parameters<typeof base.run>[0],
      graph: Parameters<typeof base.run>[1],
    ) => {
      if (typeof remote == 'function') {
        remoteTools = await remote()
        codeCatalog.replace('mcp', remoteTools)
      }
      return offered(argsOf(call)).run(call, graph)
    },
  }
  catalog.replace('code', [code])
  codeCatalog.replace('code', [code])
  return { ...opts, registry: catalog, runner: run }
}
