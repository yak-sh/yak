// The provider-neutral first-party agent loop. It projects an ordered Session
// prefix into Responses input, records completed provider items as immutable
// entry specs, and executes typed calls through hosted tools. Scheduling,
// leases, credentials, and database broadcasts stay outside this module.
import { dirname, relative, resolve, sep } from 'node:path'
import { type EntrySpec, type UsageValue } from './entries.ts'
import {
  type ResponseEvent,
  type ResponseItem,
  type ResponseRequest,
  type ResponseResult,
} from './responses.ts'
import {
  type ToolDefinition,
  type ToolHost,
  type ToolOutcome,
} from './harness_tools.ts'

export type EntryRow = {
  eid: string
  seq: number
  comps: Record<string, Record<string, unknown>>
}

export type ResponseTransport = {
  run: (
    request: ResponseRequest,
    options?: {
      signal?: AbortSignal
      event?: (event: ResponseEvent) => void
    },
  ) => Promise<ResponseResult>
}

export type InstructionOptions = {
  tree: string
  cwd?: string
  persona?: string
  prompt?: string
  authority?: string
  approval?: string
}

let within = (root: string, path: string) =>
  path == root || path.startsWith(root + sep)

let paragraphs = (parts: (string | undefined)[]) =>
  parts.map((part) => part?.trim()).filter(Boolean).join('\n\n')

// Applicable AGENTS.md files run from the worktree root down to cwd, the same
// hierarchy native Codex reads. The hosted runner never reads Codex settings,
// auth files, hooks, or a home-directory instruction source.
export let instructions = async (options: InstructionOptions) => {
  if ((options.authority ?? 'worktree') != 'worktree') {
    throw new Error(`unsupported authority: ${options.authority}`)
  }
  if ((options.approval ?? 'unattended') != 'unattended') {
    throw new Error(`unsupported approval mode: ${options.approval}`)
  }
  let tree = await Deno.realPath(options.tree)
  let wanted = resolve(tree, options.cwd ?? '.')
  let cwd = await Deno.realPath(wanted).catch(() => '')
  if (!cwd || !within(tree, cwd)) {
    throw new Error('instruction cwd leaves worktree')
  }
  let dirs: string[] = []
  for (let at = cwd;; at = dirname(at)) {
    dirs.push(at)
    if (at == tree) break
  }
  let agents: string[] = []
  for (let dir of dirs.reverse()) {
    let body = await Deno.readTextFile(resolve(dir, 'AGENTS.md')).catch(
      (error) => {
        if (error instanceof Deno.errors.NotFound) return ''
        throw error
      },
    )
    if (body.trim()) {
      let at = relative(tree, dir) || '.'
      agents.push(`## AGENTS.md (${at})\n\n${body.trim()}`)
    }
  }
  return paragraphs([
    `You are running in Tasks' first-party Codex harness. The only writable
filesystem authority is the dedicated worktree exposed to tools as /workspace.
This run is unattended: use the hosted tools directly. If a requested action
needs broader authority or an approval posture, stop and explain the refusal.
Provider credentials are unavailable to tools and must never enter content,
commands, patches, task data, or diagnostics.`,
    ...agents,
    options.persona ? `## Persona\n\n${options.persona}` : undefined,
    options.prompt ? `## Work\n\n${options.prompt}` : undefined,
  ])
}

let object = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let json = (value: unknown) => JSON.stringify(value)

let parsed = (value: unknown) => {
  if (typeof value != 'string') throw new Error('tool arguments are not text')
  let out: unknown
  try {
    out = JSON.parse(value)
  } catch {
    throw new Error('tool arguments are not valid JSON')
  }
  if (!object(out)) throw new Error('tool arguments are not an object')
  return out
}

let exact = (args: Record<string, unknown>, allowed: string[]) => {
  let alien = Object.keys(args).filter((name) => !allowed.includes(name))
  if (alien.length) {
    throw new Error(`unknown tool argument: ${alien.join(', ')}`)
  }
}

let optionalText = (value: unknown, name: string) => {
  if (value == null) return undefined
  if (typeof value != 'string') throw new Error(`${name} must be text`)
  return value
}

