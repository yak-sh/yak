/** Private, no-tool interpretation measurements. No corpus or rubric lives here.
 * Run: deno run -A bench/context-reading.ts run --packet /private/packet.json
 * --out /private/results.json --persona <eid>. Output contains private context.
 */
import { agent } from '@yaks/harness'
import { compose } from '@yaks/cli/host'
import { configPath, read } from '../packages/cli/config.ts'
import { vaultOf } from '../packages/cli/vault.ts'
import { openaiCredential } from '../packages/harness/openai_auth.ts'
import { instructionFiles } from '../packages/harness/instructions.ts'
import { owing } from '../packages/harness/session_machines.ts'
import { processMachine } from '@yaks/process/machine'
import { responses } from '@yaks/openai'
import { type Snapshot, snapshot } from '@yaks/context'
import type { Model, Reply, Request } from '@yaks/model'
import type { Bundle } from '@yaks/graph'

export type Condition = {
  id: string
  text: string
  contexts?: Record<string, string>
  technique?: string
  parameters?: Record<string, unknown>
}
export type Case = {
  id: string
  input: {
    original_message: { exact_words: string; timestamp?: string }
    ideal_context?: { text: string }
  }
}
export type Packet = {
  historical_cases: Case[]
  conditions?: Condition[]
  /** Private graph export: current persona, contains/reads targets and auth rows. */
  snapshot?: Bundle[]
  files?: Snapshot[]
}

/** Explicit projection: held_out, answers and rubric never enter a request. */
export function candidate(c: Case, condition: Condition) {
  let context = condition.contexts?.[c.id] ?? condition.text
  let original = c.input.original_message
  return 'This is a historical interpretation test, not a current action request. ' +
    'Interpret only ORIGINAL OWNER MESSAGE using CONTEXT as background, not as the request to answer. ' +
    'What did the owner mean, and what would you have done at that time? Do not execute any action. ' +
    'Do not treat historical dates as now.\n\n' +
    '--- CONTEXT (background only) ---\n' + context +
    '\n--- END CONTEXT ---\n\n' +
    'Original message timestamp: ' + (original.timestamp ?? 'unknown') + '\n' +
    '--- ORIGINAL OWNER MESSAGE ---\n' + original.exact_words +
    '\n--- END ORIGINAL OWNER MESSAGE ---'
}

export type Call = {
  request: unknown
  contextHash: string
  response: Reply | null
  error: string | null
  wallMs: number
}
export function recording(model: Model, calls: Call[]): Model {
  return async (req: Request) => {
    if (req.tools.length) {
      throw new Error('Interpretation probe must have no tools')
    }
    // Transport callbacks and cancellation handles are not model context.
    let request = JSON.parse(JSON.stringify({
      model: req.model,
      effort: req.effort,
      instructions: req.instructions,
      items: req.items,
      tools: req.tools,
      input: req.input,
      questions: req.questions,
      tokens: req.tokens,
      anchor: req.anchor,
      conversation: req.conversation,
    }))
    let call: Call = {
      request,
      contextHash:
        (await snapshot(JSON.stringify(request), 'request')).revision,
      response: null,
      error: null,
      wallMs: 0,
    }
    calls.push(call)
    let start = performance.now()
    try {
      call.response = await model(req)
      return call.response
    } catch (e) {
      call.error = String(e)
      throw e
    } finally {
      call.wallMs = performance.now() - start
    }
  }
}

/** Unknown/failed usage is not free. Every attempted call is in the total. */
export function totals(calls: Call[]) {
  let sum = (get: (r: Reply) => number | undefined) => {
    let values = calls.map((c) => c.response ? get(c.response) : undefined)
    return values.length && values.every((n) => n != null)
      ? (values as number[]).reduce((a, b) => a + b, 0)
      : null
  }
  return {
    calls: calls.length,
    callWallMs: calls.reduce((n, c) => n + c.wallMs, 0),
    inputTokens: sum((r) => r.usage?.input_tokens),
    cachedTokens: sum((r) => r.usage?.cached_tokens),
    outputTokens: sum((r) => r.usage?.output_tokens),
    dollars: sum((r) => r.cost),
    dollarsReported:
      calls.length && calls.every((c) => c.response?.cost != null)
        ? calls.every((c) => c.response?.costReported !== false)
        : null,
  }
}

