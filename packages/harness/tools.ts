import { derivedEid, mint } from '@yaks/graph/identity'
import { toolName } from '@yaks/graph/call'
import type { Reply } from '@yaks/tools'
import { answerOf, toolEid, worded } from '@yaks/tools/result'
import { runner } from '@yaks/tools'
import { artifactTools } from './artifact_tools.ts'

import { type Blobs, valueTools } from '@yaks/blob'
// What the agent can do here: run a program, and read and write its own graph.
//
// Both halves already exist — ./machine.ts declares the machine tools over
// whatever machine the host lends, @yaks/mcp declares the generic graph tools —
// and the only
// thing between them is a difference of format. A graph tool may declare its
// arguments as a Zod schema, which the MCP SDK takes; a model wants JSON
// Schema. So this file is one adapter: `graphTools` declares each
// tool with its arguments as JSON Schema, writes a call entity for each call
// and records what it returned.
//
// The model never calls a tool function directly here either. A call is an
// entity attributed to the session that asked for it, so what the tool writes
// is written in the agent's name and not the runner's, and the transcript's own
// record of the call is the same entity @yaks/tools' runner answered.
//
// The conversion is not written here. `inputSchemaOf` (@yaks/mcp/tools) is
// what an MCP `tools/list` sends, with references inlined: a provider reads a
// tool's parameters on its own, without a document to resolve `$ref` against.
// That subpath loads no MCP SDK, so a session that serves nothing never pays
// for a server.

import { machines, type SessionMachines } from './session_machines.ts'
import type { Entity, Graph, Tool as GraphTool } from '@yaks/graph'
import { core, inputSchemaOf } from '@yaks/mcp/tools'
import { workspaceTools } from '@yaks/machine/tools'
import { sessionHome, type Workspaces } from '@yaks/machine/targets'
import {
  type ChildLimits,
  sessionTools,
  type Tool,
  ToolError,
} from '@yaks/session'

/**
 * Graph tools as tools a model may call: the generic tier (`graph_apply`,
 * `graph_query`, `graph_show`, `graph_schema`) where `tools` names none, or
 * the ones it names (a host's plugins' own, `memory_around` among them). The
 * agent reads and writes the same graph its transcript lives in.
 */
export let graphTools = (
  g: Graph,
  opts: {
    actor?: Entity | null
    reply?: Reply
    tools?: GraphTool[]
  } = {},
): Tool[] => {
  let tier = opts.tools ??
    core({ vocab: g.vocab })
  // A runner: these calls are this agent's own, and `call()` runs them here.
  // Nothing sweeps a queue from inside an agent — a call somebody else wrote
  // is for whoever works the effects to notice, by handling the same rules.
  // What the host's own runner adds to a direct call's answer, this one adds
  // too, so the agent reads what any caller reads.
  let r = runner(g, {
    tools: tier,
    host: g,
    ...opts.reply ? { reply: opts.reply } : {},
  })
  return tier.map((t) => ({
    name: toolName(t),
    description: t.description,
    parameters: inputSchemaOf(t),
    ...t.readOnly ? { readOnly: true } : {},
    // A call, signed as the session that asked: the runner runs the function
    // and lands what it answered in that session's name.
    run: async (args: Record<string, unknown>, call) => {
      let actor = call?.session ? { eid: call.session } : opts.actor ?? null
      await r.ensure()
      let id = call?.call
        ? derivedEid(`harness graph tool ${call.call.entity.eid}`)
        : mint()
      return worded(answerOf(
        await r.call({
          entity: { eid: id },
          call: { to: toolEid(toolName(t)), args: args ?? {} },
          ...(actor ? { $actor: { by: actor.eid } } : {}),
        }),
        id,
      ))
    },
    recover: async (_, ctx) => {
      let id = derivedEid(`harness graph tool ${ctx.call.entity.eid}`)
      let [call] = await g.get([id])
      if (!call) return undefined
      let answer = await r.interruptCall(
        id,
        'Graph tool execution was interrupted. Its write may have landed; ' +
          'inspect the graph before repeating it.',
      )
      return worded(answerOf(answer, id))
    },
  }))
}

/** The machine, delegation, and the graph, with one wait for all three targets.
 * react records every tool's wall-clock and projects it after output bounding;
 * these raw answers remain parseable JSON for non-model callers. */
export let harnessTools = (
  g: Graph,
  opts:
    & {
      cwd?: string
      /** where artifacts' bytes are kept (the harness's `artifacts`) */
      artifacts?: Blobs
      /** the root a task child's checkout is cut under */
      machines?: SessionMachines
      workspaces?: Workspaces
      /** what a direct graph tool call is owed beside its answer (the
       * harness's `reply`) */
      reply?: Reply
    }
    & ChildLimits = {},
): Tool[] => {
  let binding = opts.machines ?? machines(g)
  let selected = opts.workspaces ?? {
    connect: () => {
      throw new Error('This host lends no workspace execution binding')
    },
  }
  let machine = workspaceTools(g, selected).map((tool) => ({
    ...tool,
    run: async (
      args: Record<string, unknown>,
      ctx?: import('@yaks/session').ToolContext,
    ) => {
      if (
        !args.workspace && ctx && ['shell', 'read', 'write'].includes(tool.name)
      ) await binding.home(ctx.session)
      return tool.run(args, ctx)
    },
  }))
  let session = sessionTools(g, { ...binding.limits, ...opts })
  let processWait = machine.find((t) => t.name == 'wait')!
  let childWait = session.find((t) => t.name == 'wait')!
  let wait: Tool = {
    name: 'wait',
    waits: true,
    description:
      'Wait for a process OR named child sessions OR tasks, with a timeout in milliseconds.',
    parameters: {
      type: 'object',
      properties: {
        process: { type: 'string' },
        children: { type: 'array', items: { type: 'string' }, minItems: 1 },
        tasks: { type: 'array', items: { type: 'string' }, minItems: 1 },
        timeout: { type: 'number' },
      },
      oneOf: [{ required: ['process'] }, { required: ['children'] }, {
        required: ['tasks'],
      }],
    },
    run: (args, ctx) => {
      if (
        [args.children, args.process, args.tasks].filter((v) => v != null)
          .length != 1
      ) {
        throw new ToolError(
          'wait',
          'name exactly one of process, children, or tasks',
        )
      }
      return args.process != null
        ? processWait.run(args, ctx)
        : childWait.run(args, ctx)
    },
  }
  return [
    ...machine.map((t) => t.name == 'wait' ? wait : t),
    ...session.filter((t) => t.name != 'wait'),
    {
      name: 'session_home',
      description:
        'Set a session default workspace without moving files or stopping commands. Omitting cwd clears the previous directory.',
      parameters: {
        type: 'object',
        properties: {
          session: { type: 'string' },
          workspace: { type: 'string' },
          cwd: { type: 'string' },
        },
        required: ['session', 'workspace'],
      },
      run: async (args) => {
        await sessionHome(
          g,
          String(args.session),
          String(args.workspace),
          args.cwd == null ? undefined : String(args.cwd),
        )
        return 'Session home updated'
      },
    },
    ...artifactTools(g, opts),
    ...graphTools(g, { reply: opts.reply }).filter((t) =>
      t.name != 'session_home'
    ),
    ...valueTools(async (entity) =>
      (await g.read('.entity.eid=' + JSON.stringify(entity)))[0]
    ),
  ]
}
