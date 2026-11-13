import { after } from '@yaks/fp'
import { edgeEid } from '@yaks/edge'
import { inputText, senders } from './input_text.ts'
import { dispatchStatus } from '@yaks/session/admission'
// The harness is its agent: the rows every transcript is read from, the runner
// it lends them (@yaks/session run.ts), and the operations a caller needs —
// start a session, send it a message, list sessions, read one back. It runs
// wherever a graph does: on a box over a SQLite file (./local.ts), or on
// Cloudflare over D1 or a Durable Object's storage. So nothing here names a
// machine. What runs on one — the shell, a checkout per child, the instruction
// files on disk, where a defect is written — is lent by the host as an option,
// and a host that lends none of it still runs a transcript to the end.
//
// Everything in and out of here is a bundle or a query. Nothing writes SQL,
// nothing reads a table, and no state lives in this process that the graph does
// not already hold: which sessions are running is `.session.status=running`,
// what was written is `.entry.session=<s>`. The one thing kept in memory is
// which transcripts this process is running, and that is the runner's.
//
// Seeding is idempotent because the ids are derived from the names — the
// vocabulary declares `name` the identity of a provider, a model and a tool,
// and a provider's offering of a model is a `serves` edge, whose id is derived
// from its two ends — so a second startup patches the rows the first one wrote
// instead of creating a second set. That is what makes `using{model}` on an
// entry mean the same thing across restarts.

import {
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  unheld,
} from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import type { Effects } from '@yaks/effects'
import type { Vocab } from '@yaks/vocab'
import { MODEL, type Model, ModelError, PROVIDER, TOOL } from '@yaks/model'
import { resultTool } from './results.ts'
import { valueTools } from '@yaks/blob'
import { toolEid } from '@yaks/tools/result'
import {
  actorOf,
  admit,
  answer,
  answering,
  answers,
  type ChildLimits,
  children,
  CONTENT,
  currentStatus,
  type Deps,
  ENTRY,
  humanCaller,
  live,
  passing,
  providerResolver,
  type Runner,
  running,
  sessionViews,
  type Step,
  taskEntry,
  type Tool,
  transcript,
  type TranscriptPage,
  transcriptUsage,
  type TranscriptWindow,
  transcriptWindow,
  usingOf,
} from '@yaks/session'
import { outputView, promptEntry, type Snapshot } from '@yaks/context'
import { lineage } from '@yaks/project'
import { render } from '@yaks/text'
import { defaultUsing } from './default.ts'
import {
  type ModelSelection,
  modelSelection,
  modelUsing,
  selectedUsing,
} from './model_selection.ts'
import { type EntrySource, entrySource, type SourceRequest } from './detail.ts'
import { inheritedInstructions } from './legacy_instructions.ts'
import { offeredTo, type Wear, wornBy } from './worn.ts'
import { PART } from '@yaks/persona'
import { type RuntimeAction, runtimeAction, runtimeRows } from './runtime.ts'

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** The provider, model and tool rows a transcript is served from, as one
 * idempotent batch with identities derived from each name, and the provider's
 * offering of the model is a `serves` edge. */
export let seed = (
  o: { provider?: string; model?: string; tools?: Tool[] } = {},
): Bundle[] => {
  let provider = o.provider ? identityEid(PROVIDER, [o.provider]) : ''
  let model = o.model ? identityEid(MODEL, [o.model]) : ''
  return [
    ...provider
      ? [{ entity: { eid: provider }, [PROVIDER]: { name: o.provider } }]
      : [],
    ...model ? [{ entity: { eid: model }, [MODEL]: { name: o.model } }] : [],
    ...provider && model
      ? [{
        entity: { eid: edgeEid(provider, 'serves', model) },
        edge: { from: provider, to: model },
        serves: { name: o.model },
      }]
      : [],
    ...(o.tools ?? []).map((t) => ({
      entity: { eid: toolEid(t.name) },
      [TOOL]: {
        name: t.name,
        ...t.title ? { title: t.title } : {},
        ...t.step ? { step: t.step } : {},
        description: t.description,
      },
    })),
  ]
}