let timeout = (value: unknown) => {
  if (value == null) return undefined
  let n = Number(value)
  if (!Number.isInteger(n) || n < 100 || n > 120_000) {
    throw new Error('timeout_ms must be an integer from 100 to 120000')
  }
  return n
}

type CallRequest = {
  index: number
  name: string
  args: Record<string, unknown>
  error?: string
}

let callShape = (
  item: ResponseItem,
  generation: string,
): { spec: EntrySpec; request: Omit<CallRequest, 'index'> } => {
  let name = String(item.name ?? '')
  let key = String(item.call_id ?? '')
  let base: EntrySpec = {
    output: {
      source: generation,
      ...typeof item.id == 'string' ? { key: item.id } : {},
      ...typeof item.phase == 'string' ? { phase: item.phase } : {},
    },
    call: { key },
  }
  try {
    if (!key) throw new Error('tool call has no correlation key')
    let args = parsed(item.arguments)
    if (name == 'shell') {
      exact(args, ['command', 'cwd', 'timeout_ms'])
      if (typeof args.command != 'string') {
        throw new Error('command is required')
      }
      let ms = timeout(args.timeout_ms)
      let cwd = optionalText(args.cwd, 'cwd')
      return {
        spec: {
          ...base,
          bash: {
            command: args.command,
            ...cwd != null ? { cwd } : {},
          },
          ...ms != null ? { timeout: { ms } } : {},
        },
        request: { name, args },
      }
    }
    if (name == 'apply_patch') {
      exact(args, ['diff', 'cwd', 'timeout_ms'])
      if (typeof args.diff != 'string') throw new Error('diff is required')
      let ms = timeout(args.timeout_ms)
      let cwd = optionalText(args.cwd, 'cwd')
      return {
        spec: {
          ...base,
          patch: {
            path: cwd ?? '.',
            diff: args.diff,
          },
          ...ms != null ? { timeout: { ms } } : {},
        },
        request: { name, args },
      }
    }
    if (name == 'task_context') {
      exact(args, [])
      return {
        spec: { ...base, task_context: {} },
        request: { name, args },
      }
    }
    if (name == 'graph_query') {
      exact(args, ['query'])
      if (typeof args.query != 'string') throw new Error('query is required')
      return {
        spec: { ...base, graph_query: { query: args.query } },
        request: { name, args },
      }
    }
    if (name == 'graph_apply') {
      exact(args, ['change'])
      if (!object(args.change)) throw new Error('change is required')
      return {
        spec: { ...base, apply: { change: json(args.change) } },
        request: { name, args },
      }
    }
    throw new Error(`unsupported tool: ${name || '(unnamed)'}`)
  } catch (error) {
    let message = (error as Error).message
    return {
      spec: {
        ...base,
        opaque: { format: 'openai:function_call', data: json(item) },
      },
      request: { name, args: {}, error: message },
    }
  }
}

let contentText = (item: ResponseItem) => {
  if (!Array.isArray(item.content)) return { body: '', unknown: true }
  let body: string[] = []
  let unknown = false
  for (let part of item.content) {
    if (!object(part)) {
      unknown = true
      continue
    }
    if (
      (part.type == 'output_text' || part.type == 'text' ||
        part.type == 'refusal') && typeof part.text == 'string'
    ) body.push(part.text)
    else unknown = true
  }
  return { body: body.join(''), unknown }
}

let reasoningText = (item: ResponseItem) => {
  if (!Array.isArray(item.summary)) return ''
  return item.summary.flatMap((part) =>
    object(part) && typeof part.text == 'string' ? [part.text] : []
  ).join('\n')
}

