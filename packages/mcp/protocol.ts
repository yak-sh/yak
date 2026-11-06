// The Model Context Protocol itself: one JSON-RPC request in, its reply out.
// No transport lives here — ./mount.ts carries it over HTTP — and no tool
// either: ./server.ts registers those. What is here is the dispatch table a
// server is built on, the checks a request's parameters get before its
// handler runs, and how a result is said in each of the protocol's two eras.
//
//   legacy  a connection opened by `initialize` (revisions 2024-10-07 to
//           2025-11-25); results are sent as the handler made them
//   modern  every request carries its own `_meta` envelope (2026-07-28);
//           `server/discover` replaces the handshake, and every result says
//           it is complete, how long it may be cached, and which server sent
//           it
//
// The answers are the ones the MCP SDK gave before this package stopped
// carrying it (T-143191), down to the order of their keys and the words of a
// malformed request's refusal, because what a client relies on is product
// (M-37853).

import { status } from '@yaks/graph/errors'
import { CallError } from '@yaks/tools/errors'
import { errorsText, toolCheck } from '@yaks/vocab/tools'

/** The revisions an `initialize` may negotiate, newest first. */
export let LEGACY = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
]
/** The revisions a request may name in its envelope. */
export let MODERN = ['2026-07-28']

/** The envelope's keys, in a request's `_meta`. */
export let VERSION = 'io.modelcontextprotocol/protocolVersion'
export let CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'
export let CLIENT = 'io.modelcontextprotocol/clientInfo'
/** Where a modern result names the server that sent it. */
export let SERVER = 'io.modelcontextprotocol/serverInfo'
/** Where a listen's notifications name the subscription they belong to. */
export let SUBSCRIPTION = 'io.modelcontextprotocol/subscriptionId'

/** Whether a revision belongs to the modern era. */
export let isModern = (version: string) => version >= MODERN[0]

/** A refusal in JSON-RPC's own terms: a code, a message, and its data. */
export class ProtocolError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message)
  }
}

type Json = Record<string, unknown>
export type Era = 'legacy' | 'modern'
export type Id = string | number

/** What a handler is handed beside its parameters. */
export type Context = {
  /** aborted when the caller hangs up */
  signal: AbortSignal
}

/** A request's handler: its parameters in, its result out. */
export type Handler = (params: Json, ctx: Context) => unknown

/** Who a server is, as `initialize` and every modern result say. */
export type Implementation = {
  name: string
  version: string
  title?: string
  description?: string
  websiteUrl?: string
  icons?: {
    src: string
    mimeType?: string
    sizes?: string[]
    theme?: 'light' | 'dark'
  }[]
}

/** How long a client may keep a result. */
export type Cache = { ttlMs: number; cacheScope: 'public' | 'private' }

/** What a resource is listed with beside its address and name. */
export type ResourceMeta = {
  title?: string
  description?: string
  mimeType?: string
  _meta?: Json
  cache?: Cache
}

/** What a prompt is listed with beside its name. */
export type PromptMeta = {
  title?: string
  description?: string
  arguments?: { name: string; description?: string; required?: boolean }[]
  _meta?: Json
}

/** A request answered: the reply, and whether it was refused before any
 * handler ran (`early`), which is when HTTP says so in its status too. */
export type Answer = { reply: Json; early: boolean }

/** A JSON-RPC request. */
export type Request = { jsonrpc: '2.0'; id: Id; method: string; params?: Json }

// The protocol's own methods that only one era serves. A method of either
// era asked of the other is not found, however it is handled here.
let ONLY: Record<string, Era> = {
  initialize: 'legacy',
  ping: 'legacy',
  'logging/setLevel': 'legacy',
  'resources/subscribe': 'legacy',
  'resources/unsubscribe': 'legacy',
  'server/discover': 'modern',
  'subscriptions/listen': 'modern',
}

// The modern results a client may cache, each told for how long.
let CACHEABLE = new Set([
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'server/discover',
])

let object = (v: unknown): v is Json =>
  v !== null && typeof v == 'object' && !Array.isArray(v)

// ---- a request's parameters, checked ---------------------------------------
//
// A malformed request is refused in the words its issues have always been
// listed in: each a JSON object with what was expected, where, and what came,
// the whole list as indented JSON.

