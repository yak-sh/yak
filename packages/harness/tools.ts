import { validateToolInput } from '@yaks/vocab/tools'
import { toolName } from '@yaks/graph'
import { artifactTools } from './artifact_tools.ts'
import type { ImageOptions } from './images.ts'
import { valueTools } from '@yaks/blob'
// What the agent can do here: run a program, and read and write its own graph.
//
// Both halves already exist as packages — @yaks/process declares the shell as
// session tools, @yaks/mcp declares the generic graph tier as graph tools — and
// the only thing missing between them is a dialect. A graph tool says its
// arguments in Zod, because that is what MCP's SDK takes; a model wants JSON
// Schema. So this file is one conversion and one adapter: `parametersOf` says a
// tool's arguments the way a model reads them, and `graphTools` hands each
// tool the {@link ToolCtx} it expects and flattens what it answers to text.
//
// The conversion is not hand-written. `shapeOf` (@yaks/mcp) is where a tool's
// Zod shape already comes from, and `zod-to-json-schema` is what the MCP SDK
// itself converts with — a second reading of Zod's type table would be a copy
// to keep in step for nothing. References are inlined ($refStrategy 'none'):
// a provider reads a tool's parameters on its own, without a document to
// resolve `$ref` against.

import { sessionCwd, workspace } from './workspace.ts'
import type { Entity, Graph, Tool as GraphTool, ToolCtx } from '@yaks/graph'
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

// A tool's answer as the transcript keeps it. Bundles are the usual answer, and
// a model reads JSON as well as it reads anything; a tool that already speaks
// prose is left alone.
let said = (out: unknown): string =>
  typeof out == 'string' ? out : JSON.stringify(out, null, 1)

/**
 * The generic graph tier as tools a model may call: `graph_apply`,
 * `graph_query`, `graph_show`, `graph_schema`. The agent reads and writes the
 * same graph its transcript lives in.
 */
export let graphTools = (
  g: Graph,
  opts: { actor?: Entity | null; depth?: Depth } = {},
): Tool[] => {
  let ctx: ToolCtx = {
    graph: g,
    actor: opts.actor ?? null,
    apply: (change) => g.apply(change),
    read: (query, o) => g.read(query, o),
  }
  return core({ vocab: g.vocab, depth: opts.depth ?? 'names' }).map((t) => ({
    name: toolName(t),
    description: t.description,
    parameters: parametersOf(t),
    run: async (args: Record<string, unknown>, call) => {
      let actor = call?.session ? { eid: call.session } : ctx.actor
      return said(
        await t.run(validateToolInput(t, args), {
          ...ctx,
          actor,
          apply: (change) =>
            g.apply(change.map((b) => ({
              ...b,
              $actor: actor ? { by: actor.eid } : {},
            }))),
        }),
      )
    },
  }))
}

/** The shell, delegation, and the graph, with one wait for all three targets.
 * react records every tool's wall-clock and projects it AFTER output bounding;
 * these raw answers remain parseable JSON for non-model callers. */
export let harnessTools = (
  g: Graph,
  opts:
    & { cwd?: string; depth?: Depth; images?: ImageOptions | false }
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
  let session = sessionTools(g, { ...workspace(g, directory), ...opts })
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
