import type { NamedTool } from '@yaks/graph'
import { mint } from '@yaks/graph/identity'
import { offered, toolName } from '@yaks/graph/call'
import { legacyOptions } from '@yaks/vocab/tools'
import { fromJsonSchema, ProtocolError } from '@modelcontextprotocol/server'
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

import { McpServer } from '@modelcontextprotocol/server'
import type {
  CallToolResult,
  JsonSchemaType,
} from '@modelcontextprotocol/server'
import type { Actor, Bundle, Graph, Tool } from '@yaks/graph'
import { status } from '@yaks/graph/errors'
import { toolsOf } from '@yaks/graph'
import type { Opts as RunnerOpts, Runner } from '@yaks/tools'
import {
  answerOf,
  faulted,
  structured,
  texts,
  toolEid,
  worded,
} from '@yaks/tools/result'
import { CallError } from '@yaks/tools/errors'
import { type Registry, registry, runner } from '@yaks/tools'
import { answerSchema } from '@yaks/tools/schema'
import {
  core,
  type CoreOpts,
  inputSchemaOf,
  pointing,
  type Search,
  translated,
} from './tools.ts'
import type { Guide } from '@yaks/graph'
import { validator } from './validator.ts'
import { fileArgs, FILES, fileSchema, type ReadFile } from './files.ts'

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
   * one — and so the tools this server lists, which are the runner's. The HTTP
   * handler builds a server per request and shares its runner, so the listing
   * is built once and a `tool` row is written once for the process rather than
   * once per request. Otherwise a runner is built here over `calls`. */
  runner?: Runner
  /** A shared catalog when this server constructs its own runner. */
  registry?: Registry
  /** the graph a call and its result are recorded in (default: `graph`). A
   * server whose graph should not hold them — one composed over somebody
   * else's stores, or a connector that will not write a stranger's question
   * into them — passes a separate graph here; the tools still read and write
   * `graph`. */
  calls?: Graph
  /** where a defect goes (default: the console): a tool's, with the call and
   * the tool's name, and a request the SDK refused or failed on the modern
   * leg, with neither, since a client this server cannot answer is a failure
   * of ours. A tool's refusal (`CallError`) is never reported. */
  report?: (err: unknown, call?: Bundle, tool?: string) => unknown
  /** what a call is owed beside its tool's answer (@yaks/tools `Reply`): the
   * host's, so a caller over MCP reads what a caller at the command line
   * reads. Used where a runner is built here; a runner passed in has its
   * own. */
  reply?: RunnerOpts['reply']
  /** Optional local file input: callers opt in with `$files: true`. Hosted
   * servers without a reader keep literal inputs and their exact schemas. */
  readFile?: ReadFile
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
  /** what the agent should read before anything else: the text, or a function
   * making it, which is called only for an exchange that sends it
   * ({@link instructed}). A host whose instructions cost reads to say pays
   * them once per connection, at `initialize`, rather than on every call. */
  instructions?: string | (() => string | Promise<string>)
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
  /** how a read is narrowed to one part of this deployment's graph, appended
   * to `graph_query`'s description — see {@link CoreOpts.narrow} */
  narrow?: CoreOpts['narrow']
  /** what every tool this server lists declares about signing in
   * ({@link Security}), declared per tool because that is where a client reads
   * it — a tool carrying `securitySchemes` in its own `meta` keeps that
   * instead. Pass a function to answer per tool, for a server where the answer
   * differs between them: a read anybody may make listed beside a write that
   * needs a token, so a client has something concrete to prompt the sign-in
   * for */
  security?: Security[] | ((t: NamedTool) => Security[] | undefined)
  /** the output schema every tool whose answer is entities is listed with
   * (default {@link answerSchema}): a host whose rows carry words of their own
   * beside their components declares them here ({@link answerWith}), since a
   * client refuses an answer that does not fit what its tool is listed with */
  answer?: { type: 'object'; [key: string]: unknown }
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
  roster?: (
    names: string[],
  ) => string | undefined | Promise<string | undefined>

  /** a calling program with more than tools to serve — resources, prompts,
   * capabilities of its own — registers them on the same server here, after
   * its tools are registered. It is handed the SDK's own server object and the
   * one exchange the server answers (undefined where it serves a whole
   * connection), so it can leave out what that exchange never reads, and it
   * is awaited. */
  extend?: (server: McpServer, exchange?: Exchange) => void | Promise<void>
  /** Skills attach to the same server, awaited before either era discovers it. */
  skills?: (server: McpServer, exchange?: Exchange) => void | Promise<void>
}

/** One HTTP exchange; a connection-serving factory leaves this undefined. */
export type Exchange = { method: string }

/** Await contributed facets on each server before its exchange is served. */
export let prepared = async (
  built: McpServer,
  opts: Pick<Options, 'extend' | 'skills'>,
  exchange?: Exchange,
): Promise<McpServer> => {
  await opts.extend?.(built, exchange)
  await opts.skills?.(built, exchange)
  return built
}