type Issue = Json & { path: (string | number)[]; message: string }
type Want = (value: unknown, path: (string | number)[]) => Issue[]

let kind = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
let expected = (want: string, v: unknown, path: (string | number)[]) => ({
  expected: want,
  code: 'invalid_type',
  path,
  message: `Invalid input: expected ${want}, received ${kind(v)}`,
})
let is = (want: string, test: (v: unknown) => boolean): Want => (v, path) =>
  test(v) ? [] : [expected(want, v, path)]
let string = is('string', (v) => typeof v == 'string')
let optional = (want: Want): Want => (v, path) =>
  v === undefined ? [] : want(v, path)
let shape = (fields: Record<string, Want>, as = 'object'): Want => (v, path) =>
  !object(v) ? [expected(as, v, path)] : Object.entries(fields).flatMap((
    [name, want],
  ) => want(v[name], [...path, name]))
let record = (values?: Want): Want => (v, path) =>
  !object(v)
    ? [expected('record', v, path)]
    : values
    ? Object.entries(v).flatMap(([k, x]) => values(x, [...path, k]))
    : []
let LEVELS = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
]
let level: Want = (v, path) =>
  LEVELS.includes(v as string) ? [] : [{
    code: 'invalid_value',
    values: LEVELS,
    path,
    message: `Invalid option: expected one of ${
      LEVELS.map((l) => JSON.stringify(l)).join('|')
    }`,
  }]
let cursor = optional(shape({ cursor: optional(string) }))

let PARAMS: Record<string, Want> = {
  initialize: shape({
    protocolVersion: string,
    capabilities: shape({}),
    clientInfo: shape({ name: string, version: string }),
  }),
  'tools/call': shape({ name: string, arguments: optional(record()) }),
  'resources/read': shape({ uri: string }),
  'prompts/get': shape({
    name: string,
    arguments: optional(record(string)),
  }),
  'logging/setLevel': shape({ level }),
  'tools/list': cursor,
  'resources/list': cursor,
  'resources/templates/list': cursor,
  'prompts/list': cursor,
}

let checked = (method: string, params: unknown) => {
  let issues = PARAMS[method]?.(params, ['params']) ?? []
  if (!issues.length) return
  let said = JSON.stringify(issues, null, 2)
  // A call's refusal has always named what it refused, and been the caller's
  // invalid parameters; the others have been said bare.
  throw method == 'tools/call'
    ? new ProtocolError(-32602, `Invalid tools/call request: ${said}`)
    : new ProtocolError(-32603, said)
}

// ---- a result, said in its era ---------------------------------------------

let said = (
  method: string,
  result: Json,
  era: Era,
  info: Implementation,
  cache?: Cache,
): Json => {
  if (era == 'legacy') return result
  let out: Json = result.resultType === undefined
    ? { ...result, resultType: 'complete' }
    : result
  if (out.resultType == 'complete' && CACHEABLE.has(method)) {
    let ttl = out.ttlMs
    let scope = out.cacheScope
    out = {
      ...out,
      ttlMs: Number.isSafeInteger(ttl) && (ttl as number) >= 0
        ? ttl
        : cache?.ttlMs ?? 0,
      cacheScope: scope == 'public' || scope == 'private'
        ? scope
        : cache?.cacheScope ?? 'private',
    }
  }
  let meta = out._meta
  if (meta === undefined) return { ...out, _meta: { [SERVER]: info } }
  if (!object(meta) || meta[SERVER] !== undefined) return out
  return { ...out, _meta: { ...meta, [SERVER]: info } }
}

// The capabilities a server says it has, each merged one level deep.
let merged = (base: Json, more: Json): Json => {
  let out = { ...base }
  for (let [k, v] of Object.entries(more)) {
    if (v === undefined) continue
    out[k] = object(out[k]) && object(v) ? { ...out[k] as Json, ...v } : v
  }
  return out
}

