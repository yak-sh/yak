import { listing, type Options } from '@yaks/mcp'
import { registry, runner, valueIn } from '@yaks/tools'
import {
  definition,
  HOSTED_LIMITS,
  type Options as Coding,
  tool as codeMode,
} from '@yaks/code-mode'
import { connected, reaching, searching } from './agent.ts'
import { inReach } from './declared.ts'
import { stripping } from './esbuild.ts'
import { ledger } from './ledger.ts'
import { argsOf, type Bundle } from '@yaks/graph'
import { toolName } from '@yaks/graph/call'
import {
  apart,
  APP,
  type Args,
  type Ctx,
  inApp,
  inSpace,
  refuse,
  SPACE,
  str,
} from './tool.ts'
import { type ResultHost, resultStore, resultTools } from './result-tools.ts'
import type { Graph, NamedTool, Tool } from '@yaks/graph'
import { outlasted } from './outlast.ts'
import { connectedTools } from './connected-mcp.ts'
import { admitted, hearing } from './refusals.ts'
import { reporter } from './defects.ts'
// Both agent doors offer short executions over the connector's tools. Each
// nested call reads the caller's reach anew, including apps just deployed.
// A host that narrows a turn once it heard words it cannot vouch for says
// which nested answers brought them (`hears`), by its direct calls' rule,
// and a host that confirms some calls first keeps them out of scripts
// (`unscripted`, operator-approvals.ts), so they are only ever called direct.
export let coded = <T extends Options>(
  opts: T & Pick<Coding, 'hears'> & {
    /** The tools this caller keeps in its own graph, under their usual names. */
    own?: { tools: NamedTool[]; graph: Graph; calls: Graph }
    /** The tools a script may not call, though a direct call may. */
    unscripted?: Set<string>
  },
  ctx: Ctx,
  local?: ResultHost,
  remote: Tool[] | (() => Promise<Tool[]>) = [],
) => {
  let { own } = opts
  let names = new Set(own?.tools.map((t) => t.name))
  let appTools = (tools: Tool[]) =>
    tools.filter((t) =>
      !names.has(t.name!) && !opts.unscripted?.has(toolName(t))
    )
  let tools = [...listing(opts), ...resultTools(ctx, local)]
  let remoteTools = typeof remote == 'function' ? [] : remote
  let codeCatalog: ReturnType<typeof registry> | undefined
  let codeRun: ReturnType<typeof runner> | undefined
  let ownRun: ReturnType<typeof runner> | undefined
  let ownRunner = () =>
    own && (ownRun ??= runner(own.calls, {
      tools: own.tools,
      host: own.graph,
      report: opts.report,
      refused: opts.refused,
    }))
  let scriptRunner = () =>
    codeRun ??= runner(opts.calls ?? opts.graph, {
      tools: scripts(),
      host: opts.graph,
      report: opts.report,
      refused: opts.refused,
    })
  let unavailable = () => {
    throw refuse('unavailable', 'code mode is unavailable on this kernel')
  }
  let offered = async (args: Args, call: string) => {
    apart(args)
    let { app, space, draft } = args
    let files = {
      space: typeof space == 'string' ? space : undefined,
      app: typeof app == 'string' ? app : undefined,
      draft: typeof draft == 'string' ? draft : undefined,
    }
    if (draft != null && !files.app) {
      throw refuse('arguments', 'Choose an app to open a specific draft.')
    }
    if (draft == 'new') {
      throw refuse(
        'arguments',
        'Open a new draft with app_files and pass its draft id.',
      )
    }
    let runCtx = { ...ctx }
    let at = args.script !== undefined && app != null
      ? await inApp(runCtx, args)
      : null
    let caller = at
      ? { app: at.app.eid, level: at.who.role, person: ctx.person }
      : undefined
    let evaluate = ctx.env.CODE_MODE ?? unavailable
    return codeMode(
      scripts(),
      scriptRunner(),
      async (modules, bridge, signal) => {
        let paying = ctx.env.LOADER
          ? at?.space ?? (await inSpace(runCtx, args)).space
          : undefined
        return await evaluate(modules, bridge, signal, {
          caller,
          bill: paying
            ? { space: paying, person: ctx.person, call }
            : undefined,
        })
      },
      ctx.env.ESBUILD ? stripping(ctx.env) : unavailable,
      {
        files,
        limits: HOSTED_LIMITS,
        clock: ctx.env.CLOCK,
        report: opts.report,
        refused: opts.refused,
        current: async () => {
          let now = { ...ctx, dir: ctx.reopen?.(true) ?? ctx.dir }
          let reach = await inReach(now)
          let graph = await reaching(now, reach)
          let current = Array.isArray(opts.core)
            ? connected(now, reach, graph)
            : { graph, search: searching(now, reach) }
          let catalog = registry([{
            name: 'yaks',
            tools: [
              ...appTools(listing({ ...opts, ...current })),
              ...resultTools(now, local),
            ],
          }, { name: 'mcp', tools: remoteTools }])
          let apps = runner(ledger(graph, opts.calls), {
            tools: catalog,
            host: graph,
            report: opts.report,
            refused: opts.refused,
          })
          return {
            admit: (call) => ownRunner()?.admit(call) ?? apps.admit(call),
          }
        },
        kept: resultStore(ctx, args, local),
        hears: opts.hears,
      },
    )
  }
  let yaks = { name: 'yaks', tools: [...appTools(tools), ...own?.tools ?? []] }
  let described = definition([yaks, { name: 'mcp', tools: remoteTools }], {
    files: {},
    limits: HOSTED_LIMITS,
  })
  let code: Tool = {
    ...described,
    inputSchema: {
      ...described.inputSchema,
      properties: {
        ...described.inputSchema.properties,
        space: SPACE,
        app: {
          ...APP,
          description:
            'An app slug to use for connection sentinels and the optional draft.',
        },
        draft: str(
          'An open draft id for this app. Omit to use app_files draft selection.',
        ),
      },
    },
    run: async (call, graph) => {
      let args = argsOf(call)
      if (
        args.script !== undefined && ctx.outlast && ctx.env.OUTLAST &&
        ctx.env.SESSION_SECRET
      ) {
        return await outlasted(
          ctx.env.OUTLAST,
          `code_mode|${call.entity.eid}`,
          {
            tool: 'code_mode',
            call: call.entity.eid,
            args,
            person: ctx.person,
            who: ctx.who,
          },
          'The script is still running.',
          ctx.env.SESSION_SECRET,
          ctx.clock?.include,
        )
      }
      if (typeof remote == 'function') {
        let catalog = scripts()
        remoteTools = await remote()
        catalog.replace('mcp', remoteTools)
      }
      return (await offered(args, call.entity.eid)).run(call, graph)
    },
  }
  let scripts = () =>
    codeCatalog ??= registry([
      yaks,
      { name: 'mcp', tools: remoteTools },
      { name: 'code', tools: [code] },
    ])
  let catalog = registry([
    { name: 'yaks', tools },
    { name: 'code', tools: [code] },
  ])
  let run = runner(opts.calls ?? opts.graph, {
    tools: catalog,
    host: opts.graph,
    report: opts.report,
    refused: opts.refused,
  })
  return { ...opts, registry: catalog, runner: run }
}

/** Reopen an outlasting connector script with the same actor and tool scope. */
export let scripted = async (ctx: Ctx, call: Bundle) => {
  let reach = await inReach(ctx)
  let graph = await reaching(ctx, reach)
  let { registry } = coded(
    {
      ...connected(ctx, reach, graph),
      calls: ledger(graph),
      report: reporter(ctx),
      refused: hearing(ctx.env, admitted(ctx)),
    },
    ctx,
    undefined,
    () => connectedTools(ctx),
  )
  let answer = await registry.get('code_mode')!.run(call, graph)
  let result = valueIn(answer)
  if (result && JSON.stringify(result.value ?? null).length > 256 * 1024) {
    result.value = await resultStore(ctx, argsOf(call)).keep(result.value, call)
  }
  return answer
}
