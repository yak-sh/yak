import { type NamedTool, namedTool, offered, toolName } from '@yaks/graph'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
// The server: a graph, its tools, and the MCP protocol implementation that
// lists and calls them. Everything transport-specific lives in ./mount.ts and
// ./stdio.ts; this file only knows how a @yaks/graph `Tool` becomes an MCP
// tool.
//
// An MCP `tools/call` reaches the tool function through @yaks/tools' runner,
// and the runner records the call as it goes: a `call{to, args}` entity signed
// as the identity this server authenticated, written before the function runs,
// and a `result` entity after. The bundles the tool returned are applied as
// the caller, so a tool cannot write in the client's name even if the client
// asks it to, and every call this server handled is an entity somebody can
// read afterwards.
//
// A refusal comes back as the tool's own error text with `isError` set, never
// as a JSON-RPC protocol error: a bad argument or a rejected write is
// something the agent reads and corrects, not a broken connection.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  type Actor,
  type Bundle,
  type Graph,
  type Schema,
  status,
  type Tool,
  toolsOf,
} from '@yaks/graph'
import {
  answerOf,
  CallError,
  faulted,
  type Opts as RunnerOpts,
  type Runner,
  runner,
  structured,
  toolEid,
  worded,
} from '@yaks/tools'
import type { BundleOpts, Depth } from './schema.ts'
import { core, type CoreOpts, pointing, type Search } from './tools.ts'
import type { Guide } from '@yaks/graph'

/**
 * How a client signs in to call a tool: `noauth` means anybody may call it,
 * `oauth2` means it needs an access token, and both together mean anonymous
 * calls work and signing in unlocks more. It is sent on the tool as
 * `_meta.securitySchemes`, which is how a client tells a mixed-auth server's
 * open tools from its authenticated ones without calling one to find out.
 */
export type Security =
  | { type: 'noauth' }
  | { type: 'oauth2'; scopes?: string[] }

/** The default `report`: a defect, said on the console. */
export let logged = (err: unknown) => console.error('tool failed —', err)