// A URI template's matcher, for the two forms a template here uses: `{x}`, one
// path segment, and `{+x}`, the rest of the address.
let matcher = (template: string) => {
  let names: string[] = []
  let pattern = template.split(/(\{\+?\w+\})/).map((part) => {
    let m = /^\{(\+?)(\w+)\}$/.exec(part)
    if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    names.push(m[2])
    return m[1] ? '(.+)' : '([^/]+)'
  }).join('')
  let re = new RegExp(`^${pattern}$`)
  return (uri: string): Record<string, string> | undefined => {
    let m = re.exec(uri)
    return m
      ? Object.fromEntries(names.map((n, i) => [n, m[i + 1]]))
      : undefined
  }
}

type Read = (uri: URL, ctx: Context) => unknown
type Resource = { name: string; meta: ResourceMeta; read: Read }
type Template = {
  name: string
  template: string
  match: ReturnType<typeof matcher>
  meta: ResourceMeta
  read: (uri: URL, vars: Record<string, string>, ctx: Context) => unknown
}
type Prompt = {
  meta: PromptMeta
  get: (args: Record<string, string>, ctx: Context) => unknown
}

/** A server: what it answers, and how it answers one request. */
export type Server = {
  /** who it is */
  info: Implementation
  /** what it says it can do */
  capabilities(): Json
  /** say it can do more */
  capable(more: Json): void
  /** answer `method` with `handler`, in place of any handler before it */
  handle(method: string, handler: Handler): void
  /** a resource at one address */
  resource(name: string, uri: string, meta: ResourceMeta, read: Read): void
  /** resources at every address matching a URI template */
  template(
    name: string,
    template: string,
    meta: ResourceMeta,
    read: Template['read'],
  ): void
  /** a prompt the person picks by name */
  prompt(name: string, meta: PromptMeta, get: Prompt['get']): void
  /** one request, answered in its era */
  answer(request: Request, era: Era, signal?: AbortSignal): Promise<Answer>
}

/**
 * A server answering `initialize` (or `server/discover`), with the
 * capabilities and handlers registered on it afterwards. `report` hears a
 * handler's failure — not a refusal: a {@link ProtocolError} or a
 * `CallError` is the caller's, and so is anything @yaks/graph's `status` puts
 * under 500.
 */