export type Point = { id: string; evidence: string[] }
export type Grade = { id: string; value: 0 | 1 | null; evidence: string[] }
/** External binary judgements only; unassigned points remain in denominator. */
export function score(points: Point[], grades: Grade[], failed = false) {
  if (new Set(points.map((p) => p.id)).size != points.length) {
    throw new Error('Duplicate rubric point')
  }
  let assigned = new Map<string, Grade>()
  for (let grade of grades) {
    if (!points.some((p) => p.id == grade.id) || assigned.has(grade.id)) {
      throw new Error('Unknown or duplicate grade')
    }
    if (![0, 1, null].includes(grade.value)) throw new Error('Not binary')
    if (grade.value != null && !grade.evidence.length) {
      throw new Error('A judgement needs graph evidence references')
    }
    assigned.set(grade.id, grade)
  }
  let known = points.flatMap((p) => {
    let v = assigned.get(p.id)?.value
    return v == null ? [] : [v]
  })
  let earned = known.reduce<number>((a, b) => a + b, 0)
  let complete = !failed && points.length > 0 && known.length == points.length
  return {
    denominator: points.length,
    assigned: known.length,
    missing: points.length - known.length,
    earned: failed || !known.length ? null : earned,
    fraction: complete ? earned / points.length : null,
    failed,
  }
}

const plugins = [
  '@yaks/kernel',
  '@yaks/id',
  '@yaks/key',
  '@yaks/alias',
  '@yaks/secrets',
  '@yaks/edge',
  '@yaks/blob',
  '@yaks/doc',
  '@yaks/archetype',
  '@yaks/effects',
  '@yaks/task',
  '@yaks/project',
  '@yaks/session',
  '@yaks/tools',
  '@yaks/model',
  '@yaks/openai',
  '@yaks/process',
  '@yaks/machine',
  '@yaks/context',
  '@yaks/connections',
  '@yaks/persona',
  '@yaks/harness',
]

async function exported(query: string): Promise<Bundle[]> {
  let result = await new Deno.Command('yak', {
    args: ['graph', 'query', query, '--json'],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr))
  let parsed = JSON.parse(new TextDecoder().decode(result.stdout))
  let rows = Array.isArray(parsed) ? parsed : parsed.result
  if (!Array.isArray(rows)) throw new Error('Graph export must return bundles')
  return rows
}