/** How an MCP server over a graph is built. */
export type Options = {
  /** the graph its tools read and write */
  graph: Graph
  /** the runner these tools are run by, when the calling program already has
   * one. The HTTP handler builds a server per request and shares its runner,
   * so the `tool` rows are written once for the process rather than once per
   * request. Otherwise a runner is built here over `calls`. */
  runner?: Runner
  /** the graph a call and its result are recorded in (default: `graph`). A
   * server whose graph should not hold them — one composed over somebody
   * else's stores, or a connector that will not write a stranger's question
   * into them — passes a separate graph here; the tools still read and write
   * `graph`. */
  calls?: Graph
  /** where a tool's defect goes, with the call and the tool's name (default:
   * the console). A refusal (`CallError`) is never reported. */
  report?: RunnerOpts['report']
  /** who is calling — every write this server makes is signed with this actor:
   * `by` the identity it acts for, `via` the run it came through (default:
   * nobody, and writes are stored unattributed) */
  actor?: Actor | null
  /** the server's name, as a client displays it (default: `yaks`) */
  name?: string
  /** the server's version (default: `0.0.0`) */
  version?: string
  /** the server's name as a person reads it, where `name` is the id a client
   * keys it by (MCP `Implementation.title`) */
  title?: string
  /** one line describing what this server is, for a client that displays one
   * (MCP `Implementation.description`) */
  description?: string
  /** where to read more about it (MCP `Implementation.websiteUrl`) */
  websiteUrl?: string
  /** the square icon a client shows beside the name (MCP
   * `Implementation.icons`, the 2025-11-25 revision). `sizes` is `['any']` for
   * a scalable icon, otherwise `['512x512']` and the like; `src` is an http(s)
   * or a data URI, and an SVG behind one must embed its own assets — an
   * `<img>` loads nothing a referenced SVG points at. */
  icons?: {
    src: string
    mimeType?: string
    sizes?: string[]
    theme?: 'light' | 'dark'
  }[]
  /** what the agent should read before anything else */
  instructions?: string
  /** how much of the vocabulary each tool's output schema describes
   * (default: `full` — see {@link Depth}; `graph_apply`'s input schema is
   * always `full`) */
  schema?: Depth
  /** a property the calling program returns or accepts differently than the
   * vocabulary declares — a reference that reads back as a named object, or a
   * property two of its stores name differently (see {@link BundleOpts}) */
  prop?: BundleOpts['prop']
  /** where a component is documented at length, when the calling program has
   * such a page — `graph_schema` returns it beside the properties */
  guide?: Guide
  /** ranked full-text search; without it there is no `search` tool */
  search?: Search
  /** this server only reads: the generic tier's `graph_apply` is not listed at
   * all — see {@link CoreOpts.readOnly}. A plugin's own tools are untouched:
   * this constrains the generic tier, not every tool. */
  readOnly?: boolean
  /** extra arguments every generic read tool takes here — see
   * {@link CoreOpts.scope} */
  scope?: CoreOpts['scope']
  /** how a caller undoes a delete on this deployment, appended to
   * `graph_apply`'s description — see {@link CoreOpts.undo} */
  undo?: CoreOpts['undo']
  /** what every tool this server lists declares about signing in
   * ({@link Security}), declared per tool because that is where a client reads
   * it — a tool carrying `securitySchemes` in its own `meta` keeps that
   * instead. Pass a function to answer per tool, for a server where the answer
   * differs between them: a read anybody may make listed beside a write that
   * needs a token, so a client has something concrete to prompt the sign-in
   * for */
  security?: Security[] | ((t: NamedTool) => Security[] | undefined)
  /** tools to list beside the generic tier and the graph's plugins' */
  tools?: Tool[]
  /** whether this server adds the generic tier itself (default: yes). A
   * calling program that already has the tier in `tools` — one whose CLI runs
   * the same `graph_apply` this server does, out of one list — passes false,
   * so the tier is listed once and is the same tool object either way. */
  core?: boolean
  /** extra text to append to a tool result, given the tool names this server
   * is listing right now: the staleness sentence for a client whose cached
   * tool list has changed under it (roster.ts). Called once per tool result,
   * and what it returns is sent as a trailing content block, so a JSON result
   * stays valid JSON. */
  roster?: (names: string[]) => string | undefined | Promise<string | undefined>

  /** a calling program with more than tools to serve — resources, prompts,
   * capabilities of its own — registers them on the same server here, after
   * its tools are registered. It is handed the SDK's own server object, and it
   * is awaited. */
  extend?: (server: McpServer) => void | Promise<void>
}

/**
 * What a tool on this server answers, as JSON Schema: the bundles it returned,
 * under `result` — which is what {@link said} sends as `structuredContent`,
 * and MCP wants an object there rather than an array.
 *
 * Every tool whose answer is entities answers this one shape, so it is written
 * once and listed on all of them, a plugin's tool included without declaring
 * anything; a tool whose answer is not entities declares its own
 * `outputSchema` (`graph_schema`, a vocabulary document). It says what a
 * bundle is and not what any component holds: a fully typed bundle is tens of
 * kilobytes of vocabulary, and `tools/list` would carry a copy per tool before
 * the agent has asked its first question. What a component holds is
 * `graph_schema`'s answer, asked for when it is wanted.
 */
export let answerSchema: { type: 'object'; [key: string]: unknown } = {
  type: 'object',
  properties: {
    result: {
      type: 'array',
      description: 'one bundle per entity this tool answered about',
      items: {
        type: 'object',
        description:
          'an entity and the components it carries: `entity` says which ' +
          'entity, and every other key is a component of it',
        properties: {
          entity: {
            type: 'object',
            description: 'which entity this bundle is about',
            properties: {
              eid: { type: 'string', description: "the entity's id" },
            },
            required: ['eid'],
          },
        },
        required: ['entity'],
        // The `$` sugars a bundle may wear beside its components — `$alias`,
        // the name a minted entity was asked for by, and the rest of
        // @yaks/graph's — are not components and are not objects, so they are
        // matched first and left open.
        patternProperties: { '^\\$': {} },
        additionalProperties: {
          type: ['object', 'null'],
          description:
            "one component's properties, or null where the transaction " +
            'removed it',
        },
      },
    },
  },
  required: ['result'],
}

