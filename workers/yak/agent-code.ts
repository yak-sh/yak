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
import {
  RESULT_LIMIT,
  RESULT_SCHEMA,
  resultBytes,
  resultValue,
} from './results.ts'

// Both agent doors offer short executions over the connector's tools. Each
// nested call reads the caller's reach anew, including apps just deployed.
export let coded = <T extends Options>(
  opts: T,
  ctx: Ctx,
  local?: ResultHost,
) => {
  let catalog = registry([{
    name: 'yaks',
    tools: [
      ...listing(opts),
      ...resultTools(ctx, local),
    ],
  }])
  let run = runner(opts.calls ?? opts.graph, {
    tools: catalog,
    host: opts.graph,
    report: opts.report,
  })
  let unavailable = () => {
    throw refuse('unavailable', 'code mode is unavailable on this kernel')
  }
  let offered = (args = {}) =>
    codeMode(
      catalog,
      run,
      ctx.env.CODE_MODE ?? unavailable,
      ctx.env.ESBUILD ? stripping(ctx.env) : unavailable,
      ctx.env.CLOCK,
      async () => {
        let now = { ...ctx, dir: ctx.reopen?.() ?? ctx.dir }
        let reach = await inReach(now)
        let graph = await reaching(now, reach)
        let catalog = registry([{
          name: 'yaks',
          tools: [
            ...listing({ ...opts, graph, search: searching(now, reach) }),
            ...resultTools(now, local),
          ],
        }])
        return runner(ledger(graph, opts.calls), {
          tools: catalog,
          host: graph,
          report: opts.report,
        })
      },
      resultStore(ctx, args, local),
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
    run: (
      call: Parameters<typeof base.run>[0],
      graph: Parameters<typeof base.run>[1],
    ) => offered(argsOf(call)).run(call, graph),
  }
  catalog.replace('code', [code])
  let retain: NonNullable<Options['retain']> = {
    schema: RESULT_SCHEMA,
    result: async (answer, tool, call) => {
      let value = resultValue(answer, tool)
      if (resultBytes(value) <= RESULT_LIMIT) return
      let summary = await resultStore(ctx, argsOf(call), local).keep(
        value,
        call,
      )
      return {
        content: [{ type: 'text', text: JSON.stringify(summary) }],
        structuredContent: summary,
      }
    },
  }
  return { ...opts, registry: catalog, runner: run, retain }
}
