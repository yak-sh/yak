/** Short, isolated code executions over a caller's scoped registry. The host
 * supplies an evaluator and reads a script's TypeScript as JavaScript; this
 * package owns discovery, limits and the bridge. */
import { argsOf, type Bundle, mint, type Tool, who } from '@yaks/graph'
import { type Clock, system } from '@yaks/fp'
import {
  answerOf,
  CallError,
  faulted,
  type Registry,
  type Runner,
  structured,
  texts,
  toolEid,
} from '@yaks/tools'
import { catalog, declarations } from './types.ts'
import { source, TOO } from './source.ts'
export { catalog, declarations, type Entry } from './types.ts'
export { TOO } from './source.ts'

export let LIMITS = {
  wallMs: 30_000,
  cpuMs: 100,
  memoryMiB: 128,
  calls: 16,
  outputBytes: 262_144,
  readBytes: 4_194_304,
  systemBytes: 33_554_432,
  scriptBytes: 65_536,
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
}
export type Answer = { value: unknown; calls: Receipt[]; error?: string }
/** The caller's graph keeps large results and admits reads within its scope.
 * `keep` returns the result's id, shape and preview for the model or script. */
export type Kept = {
  keep(value: unknown, source: Bundle): Promise<unknown>
  read(id: string): Promise<unknown>
}
export type Evaluate = (
  modules: Record<string, string>,
  bridge: {
    call(set: string, name: string, args: string): Promise<Result>
    read(id: string): Promise<unknown>
  },
  signal: AbortSignal,
) => Promise<string>
/** How the host reads a module's TypeScript as JavaScript, by its path.
 * Throws a SyntaxError where the source does not parse. */
