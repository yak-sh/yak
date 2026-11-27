/** Short, isolated code executions over a caller's scoped registry. The host
 * supplies an evaluator and reads a script's TypeScript as JavaScript; this
 * package owns discovery, limits and the bridge. */
import { argsOf, type Bundle, mint, type Tool, who } from '@yaks/graph'
import { toolName } from '@yaks/graph/call'
import { system } from '@yaks/fp'
import {
  answerOf,
  CallError,
  faulted,
  heard,
  type Opts,
  type Provider,
  refusalOf,
  type Registry,
  type Runner,
  structured,
  texts,
  toolEid,
  valueIn,
} from '@yaks/tools'
import { catalog, declarations } from './types.ts'
import { described } from './repl.ts'
import { source, timedOut, TOO } from './source.ts'
import {
  browserDeclarations,
  FILE_BYTES,
  fileDeclarations,
  type FileScope,
} from './files.ts'
export { catalog, declarations, type Entry } from './types.ts'
export { TOO } from './source.ts'
export { FILE_BYTES } from './files.ts'

export let LIMITS = {
  wallMs: 30_000,
  cpuMs: 100,
  memoryMiB: 128,
  calls: 16,
  systemBytes: 33_554_432,
  scriptBytes: 65_536,
}
export let HOSTED_LIMITS = {
  ...LIMITS,
  wallMs: 120_000,
  cpuMs: 30_000,
  calls: 64,
}
export type Result = {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}
/** One nested call as the answer reports it: the script holds its result,
 * and only a failure's words come back, so the model reads what the script
 * returns rather than every row a read handed the sandbox. */
export type Receipt = {
  id: string
  path: [string, string]
  isError?: boolean
  error?: string
  pending?: boolean
  /** the tool or `Options.hears` marked the answer `heard` */
  heard?: true
}
export type Answer = {
  value: unknown
  calls: Receipt[]
  error?: string
  /** the REPL the cell ran in */
  repl?: string
  /** the cell's top-level names whose values could not be kept */
  dropped?: string[]
}
/** The host admits reads of results kept by its model-facing harness. */
export type Kept = {
  keep(value: unknown, source: Bundle): Promise<unknown>
  read(id: string): Promise<unknown>
}
export type Evaluate = (
  modules: Record<string, string>,
  bridge: {
    call(set: string, name: string, args: string): Promise<Result>
    read(id: string): Promise<unknown>
    file?(app: string, args: string): Promise<Result>
  },
  signal: AbortSignal,
) => Promise<string>
/** How the host reads a module's TypeScript as JavaScript, by its path.
 * Throws a SyntaxError where the source does not parse. */
export type Strip = (path: string, source: string) => string | Promise<string>
let bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
let message = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 1024)
let finished = (
  value: unknown,
  calls: Receipt[],
  error?: string,
  more: Pick<Answer, 'repl' | 'dropped'> = {},
): Answer => {
  if (bytes(value) > LIMITS.systemBytes) {
    throw new CallError('limit', TOO.system)
  }
  let out: Answer = {
    value,
    calls: structuredClone(calls),
    ...(error ? { error } : {}),
    ...more,
  }
  return out
}
/** What an execution is given beside its script, tools and evaluator. A
 * runner's `clock`, `report` and `refused` mean here what they mean to it:
 * what the bridge refuses itself (a tool outside the scope, a limit,
 * arguments that are not an object, a call after the execution ended) is
 * heard by `refused` with the nested call it refused, as a runner hears its
 * own refusals. */
export type Options = Pick<Opts, 'clock' | 'report' | 'refused'> & {
  /** The app mount's tool arguments, scoped by the host. */
  files?: FileScope
  /** puppeteer's module, read only for a script that names `browser`, which
   * launches a browser on the evaluator's `env.BROWSER` */
  browser?: () => Promise<string>
  /** the REPL this execution is a cell of: its top-level values and its
   * `storage` last from cell to cell (./repl.ts) */
  repl?: string
  /** Execution limits advertised by this host. */
  limits?: typeof LIMITS
  /** the runner each nested call reaches, asked anew for every call
   * (default: the execution's `run`) */
  current?: () => Promise<Pick<Runner, 'admit'>>
  /** the results the host's harness kept, read by `results.read` */
  kept?: Kept
  /** whether the caller hears in a nested call's answer words it cannot
   * vouch for, by the rule its direct calls take: its receipt says `heard`,
   * and so does the execution's answer, as a direct call's result would */
  hears?: (tool: Tool, answer: Bundle[]) => Promise<boolean>
}
let said = (r: Result) => r.content.map((c) => c.text).join('\n').slice(0, 1024)