// The reply, built twice over from the bundles the tool returned: the text
// they carry (or the bundles themselves, as JSON) for a client that reads
// text, and the answer as data for one that reads structure (@yaks/tools
// `structured`). MCP requires structured content to be an object, so the
// bundles are nested under `result` — the shape {@link answerSchema}
// publishes.
//
// Bundles carrying an `error` or an `exception` component are the tool's
// refusal, and come back as an error rather than a success that reads like an
// apology. A refusal from a tool that declared its own output schema carries
// no structured content: a client checks whatever it is sent against that
// schema, and fault bundles are not in its shape.
let said = (t: Tool, answer: Bundle[], failed: boolean): CallToolResult => {
  return {
    // A refusal points at the tool that has the current answer: a client
    // holding a tool list from before a property was added or removed finds out
    // here and nowhere else.
    content: [{
      type: 'text',
      text: failed ? pointing(worded(answer)) : worded(answer),
    }],
    ...(failed && t.outputSchema
      ? {}
      : { structuredContent: structured(t, answer) }),
    ...(failed ? { isError: true } : {}),
  }
}

// A refusal is an error: `isError` is set on the reply so a client counts it
// as one instead of a success that reads like an apology.
let failed = (err: unknown): CallToolResult => ({
  content: [{
    type: 'text',
    text: err instanceof Error ? err.message : String(err),
  }],
  isError: true,
})

// @yaks/graph leaves a tool's schemas opaque, because the core package depends
// on no validation library. This is where `Schema` gets a concrete meaning:
// the MCP SDK takes Zod, so a schema that is not a Zod schema throws at
// startup rather than producing a tool that lists the wrong arguments.
let zodOf = (
  tool: string,
  where: string,
  s: Schema | undefined,
): z.ZodTypeAny | undefined => {
  if (s == undefined) return undefined
  if (s instanceof z.ZodType) return s
  throw new Error(`${tool}: ${where} must be a Zod schema`)
}

// One more sentence at the end of a reply, as its own content block. It is not
// appended to the existing text because that text may be JSON — the generic
// tier returns a typed value — and a sentence glued onto it would leave the
// caller with something it can no longer parse.
let noting = (out: CallToolResult, line: string | undefined): CallToolResult =>
  line
    ? { ...out, content: [...out.content, { type: 'text', text: line }] }
    : out

// The `_meta` a tool is listed with, beside its schemas: whatever the tool
// declares itself, plus this server's own security schemes when the tool
// declares none. It is sent per tool even when every tool is the same, because
// that is where a client reads it — a mixed-auth server's open tools are told
// apart from its authenticated ones by this field alone.
let metaOf = (
  tool: NamedTool,
  security: Options['security'],
): Record<string, unknown> | undefined => {
  let says = typeof security == 'function' ? security(tool) : security
  let meta = {
    ...tool.meta,
    ...spelling(tool),
    ...(says && !tool.meta?.securitySchemes ? { securitySchemes: says } : {}),
  }
  return Object.keys(meta).length ? meta : undefined
}

/** The `_meta` key the command-line grammar is sent under. */
export let COMMAND = 'yak.sh/command'

// The misspelled key @yaks/cli v0.1.0 on JSR reads, sent beside COMMAND until
// a release carries the CLI that reads COMMAND. T-37984 drops it.
let LEGACY_COMMAND = 'yaks.sh/command'