/// let hi = { instructions: () => 'hi' }
/// instructed(hi, { method: 'initialize' }) ~> 'hi'
/// instructed(hi, { method: 'tools/call' }) ~> undefined
/// instructed(hi) ~> 'hi'
/**
 * The instructions a server answering `exchange` sends: said for `initialize`,
 * the one reply that carries them, and for a server serving a whole
 * connection (no exchange), whose `initialize` is still to come. Any other
 * exchange never sends them, so a function making them is not called.
 */
export let instructed = async (
  opts: Pick<Options, 'instructions' | 'readFile'>,
  exchange?: Exchange,
): Promise<string | undefined> => {
  let said = opts.instructions
  if (exchange && exchange.method != 'initialize') return undefined
  let text = typeof said == 'function' ? await said() : said
  return opts.readFile ? [text, FILES].filter(Boolean).join('\n\n') : text
}

export { answerSchema, answerWith } from '@yaks/tools/schema'

// The reply, built twice over from the bundles the tool returned: the text
// they carry (or the bundles themselves, as JSON) for a client that reads
// text, and the answer as data for one that reads structure (@yaks/tools
// `structured`). MCP requires structured content to be an object, so the
// bundles are nested under `result` — the shape {@link answerSchema}
// publishes.
//
// Bundles carrying a `refusal` or an `exception` component are the tool's
// refusal, and come back as an error rather than a success that reads like an
// apology. A refusal from a tool that declared its own output schema carries
// no structured content: a client checks whatever it is sent against that
// schema, and fault bundles are not in its shape.
let said = (t: Tool, answer: Bundle[], failed: boolean): CallToolResult => {
  return {
    // A refusal points at the tool that has the current answer: a client
    // holding a tool list from before a property was added or removed finds out
    // here and nowhere else.
    // Data and the words beside it go in blocks of their own, data first, so
    // a client parsing the first block finds JSON (@yaks/tools `texts`).
    content: (failed ? [pointing(worded(answer))] : texts(answer)).map((
      text,
    ) => ({ type: 'text' as const, text })),
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

// A tool's `noun`, `verb` and positional inputs — the parts a CLI needs to build a
// command out of it. MCP gives a tool one flat `name` and nowhere to put any
// of them, so they are sent in `_meta`, which is what `_meta` is for, and a
// CLI reassembles `yak task new 'ship it'` from the same declaration the
// vocabulary made (@yaks/cli platform.ts). A tool that declared only a noun,
// or only a verb, sends just that one, because that single word is the whole
// command; a tool that declared neither sends nothing here and is listed under
// its own name.
let spelling = (tool: NamedTool): Record<string, unknown> | undefined => {
  let props = tool.inputSchema?.properties as
    | Record<string, { short?: string }>
    | undefined
  let input = Object.fromEntries(
    Object.entries(props ?? {}).filter(([, p]) =>
      p && typeof p == 'object' && p.short
    )
      .map(([name, p]) => [name, { short: p.short }]),
  )
  // Older published CLIs read options; keep their spelling at this boundary.
  let options = legacyOptions(tool)
  let said = {
    ...(tool.noun ? { noun: tool.noun } : {}),
    ...(tool.verb ? { verb: tool.verb } : {}),
    ...(tool.positional ? { positional: tool.positional } : {}),
    ...(tool.forward ? { forward: tool.forward } : {}),
    ...(Object.keys(input).length ? { input } : {}),
    ...(Object.keys(options).length ? { options } : {}),
  }
  return Object.keys(said).length
    ? { [COMMAND]: said, [LEGACY_COMMAND]: said }
    : undefined
}

/**
 * Every tool this server lists and answers, in the order it registers them:
 * the generic tier, then the graph's plugins', then the caller's own. A caller
 * that already has the tier in its own list passes `core: false`, so the tier
 * is not added twice. A tool offered only elsewhere (`surfaces` without `mcp`)
 * is neither listed nor callable here. Nothing is callable and unlisted: a
 * client checks `tools/list` before it calls, so a name it does not find there
 * is a name that does not answer.
 *
 * ```ts ignore
 * let names = listing(opts).map(toolName)
 * ```
 */
export let listing = (opts: Options): Tool[] =>
  (opts.runner?.registry.list() ?? opts.registry?.list() ?? [
    ...(opts.core === false ? [] : core({
      vocab: opts.graph.vocab,
      guide: opts.guide,
      search: opts.search,
      readOnly: opts.readOnly,
      scope: opts.scope,
      undo: opts.undo,
      narrow: opts.narrow,
    })),
    ...toolsOf(opts.graph.plugins),
    ...(opts.tools ?? []),
  ]).filter(offered('mcp'))

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
 * every tool the graph's plugins contribute and any you pass yourself. The
 * instructions are the text itself here: a function making them is said by
 * {@link instructed} for the exchange this server answers.
 *
 * ```ts ignore
 * let s = server({ graph, actor: { by: 'm1' } })
 * await s.connect(transport)
 * ```
 */
export let server = (
  opts: Options & { instructions?: string },
): McpServer => {
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
    // One validator for every server this process builds: the SDK makes an
    // Ajv instance per server otherwise, and a server is built per request.
    jsonSchemaValidator: validator,
  })

  let catalog = opts.runner?.registry ?? opts.registry ??
    registry([{ name: 'local', tools: listing(opts) }])
  let tools = () => catalog.list().filter(offered('mcp'))
  // Where a call and its result are recorded, which is this graph unless the
  // caller passed a separate one (a server over a composition of stores, or a
  // connector that will not write a row into somebody else's store just
  // because a question was asked). The tools still read and write `graph`.
  let calls = opts.calls ?? graph
  let report = opts.report ?? logged
  let run = opts.runner ?? runner(calls, {
    tools: catalog,
    host: graph,
    report,
    ...opts.reply ? { reply: opts.reply } : {},
  })
  let answer = opts.answer ?? answerSchema
  let schemaOf = (t: NamedTool) => t.outputSchema ?? answer
  // The check a client makes of every answer, made here first, against the
  // schema the tool is listed with. A client refuses an answer that does not
  // fit after this server has answered, so nothing here would ever hear of
  // it: the failure is caught where the answer leaves, and reported. A schema
  // the check cannot read is the same failure, in the validator's words. The
  // answer still goes either way, since what to do with it is the client's.
  let misfit = (t: NamedTool, out: CallToolResult): unknown => {
    if (out.structuredContent === undefined) return undefined
    try {
      let held = validator.getValidator(schemaOf(t) as JsonSchemaType)(
        out.structuredContent,
      )
      return held.valid ? undefined : new Error(
        `${t.name}'s answer does not fit its output schema: ${held.errorMessage}`,
      )
    } catch (err) {
      return err
    }
  }
  let call = async (name: string, args: Record<string, unknown>) => {
    let names = tools().map((t) => t.name)

    let out: CallToolResult
    let id = mint()
    let input = translated(name, args ?? {})
    let asked: Bundle = {
      entity: { eid: id },
      call: { to: toolEid(name), args: input },
      ...(actor ? { $actor: { ...actor } } : {}),
    }
    let admitted = run.admit(asked)
    let t = admitted?.tool
    if (!admitted || !t || t.name != name || !offered('mcp')(t)) {
      throw new ProtocolError(-32602, `Tool ${name} not found`)
    }
    try {
      asked.call = {
        to: toolEid(name),
        args: await fileArgs(input, inputSchemaOf(t), opts.readFile),
      }
      if (!t.readOnly) await admitted.ensure()
      let landed = await (t.readOnly ? admitted.read() : admitted.call())
      out = said(t, answerOf(landed, id), faulted(landed, id))
    } catch (err) {
      // The runner answers a tool's own throw as a fault above; a throw that
      // reaches here is the runner's (a call it could not record), reported
      // the same way unless it was the caller's refusal.
      if (!(err instanceof CallError) && status(err) >= 500) {
        await report(err, asked, t.name)
      }
      out = failed(err)
    }
    let unfit = misfit(t, out)
    if (unfit) await report(unfit, asked, t.name)
    // A refusal carries the roster sentence too: an agent holding a stale
    // tool list is likelier to be refused than served, so that is exactly
    // the reply worth attaching it to.
    return noting(out, await opts.roster?.(names))
  }
  for (let t of tools()) {
    let meta = metaOf(t, opts.security)
    let config = {
      ...(t.title ? { title: t.title } : {}),
      description: t.description,
      inputSchema: fromJsonSchema(
        fileSchema(inputSchemaOf(t), opts.readFile),
        validator,
      ),
      outputSchema: fromJsonSchema(schemaOf(t), validator),
      annotations: annotated(t),
      ...(meta ? { _meta: meta } : {}),
    }
    mcp.registerTool(
      t.name,
      config,
      (args) => call(t.name, args as Record<string, unknown>),
    )
  }
  // The listing is this server's own, not the SDK's: a tool that declared its
  // input as JSON Schema is sent that declaration unchanged. The direct
  // tools/call dispatch below leaves argument validation to the runner, and
  // every tool is listed with the one answer schema, since every tool answers
  // bundles, unless it declared its own.
  mcp.server.setRequestHandler('tools/list', () => ({
    tools: tools().map((t) => ({
      name: t.name,
      ...(t.title ? { title: t.title } : {}),
      description: t.description,
      inputSchema: fileSchema(inputSchemaOf(t), opts.readFile),
      outputSchema: schemaOf(t),
      annotations: annotated(t),
      ...(metaOf(t, opts.security) ? { _meta: metaOf(t, opts.security) } : {}),
    })),
  }))
  // Exact authoring schemas provide header metadata, not domain validation.
  // The runner owns malformed-argument refusals and records every graph call.
  mcp.server.setRequestHandler('tools/call', async (request) => {
    return await call(request.params.name, request.params.arguments ?? {})
  })
  return mcp
}