/** All nested calls use admitted registry implementations, the outer caller's
 * stamps and the ordinary runner. Arguments cannot select an actor or session. */
export let execute = async (
  script: string,
  registry: Registry,
  run: Runner,
  asked: Bundle,
  evaluate: Evaluate,
  strip: Strip,
  opts: Options = {},
): Promise<Answer> => {
  let {
    clock = system,
    current = () => Promise.resolve(run),
    kept,
    limits = LIMITS,
    files,
  } = opts
  let repl = opts.repl ? { repl: opts.repl } : {}
  if (
    script.length > LIMITS.scriptBytes || bytes(script) > LIMITS.scriptBytes
  ) {
    throw new CallError('limit', TOO.script)
  }
  let entries = catalog(registry).filter((e) => e.name != 'code_mode')
  let allowed = new Map(entries.map((e) => [JSON.stringify(e.path), e]))
  let calls: Receipt[] = []
  let pending = new Set<Promise<unknown>>()
  let controller = new AbortController()
  let active = true
  let actor = who(asked)
  // A nested call as the runner records it. Its id is minted before the
  // bridge's first check, so whether the bridge refuses it or the runner
  // does, it is heard under the one id the call keeps throughout.
  let nested = (id: string, name?: string, args?: unknown): Bundle => ({
    entity: { eid: id },
    call: {
      ...(name ? { to: toolEid(name) } : {}),
      ...(args === undefined ? {} : { args }),
      source: asked.entity.eid,
    },
    ...(actor ? { $actor: actor } : {}),
  })
  let hear = async (e: unknown, call: Bundle, tool?: string) => {
    let refusal = refusalOf(e)
    if (refusal) await heard(opts, refusal, call, tool)
  }
  let read = async (id: string): Promise<unknown> => {
    try {
      if (!active) throw new CallError('expired', 'execution has ended')
      if (typeof id != 'string' || !id || id.length > 256) {
        throw new CallError('args', 'results.read takes a result id')
      }
      if (!kept) throw new CallError('result', 'kept results are unavailable')
      let value = await kept.read(id)
      if (bytes(value) > LIMITS.systemBytes) {
        throw new CallError('limit', TOO.system)
      }
      if (!active) throw new CallError('expired', 'execution has ended')
      return value
    } catch (e) {
      await hear(e, nested(mint()), 'results.read')
      throw e
    }
  }
  let call = async (
    set: string,
    name: string,
    args: string,
    app?: string,
  ): Promise<Result> => {
    let id = mint()
    let named = typeof name == 'string' ? name : undefined
    let input: unknown
    let receipt: Receipt | undefined
    let work: Promise<Result> | undefined
    try {
      if (!active) throw new CallError('expired', 'execution has ended')
      if (
        typeof set != 'string' || typeof name != 'string' ||
        typeof args != 'string'
      ) throw new CallError('args', 'bridge takes JSON text')
      let most = app === undefined
        ? LIMITS.scriptBytes
        : Math.ceil(FILE_BYTES / 3) * 4 + LIMITS.scriptBytes
      if (args.length > most || new TextEncoder().encode(args).length > most) {
        throw new CallError(
          'limit',
          app === undefined
            ? TOO.args
            : 'app files are limited to 1 MiB per fs write',
        )
      }
      try {
        input = JSON.parse(args)
      } catch {
        throw new CallError('args', 'tool arguments must be JSON')
      }
      // A refusal names the tool the script asked for, as `tools[set][name]`
      // spells it, so its words say which call was refused.
      let path = `${set}.${name}`
      if (!allowed.has(JSON.stringify([set, name]))) {
        throw new CallError(
          'tool',
          `tool ${path} is outside this execution scope`,
        )
      }
      if (calls.length >= limits.calls) {
        throw new CallError(
          'limit',
          TOO.calls.replace('16', String(limits.calls)),
        )
      }
      if (!input || typeof input != 'object' || Array.isArray(input)) {
        throw new CallError('args', 'tool arguments must be an object')
      }
      if (app !== undefined) {
        let { op, path, base64, encoding } = input as Record<string, unknown>
        input = {
          op,
          ...path === undefined ? {} : { path },
          ...base64 === undefined ? {} : { base64 },
          ...encoding === undefined ? {} : { encoding },
          app,
          ...files?.space ? { space: files.space } : {},
          ...files?.app == app && files?.draft ? { draft: files.draft } : {},
        }
      }
      let made: Receipt = { id, path: [set, name], pending: true }
      receipt = made
      calls.push(made)
      work = (async (): Promise<Result> => {
        let live = await current()
        if (!active) throw new CallError('expired', 'execution has ended')
        let admitted = live.admit(nested(id, name, input))
        if (!admitted || admitted.tool.name != name) {
          throw new CallError('tool', `tool ${path} is no longer available`)
        }
        await admitted.ensure()
        if (!active) throw new CallError('expired', 'execution has ended')
        let landed = await admitted.call()
        let answer = answerOf(landed, id)
        let failed = faulted(landed, id)
        let result: Result = {
          content: texts(answer, Infinity).map((text) => ({
            type: 'text',
            text,
          })),
          ...(!failed || !admitted.tool.outputSchema
            ? {
              structuredContent: app !== undefined
                ? valueIn(answer)
                : structured(admitted.tool, answer),
            }
            : {}),
          ...(failed ? { isError: true } : {}),
        }
        if (bytes(result) > LIMITS.systemBytes) {
          throw new CallError('limit', TOO.system)
        }
        if (
          answer.some((b) => b.heard) ||
          !failed && await opts.hears?.(admitted.tool, answer)
        ) {
          made.heard = true
        }
        if (failed) Object.assign(made, { isError: true, error: said(result) })
        return result
      })()
      pending.add(work)
      return await work
    } catch (e) {
      if (receipt) receipt.error = message(e)
      await hear(e, nested(id, named, input), named)
      throw e
    } finally {
      if (receipt) delete receipt.pending
      if (work) pending.delete(work)
    }
  }
  let cancel = () => {}
  let timeout = new Promise<never>((_, reject) => {
    cancel = clock.after(limits.wallMs, () => {
      active = false
      controller.abort()
      reject(new CallError('timeout', timedOut(limits.wallMs)))
    })
  })
  try {
    let text = await Promise.race([
      (async () =>
        source(script, entries, LIMITS.systemBytes, strip, {
          wallMs: limits.wallMs,
          files: !!files,
          browser: opts.browser && /\bbrowser\b/.test(script)
            ? await opts.browser()
            : undefined,
          cell: !!opts.repl,
        }))()
        .then((modules) => opts.repl ? described(modules) : modules)
        .then((modules) => {
          controller.signal.throwIfAborted()
          return evaluate(modules, {
            call: (set, name, args) => call(set, name, args),
            read,
            ...files
              ? { file: (app, args) => call('yaks', 'app_files', args, app) }
              : {},
          }, controller.signal)
        }),
      timeout,
    ])
    active = false
    await Promise.race([Promise.allSettled([...pending]), timeout])
    if (
      typeof text != 'string' || text.length > LIMITS.systemBytes ||
      new TextEncoder().encode(text).length > LIMITS.systemBytes
    ) throw new CallError('limit', TOO.system)
    let answer = JSON.parse(text)
    let error = typeof answer.unkept == 'string'
      ? `the cell's values could not be kept: ${answer.unkept}`
      : answer.error
    return await finished(
      answer.value ?? null,
      calls,
      typeof error == 'string' ? error.slice(0, 1024) : undefined,
      {
        ...repl,
        ...Array.isArray(answer.dropped) && answer.dropped.length
          ? { dropped: answer.dropped.map(String) }
          : {},
      },
    )
  } catch (e) {
    return await finished(null, calls, message(e), repl)
  } finally {
    active = false
    controller.abort()
    cancel()
  }
}