let itemSpec = (
  item: ResponseItem,
  generation: string,
): {
  spec: EntrySpec
  request?: Omit<CallRequest, 'index'>
  final?: string
} => {
  if (item.type == 'function_call') {
    let shaped = callShape(item, generation)
    return { spec: shaped.spec, request: shaped.request }
  }
  let output = {
    source: generation,
    ...typeof item.id == 'string' ? { key: item.id } : {},
    ...typeof item.phase == 'string' ? { phase: item.phase } : {},
  }
  if (item.type == 'message') {
    let content = contentText(item)
    return {
      spec: {
        output,
        message: { role: 'agent' },
        content: { body: content.body },
        ...content.unknown
          ? { opaque: { format: 'openai:message', data: json(item) } }
          : {},
      },
      final: content.body,
    }
  }
  if (item.type == 'reasoning') {
    let body = reasoningText(item)
    return {
      spec: {
        output,
        reasoning: {},
        ...body ? { content: { body } } : {},
        opaque: { format: 'openai:reasoning', data: json(item) },
      },
    }
  }
  if (item.type == 'compaction') {
    let body = reasoningText(item) ||
      (typeof item.text == 'string' ? item.text : '')
    return {
      spec: {
        output,
        checkpoint: { through: generation },
        ...body ? { content: { body } } : {},
        opaque: { format: 'openai:compaction', data: json(item) },
      },
    }
  }
  return {
    spec: {
      output,
      opaque: { format: `openai:${item.type}`, data: json(item) },
    },
  }
}

export type GenerationWork = {
  specs: EntrySpec[]
  calls: CallRequest[]
  usage: UsageValue
  model: string
  finalText: string
}

export type GenerationFault = Error & { entrySpecs?: EntrySpec[] }

let failedEvidence = (error: unknown, generation: string): EntrySpec[] => {
  let fault = error as {
    items?: ResponseItem[]
    evidence?: ResponseEvent[]
  }
  return [
    ...fault.items ?? [],
    ...fault.evidence ?? [],
  ].map((value) => ({
    output: { source: generation },
    opaque: {
      format: `openai:failed:${String(value.type ?? 'item')}`,
      data: json(value),
    },
  }))
}

export let generationEntries = (
  result: ResponseResult,
  generation: string,
): GenerationWork => {
  let specs: EntrySpec[] = []
  let calls: CallRequest[] = []
  let finalText = ''
  for (let item of result.items) {
    let shaped = itemSpec(item, generation)
    let index = specs.push(shaped.spec) - 1
    if (shaped.request) calls.push({ index, ...shaped.request })
    if (shaped.final != null) finalText = shaped.final
  }
  for (let event of result.unknown) {
    specs.push({
      output: { source: generation },
      opaque: { format: `openai:event:${event.type}`, data: json(event) },
    })
  }
  return {
    specs,
    calls,
    usage: {
      input: result.usage?.input ?? 0,
      cached: result.usage?.cached ?? 0,
      output: result.usage?.output ?? 0,
      reasoning: result.usage?.reasoning ?? 0,
    },
    model: result.model,
    finalText,
  }
}

let providerOf = (row: EntryRow | undefined) =>
  String(row?.comps.generation?.provider ?? '')

let opaqueItem = (row: EntryRow) => {
  let raw = row.comps.opaque?.data
  if (typeof raw != 'string') return undefined
  try {
    let value = JSON.parse(raw)
    return object(value) && typeof value.type == 'string' ? value : undefined
  } catch {
    return undefined
  }
}

let callName = (row: EntryRow) =>
  row.comps.bash
    ? 'shell'
    : row.comps.patch
    ? 'apply_patch'
    : row.comps.task_context
    ? 'task_context'
    : row.comps.graph_query
    ? 'graph_query'
    : row.comps.apply
    ? 'graph_apply'
    : 'tool'

let callArgs = (row: EntryRow): Record<string, unknown> => {
  if (row.comps.bash) {
    return {
      command: row.comps.bash.command,
      ...row.comps.bash.cwd != null ? { cwd: row.comps.bash.cwd } : {},
      ...row.comps.timeout?.ms != null
        ? { timeout_ms: row.comps.timeout.ms }
        : {},
    }
  }
  if (row.comps.patch) {
    return {
      diff: row.comps.patch.diff,
      ...row.comps.patch.path != null ? { cwd: row.comps.patch.path } : {},
      ...row.comps.timeout?.ms != null
        ? { timeout_ms: row.comps.timeout.ms }
        : {},
    }
  }
  if (row.comps.graph_query) {
    return { query: String(row.comps.graph_query.query ?? '') }
  }
  if (row.comps.apply) {
    try {
      return { change: JSON.parse(String(row.comps.apply.change)) }
    } catch {
      return {}
    }
  }
  return {}
}