// A tool's `noun`, `verb` and `options` — the parts a CLI needs to build a
// command out of it. MCP gives a tool one flat `name` and nowhere to put any
// of them, so they are sent in `_meta`, which is what `_meta` is for, and a
// CLI reassembles `yak task new 'ship it'` from the same declaration the
// vocabulary made (@yaks/cli platform.ts). A tool that declared only a noun,
// or only a verb, sends just that one, because that single word is the whole
// command; a tool that declared neither sends nothing here and is listed under
// its own name.
let spelling = (tool: NamedTool): Record<string, unknown> | undefined => {
  let said = {
    ...(tool.noun ? { noun: tool.noun } : {}),
    ...(tool.verb ? { verb: tool.verb } : {}),
    ...(tool.options ? { options: tool.options } : {}),
  }
  return Object.keys(said).length
    ? { [COMMAND]: said, [LEGACY_COMMAND]: said }
    : undefined
}

/**
 * A tool's arguments as one Zod shape — its `input` object, with every schema
 * checked to be a Zod schema. This is what the server hands the MCP SDK, and
 * the starting point for anything that has to express a tool's arguments in
 * another format: a model's tool declaration takes JSON Schema, and
 * `z.object(shapeOf(tool))` is what you convert.
 */
export let shapeOf = (tool: Tool): Record<string, z.ZodTypeAny> =>
  Object.fromEntries(
    Object.entries(tool.input ?? {}).map((
      [name, s],
    ) => [name, zodOf(toolName(tool), `argument '${name}'`, s)!]),
  )

/**
 * A tool's arguments as JSON Schema, whichever way it declared them: its own
 * `inputSchema`, or its Zod shape converted. This is exactly what
 * `tools/list` sends, so anything else that needs a tool's argument
 * grammar — a CLI mapping a command onto it, say — reads what an MCP client
 * reads.
 */
export let inputSchemaOf = (
  tool: Tool,
): { type: 'object'; [key: string]: unknown } =>
  (tool.inputSchema ?? zodToJsonSchema(z.object(shapeOf(tool)), {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  })) as { type: 'object'; [key: string]: unknown }

/**
 * Every tool this server lists, in the order it registers them: the generic
 * tier, then the graph's plugins', then the caller's own. A caller that
 * already has the tier in its own list passes `core: false`, so the tier is
 * not added twice. A tool offered only elsewhere (`surfaces` without `mcp`)
 * is neither listed nor callable here.
 *
 * ```ts ignore
 * let names = listing(opts).map(toolName)
 * ```
 */
export let listing = (opts: Options): Tool[] =>
  [
    ...(opts.core === false ? [] : core({
      vocab: opts.graph.vocab,
      depth: opts.schema,
      prop: opts.prop,
      guide: opts.guide,
      search: opts.search,
      readOnly: opts.readOnly,
      scope: opts.scope,
      undo: opts.undo,
    })),
    ...toolsOf(opts.graph.plugins),
    ...(opts.tools ?? []),
  ].filter(offered('mcp'))

/** The roster this server serves: the tool names it lists, in listing order.
 * This is what a client caches when it connects, and what
 * {@link rosterVersion} hashes. */
export let roster = (opts: Options): string[] => listing(opts).map(toolName)

/**
 * One tool's behavior, as MCP's four hints (`ToolAnnotations`). A client reads
 * them to decide what it may call without asking the user first, so they are a
 * contract and not decoration — the MCP directories review them against what
 * the tool actually does.
 *
 * Only `destructive` has a default, and it is the safe one: a tool that writes
 * and has not declared otherwise is treated as destructive, so forgetting to
 * declare it can never loosen a prompt. A read-only tool is never destructive.
 *
 * The tool's title rides in the annotations too, for the directories that read
 * a listing's display name there rather than at the top level of the tool.
 */
export let annotated = (
  t: Pick<
    Tool,
    'title' | 'readOnly' | 'destructive' | 'idempotent' | 'openWorld'
  >,
) => ({
  // Omitted when the tool has none: an absent title is the tool saying
  // nothing, where an empty one would claim its display name is ''.
  ...(t.title ? { title: t.title } : {}),
  readOnlyHint: !!t.readOnly,
  destructiveHint: t.readOnly ? false : t.destructive ?? true,
  idempotentHint: !!t.idempotent,
  openWorldHint: !!t.openWorld,
})