// Reopening a harness must not rewrite its unchanged provider/tool catalogue.
// Compare only the properties the seed owns; discovery may enrich these rows.
let seedMissing = (g: Graph, rows: Bundle[]) =>
  after(
    g.get(rows.map((b) => b.entity.eid), [
      PROVIDER,
      MODEL,
      TOOL,
      'edge',
      'serves',
    ]),
    (held) => {
      let changed = unheld(held, rows)
      return changed.length ? g.apply(changed, { trusted: true }) : []
    },
  )

/** What an agent runs over: a graph, the effects its commits raise, the
 * vocabulary it reads them with, the process working it, which a run's lease
 * names as its holder, and, where the host can tell, whether another holder is
 * over, so a run it held is taken over now rather than at its expiry. */
export type Host = {
  g: Graph
  fx: Effects
  vocab: Vocab
  me: Eid
  gone?: (holder: Eid) => boolean | Promise<boolean>
}

/** Where a defect happened: what was running, and in which transcript. */
export type Where = { phase: string; session?: Eid }

/** What a new session opens with: where it lives, the instruction files
 * found there, each snapshotted into the transcript ahead of the first
 * message, the persona it wears and the topic it is opened on (@yaks/topic's
 * `session.topic`). */
export type Opening = {
  home?: Comp
  files?: Snapshot[]
  persona?: Eid
  topic?: Eid
}

/** How an agent is started: the graph it runs over, what serves it, what it
 * may do, and what its host lends it. */
export type Opts<H extends Host = Host> = ChildLimits & {
  h: H
  /** one model for every provider (a test's, an embedder's) */
  model?: Model
  /** implementations keyed by `provider.name` */
  providers?: Record<string, Model>
  /** the model to ask for by name (otherwise the graph's `defaultUsing`) */
  name?: string
  /** the provider to ask, by name, and the one `model` serves */
  provider?: string
  /** what the agent may call */
  tools?: Tool[]
  /** tools served from elsewhere, offered afresh to every ask of the
   * transcript named */
  remote?: (session: Eid) => Promise<Tool[]>
  /** tools offered only to a transcript whose `sending.tools` names them
   * (@yaks/session `Deps.named`) */
  named?: () => Tool[]
  streaming?: boolean
  checkpointMs?: number
  /** each piece of a streamed reply, once it is stored (@yaks/session
   * `Deps.typed`) */
  typed?: (session: Eid, text: string) => void
  /** The system prompt every ask carries, or what reads each transcript's:
   * read again for every ask, so what it reads (a name, the apps in reach)
   * is current in a transcript that runs for weeks. */
  instructions?: string | ((session: Eid) => Promise<string>)
  /** Wear each transcript's persona on every ask (`session.persona`, or that
   * of the session that started it): its text (@yaks/persona `voice`) leads
   * the system prompt and `instructions` follows it, both read again for
   * every ask, so an edit to the persona reaches a transcript on its next
   * turn. `bases` is where a persona's base (`persona.base`) is kept when this
   * graph does not keep it, and `topic` says the tree of the topic the
   * transcript is opened on (`session.topic`) after the persona. A transcript
   * that wears nothing keeps the instructions it was given. `tools` offers
   * each ask exactly the registered tools that persona contains, as it
   * contains them then, where no line of the transcript selected its own
   * (`sending.tools`); a persona containing none leaves the runner's set. */
  wear?: Wear
  /** Maximum tool-result UTF-8 bytes before model-facing handle projection. */
  outputLimit?: number
  /** A multi-user host supplies its scoped result storage at the same model boundary. */
  resultText?: Deps['resultText']
  /** the share of its model's context window a transcript fills before it is
   * compacted, for every model (@yaks/session `Deps.compactAt`) */
  compactAt?: number
  /** each step of every transcript, as it lands */
  each?: (step: Step, session?: string) => void | Promise<void>
  opening?: (persona?: Eid, session?: Eid) => Promise<Opening>
  /** context an ask carries without storing its bytes in entries */
  context?: Deps['contextItems']
  /** Dynamic context independent of source-bound image items. */
  inputSource?: (entry: Bundle) => string | undefined
  requestItems?: Deps['requestItems']
  /** defects, apart from refusals (default `console.error`) */
  report?: (error: unknown, where: Where) => void
  /** each refusal a tool call met, apart from defects (@yaks/session
   * `Deps.refused`) */
  refused?: Deps['refused']
  /** what the host reconciles when the agent resumes */
  resuming?: () => Promise<void>
  /** what the host lets go of once every admitted operation has drained */
  release?: () => Promise<void> | void
  /** how long a transcript's lease stands between renewals, so how long a
   * process that died running it holds it up (ms; default @yaks/effects') */
  hold?: number
  /** how long a background call runs before the model may take a turn while
   * it runs (ms; default @yaks/session `PATIENCE`) */
  patience?: number
}