let portableCall = (row: EntryRow) =>
  `${callName(row)} ${JSON.stringify(callArgs(row))}`

// Project only the generation's frozen prefix. Typed content crosses provider
// boundaries; correlation keys and opaque replay evidence stay with the
// provider that minted them.
export let project = (entries: EntryRow[], generation: string): unknown[] => {
  let ordered = entries.toSorted((a, b) => a.seq - b.seq)
  let current = ordered.find((row) => row.eid == generation)
  if (!current?.comps.generation) throw new Error('no generation entry')
  let through = String(current.comps.generation.through)
  let cut = ordered.find((row) => row.eid == through)?.seq
  if (cut == null) throw new Error('generation prefix is missing')
  let provider = providerOf(current)
  let byEid = new Map(ordered.map((row) => [row.eid, row]))
  let out: unknown[] = []
  for (let row of ordered.filter((entry) => entry.seq <= cut)) {
    let comps = row.comps
    if (comps.message?.role == 'user' && !comps.output) {
      out.push({
        role: 'user',
        content: [{
          type: 'input_text',
          text: String(comps.content?.body ?? ''),
        }],
      })
      continue
    }
    if (comps.output && comps.message?.role == 'agent') {
      out.push({
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: String(comps.content?.body ?? ''),
        }],
      })
      continue
    }
    if (comps.output && comps.reasoning) {
      let source = byEid.get(String(comps.output.source))
      let opaque = opaqueItem(row)
      if (providerOf(source) == provider && opaque) out.push(opaque)
      else if (comps.content?.body) {
        out.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: String(comps.content.body) }],
        })
      }
      continue
    }
    if (comps.output && comps.call) {
      let source = byEid.get(String(comps.output.source))
      let opaque = opaqueItem(row)
      if (providerOf(source) == provider) {
        out.push(
          callName(row) == 'tool' && opaque ? opaque : {
            type: 'function_call',
            ...comps.output.key != null ? { id: comps.output.key } : {},
            call_id: String(comps.call.key),
            name: callName(row),
            arguments: JSON.stringify(callArgs(row)),
          },
        )
      } else {
        out.push({
          role: 'assistant',
          content: [{
            type: 'output_text',
            text: `Tool call: ${portableCall(row)}`,
          }],
        })
      }
      continue
    }
    if (comps.result) {
      let call = byEid.get(String(comps.result.call))
      let source = call && byEid.get(String(call.comps.output?.source))
      let body = String(comps.content?.body ?? '')
      if (call && providerOf(source) == provider) {
        out.push({
          type: 'function_call_output',
          call_id: String(call.comps.call?.key ?? ''),
          output: body,
        })
      } else {
        out.push({
          role: 'user',
          content: [{
            type: 'input_text',
            text: `Tool result${
              call ? ` for ${callName(call)}` : ''
            }:\n${body}`,
          }],
        })
      }
      continue
    }
    if (comps.output && comps.checkpoint) {
      let source = byEid.get(String(comps.output.source))
      let opaque = opaqueItem(row)
      if (providerOf(source) == provider && opaque) out.push(opaque)
      else if (comps.content?.body) {
        out.push({
          role: 'user',
          content: [{
            type: 'input_text',
            text: `Session checkpoint:\n${String(comps.content.body)}`,
          }],
        })
      }
      continue
    }
    if (comps.output && comps.opaque) {
      let source = byEid.get(String(comps.output.source))
      let opaque = opaqueItem(row)
      if (providerOf(source) == provider && opaque) out.push(opaque)
    }
  }
  return out
}

export type GenerateOptions = {
  entries: EntryRow[]
  generation: string
  instructions: string
  transport: ResponseTransport
  tools: ToolDefinition[]
  signal?: AbortSignal
  event?: (event: ResponseEvent) => void
  cacheKey?: string
}

