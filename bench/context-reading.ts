/** Private interpretation measurements. No corpus or rubric lives here.
 * Run: deno run -A bench/context-reading.ts run --packet /private/packet.json
 * --out /private/results.json [--native]. Native keeps the full default tool
 * schemas but executes only isolated graph reads. Output contains private context.
 */
import { agent } from '@yaks/harness'
import { ownerOracle, ownerWords } from './owner-oracle.ts'
import {
  conservativeTokens,
  graphTree,
  growOracleTree,
  type OracleCall,
  type OracleLimits,
} from '@yaks/oracle'
import { harnessTools } from '../packages/harness/tools.ts'
import { skillItems, skillTools } from '../packages/harness/skills.ts'
import { machines } from '../packages/harness/session_machines.ts'
import type { Graph } from '@yaks/graph'
import type { Tool } from '@yaks/session'
import { compose } from '@yaks/cli/host'
import { configPath, read } from '../packages/cli/config.ts'
import { vaultOf } from '../packages/cli/vault.ts'
import { openaiCredential } from '../packages/harness/openai_auth.ts'
import { instructionFiles } from '../packages/harness/instructions.ts'
import { owing } from '../packages/harness/session_machines.ts'
import { executionWorkspace } from '@yaks/machine/execution'
import { localConnector } from '@yaks/machine/connectors'
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
  /** Audited candidate-only frozen graph rows, never auth or grading rows. */
  evidence?: Record<string, Bundle[]>
  skills?: Bundle[]
  /** Opt-in single-node oracle grown only from per-case audited evidence. */
  ownerOracle?: boolean
  /** Audited earlier tree corpus, distinct from native per-case evidence. */
  oracleTree?: {
    rows: Bundle[]
    limits: OracleLimits
    tree: string
    adjustment?: string
  }
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
  role?: string
  request: unknown
  contextHash: string
  response: Reply | null
  error: string | null
  wallMs: number
}
export function recording(
  model: Model,
  calls: Call[],
  native = false,
  role?: string,
): Model {
  let wrapped: Model = async (req: Request) => {
    if (!native && req.tools.length) {
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
      ...(role ? { role } : {}),
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
  return Object.assign(wrapped, {
    mark: model.mark,
    anchor: model.anchor,
    list: model.list,
    info: model.info,
  })
}

/** Keep the native tool offer, but lend only isolated read capabilities.
 * Non-read schemas remain visible so this is not a no-tools prompt ablation.
 * No denied handler is ever entered (especially shell, publish and spawning).
 */
export function readOnly(tools: Tool[]): Tool[] {
  const allowed = new Set([
    'graph_query',
    'graph_show',
    'graph_schema',
    'graph_value_read',
    'graph_value_search',
  ])
  return tools.map((tool) =>
    allowed.has(tool.name) ? tool : {
      ...tool,
      run: () =>
        Promise.resolve(
          'Isolated interpretation measurement: actions and external access are disabled.',
        ),
      recover: undefined,
    }
  )
}

/** Corpus evidence is inert earlier text, never executable transcript state.
 * Selection and held-out auditing remain the private packet author's duty.
 */
export function evidenceRows(rows: Bundle[], cutoff: string): Bundle[] {
  return rows.map((row) => {
    let at = (row.created as { at?: string } | undefined)?.at
    if (
      !at || !Number.isFinite(Date.parse(at)) ||
      !Number.isFinite(Date.parse(cutoff)) ||
      Date.parse(at) >= Date.parse(cutoff)
    ) {
      throw new Error('Evidence must strictly precede the original message')
    }
    return {
      entity: { eid: row.entity.eid },
      ...row.content ? { content: row.content } : {},
      ...row.doc ? { doc: row.doc } : {},
      created: { at },
    }
  })
}

/** Validate the whole tree corpus independently for every historical cutoff.
 * Never silently filter a shared corpus into a different measurement per case.
 */
export function treeRows(packet: Packet, native: boolean) {
  if (!packet.oracleTree) return
  if (!native) throw new Error('Oracle tree requires isolated native mode')
  if (packet.ownerOracle) throw new Error('Choose ownerOracle or oracleTree')
  for (let c of packet.historical_cases) {
    evidenceRows(
      packet.oracleTree.rows,
      c.input.original_message.timestamp ?? '',
    )
    ownerWords(packet.oracleTree.rows, c.input.original_message.timestamp ?? '')
  }
}

/** The engine is the sole recorder for tree calls. Convert its frozen trace,
 * including failed attempts, once; candidate calls use recording() separately.
 */
export async function treeCalls(trace: readonly OracleCall[]): Promise<Call[]> {
  return await Promise.all(trace.map(async (call) => ({
    role: 'oracle-tree-' + call.role,
    request: call.request,
    contextHash:
      (await snapshot(JSON.stringify(call.request), 'request')).revision,
    response: call.reply ?? null,
    error: call.error ?? null,
    wallMs: call.wallMs,
  })))
}

/** Native candidate is the real asker; no synthetic converse()/asker model.
 * Keep diagnostics accessible even when growth fails before returning a tree.
 */
export async function measuredTree(options: {
  rows: Bundle[]
  cutoff: string
  model: Model
  limits: OracleLimits
  graph: Graph
  tree: string
  title?: string
  prepare?: boolean
  adjustment?: string
}) {
  let trace: OracleCall[] = []
  let tree: Awaited<ReturnType<typeof growOracleTree>> | undefined
  let growthError: string | null = null
  let consultations: {
    message: string
    conversation?: string
    result?: unknown
    error?: string
  }[] = []
  let limits = {
    ownTokens: 5000,
    requestTokens: 100_000,
    evidencePageTokens: 20_000,
    ...options.limits,
  }
  try {
    // The injected model is recorded by the engine, with its exact per-call role.
    tree = await graphTree(options.graph, {
      title: options.title ?? 'Oracle tree',
      retained: !options.prepare,
      ...options,
      rows: evidenceRows(options.rows, options.cutoff),
      limits,
      modelName: 'gpt-6.1-sol',
      measureTokens: conservativeTokens,
      onCall: (call) => {
        trace.push(call)
      },
    })
  } catch (e) {
    growthError = String(e)
  }
  if (tree && options.adjustment) {
    try {
      await tree.query({ message: options.adjustment, maintenance: true })
    } catch (e) {
      growthError = String(e)
    }
  }
  let assertReady = () => {
    if (growthError) throw new Error(growthError)
    let stats = tree!.stats()
    if (stats.readyNodes < 1) {
      throw new Error(
        `Oracle tree shortfall: ${stats.readyNodes} ready nodes; need a ready root`,
      )
    }
  }
  let ask = tree?.question()
  let tool: Tool = {
    name: 'ask_oracle',
    description:
      'Consult the oracle tree with the original owner message and relevant context or uncertainty. Omit conversation to open a receiving fork; continue its returned conversation handle for follow-ups, including structural questions.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        conversation: { type: 'string' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    run: async (args) => {
      let { message, conversation } = args as {
        message?: unknown
        conversation?: unknown
      }
      if (
        typeof message != 'string' || !message.trim() ||
        (conversation !== undefined &&
          (typeof conversation != 'string' || !conversation.trim()))
      ) {
        throw new Error(
          'ask_oracle needs message and optional conversation text',
        )
      }
      if (!tree) throw new Error(growthError ?? 'Tree unavailable')
      let q: typeof consultations[number] = {
        message,
        ...(conversation === undefined
          ? {}
          : { conversation: conversation as string }),
      }
      consultations.push(q)
      try {
        q.result = await ask!({
          message,
          conversation: conversation as string | undefined,
        })
        return JSON.stringify(q.result)
      } catch (e) {
        q.error = String(e)
        throw e
      }
    },
  }
  return {
    tool,
    assertReady,
    calls: () => treeCalls(tree?.trace ?? trace),
    consulted: () => consultations.some((q) => q.result !== undefined),
    evidence: () => ({
      root: tree?.root ?? trace[0]?.node ?? null,
      // A root failure has no published revisions; retain its requests/errors.
      tree: options.tree,
      trace: tree?.trace ?? trace,
      declines: tree?.declines ?? [],
      changes: tree?.changes ?? [],
      stats: tree?.stats() ??
        { readyNodes: 0, calls: trace.length, partialErrors: [growthError] },
      limits,
      counter: 'utf8-bytes',
      growthError,
      consultations,
    }),
  }
}

/** A final interpretation must belong to the candidate transcript and consume
 * every completed tool result. Oracle prose and pre-result outputs do not count.
 */
export function finalCandidate(entries: Bundle[]): string | null {
  let seq = (b: Bundle | undefined) =>
    (b?.entry as { seq?: number } | undefined)?.seq ?? 0
  let all = entries.toSorted((a, b) => seq(a) - seq(b))
  let byId = new Map(all.map((b) => [b.entity.eid, b]))
  let results = all.filter((b) => b.result)
  let answered = new Set(
    results.map((b) => (b.result as { call?: string }).call),
  )
  if (all.some((b) => b.call && !answered.has(b.entity.eid))) return null
  let lastResult = Math.max(0, ...results.map(seq))
  let final = all.findLast((b) => {
    if (!b.output || b.result || b.call || b.reasoning || b.tool_progress) {
      return false
    }
    let body = (b.content as { body?: string } | undefined)?.body
    if (!body?.trim() || seq(b) <= lastResult) return false
    let ask = byId.get((b.output as { source?: string }).source ?? '')
    let through = byId.get(
      (ask?.ask as { through?: string } | undefined)?.through ?? '',
    )
    return !lastResult || seq(through) >= lastResult
  })
  return (final?.content as { body?: string } | undefined)?.body ?? null
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
  '@yaks/oracle',
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
  native?: boolean
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
  if (packet.ownerOracle) {
    if (!options.native) {
      throw new Error('Owner oracle requires isolated native mode')
    }
    for (let c of packet.historical_cases) {
      if (!packet.evidence?.[c.id]) {
        throw new Error('Oracle needs audited owner evidence')
      }
      ownerWords(
        packet.evidence[c.id],
        c.input.original_message.timestamp ?? '',
      )
    }
  }
  treeRows(packet, options.native ?? false)
  // Host-only reads, before any candidate exists. Never lend this CLI to it.
  let config = read(configPath()!)
  // Current native graph vocabulary, without plugin runtime configuration.
  let composition = options.native
    ? config.plugins?.map((p) => typeof p == 'string' ? p : p.use) ?? plugins
    : plugins
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
    { db: ':memory:', plugins: composition },
    ['graph'],
    undefined,
    { process: false },
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
    let explicit = executionWorkspace(
      setup.graph,
      await localConnector().connect('local://'),
      {
        workspace: crypto.randomUUID(),
        root: options.cwd,
        receipts: (Deno.env.get('TMPDIR') ?? '/tmp') +
          '/context-reading-receipts',
      },
    )
    files = packet.files ??
      (options.opening == 'repo-current'
        ? await instructionFiles(explicit, options.cwd)
        : [])
    if (options.persona && !packet.files) {
      files.push(
        ...await owing(
          setup.graph,
          { cwd: options.cwd },
          files,
          { persona: options.persona },
        ),
      )
    }
  } finally {
    await setup.close()
  }
  // Resolve credentials against host-only metadata, not the candidate graph.
  let authHost = await compose(
    { db: ':memory:', plugins: composition },
    ['graph'],
    undefined,
    { process: false },
  )
  await authHost.graph.apply(source, { trusted: true })
  let oracleHost = packet.oracleTree
    ? await compose(config, ['graph'], undefined, { process: false })
    : undefined
  let results: unknown[] = []
  let allCalls: Call[] = []
  try {
    for (let c of packet.historical_cases) {
      for (
        let condition of packet.conditions ?? [{ id: 'baseline', text: '' }]
      ) {
        let start = performance.now()
        let host = await compose(
          { db: ':memory:', plugins: composition },
          ['graph'],
          undefined,
          { process: false },
        )
        let calls: Call[] = []
        let transcript: Bundle[] = []
        let oracle: Awaited<ReturnType<typeof ownerOracle>> | undefined
        let tree: Awaited<ReturnType<typeof measuredTree>> | undefined
        let error: string | null = null
        let session: string | null = null
        let a: ReturnType<typeof agent> | undefined
        try {
          let visible = options.native
            ? source.filter((b) => b.model || b.provider || b.serves).map((
              b,
            ) => ({
              entity: b.entity,
              ...b.model ? { model: b.model } : {},
              ...b.provider
                ? {
                  provider: Object.fromEntries(
                    Object.entries(b.provider as Record<string, unknown>)
                      .filter((
                        [key],
                      ) => !['credential'].includes(key)),
                  ),
                }
                : {},
              ...b.serves ? { serves: b.serves, edge: b.edge } : {},
            })) as Bundle[]
            : source
          await host.graph.apply(visible, { trusted: true })
          if (options.native) {
            if (!packet.evidence?.[c.id]) {
              throw new Error('Native run needs audited per-case evidence')
            }
            await host.graph.apply([
              ...evidenceRows(
                packet.evidence[c.id],
                c.input.original_message.timestamp ?? '',
              ),
              ...packet.skills ?? [],
            ], { trusted: true })
          }
          let auth = openaiCredential({
            g: authHost.graph,
            vault: vaultOf(config.db!),
            person: config.person,
          }, () => undefined)
          let transport = responses({ ...auth, web: false })
          let model = recording(
            transport,
            calls,
            options.native,
            packet.ownerOracle || packet.oracleTree
              ? 'candidate-answer'
              : undefined,
          )
          let modelId = source.find((b) =>
            (b.model as { name?: string } | undefined)?.name == 'gpt-6.1-sol'
          )?.entity.eid
          if (!modelId) {
            throw new Error('Snapshot must include gpt-6.1-sol; no downgrade')
          }
          let binding = machines(host.graph)
          let nativeTools = options.native
            ? readOnly([
              ...harnessTools(host.graph, { machines: binding }),
              ...skillTools(host.graph),
            ])
            : []
          if (packet.ownerOracle) {
            oracle = await ownerOracle({
              rows: packet.evidence![c.id],
              cutoff: c.input.original_message.timestamp ?? '',
              grow: recording(transport, calls, true, 'owner-context-growth'),
              query: recording(transport, calls, true, 'owner-query-fork'),
            })
            nativeTools.push(oracle.tool)
          }
          if (packet.oracleTree) {
            if (!packet.oracleTree.tree) {
              throw new Error('Answer runs require a retained graph tree')
            }
            tree = await measuredTree({
              rows: packet.oracleTree.rows,
              cutoff: c.input.original_message.timestamp ?? '',
              model: transport,
              limits: packet.oracleTree.limits,
              graph: oracleHost!.graph,
              tree: packet.oracleTree.tree,
              adjustment: packet.oracleTree.adjustment,
            })
            tree.assertReady()
            nativeTools.push(tree.tool)
          }
          a = agent({
            h: { g: host.graph, fx: host.fx, vocab: host.vocab, me: host.me },
            providers: { openai: model },
            provider: 'openai',
            name: 'gpt-6.1-sol',
            tools: nativeTools,
            requestItems: options.native
              ? (_, __, current) => skillItems(host.graph, current)
              : undefined,
            remote: () => Promise.resolve([]),
            named: () => [],
            opening: () => Promise.resolve({ files }),
          })
          let context = condition.contexts?.[c.id] ?? condition.text
          let consultation = tree
            ? '\nBefore your final interpretation, consult ask_oracle at least once. Supply the original owner message and relevant context or uncertainty. Continue the returned conversation handle as useful; you are the real asker. This is a measured historical oracle tree, not contact with the live owner.'
            : oracle
            ? '\nYou may consult ask_owner in plain words about the owner and earlier context. ' +
              'Before your final interpretation, consult it at least once with the original message ' +
              'and any context or uncertainty you need it to interpret. This is a measured oracle condition, not contact with the live owner.'
            : ''
          session = await a.start(
            candidate(c, {
              ...condition,
              text: context + consultation,
              contexts: undefined,
            }),
            {
              model: modelId,
            },
          )
          await a.idle(session)
          transcript = await a.transcript(session)
          if (
            !finalCandidate(transcript) || calls.some((call) =>
              call.error ||
              !call.response
            )
          ) {
            error = 'Missing or failed model call'
          }
          if (tree && !tree.consulted()) {
            error = 'Required oracle tree consultation missing'
          }
          if (oracle && !oracle.evidence.queries.length) {
            error = 'Required oracle consultation missing'
          }
          if (
            calls.some((call) =>
              call.response && call.response.model != 'gpt-6.1-sol'
            )
          ) {
            error = 'Returned model differs from required gpt-6.1-sol'
          }
        } catch (e) {
          error = String(e)
        } finally {
          await a?.close()
          await host.close()
        }
        // Engine trace includes growth, routing, decline reviews and failures.
        // Append once, never wrap growth in a second totals recorder.
        if (tree) calls.push(...await tree.calls())
        if (calls.some((call) => call.error || !call.response)) {
          error ??= 'Missing or failed model call'
        }
        if (
          calls.some((call) =>
            call.response && call.response.model != 'gpt-6.1-sol'
          )
        ) {
          error = 'Returned model differs from required gpt-6.1-sol'
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
          mode: options.native
            ? 'full-native-opening-isolated-read-only'
            : 'initial-interpretation-no-tools',
          session,
          suppliedContext: files,
          calls,
          transcript,
          oracle: oracle?.evidence,
          oracleTree: tree?.evidence(),
          error,
          totals: totals(calls),
          wallMs: performance.now() - start,
        })
        await options.save({
          label: options.native
            ? 'Current native opening and tool schemas, isolated corpus graph reads; action/external handlers disabled; not whole-production-graph replay'
            : 'Restricted no-tool historical interpretation; not a full operational baseline',
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
  } finally {
    await oracleHost?.close()
    await authHost.close()
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
    native: args.includes('--native'),
    persona: args.includes('--persona') ? value('persona') : undefined,
    cwd: args.includes('--cwd') ? value('cwd') : Deno.cwd(),
    opening: args.includes('--opening')
      ? value('opening') as 'graph-only' | 'repo-current'
      : 'graph-only',
    save: (result) =>
      Deno.writeTextFile(out, JSON.stringify(result, null, 2) + '\n'),
  })
}