/** A running agent. */
export type Agent<H extends Host = Host> = {
  h: H
  tools: Tool[]
  /** the model entity every new session is started under */
  model: Eid
  /** what to call a model or tool entity, for the views */
  names: Record<string, string>
  /** start a transcript with one instruction; the runner takes it from there.
   * `by` is who wrote the instruction, where the caller knows. */
  start: (
    prompt: string,
    o?: { effort?: string; model?: Eid; persona?: Eid; by?: Eid },
  ) => Promise<Eid>
  /** personas this graph offers for a new session */
  personas: () => Promise<Bundle[]>
  /** the configured models, and what this session asks for next */
  models: (session?: Eid) => Promise<ModelSelection>
  /** record a passive model choice; the next request honours it */
  selectModel: (session: Eid, model: Eid) => Promise<void>
  /** say something more to a transcript that is already going, as `by` where
   * the caller knows who wrote it */
  send: (session: Eid, text: string, by?: Eid) => Promise<Eid>
  /** mint and delegate unfiled work under an existing session */
  taskEntry: (session: Eid, text: string) => Promise<{ task: Eid; child: Eid }>
  archive: (session: Eid, archived: boolean) => Promise<void>
  /** selected session or a bounded, cursor-paged list */
  sessions: (selected?: Eid, page?: ListPage) => Promise<Bundle[]>
  /** A bounded page of open/wip tasks, requested explicitly. */
  tasks: (page?: ListPage) => Promise<Bundle[]>
  /** direct delegated sessions, including forks */
  children: (session: Eid) => Promise<Bundle[]>
  /** one transcript's entries, in order */
  transcript: (session: Eid) => Promise<Bundle[]>
  transcriptWindow: (
    session: Eid,
    request?: TranscriptWindow,
  ) => Promise<TranscriptPage>
  entrySource: (
    session: Eid,
    eid: Eid,
    request?: SourceRequest,
  ) => Promise<EntrySource>
  usage: (session: Eid) => Promise<Bundle[]>
  /** run every transcript left owed a turn that nothing wrote a run for, and
   * answer which they were */
  resume: () => Promise<Eid[]>
  /** wait for a transcript to run out of things to do */
  idle: (session: Eid) => Promise<void>
  /** one bundle as a line of text, through @yaks/render's session views */
  line: (b: Bundle, view?: string, ctx?: Record<string, unknown>) => string
  /** Explicit instruction admission; appends a snapshot, never a user turn. */
  instruct: (session: Eid, text: string, source?: string) => Promise<Eid>
  runtime: (session: Eid) => Promise<Bundle[]>
  control: (session: Eid, action: RuntimeAction) => Promise<string>
  /** an operation the host adds, admitted like these: refused once the agent
   * is closing, and drained before the host lets go of anything */
  admitted: <A extends unknown[], T>(
    work: (...args: A) => Promise<T>,
  ) => (...args: A) => Promise<T>
  /** stop admitting, drain, and release; `reason` is what later calls get */
  close: (reason?: Error) => Promise<void>
}

