// The server: a graph, its tools, and the MCP protocol machine that lists and
// calls them. Everything transport-shaped lives in ./mount.ts and ./stdio.ts;
// this file only knows how a `Tool` becomes an MCP tool.
//
// A tool is handed a `ToolCtx` whose `apply` is SIGNED — every bundle's
// `$actor` is replaced by the identity the door authenticated, exactly as
// @yaks/api's `/apply` does it, so a tool cannot write in the client's name
// even if the client asked it to.
//
// A refusal comes back as the tool's own error text with `isError`, never as a
// protocol error: a bad argument or a rejected write is something the agent
// reads and corrects, not a broken connection.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  type Entity,
  type Graph,
  type Schema,
  type Tool,
  type ToolCtx,
  toolsOf,
} from '@yaks/graph'
import { signed } from '@yaks/api'
import type { BundleOpts, Depth } from './schema.ts'
import { core, type Search } from './tools.ts'
import type { Guide } from './words.ts'

/** How an MCP server over a graph is built. */
export type Options = {
  /** the graph its tools read and write */
  graph: Graph
  /** who is calling — every write this server makes is signed as this entity
   * (default: nobody, and batches land unattributed) */
  actor?: Entity | null
  /** the server's name, as a client displays it (default: `yaks`) */
  name?: string
  /** the server's version (default: `0.0.0`) */
  version?: string
  /** what the agent should read before anything else */
  instructions?: string
  /** how deeply each tool's output schema spells out the vocabulary
   * (default: `full` — see {@link Depth}; the write door is always `full`) */
  schema?: Depth
  /** a column this host answers or takes differently than the vocabulary
   * declares — a reference that reads back as a named object, a column two of
   * its stores spell differently (see {@link BundleOpts}) */
  column?: BundleOpts['column']
  /** where a component is documented at length, when this host has such a
   * page — `graph_schema` hands it over beside the columns */
  guide?: Guide
  /** ranked full-text search; without it there is no `search` tool */
  search?: Search
  /** tools beside the generic tier and the graph's plugins' */
  tools?: Tool[]
  /** what a result should ALSO say, given the names this server is listing
   * right now: the staleness line for a client whose cached tool list has
   * moved under it (roster.ts). Called once per tool result, and what it
   * answers rides as a trailing content block — a JSON answer stays JSON. */
  roster?: (names: string[]) => string | undefined | Promise<string | undefined>

  /** a host with more than tools to serve — resources, prompts, a capability
   * of its own — registers them on the same server here, after its tools are
   * on it. It is handed the SDK's own server, and it is awaited. */
  extend?: (server: McpServer) => void | Promise<void>
}

/**
 * A tool's own reply, when the words and the value differ: `text` is what a
 * client without schemas reads, and `data` is handed to one that renders the
 * answer (MCP Apps) exactly as given — not wrapped under `result`, which is
 * what a tool answering a plain value gets.
 *
 * ```ts
 * run: () => new Say('two apps here', { apps: [] })
 * ```
 */
export class Say {
  constructor(readonly text: string, readonly data?: unknown) {}
}

// The reply, said both ways from one value: the JSON as text for a client that
// reads text, and the same value as `structuredContent` for one that reads the
// schema. MCP requires structured content to be an object, so it rides under
// `result` (schema.ts `outputSchema`).
let said = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: { result: value },
})

let bare = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

// A tool that says its own words (`Say`). The data rides UNWRAPPED, because a
// host that renders it was told which page to render it in and the page reads
// the answer's own shape.
let spoke = (s: Say): CallToolResult => ({
  content: [{ type: 'text', text: s.text }],
  ...(s.data == undefined
    ? {}
    : { structuredContent: s.data as Record<string, unknown> }),
})

// A refusal IS an error: `isError` rides the reply so a harness counts it as
// one instead of a success that reads like an apology.
let failed = (err: unknown): CallToolResult => ({
  content: [{
    type: 'text',
    text: err instanceof Error ? err.message : String(err),
  }],
  isError: true,
})