export async function run(packet: Packet, options: {
  persona?: string
  cwd: string
  opening?: 'graph-only' | 'repo-current'
  save: (result: unknown) => Promise<void>
}) {
  let began = performance.now()
  if (
    !Array.isArray(packet.historical_cases) || !packet.historical_cases.length
  ) {
    throw new Error('Packet needs historical_cases')
  }
  for (let c of packet.historical_cases) {
    if (!c.id || typeof c.input?.original_message?.exact_words != 'string') {
      throw new Error('Case needs id and input.original_message.exact_words')
    }
  }
  if (
    options.opening && !['graph-only', 'repo-current'].includes(options.opening)
  ) {
    throw new Error('opening must be graph-only or repo-current')
  }
  for (let condition of packet.conditions ?? []) {
    if (!condition.id || typeof condition.text != 'string') {
      throw new Error('Condition needs id and text')
    }
  }
  for (let file of packet.files ?? []) {
    if ((await snapshot(file.body, file.source)).revision != file.revision) {
      throw new Error('Frozen instruction revision mismatch: ' + file.source)
    }
  }
  // Host-only reads, before any candidate exists. Never lend this CLI to it.
  let config = read(configPath()!)
  if (options.persona && !packet.snapshot && !packet.files) {
    throw new Error(
      'Explicit persona needs private packet.snapshot rows for the existing owing() resolver, or packet.files frozen snapshots',
    )
  }
  let source = packet.snapshot ?? (await Promise.all(
    [
      'provider',
      'model',
      'serves',
      'connection',
      'secret',
      'integration',
      'person',
    ].map((c) => exported('.' + c + ' *')),
  )).flat()
  // CLI rows include read-side actor/stamp metadata: seed only stored components.
  source = [...new Map(source.map((b) => [b.entity.eid, b])).values()].map(
    (b) => {
      let { $actor: _actor, $was: _was, ...row } = b
      return { ...row, entity: { eid: b.entity.eid } }
    },
  )
  let setup = await compose(
    { db: ':memory:', plugins },
    ['graph'],
    undefined,
    {},
  )
  let files: Snapshot[]
  try {
    source = source.map((b) =>
      Object.fromEntries(
        Object.entries(b).filter(([key]) =>
          key == 'entity' || setup.vocab.comps.includes(key)
        ),
      )
    ) as Bundle[]
    await setup.graph.apply(source, { trusted: true })
    files = packet.files ??
      (options.opening == 'repo-current'
        ? await instructionFiles(processMachine(setup.graph), options.cwd)
        : [])
    if (options.persona && !packet.files) {
      files.push(
        ...await owing(
          setup.graph,
          { cwd: options.cwd },
          files,
          options.persona,
        ),
      )
    }
  } finally {
    await setup.close()
  }
  let results: unknown[] = []
  let allCalls: Call[] = []
  for (let c of packet.historical_cases) {
    for (let condition of packet.conditions ?? [{ id: 'baseline', text: '' }]) {
      let start = performance.now()
      let host = await compose(
        { db: ':memory:', plugins },
        ['graph'],
        undefined,
        {},
      )
      let calls: Call[] = []
      let transcript: Bundle[] = []
      let error: string | null = null
      let session: string | null = null
      let a: ReturnType<typeof agent> | undefined
      try {
        await host.graph.apply(source, { trusted: true })
        let auth = openaiCredential({
          g: host.graph,
          vault: vaultOf(config.db!),
          person: config.person,
        }, () => undefined)
        let model = recording(responses({ ...auth, web: false }), calls)
        let modelId = source.find((b) =>
          (b.model as { name?: string } | undefined)?.name == 'gpt-6.1-sol'
        )?.entity.eid
        if (!modelId) {
          throw new Error('Snapshot must include gpt-6.1-sol; no downgrade')
        }
        a = agent({
          h: { g: host.graph, fx: host.fx, vocab: host.vocab, me: host.me },
          providers: { openai: model },
          provider: 'openai',
          tools: [],
          remote: () => Promise.resolve([]),
          named: () => [],
          opening: () => Promise.resolve({ files }),
        })
        session = await a.start(candidate(c, condition), {
          model: modelId,
        })
        await a.idle(session)
        transcript = await a.transcript(session)
        if (
          !calls.length || calls.some((call) =>
            call.error ||
            !call.response?.items.some((i) => i.kind == 'assistant' && i.text)
          )
        ) {
          error = 'Missing or failed model call'
        }
      } catch (e) {
        error = String(e)
      } finally {
        await a?.close()
        await host.close()
      }
      allCalls.push(...calls)
      results.push({
        caseId: c.id,
        requestedModel: 'gpt-6.1-sol',
        provider: 'openai',
        opening: packet.files
          ? 'frozen-packet'
          : options.opening ?? 'graph-only',
        condition,
        mode: 'initial-interpretation-no-tools',
        session,
        suppliedContext: files,
        calls,
        transcript,
        error,
        totals: totals(calls),
        wallMs: performance.now() - start,
      })
      await options.save({
        label:
          'Restricted no-tool, no-system-preamble historical interpretation; not a full operational baseline or production mechanism test',
        opening: packet.files
          ? 'frozen-packet'
          : options.opening ?? 'graph-only',
        model: 'gpt-6.1-sol',
        provider: 'openai',
        results,
        totals: totals(allCalls),
        wallMs: performance.now() - began,
      })
    }
  }
}

if (import.meta.main) {
  let args = Deno.args
  if (args[0] == 'score') {
    // Separate private grading packet; never passed to run() or a model.
    if (!args[1]) throw new Error('score /private/grading.json')
    let grading = JSON.parse(await Deno.readTextFile(args[1]))
    console.log(
      JSON.stringify(
        score(grading.points, grading.grades, grading.failed ?? false),
        null,
        2,
      ),
    )
    Deno.exit(0)
  }
  let value = (name: string) => args[args.indexOf('--' + name) + 1]
  if (
    args[0] != 'run' || !args.includes('--packet') || !args.includes('--out')
  ) {
    throw new Error(
      'run --packet /private/packet.json --out /private/results.json [--persona eid] [--cwd path]',
    )
  }
  let packet = JSON.parse(await Deno.readTextFile(value('packet')))
  let out = value('out')
  // Refuse overwrite and create private output before spending anything.
  await Deno.writeTextFile(out, '{}\n', { createNew: true, mode: 0o600 })
  await run(packet, {
    persona: args.includes('--persona') ? value('persona') : undefined,
    cwd: args.includes('--cwd') ? value('cwd') : Deno.cwd(),
    opening: args.includes('--opening')
      ? value('opening') as 'graph-only' | 'repo-current'
      : 'graph-only',
    save: (result) =>
      Deno.writeTextFile(out, JSON.stringify(result, null, 2) + '\n'),
  })
}