/** A page of sidebar rows. A selected session only queries its direct children. */
export type ListPage = { after?: string | number; limit?: number }
export let LISTED = 20
let page = (query: string, options: ListPage = {}) =>
  query +
  `&.order=-created.at&.limit=${
    Math.min(LISTED, Math.max(1, options.limit ?? LISTED))
  }` +
  (options.after == null ? '' : `&.after=${options.after}`) + '&*'

// What attributes a write made here: the transcript it is about, and who
// wrote it where the caller said. The terminal says who is at its keyboard,
// the config's `person` (./backend_worker.ts); where nobody says, the
// instrument is recorded and the actor is left unset rather than guessed; a
// model turn attributes itself (@yaks/session react.ts).
export let through = (session: Eid, by?: Eid) => ({
  ...by ? { by } : {},
  via: session,
})

/** A new transcript, as one write: the session and its instruction files,
 * followed by a message that asks for a turn when one was given. An empty
 * session holds its model choice until that first message arrives. The
 * session and the message are whoever began it; the instruction files are the
 * harness's own, put in front of the model, and never that person's words. */
export let begin = async (
  g: Graph,
  prompt: string | undefined,
  o: Opening & {
    using: Comp
    eid?: Eid
    by?: Eid
    via?: Eid
    project?: Eid
    work?: Eid
    title?: string
  },
): Promise<Eid> => {
  let operator = await humanCaller(g, { by: o.by, via: o.via })
  // A session wearing no persona works as the session that started it does
  // (@yaks/session `actorOf`), so what it writes still names an actor.
  let actor = !o.persona && o.via ? await actorOf(g, o.via) : undefined
  let project = o.project ??
    (o.work
      ? (await lineage(g, o.work)).find((b) => b.project)?.entity.eid
      : undefined)
  let session = o.eid ?? crypto.randomUUID() as Eid
  let files = (o.files ?? []).map((f, i) => ({
    ...promptEntry(session, i + 1, f.body, f.source, 'shared', f.revision),
    $actor: through(session),
  }))
  let context = [
    ...files,
    ...prompt
      ? [{
        entity: { eid: crypto.randomUUID() as Eid },
        [ENTRY]: { session, seq: files.length + 1 },
        [CONTENT]: { body: prompt },
        using: o.using,
        $actor: through(session, o.by),
      }]
      : [],
  ]
  await g.apply([
    {
      entity: { eid: session },
      session: {
        id: session.slice(0, 8),
        operator,
        ...o.persona ? { persona: o.persona } : {},
        ...actor ? { actor } : {},
        ...o.topic ? { topic: o.topic } : {},
      },
      native: {},
      ...o.home ? { home: o.home } : {},
      ...project ? { filed: { project } } : {},
      ...o.title ? { doc: { title: o.title } } : {},
      ...prompt ? {} : { using: o.using },
      $actor: through(session, o.by),
    },
    ...context,
  ])
  return session
}

// The defects an agent reports, where its options name nowhere else.
let reporter = (opts: { report?: (error: unknown, where: Where) => void }) =>
  opts.report ??
    ((error: unknown, where: Where) => console.error(where.phase, error))

// What serves each provider, by `provider.name`.
let served = (opts: Pick<Opts, 'model' | 'providers' | 'provider'>) => ({
  ...opts.model && opts.provider ? { [opts.provider]: opts.model } : {},
  ...opts.providers,
})

// The runner's model where nothing resolves one: a host lent no model asks
// through `resolveModel` alone.
let unserved: Model = () =>
  Promise.reject(new ModelError('provider', 'Choose a model'))