export let protocol = (opts: {
  info: Implementation
  instructions?: string
  capabilities?: Json
  report?: (err: unknown) => unknown
}): Server => {
  let { info, instructions } = opts
  let capabilities: Json = { ...opts.capabilities }
  let handlers = new Map<string, Handler>()
  let resources = new Map<string, Resource>()
  let templates = new Map<string, Template>()
  let prompts = new Map<string, Prompt>()
  let caches = new WeakMap<object, Cache>()
  let capable = (more: Json) => capabilities = merged(capabilities, more)

  let listing = (kind: 'resources' | 'prompts') => {
    let held = capabilities[kind] as { listChanged?: boolean } | undefined
    capable({ [kind]: { listChanged: held?.listChanged ?? true } })
  }
  let cached = (result: unknown, cache?: Cache) => {
    if (cache && object(result)) caches.set(result, cache)
    return result
  }

  handlers.set('initialize', (params) => {
    let asked = params.protocolVersion as string
    return {
      protocolVersion: LEGACY.includes(asked) ? asked : LEGACY[0],
      capabilities,
      serverInfo: info,
      ...(instructions ? { instructions } : {}),
    }
  })
  handlers.set('ping', () => ({}))
  handlers.set('server/discover', () => ({
    supportedVersions: MODERN,
    capabilities: { ...capabilities },
    ...(instructions ? { instructions } : {}),
  }))

  let server: Server = {
    info,
    capabilities: () => capabilities,
    capable,
    handle: (method, handler) => void handlers.set(method, handler),
    resource(name, uri, meta, read) {
      if (resources.has(uri)) {
        throw new Error(`Resource ${uri} is already registered`)
      }
      resources.set(uri, { name, meta, read })
      listing('resources')
    },
    template(name, template, meta, read) {
      if (templates.has(name)) {
        throw new Error(`Resource template ${name} is already registered`)
      }
      templates.set(name, {
        name,
        template,
        match: matcher(template),
        meta,
        read,
      })
      listing('resources')
    },
    prompt(name, meta, get) {
      if (prompts.has(name)) {
        throw new Error(`Prompt ${name} is already registered`)
      }
      prompts.set(name, { meta, get })
      listing('prompts')
    },
    async answer(request, era, signal = new AbortController().signal) {
      let { id, method } = request
      let refused = (
        err: { code: number; message: string; data?: unknown },
      ) => ({
        jsonrpc: '2.0',
        id,
        error: {
          // A missing resource has its own code in the SDK's words, sent as
          // the invalid parameters it is (-32002 → -32602).
          code: err.code == -32002 ? -32602 : err.code,
          message: err.message,
          ...(err.data === undefined ? {} : { data: err.data }),
        },
      })
      let handler = handlers.get(method)
      if (!handler || (ONLY[method] && ONLY[method] != era)) {
        return {
          reply: refused({ code: -32601, message: 'Method not found' }),
          early: true,
        }
      }
      try {
        checked(method, request.params)
        let result = await handler(request.params ?? {}, { signal }) as Json
        return {
          reply: {
            result: said(method, result, era, info, caches.get(result)),
            jsonrpc: '2.0',
            id,
          },
          early: false,
        }
      } catch (err) {
        let e = err as { code?: unknown; message?: string; data?: unknown }
        let theirs = err instanceof ProtocolError || err instanceof CallError
        if (!theirs && status(err) >= 500) {
          await opts.report?.(err)
        }
        return {
          reply: refused({
            code: Number.isSafeInteger(e?.code) ? e.code as number : -32603,
            message: e?.message ?? 'Internal error',
            data: e?.data,
          }),
          early: false,
        }
      }
    },
  }

  server.handle('resources/list', () => ({
    resources: [...resources].map(([uri, { name, meta }]) => ({
      uri,
      name,
      ...listed(meta),
    })),
  }))
  server.handle('resources/templates/list', () => ({
    resourceTemplates: [...templates.values()].map((t) => ({
      name: t.name,
      uriTemplate: t.template,
      ...listed(t.meta),
    })),
  }))
  server.handle('resources/read', async (params, ctx) => {
    let asked = params.uri as string
    let uri: URL
    try {
      uri = new URL(asked)
    } catch {
      throw new ProtocolError(-32602, `Resource URI ${asked} is invalid`, {
        uri: asked,
        reason: 'invalid_uri',
      })
    }
    let one = resources.get(uri.toString())
    if (one) return cached(await one.read(uri, ctx), one.meta.cache)
    for (let t of templates.values()) {
      let vars = t.match(uri.toString())
      if (vars) return cached(await t.read(uri, vars, ctx), t.meta.cache)
    }
    throw new ProtocolError(-32002, `Resource not found: ${asked}`, {
      uri: asked,
    })
  })
  server.handle('prompts/list', () => ({
    prompts: [...prompts].map(([name, { meta }]) => ({
      name,
      title: meta.title,
      description: meta.description,
      arguments: meta.arguments,
      _meta: meta._meta,
    })),
  }))
  server.handle('prompts/get', async (params, ctx) => {
    let name = params.name as string
    let p = prompts.get(name)
    if (!p) throw new ProtocolError(-32602, `Prompt ${name} not found`)
    let args = (params.arguments ?? {}) as Record<string, string>
    if (p.meta.arguments) {
      let errors = toolCheck(argumentSchema(p.meta))(args)
      if (errors.length) {
        throw new ProtocolError(
          -32602,
          `Invalid arguments for prompt ${name}: ${errorsText(errors)}`,
        )
      }
    }
    return await p.get(args, ctx)
  })
  return server
}

// A resource's listing beside its address: what it declared, in its order,
// less how long it may be cached, which rides on what it reads.
let listed = ({ cache: _, ...meta }: ResourceMeta) => meta

// The schema a prompt's arguments are checked against: each a string, the
// required ones there, and anything more allowed.
let schemas = new WeakMap<PromptMeta, Json>()
let argumentSchema = (meta: PromptMeta): Json => {
  let held = schemas.get(meta)
  if (held) return held
  let made = {
    type: 'object',
    properties: Object.fromEntries(
      (meta.arguments ?? []).map((a) => [a.name, { type: 'string' }]),
    ),
    required: (meta.arguments ?? []).filter((a) => a.required).map((a) =>
      a.name
    ),
    additionalProperties: true,
  }
  schemas.set(meta, made)
  return made
}