// @yaks/graph leaves a tool's schemas opaque, because the core depends on no
// validation library. Here is where `Schema` means something: the MCP SDK takes
// Zod, so a schema that is not one is a mistake to say out loud at startup
// rather than a tool that lists wrong.
let zodOf = (
  tool: string,
  where: string,
  s: Schema | undefined,
): z.ZodTypeAny | undefined => {
  if (s == undefined) return undefined
  if (s instanceof z.ZodType) return s
  throw new Error(`${tool}: ${where} must be a Zod schema`)
}

// One more thing said at the end of a reply, as its own content block. It is
// not appended to the text because a text may be JSON — the generic tier
// answers a described value — and a sentence glued to it would be a value the
// caller can no longer parse.
let noting = (out: CallToolResult, line: string | undefined): CallToolResult =>
  line
    ? { ...out, content: [...out.content, { type: 'text', text: line }] }
    : out

let shapeOf = (tool: Tool): Record<string, z.ZodTypeAny> =>
  Object.fromEntries(
    Object.entries(tool.input ?? {}).map((
      [name, s],
    ) => [name, zodOf(tool.name, `argument '${name}'`, s)!]),
  )

/**
 * Every tool this server lists, in the order it registers them: the generic
 * tier, then the graph's plugins', then the host's own.
 *
 * ```ts
 * let names = listing(opts).map((t) => t.name)
 * ```
 */
export let listing = (opts: Options): Tool[] => [
  ...core({
    vocab: opts.graph.vocab,
    depth: opts.schema,
    column: opts.column,
    guide: opts.guide,
    search: opts.search,
  }),
  ...toolsOf(opts.graph.plugins),
  ...(opts.tools ?? []),
]

/** The ROSTER this server serves: the names it lists, in listing order. What a
 * client caches at connect, and what {@link rosterVersion} names. */
export let roster = (opts: Options): string[] =>
  listing(opts).map((t) => t.name)

/**
 * Build the MCP server for a graph: the generic tier (`graph_apply`,
 * `graph_query`, `graph_show`, `graph_schema`, and `search` when a
 * {@link https://jsr.io/@yaks/mcp/doc/~/Search | Search} was passed), plus
 * every tool the graph's plugins contribute and any you pass yourself.
 *
 * ```ts
 * let s = server({ graph, actor: { eid: 'm1' } })
 * await s.connect(transport)
 * ```
 */
export let server = (opts: Options): McpServer => {
  let { graph } = opts
  let actor = opts.actor ?? null
  let mcp = new McpServer({
    name: opts.name ?? 'yaks',
    version: opts.version ?? '0.0.0',
  }, {
    capabilities: { tools: {} },
    ...(opts.instructions ? { instructions: opts.instructions } : {}),
  })

  let ctx: ToolCtx = {
    graph,
    actor,
    apply: (change) => graph.apply(signed(change, actor)),
    read: (query, readOpts) => graph.read(query, readOpts),
  }

  let tools = listing(opts)
  let names = tools.map((t) => t.name)

  for (let t of tools) {
    let output = zodOf(t.name, 'output', t.output)
    let config = {
      ...(t.title ? { title: t.title } : {}),
      description: t.description,
      inputSchema: shapeOf(t),
      annotations: {
        readOnlyHint: !!t.readOnly,
        destructiveHint: !t.readOnly,
        openWorldHint: false,
      },
      ...(t.meta ? { _meta: t.meta } : {}),
    }
    let run = async (args: Record<string, unknown>) => {
      let out: CallToolResult
      try {
        let value = await t.run(args, ctx)
        out = value instanceof Say
          ? spoke(value)
          : output
          ? said(value)
          : bare(value)
      } catch (err) {
        out = failed(err)
      }
      // A refusal carries it too: an agent holding a stale list is likelier to
      // be refused than served, and that is the reply worth telling.
      return noting(out, await opts.roster?.(names))
    }
    if (output) {
      mcp.registerTool(t.name, { ...config, outputSchema: output }, run)
    } else mcp.registerTool(t.name, config, run)
  }
  return mcp
}