/**
 * The runner an agent's options lend (@yaks/session `Runner`), over the
 * provider, model and tool rows its first step seeds: what serves each
 * provider, what a transcript may call, and how a step is taken. A host registers it with
 * @yaks/session `running` wherever its effects are worked.
 *
 * ```ts
 * import { lend } from '@yaks/harness'
 * import { running } from '@yaks/session'
 *
 * // h.fx.handle(running(h.g, lend({ h, model })))
 * ```
 */
export let lend = <H extends Host>(opts: Opts<H>): Runner => {
  let h = opts.h
  let report = reporter(opts)
  const provider = opts.provider
  let name = opts.name ?? ''
  const implementations = served(opts)
  let model = opts.model ?? implementations[provider ?? ''] ?? unserved
  let tools = opts.resultText ? opts.tools ?? [] : [
    ...opts.tools ?? [],
    ...[resultTool(h.g), ...valueTools(async (id) => (await h.g.get([id]))[0])]
      .filter((t) => !opts.tools?.some((own) => own.name == t.name)),
  ]
  let remote = opts.remote ?? (() => Promise.resolve([]))
  let remoteSignature = ''
  // The remote tools each session's newest ask was offered. A tool is its
  // name, and a server reconfigured mid-ask serves that name from somewhere
  // else: the calls an ask issued run on the handlers it was offered.
  const offered = new Map<Eid, Tool[]>()
  const offerSessions = new Map<Eid, Eid>()
  // Seeded by the first step, not when lent: a host lends the runner while it
  // is being put together, before anything may be written in its name.
  let seeded: unknown
  let {
    taskDefaults,
    maxChildren,
    maxSessions,
    childProperties,
    prepareChild,
  } = opts
  let resolveModel = providerResolver(
    h.g,
    implementations,
    opts.model,
    undefined,
    (error) => report(error, { phase: 'model-metadata' }),
  )
  // Compaction is a text task, even when a transcript selects a media model:
  // it asks the model this agent was lent by name, else the default
  // (./default.ts), read again before every ask.
  let compact: NonNullable<Deps['compactModel']> = {
    model,
    name,
    ...provider ? { provider: identityEid(PROVIDER, [provider]) } : {},
  }
  return {
    holder: h.me,
    asyncTools: true,
    ...opts.patience == null ? {} : { patience: opts.patience },
    gone: h.gone,
    taskDefaults,
    maxChildren,
    maxSessions,
    childProperties,
    prepareChild,
    model,
    resolveModel,
    compactModel: compact,
    answers: answers(h.g, implementations, opts.model),
    tools,
    named: opts.named,
    toolSnapshot: async (phase, session, boundary, open) => {
      if (!name) {
        let using = await defaultUsing(h.g)
        let [row] = await h.g.get([String(using.model)])
        Object.assign(
          compact,
          { provider: undefined },
          await resolveModel(using, row),
        )
      }
      await (seeded ??= seedMissing(
        h.g,
        seed({ provider, model: name, tools }),
      ))
      const key = boundary ?? session
      const held = phase === 'call' && offered.get(key)
      if (held) return [...tools, ...held]
      const served = await remote(session)
      const all = [...tools, ...served]
      const twice = [
        ...new Set(
          all.map((t) => t.name).filter((n, i, names) => names.indexOf(n) != i),
        ),
      ]
      if (twice.length) {
        throw new Error(`Two tools share a name: ${twice.join(', ')}`)
      }
      // Several asks may overlap older calls. Keep each original offer until
      // all of its calls have final results; a later catalogue refresh must
      // not redirect an in-progress call to a newly configured MCP server.
      if (phase === 'ask' && offered.size) {
        const asks = await h.g.get(
          open.flatMap((b) => {
            const source = (b.call as Comp)?.source
            return source == null ? [] : [String(source)]
          }),
          ['ask'],
        )
        const outstanding = new Set(
          asks.flatMap((ask) => {
            const through = (ask.ask as Comp | undefined)?.through
            return through == null ? [] : [String(through)]
          }),
        )
        for (const old of offered.keys()) {
          if (
            old != key && offerSessions.get(old) == session &&
            !outstanding.has(old)
          ) {
            offered.delete(old)
            offerSessions.delete(old)
          }
        }
      }
      offered.set(key, served)
      offerSessions.set(key, session)
      const signature = JSON.stringify(
        served.map((t) => [t.name, t.description, t.parameters]),
      )
      if (signature !== remoteSignature) {
        await seedMissing(h.g, seed({ provider, model: name, tools: served }))
        remoteSignature = signature
      }
      return all
    },
    streaming: opts.streaming,
    checkpointMs: opts.checkpointMs,
    typed: opts.typed,
    compactAt: opts.compactAt,
    instructions: typeof opts.instructions == 'string'
      ? opts.instructions
      : undefined,
    resolveInstructions: async (inherited, session) => {
      if (!opts.wear) {
        return typeof opts.instructions == 'function'
          ? await opts.instructions(session)
          : inheritedInstructions(inherited, opts.instructions)
      }
      // What was sent before already says the persona, so only what the host
      // adds follows the persona's text as it reads now, a part of its own.
      // The two are read at once.
      let reads = typeof opts.instructions == 'function'
        ? opts.instructions
        : undefined
      let [worn, added] = await Promise.all([
        wornBy(h.g, session, opts.wear),
        reads ? reads(session) : opts.instructions as string | undefined,
      ])
      // A transcript wearing nothing is told what it was told before: the
      // instructions its first line chose (a builder's contract) stand.
      if (!worn && !reads) return inheritedInstructions(inherited, added)
      return [worn, added].filter(Boolean).join(PART) || undefined
    },
    ...opts.wear?.tools
      ? { resolveTools: (session) => offeredTo(h.g, session, opts.wear) }
      : {},
    inputText: async (transcript) =>
      inputText(transcript, await senders(h.g, transcript), opts.inputSource),
    contextItems: opts.context,
    requestItems: opts.requestItems,
    resultText: opts.resultText ??
      ((entry) => outputView(h.g, entry, opts.outputLimit)),
    report: (error, session, phase) => report(error, { session, phase }),
    ...opts.refused ? { refused: opts.refused } : {},
    each: opts.each,
    hold: opts.hold,
  }
}