let pathsOf = (providers: readonly Provider[]): string => {
  let names = providers.filter(({ tools }) =>
    tools.some((t) => toolName(t) != 'code_mode')
  ).map(({ name }) => name)
  return names.length
    ? names.map((n) => `tools.${n}.<name>(args)`).join(' or ') +
      ' (the set each tool is in, never another name)'
    : 'tools[set][name](args)'
}

/** How a script names a tool, by the sets it will see. */
export let sets = (registry: Registry): string => pathsOf(registry.providers())

let fields = {
  name: 'code_mode',
  title: 'Run code',
  step: {
    doing: 'Working through several steps…',
    done: 'Worked through several steps',
  },
  inputSchema: {
    type: 'object',
    properties: {
      script: { type: 'string' },
      search: { type: 'string' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      value: {},
      calls: { type: 'array', items: { type: 'object' } },
      error: { type: 'string' },
      declarations: { type: 'string' },
      tools: { type: 'array', items: { type: 'object' } },
      limits: { type: 'object' },
      next: { type: ['integer', 'null'] },
      result_handle: { type: 'string' },
    },
  },
  applied: true,
  destructive: true,
  openWorld: true,
}

type Definition = Omit<Tool, 'run' | 'inputSchema'> & {
  inputSchema: NonNullable<Tool['inputSchema']> & {
    properties: Record<string, unknown>
  }
}

/** The code tool's public declaration from its providers, without building
 * their registry or publishing any of the nested tools' schemas. */
export let definition = (
  providers: readonly Provider[],
  opts: Pick<Options, 'files' | 'limits' | 'browser'> = {},
): Definition => ({
  ...fields,
  description:
    (opts.files
      ? 'Run JavaScript or TypeScript here. Use an async function body with return and await. Use fs for temporary files under /tmp and app draft files under /apps/<app>. Use fetch for HTTP requests. ' +
        (opts.browser
          ? "Use await browser.launch() for a puppeteer Browser on Cloudflare's headless Chrome; it closes when the run ends. "
          : '')
      : 'Use this for bulk reads, imports, reconciles and writes: keep source data and whole tool results inside a short JS/TS function body with return and await. ') +
    pathsOf(providers) +
    ' calls the same scoped tools, returning MCP content and structuredContent. Check isError before using a result. The answer is your return value plus a receipt per call. Large return values and tool results are kept in the graph; the answer gives their id, size, shape and preview. Use await results.read(id) to load a kept result. Omit script to read generated TypeScript declarations, with search, offset and limit for discovery. ' +
    `${(opts.limits ?? LIMITS).wallMs / 1000}s wall, ${
      (opts.limits ?? LIMITS).cpuMs
    }ms CPU, 128MiB isolate, ${
      (opts.limits ?? LIMITS).calls
    } calls, 64KiB script and tool arguments. ` +
    'Started writes may complete after a script fails or times out; pending receipts mean the outcome is still unknown.',
})

/** One connector tool: omit script to discover generated declarations; supply
 * a JS/TS function body to execute it with the same tool objects. */
export let tool = (
  registry: Registry,
  run: Runner,
  evaluate: Evaluate,
  strip: Strip,
  opts: Options = {},
): Tool => ({
  ...definition(registry.providers(), opts),
  run: async (asked) => {
    let { script, search, offset = 0, limit = 20 } = argsOf(asked)
    let matches = catalog(registry).filter((e) =>
      e.name != 'code_mode' &&
      (!search || registry.search(String(search)).some((t) => t.name == e.name))
    )
    let start = Number(offset), end = start + Number(limit)
    let value = script === undefined
      ? {
        declarations: declarations(matches.slice(start, end)) +
          '\ndeclare const results: { read(id: string): Promise<any> }' +
          (opts.files ? fileDeclarations : '') +
          (opts.browser ? browserDeclarations : ''),
        tools: matches.slice(start, end).map((
          { path, description, inputSchema, outputSchema },
        ) => ({ path, description, inputSchema, outputSchema })),
        next: end < matches.length ? end : null,
        limits: opts.limits ?? LIMITS,
      }
      : await execute(
        String(script),
        registry,
        run,
        asked,
        evaluate,
        strip,
        opts,
      )
    if (bytes(value) > LIMITS.systemBytes) {
      throw new CallError('limit', TOO.system)
    }
    let heard = 'calls' in value && value.calls.some((c) => c.heard)
    return [{
      entity: { eid: mint() },
      output: { source: asked.entity.eid, value },
      ...heard ? { heard: {} } : {},
    }]
  },
})