export let generate = async (options: GenerateOptions) => {
  let row = options.entries.find((entry) => entry.eid == options.generation)
  let value = row?.comps.generation
  if (!value) throw new Error('no generation entry')
  let request: ResponseRequest = {
    model: String(value.model),
    instructions: options.instructions,
    input: project(options.entries, options.generation),
    tools: options.tools,
    parallel_tool_calls: true,
    ...value.effort ? { reasoning: { effort: value.effort } } : {},
    ...options.cacheKey ? { prompt_cache_key: options.cacheKey } : {},
  }
  let result: ResponseResult
  try {
    result = await options.transport.run(request, {
      signal: options.signal,
      event: options.event,
    })
  } catch (error) {
    let fault = error instanceof Error ? error : new Error(String(error))
    Object.assign(fault, {
      entrySpecs: failedEvidence(error, options.generation),
    })
    throw fault
  }
  return generationEntries(result, options.generation)
}

let requestOf = (row: EntryRow) => {
  if (!row.comps.call) throw new Error('entry is not a tool call')
  let name = callName(row)
  if (name == 'tool') throw new Error('unsupported recorded tool')
  let args = callArgs(row)
  if (name == 'graph_apply' && !object(args.change)) {
    throw new Error('recorded graph change is malformed')
  }
  return { name, args }
}

export let resultEntry = (call: string, outcome: ToolOutcome): EntrySpec => ({
  result: { call },
  content: { body: outcome.output },
  ...outcome.facets,
})

export let executeCall = async (
  row: EntryRow,
  tools: ToolHost,
  signal?: AbortSignal,
) => {
  let call = requestOf(row)
  let outcome: ToolOutcome
  try {
    outcome = await tools.call(call.name, call.args, { signal })
  } catch (error) {
    outcome = {
      output: `tool failed: ${(error as Error).message}`,
      failed: true,
    }
  }
  return resultEntry(row.eid, outcome)
}

export type TurnLog = {
  read: () => Promise<EntryRow[]>
  append: (specs: EntrySpec[]) => Promise<string[]>
  settle?: (generation: string, usage: UsageValue) => Promise<void>
  fail?: (generation: string, message: string) => Promise<void>
}

export type TurnOptions = {
  log: TurnLog
  through: string
  provider: string
  model: string
  effort?: string
  instructions: string
  transport: ResponseTransport
  tools: ToolHost
  signal?: AbortSignal
  event?: (event: ResponseEvent) => void
  cacheKey?: string
  maxGenerations?: number
}

// A small reference driver used by fakes and by the initial integration. Each
// production scheduler action may call generate()/executeCall() separately;
// this loop preserves the same append-before-advance ordering.
export let runTurn = async (options: TurnOptions) => {
  let through = options.through
  let max = Math.max(1, options.maxGenerations ?? 32)
  for (let step = 0; step < max; step++) {
    let [generation] = await options.log.append([{
      generation: {
        through,
        provider: options.provider,
        model: options.model,
        ...options.effort ? { effort: options.effort } : {},
      },
    }])
    let work: GenerationWork
    try {
      work = await generate({
        entries: await options.log.read(),
        generation,
        instructions: options.instructions,
        transport: options.transport,
        tools: options.tools.tools,
        signal: options.signal,
        event: options.event,
        cacheKey: options.cacheKey,
      })
    } catch (error) {
      let evidence = (error as GenerationFault).entrySpecs ?? []
      if (evidence.length) await options.log.append(evidence)
      await options.log.fail?.(generation, (error as Error).message)
      throw error
    }
    let outputs = await options.log.append(work.specs)
    await options.log.settle?.(generation, work.usage)
    if (!work.calls.length) return { finalText: work.finalText, generation }
    await Promise.all(work.calls.map(async (call) => {
      let eid = outputs[call.index]
      let outcome: ToolOutcome
      if (call.error) {
        outcome = { output: `tool failed: ${call.error}`, failed: true }
      } else {
        try {
          outcome = await options.tools.call(call.name, call.args, {
            signal: options.signal,
          })
        } catch (error) {
          outcome = {
            output: `tool failed: ${(error as Error).message}`,
            failed: true,
          }
        }
      }
      await options.log.append([resultEntry(eid, outcome)])
    }))
    let entries = await options.log.read()
    through = entries.toSorted((a, b) => a.seq - b.seq).at(-1)!.eid
  }
  throw new Error(`runner exceeded ${max} model generations`)
}