export type Strip = (path: string, source: string) => string | Promise<string>
let bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
let message = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 1024)
let keptValue = async (value: unknown, asked: Bundle, kept?: Kept) => {
  let size = bytes(value)
  if (size > LIMITS.systemBytes) throw new CallError('limit', TOO.system)
  return size > LIMITS.outputBytes && kept
    ? await kept.keep(value, asked)
    : value
}
let finished = async (
  value: unknown,
  calls: Receipt[],
  asked: Bundle,
  kept?: Kept,
  error?: string,
): Promise<Answer> => {
  let out: Answer = {
    value: await keptValue(value, asked, kept),
    calls: structuredClone(calls),
    ...(error ? { error } : {}),
  }
  return out
}
// A result's size, counted once: its structured form where it has one, which
// its text repeats.
let size = (r: Result) => bytes(r.structuredContent ?? r.content)
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
  clock: Clock = system,
  current: () => Promise<Runner> = () => Promise.resolve(run),
  kept?: Kept,
): Promise<Answer> => {
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
  let used = 0
  let read = async (id: string): Promise<unknown> => {
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
  }
  let call = async (
    set: string,
    name: string,
    args: string,
  ): Promise<Result> => {
    if (!active) throw new CallError('expired', 'execution has ended')
    if (
      typeof set != 'string' || typeof name != 'string' ||
      typeof args != 'string'
    ) throw new CallError('args', 'bridge takes JSON text')
    if (
      args.length > LIMITS.scriptBytes ||
      new TextEncoder().encode(args).length > LIMITS.scriptBytes
    ) {
      throw new CallError('limit', TOO.args)
    }
    let input: unknown
    try {
      input = JSON.parse(args)
    } catch {
      throw new CallError('args', 'tool arguments must be JSON')
    }
    let tool = allowed.get(JSON.stringify([set, name]))
    if (!tool) {
      throw new CallError('tool', 'tool is outside this execution scope')
    }
    if (calls.length >= LIMITS.calls) {
      throw new CallError('limit', TOO.calls)
    }
    if (!input || typeof input != 'object' || Array.isArray(input)) {
      throw new CallError('args', 'tool arguments must be an object')
    }
    let id = mint()
    let receipt: Receipt = { id, path: [set, name], pending: true }
    calls.push(receipt)
    let work = (async (): Promise<Result> => {
      let actor = who(asked)
      let live = await current()
      if (!active) throw new CallError('expired', 'execution has ended')
      let nested: Bundle = {
        entity: { eid: id },
        call: { to: toolEid(name), args: input, source: asked.entity.eid },
        ...(actor ? { $actor: actor } : {}),
      }
      let admitted = live.admit(nested)
      if (!admitted || admitted.tool.name != name) {
        throw new CallError('tool', 'tool is no longer available')
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
          ? { structuredContent: structured(admitted.tool, answer) }
          : {}),
        ...(failed ? { isError: true } : {}),
      }
      let length = size(result)
      if (bytes(result) > LIMITS.systemBytes) {
        throw new CallError('limit', TOO.system)
      }
      used += length
      if (failed) Object.assign(receipt, { isError: true, error: said(result) })
      if (used > LIMITS.readBytes && kept) {
        let value = await kept.keep(result, nested)
        return {
          content: [{ type: 'text', text: JSON.stringify(value) }],
          structuredContent: value as Record<string, unknown>,
          ...(failed ? { isError: true } : {}),
        }
      }
      return result
    })()
    pending.add(work)
    try {
      return await work
    } catch (e) {
      receipt.error = message(e)
      throw e
    } finally {
      delete receipt.pending
      pending.delete(work)
    }
  }
  let cancel = () => {}
  let timeout = new Promise<never>((_, reject) => {
    cancel = clock.after(LIMITS.wallMs, () => {
      active = false
      controller.abort()
      reject(new CallError('timeout', 'execution exceeded 30 seconds'))
    })
  })
  try {
    let text = await Promise.race([
      source(script, entries, LIMITS.systemBytes, strip).then((modules) => {
        controller.signal.throwIfAborted()
        return evaluate(modules, { call, read }, controller.signal)
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
    return await finished(
      answer.value ?? null,
      calls,
      asked,
      kept,
      typeof answer.error == 'string' ? answer.error.slice(0, 1024) : undefined,
    )
  } catch (e) {
    return await finished(null, calls, asked, kept, message(e))
  } finally {
    active = false
    controller.abort()
    cancel()
  }
}

/** One connector tool: omit script to discover generated declarations; supply
 * a JS/TS function body to execute it with the same tool objects. */
export let tool = (
  registry: Registry,
  run: Runner,
  evaluate: Evaluate,
  strip: Strip,
  clock?: Clock,
  current?: () => Promise<Runner>,
  kept?: Kept,
): Tool => ({
  name: 'code_mode',
  title: 'Run code',
  description:
    'Use this for bulk reads, imports, reconciles and writes: keep source data and whole tool results inside a short JS/TS function body with return and await. tools[set][name](args) calls the same scoped tools, returning MCP content and structuredContent. Read schemas and rows, parse input, join, compare, build bundles and write them inside the script. Check isError before using a result. The answer is your return value plus a receipt per call (its id and path, and the error words of a call that failed). Large return values and tool results are kept in the graph; the answer gives their id, size, shape and preview. Use await results.read(id) inside a script to load a kept result, then filter or summarize it before returning. Omit script to read generated TypeScript declarations; search narrows discovery by tool name/description; offset/limit page it (at most 20). No ambient network, secrets or other bindings. 30s wall, 100ms CPU, 128MiB isolate, 16 calls, 64KiB script and arguments. Tool results over the 4MiB execution read budget and return values over 256KiB are kept; accidental results over 32MiB are refused for system safety. Started writes may complete after a script fails or times out; pending receipts mean the outcome is still unknown. Durable workflows and human waits are separate.',
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
    },
  },
  applied: true,
  destructive: true,
  openWorld: true,
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
          '\ndeclare const results: { read(id: string): Promise<any> }',
        tools: matches.slice(start, end).map((
          { path, description, inputSchema, outputSchema },
        ) => ({ path, description, inputSchema, outputSchema })),
        next: end < matches.length ? end : null,
        limits: LIMITS,
      }
      : await execute(
        String(script),
        registry,
        run,
        asked,
        evaluate,
        strip,
        clock,
        current,
        kept,
      )
    value = await keptValue(value, asked, kept) as typeof value
    return [{
      entity: { eid: mint() },
      output: { source: asked.entity.eid, value },
    }]
  },
})
