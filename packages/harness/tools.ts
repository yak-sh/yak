import { toolName } from '@yaks/graph'
import { answerOf, runner, toolEid, worded } from '@yaks/tools'
import { artifactTools } from './artifact_tools.ts'
import type { ImageOptions } from './images.ts'
import { valueTools } from '@yaks/blob'
// What the agent can do here: run a program, and read and write its own graph.
//
// Both halves already exist as packages — @yaks/process declares the shell as
// session tools, @yaks/mcp declares the generic graph tools — and the only
// thing between them is a difference of format. A graph tool declares its
// arguments as a Zod schema, because that is what the MCP SDK takes; a model
// wants JSON Schema. So this file is one conversion and one adapter:
// `parametersOf` renders a tool's arguments as JSON Schema, and `graphTools`
// writes A call entity for each one and records what it returned.
//
// The model never calls a tool function directly here either. A call is an
// entity attributed to the session that asked for it, so what the tool writes
// is written in the agent's name and not the daemon's, and the transcript's own
// record of the call is the same entity @yaks/tools' runner answered.
//
// The conversion is not hand-written. `shapeOf` (@yaks/mcp) is where a tool's
// Zod shape already comes from, and `zod-to-json-schema` is what the MCP SDK
// itself converts with — reimplementing Zod's type table here would be a second
// copy to keep in step for nothing. References are inlined ($refStrategy 'none'):
// a provider reads a tool's parameters on its own, without a document to
// resolve `$ref` against.

import { sessionCwd, workspace } from './workspace.ts'
import { worktrees } from './paths.ts'
import type { Entity, Graph, Tool as GraphTool } from '@yaks/graph'
import { shapeOf } from '@yaks/mcp'
import { core, type Depth } from '@yaks/mcp'
import { shellTools } from '@yaks/process'
import {
  type ChildLimits,
  sessionTools,
  type Tool,
  ToolError,
} from '@yaks/session'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

/** A graph tool's arguments as JSON Schema, the way a model declaration takes
 * them. */
export let parametersOf = (tool: GraphTool): Record<string, unknown> => {
  if (tool.inputSchema) return tool.inputSchema
  let json = zodToJsonSchema(z.object(shapeOf(tool)), {
    $refStrategy: 'none',
  }) as Record<string, unknown>
  delete json.$schema
  return json
}

/**
 * The generic graph tier as tools a model may call: `graph_apply`,
 * `graph_query`, `graph_show`, `graph_schema`. The agent reads and writes the
 * same graph its transcript lives in.
 */
export let graphTools = (
  g: Graph,
  opts: { actor?: Entity | null; depth?: Depth } = {},
): Tool[] => {
  let tier = core({ vocab: g.vocab, depth: opts.depth ?? 'names' })
  // A runner: these calls are this agent's own, and `call()` runs them here.
  // Nothing sweeps a queue from inside an agent — a call somebody else wrote
  // is a daemon's to notice, by registering the same rules as effects.
  let r = runner(g, { tools: tier, host: g })
  return tier.map((t) => ({
    name: toolName(t),
    description: t.description,
    parameters: parametersOf(t),
    // A call, signed as the session that asked: the runner runs the function
    // and lands what it answered in that session's name.
    run: async (args: Record<string, unknown>, call) => {
      let actor = call?.session ? { eid: call.session } : opts.actor ?? null
      await r.ensure()
      return worded(answerOf(
        await r.call([{
          entity: { eid: '$call' },
          call: { to: toolEid(toolName(t)), args: JSON.stringify(args ?? {}) },
          ...(actor ? { $actor: { by: actor.eid } } : {}),
        }]),
      ))
    },
  }))
}

/** The shell, delegation, and the graph, with one wait for all three targets.
 * react records every tool's wall-clock and projects it after output bounding;
 * these raw answers remain parseable JSON for non-model callers. */
export let harnessTools = (
  g: Graph,
  opts:
    & {
      cwd?: string
      depth?: Depth
      images?: ImageOptions | false
      /** the root a task child's checkout is cut under */
      worktrees?: string
    }
    & ChildLimits = {},
): Tool[] => {
  let shell = shellTools(g, { cwd: opts.cwd })
  let directory = opts.cwd ?? Deno.cwd()
  let baseShell = shell.find((t) => t.name == 'shell')!
  let runShell = baseShell.run
  baseShell.run = async (args, ctx) =>
    runShell({
      ...args,
      cwd: args.cwd ??
        (ctx ? await sessionCwd(g, ctx.session, directory) : directory),
    }, ctx)
  let session = sessionTools(g, {
    ...workspace(g, directory, opts.worktrees ?? worktrees()),
    ...opts,
  })
  let processWait = shell.find((t) => t.name == 'wait')!
  let childWait = session.find((t) => t.name == 'wait')!
  let wait: Tool = {
    name: 'wait',
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
    ...shell.map((t) => t.name == 'wait' ? wait : t),
    ...session.filter((t) => t.name != 'wait'),
    ...artifactTools(g, opts),
    ...graphTools(g, { depth: opts.depth }),
    ...valueTools(async (entity) =>
      (await g.read('.entity.eid=' + JSON.stringify(entity)))[0]
    ).map((tool) => ({
      ...tool,
      run: async (args: Record<string, unknown>) => {
        try {
          return await tool.run(args)
        } catch (error) {
          throw new ToolError(
            'value',
            error instanceof Error ? error.message : String(error),
          )
        }
      },
    })),
  ]
}