/**
 * Build the MCP server for a graph: the generic tier (`graph_apply`,
 * `graph_query`, `graph_show`, `graph_schema`, and `search` when a
 * {@link https://jsr.io/@yaks/mcp/doc/~/Search | Search} was passed), plus
 * every tool the graph's plugins contribute and any you pass yourself.
 *
 * ```ts ignore
 * let s = server({ graph, actor: { by: 'm1' } })
 * await s.connect(transport)
 * ```
 */
export let server = (opts: Options): McpServer => {
  let { graph } = opts
  let actor = opts.actor ?? null
  let mcp = new McpServer({
    name: opts.name ?? 'yaks',
    version: opts.version ?? '0.0.0',
    // How the server presents itself, when the caller supplied any of it:
    // what `initialize` reports beside the server's name, so a client reading
    // `serverInfo` needs nothing pasted into a form. Each field is omitted
    // when unset rather than sent empty — an absent field means the server
    // said nothing, an empty one means the server said its title is the empty
    // string.
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.websiteUrl ? { websiteUrl: opts.websiteUrl } : {}),
    ...(opts.icons?.length ? { icons: opts.icons } : {}),
  }, {
    capabilities: { tools: {} },
    ...(opts.instructions ? { instructions: opts.instructions } : {}),
  })

  let tools = listing(opts).map(namedTool)
  // Where a call and its result are recorded, which is this graph unless the
  // caller passed a separate one (a server over a composition of stores, or a
  // connector that will not write a row into somebody else's store just
  // because a question was asked). The tools still read and write `graph`.
  let calls = opts.calls ?? graph
  let report = opts.report ?? logged
  let run = opts.runner ?? runner(calls, { tools, host: graph, report })
  let names = tools.map((t) => t.name)

  for (let t of tools) {
    let meta = metaOf(t, opts.security)
    let config = {
      ...(t.title ? { title: t.title } : {}),
      description: t.description,
      inputSchema: t.inputSchema ? z.object({}).passthrough() : shapeOf(t),
      annotations: annotated(t),
      ...(meta ? { _meta: meta } : {}),
    }
    let call = async (args: Record<string, unknown>) => {
      let out: CallToolResult
      let asked: Bundle = {
        entity: { eid: '$call' },
        call: { to: toolEid(t.name), args: args ?? {} },
        ...(actor ? { $actor: { ...actor } } : {}),
      }
      try {
        await run.ensure()
        let landed = await run.call(asked)
        out = said(t, answerOf(landed), faulted(landed))
      } catch (err) {
        // The runner answers a tool's own throw as a fault above; a throw that
        // reaches here is the runner's (a call it could not record), reported
        // the same way unless it was the caller's refusal.
        if (!(err instanceof CallError) && status(err) >= 500) {
          await report(err, asked, t.name)
        }
        out = failed(err)
      }
      // A refusal carries the roster sentence too: an agent holding a stale
      // tool list is likelier to be refused than served, so that is exactly
      // the reply worth attaching it to.
      return noting(out, await opts.roster?.(names))
    }
    mcp.registerTool(t.name, config, call)
  }
  // The listing is this server's own, not the SDK's: a tool that declared its
  // input as JSON Schema is sent that declaration unchanged (the SDK's
  // argument parsing is passthrough for those; the runner validates the
  // arguments before the handler runs), and every tool is listed with the one
  // answer schema, since every tool answers bundles, unless it declared its own.
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((t) => ({
      name: t.name,
      ...(t.title ? { title: t.title } : {}),
      description: t.description,
      inputSchema: inputSchemaOf(t),
      outputSchema: t.outputSchema ?? answerSchema,
      annotations: annotated(t),
      ...(metaOf(t, opts.security) ? { _meta: metaOf(t, opts.security) } : {}),
    })),
  }))
  return mcp
}