/**
 * Lend a graph the runner and work its pool, seeded with what serves it.
 *
 * ```ts ignore
 * import { agent } from '@yaks/harness'
 *
 * let a = agent({ h: { g, fx, vocab, me }, model: fake })
 * let s = await a.start('reply with the word pong')
 * await a.idle(s)
 * ```
 */
export let agent = <H extends Host>(opts: Opts<H>): Agent<H> => {
  let h = opts.h
  let report = reporter(opts)
  const provider = opts.provider
  let name = opts.name ?? ''
  const implementations = served(opts)
  let tools = opts.tools ?? []
  // The runner, taking every run this graph's commits owe it, until the agent
  // closes: then no step starts, a waiting tool stops waiting, and the step in
  // flight is let finish.
  let stopping = new AbortController()
  let r: Runner = { ...lend(opts), stopping: stopping.signal }
  seedMissing(h.g, seed({ provider, model: name, tools }))
  h.fx.handle(running(h.g, r))
  let working = h.fx.work(h.g, stopping.signal).catch((error) =>
    report(error, { phase: 'effects' })
  )

  // What this agent was lent by name; the default stands in for no model.
  let using: { provider?: Eid; model?: Eid } = {
    ...provider ? { provider: identityEid(PROVIDER, [provider]) } : {},
    ...name ? { model: identityEid(MODEL, [name]) } : {},
  }
  let names: Record<string, string> = {
    ...using.model ? { [using.model]: name } : {},
    ...Object.fromEntries(tools.map((t) => [toolEid(t.name), t.name])),
  }
  // Lifecycle bookkeeping only; all application state remains in the graph.
  let refusal: Error | undefined
  let shutdown: Promise<void> | undefined
  let operations = new Set<Promise<unknown>>()
  let admitted =
    <A extends unknown[], T>(work: (...args: A) => Promise<T>) =>
    (...args: A): Promise<T> => {
      if (refusal) return Promise.reject(refusal)
      let pending = work(...args)
      operations.add(pending)
      let done = () => operations.delete(pending)
      pending.then(done, done)
      return pending
    }

  // The request in force on a transcript: what a line said to it asks a turn
  // with, since a turn is asked for by a `using` on an entry.
  let asking = async (session: Eid) => {
    let using = await usingOf(h.g, session) ??
      await selectedUsing(h.g, session)
    return using ? { using } : {}
  }
  // Whether a transcript has nothing more to do that this agent is doing or
  // owes: no pass of its own over it, nothing waiting for a place, and no turn
  // it answers outstanding.
  let quiet = async (session: Eid) => {
    if (passing(h.g, session)) return false
    let [self] = await h.g.get([session], [
      'dispatch',
      'waiting',
      'admitted',
    ])
    if (dispatchStatus(self) == 'queued') return false
    let status = await currentStatus(h.g, session)
    if (status != 'pending' && status != 'running') return true
    return !await answering(h.g, session, r)
  }

  let a: Agent<H> = {
    h,
    tools,
    names,
    get model() {
      return String(using.model ?? '')
    },
    admitted,
    personas: async () =>
      (await h.g.read('.persona')).sort((a, b) =>
        String((a.doc as Comp | undefined)?.title ?? '').localeCompare(
          String((b.doc as Comp | undefined)?.title ?? ''),
        )
      ),
    models: async (session) =>
      modelSelection(
        h.g,
        session,
        using.model ? using : await defaultUsing(h.g),
      ),
    selectModel: async (session, model) => {
      const [owner] = await h.g.get([session])
      if (!owner?.session) throw new Error('Unknown session')
      const chosen = await modelUsing(h.g, model, implementations)
      const prior = await selectedUsing(h.g, session)
      await h.g.apply([{
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        notice: {},
        using: { ...using, ...prior, ...chosen },
        $actor: through(session),
      }])
    },
    start: admitted((
      prompt: string,
      o: { effort?: string; model?: Eid; persona?: Eid; by?: Eid } = {},
    ) =>
      admit(h.g, undefined, opts, async () => {
        const chosen = o.model
          ? await modelUsing(h.g, o.model, implementations)
          : using.model
          ? {}
          : await defaultUsing(h.g)
        let eid = crypto.randomUUID()
        return begin(h.g, prompt, {
          eid,
          ...await opts.opening?.(o.persona, eid),
          ...o.persona ? { persona: o.persona } : {},
          by: o.by,
          using: {
            ...using,
            ...chosen,
            ...o.effort ? { effort: o.effort } : {},
          },
        })
      })
    ),
    send: admitted(async (session: Eid, text: string, by?: Eid) => {
      // Admission is independent of the provider/tool execution queue. The
      // session plugin assigns seq inside this write's transaction.
      let eid = crypto.randomUUID() as Eid
      await h.g.apply([{
        entity: { eid },
        [ENTRY]: { session },
        [CONTENT]: { body: text },
        ...await asking(session),
        $actor: through(session, by),
      }])
      return eid
    }),
    taskEntry: admitted((session: Eid, text: string) =>
      taskEntry(h.g, session, text, opts)
    ),
    archive: admitted(async (session: Eid, archived: boolean) => {
      let rows = await h.g.read('.session')
      if (!rows.some((b) => b.entity.eid == session)) {
        throw new Error('Unknown session')
      }
      // The mark is written bare: when it happened, and through what, are the
      // graph's to stamp (@yaks/graph stamp.ts), never this clock's.
      await h.g.apply([{
        entity: { eid: session },
        archived: archived ? {} : null,
        $actor: through(session),
      }])
    }),
    sessions: admitted(async (selected?: Eid, options?: ListPage) => {
      let rows = options || !selected
        ? await h.g.read(page('.session', options))
        : [
          ...(await h.g.get([selected])).filter((b) => b.session),
          // The closed browser is a selected-session tree, not an archive page.
          // Include direct children even before they start (spawned.call may be
          // null), without scanning or titling every historical session.
          ...await h.g.read('.session&.spawned.parent=' + selected + '&*'),
        ]
      // A selected session need not belong to the current page.
      if (selected && !rows.some((b) => b.entity.eid == selected)) {
        rows = [
          ...(await h.g.get([selected])).filter((b) => b.session),
          ...rows,
        ]
      }
      return await Promise.all(rows.map(async (b) => ({
        ...b,
        session: { ...b.session as Comp, title: await sessionTitle(h.g, b) },
      })))
    }),
    runtime: (session) => runtimeRows(h.g, session),
    control: (session, action) => runtimeAction(a, session, action),
    children: admitted((session: Eid) => children(h.g, session)),
    tasks: admitted(async (options?: ListPage) =>
      await h.g.read(page('.task.status=open,wip', options))
    ),
    entrySource: (session, eid, request) =>
      entrySource(h.g, session, eid, request),
    transcript: admitted((session: Eid) => transcript(h.g, session)),
    usage: (session) => transcriptUsage(h.g, session),
    transcriptWindow: (session, request) =>
      transcriptWindow(h.g, session, request),
    resume: admitted(async () => {
      // A child stays active until its receipt lands. Waking that dispatch
      // retries an interrupted delivery without revisiting finished children.
      let woken = [
        ...new Set((await h.g.read(
          `${live}|.session&.dispatch.status=active,queued,waiting`,
        )).map((b) => b.entity.eid)),
      ]
      await opts.resuming?.()
      for (let s of woken) {
        answer(h.g, s, r).catch((error) =>
          report(error, { phase: 'resume', session: s })
        )
      }
      return woken
    }),
    idle: admitted(async (session: Eid) => {
      while (!stopping.signal.aborted && !await quiet(session)) {
        await (passing(h.g, session)?.catch(() => {}) ??
          new Promise((go) => setTimeout(go, 10)))
      }
    }),
    line: (b, view = 'Line', ctx = {}) =>
      render(sessionViews, b, view, h.vocab, {
        names,
        anchor: r.model.anchor,
        ...ctx,
      }, 'plain'),
    instruct: admitted(
      async (session: Eid, text: string, source = 'explicit') => {
        let entry = promptEntry(session, undefined, text, source, 'local')
        await h.g.apply([{ ...entry, ...await asking(session) }])
        return entry.entity.eid
      },
    ),
    // Admission stops, the runner takes no new step and leaves the pool, and
    // what was admitted and the step in flight drain before the host lets go.
    close: (reason) =>
      shutdown ??= (async () => {
        refusal ??= reason ?? new Error('Agent is closing')
        stopping.abort()
        await Promise.allSettled([...operations])
        await h.fx.stop()
        await working
        await opts.release?.()
      })(),
  }
  return a
}

/** Child assignment is explicit admission data; copied fork context is not its title. */
export let sessionTitle = async (
  g: Graph,
  session: Bundle,
): Promise<string> => {
  if (session.spawned) {
    const [assignment] = await g.get([session.entity.eid + ':input'])
    if (assignment?.content) return titleOf([assignment])
  }
  return titleOf(
    await g.read(
      '.entry.session=' + session.entity.eid +
        '&.content&!prompt&!notice&.order=entry.seq&.limit=1',
    ),
  )
}

/** What a transcript is called in a listing: the first message sent to it. */
export let titleOf = (entries: Bundle[]): string =>
  String(
    comp(
      entries.find((b) => CONTENT in b && !b.prompt && !b.notice) ??
        {} as Bundle,
      CONTENT,
    )
      ?.body ?? '',
  )
    .split('\n')[0].slice(0, 60)
