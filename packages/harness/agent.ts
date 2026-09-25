// The harness is its agent runner: the rows every transcript is read from, the
// daemon over them, and the operations a caller needs — start a session, send
// it a message, list sessions, read one back. It runs wherever a graph does: on
// a box over a SQLite file (./local.ts), or on Cloudflare over D1 or a Durable
// Object's storage. So nothing here names a machine. What runs on one — the
// shell, a checkout per child, the instruction files on disk, the lock between
// two processes, where a defect is written — is lent by the host as an option,
// and a host that lends none of it still runs a transcript to the end.
//
// Everything in and out of here is a bundle or a query. Nothing writes SQL,
// nothing reads a table, and no state lives in this process that the graph does
// not already hold: which sessions are running is `.session.status=running`,
// what was written is `.entry.session=<s>`. The one thing it keeps in memory
// is the daemon's queue, which is a position in a queue rather than state.
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
  identityEid,
} from '@yaks/graph'
import type { Effects } from '@yaks/effects'
import type { Vocab } from '@yaks/vocab'
import { MODEL, type Model, PROVIDER, TOOL } from '@yaks/model'
import { toolEid } from '@yaks/tools'
import {
  admit,
  type ChildLimits,
  children,
  CONTENT,
  type Daemon,
  daemon,
  deliverChild,
  type Deps,
  ENTRY,
  live,
  type Step,
  taskEntry,
  type Tool,
  transcript,
  type TranscriptPage,
  transcriptUsage,
  type TranscriptWindow,
  transcriptWindow,
  views,
} from '@yaks/session'
import { outputView, promptEntry, type Snapshot } from '@yaks/context'
import { render } from '@yaks/text'
import {
  type ModelSelection,
  modelSelection,
  modelUsing,
  selectedUsing,
} from './model_selection.ts'
import { providerResolver } from './providers.ts'
import { type EntrySource, entrySource, type SourceRequest } from './detail.ts'
import { inheritedInstructions } from './legacy_instructions.ts'
import { type RuntimeAction, runtimeAction, runtimeRows } from './runtime.ts'

/** The model the harness uses when nothing names another. */
export let ASTRA = 'gpt-6-astra'

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** The provider, model and tool rows a transcript is served from, as one
 * idempotent batch written under `$alias`es: the graph derives every id from a
 * name, and the provider's offering of the model is a `serves` edge. */
export let seed = (
  o: { provider?: string; model?: string; tools?: Tool[] } = {},
): Bundle[] => {
  let model = o.model ?? ASTRA
  return [
    {
      entity: { eid: '$provider' },
      [PROVIDER]: { name: o.provider ?? 'openai' },
    },
    { entity: { eid: '$model' }, [MODEL]: { name: model } },
    {
      entity: { eid: '$serves' },
      edge: { from: '$provider', to: '$model' },
      serves: { name: model },
    },
    ...(o.tools ?? []).map((t, i) => ({
      entity: { eid: `$tool${i}` },
      [TOOL]: { name: t.name, description: t.description },
    })),
  ]
}

/** What an agent runs over: a graph, the effects its commits raise, and the
 * vocabulary it reads them with. */
export type Host = { g: Graph; fx: Effects; vocab: Vocab }

/** Where a defect happened: what was running, and in which transcript. */
export type Where = { phase: string; session?: Eid }

/** What a new session opens with: where it lives, and the instruction files
 * found there, each snapshotted into the transcript ahead of the first
 * message. */
export type Opening = { home?: Comp; files?: Snapshot[] }

/** How an agent is started: the graph it runs over, what serves it, what it
 * may do, and what its host lends it. */
export type Opts<H extends Host = Host> = ChildLimits & {
  h: H
  /** one model for every provider (a test's, an embedder's) */
  model?: Model
  /** implementations keyed by `provider.name` */
  providers?: Record<string, Model>
  /** the model to ask for by name (default `gpt-6-astra`) */
  name?: string
  /** Default provider for new sessions; model selection remains graph data. */
  provider?: string
  /** what the agent may call */
  tools?: Tool[]
  /** tools served from elsewhere, offered afresh to every ask */
  remote?: () => Promise<Tool[]>
  streaming?: boolean
  checkpointMs?: number
  /** The system prompt every ask carries. */
  instructions?: string
  /** Maximum tool-result code points before model-facing handle projection. */
  outputLimit?: number
  /** each step of every transcript, as it lands */
  each?: (step: Step) => void
  opening?: () => Promise<Opening>
  /** context an ask carries without storing its bytes in entries */
  context?: Deps['contextItems']
  /** one runtime per step when several open the same graph */
  lock?: (session: Eid) => (() => void) | undefined
  /** defects, apart from refusals (default `console.error`) */
  report?: (error: unknown, where: Where) => void
  /** what the host reconciles when the agent resumes */
  resuming?: () => Promise<void>
  /** what the host lets go of once every admitted operation has drained */
  release?: () => Promise<void> | void
}

/** A running agent. */
export type Agent<H extends Host = Host> = {
  h: H
  d: Daemon
  tools: Tool[]
  /** the model entity every new session is started under */
  model: Eid
  /** what to call a model or tool entity, for the views */
  names: Record<string, string>
  /** start a transcript with one instruction; the daemon takes it from there.
   * `by` is who wrote the instruction, where the caller knows. */
  start: (
    prompt: string,
    o?: { effort?: string; model?: Eid; by?: Eid },
  ) => Promise<Eid>
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
  /** every session, oldest first, each carrying its derived status */
  sessions: () => Promise<Bundle[]>
  /** open/wip tasks, filed or bare, oldest first */
  tasks: () => Promise<Bundle[]>
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
  /** wake every transcript a restart left mid-step */
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

// A handle can be minted long after birth; it is not a clock. Stable ties
// preserve the read order for rows written in the same millisecond.
let byBirth = (a: Bundle, b: Bundle) =>
  String((a.created as Comp)?.at ?? '').localeCompare(
    String((b.created as Comp)?.at ?? ''),
  )

/** How many transcripts — and how many tasks — the panels list. Naming a
 * transcript costs a read of its first line and mirroring one costs its whole
 * bundle, so the lists are the recent ones: a graph holding years of archive
 * (the fleet's 5,463 transcripts and 5,806 tasks landed in this one) would
 * otherwise be mirrored end to end on every refresh, and the panels time out
 * and paint nothing at all. A week of work is well inside this. */
export let LISTED = 200

/**
 * Put the daemon on a graph's entries, seeded with what serves it.
 *
 * ```ts
 * import { agent } from '@yaks/harness'
 *
 * let a = agent({ h: { g, fx, vocab }, model: fake })
 * let s = await a.start('reply with the word pong')
 * await a.idle(s)
 * ```
 */
export let agent = <H extends Host>(opts: Opts<H>): Agent<H> => {
  let h = opts.h
  let report = opts.report ??
    ((error: unknown, where: Where) => console.error(where.phase, error))
  const provider = opts.provider ?? 'openai'
  if (provider !== 'openai' && !opts.name) {
    throw new Error('Choose an explicit model name for a non-default provider')
  }
  let name = opts.name ?? ASTRA
  const implementations = {
    ...opts.model ? { [provider]: opts.model } : {},
    ...opts.providers,
  }
  let model = opts.model ?? implementations[provider]
  if (!model) throw new Error('Nothing serves provider ' + provider)
  const resolveModel = providerResolver(h.g, implementations, opts.model)
  let tools = opts.tools ?? []
  let remote = opts.remote ?? (() => Promise.resolve([]))
  let remoteSignature = ''
  // The remote tools each session's newest ask was offered. A tool is its
  // name, and a server reconfigured mid-ask serves that name from somewhere
  // else: the calls an ask issued run on the handlers it was offered.
  const offered = new Map<Eid, Tool[]>()
  h.g.apply(seed({ provider, model: name, tools }), { trusted: true })
  let d = daemon(
    h.g,
    h.fx,
    {
      model,
      resolveModel,
      tools,
      toolSnapshot: async (phase, session) => {
        const held = phase === 'call' && offered.get(session)
        if (held) return [...tools, ...held]
        const served = await remote()
        offered.set(session, served)
        const all = [...tools, ...served]
        if (
          new Set(all.map((t) => t.name)).size !== all.length
        ) throw new Error('Duplicate local/MCP tool name')
        const signature = JSON.stringify(
          served.map((t) => [t.name, t.description, t.parameters]),
        )
        if (signature !== remoteSignature) {
          await h.g.apply(seed({ provider, model: name, tools: served }), {
            trusted: true,
          })
          remoteSignature = signature
        }
        return all
      },
      streaming: opts.streaming,
      checkpointMs: opts.checkpointMs,
      instructions: opts.instructions,
      resolveInstructions: (inherited) =>
        inheritedInstructions(inherited, opts.instructions),
      contextItems: opts.context,
      resultText: tools.some((t) => t.name == 'graph_value_read')
        ? (entry) => outputView(h.g, entry, opts.outputLimit)
        : undefined,
      report: (error, session, phase) => report(error, { session, phase }),
    },
    opts.each,
    (error, session) => report(error, { phase: 'daemon', session }),
    opts.lock,
  )

  let using = {
    provider: identityEid(PROVIDER, [provider]),
    model: identityEid(MODEL, [name]),
  }
  let names: Record<string, string> = {
    [using.model]: name,
    ...Object.fromEntries(tools.map((t) => [toolEid(t.name), t.name])),
  }
  // What attributes a write made here: the transcript it is about, and who
  // wrote it where the caller said. The harness runs for whoever is at the
  // keyboard and holds no entity for them, so otherwise the instrument is
  // recorded and the actor is left unset rather than guessed; a model turn
  // attributes itself (@yaks/session react.ts).
  let through = (session: Eid, by?: Eid) => ({
    ...by ? { by } : {},
    via: session,
  })

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

  let a: Agent<H> = {
    h,
    d,
    tools,
    names,
    model: using.model,
    admitted,
    models: (session) => modelSelection(h.g, session, using),
    selectModel: async (session, model) => {
      const [owner] = await h.g.storage.tx((tx) => tx.get([session]))
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
      o: { effort?: string; model?: Eid; by?: Eid } = {},
    ) =>
      admit(h.g, undefined, opts, async () => {
        const chosen = o.model
          ? await modelUsing(h.g, o.model, implementations)
          : {}
        let { home, files = [] } = await opts.opening?.() ?? {}
        let session = crypto.randomUUID() as Eid
        let context = files.map((f, i) =>
          promptEntry(session, i + 1, f.body, f.source, 'shared', f.revision)
        )
        await h.g.apply([
          ...context,
          {
            entity: { eid: session },
            session: { id: session.slice(0, 8) },
            ...home ? { home } : {},
            $actor: through(session, o.by),
          },
          {
            entity: { eid: crypto.randomUUID() as Eid },
            [ENTRY]: { session, seq: context.length + 1 },
            [CONTENT]: { body: prompt },
            using: {
              ...using,
              ...chosen,
              ...o.effort ? { effort: o.effort } : {},
            },
          },
        ])
        return session
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
    sessions: admitted(async () =>
      Promise.all(
        (await h.g.read('.session&*')).toSorted(byBirth).slice(-LISTED).map(
          async (b) => ({
            ...b,
            session: {
              ...b.session as Comp,
              title: await sessionTitle(h.g, b),
            },
          }),
        ),
      )
    ),
    runtime: (session) => runtimeRows(h.g, session),
    control: (session, action) => runtimeAction(a, session, action),
    children: admitted((session: Eid) => children(h.g, session)),
    tasks: admitted(async () =>
      (await h.g.read('.task.status=open,wip&*')).toSorted(byBirth)
        .slice(-LISTED)
    ),
    entrySource: (session, eid, request) =>
      entrySource(h.g, session, eid, request),
    transcript: admitted((session: Eid) => transcript(h.g, session)),
    usage: (session) => transcriptUsage(h.g, session),
    transcriptWindow: (session, request) =>
      transcriptWindow(h.g, session, request),
    resume: admitted(async () => {
      let woken = (await h.g.read(live)).map((b) => b.entity.eid)
      // Reconcile receipts lost between a child commit and its effect.
      for (
        let b of await h.g.read(
          '.spawned .session.status=settled,failed,stopped',
        )
      ) {
        // Reconcile delivery without scheduling another execution of a
        // finished child. The daemon tracks this work for shutdown draining.
        let parent = String((b.spawned as Comp).parent)
        d.enqueue(parent, () => deliverChild(h.g, b.entity.eid)).catch(
          (error) =>
            report(error, { phase: 'resume-receipt', session: parent }),
        )
      }
      await opts.resuming?.()
      for (let s of woken) d.wake(s)
      return woken
    }),
    idle: admitted((session: Eid) => d.idle(session)),
    line: (b, view = 'Line', ctx = {}) =>
      render(views, b, view, h.vocab, {
        names,
        anchor: model.anchor,
        ...ctx,
      }, 'plain'),
    instruct: admitted((session: Eid, text: string, source = 'explicit') =>
      d.enqueue(session, async () => {
        let entry = promptEntry(session, undefined, text, source, 'local')
        await h.g.apply([entry])
        return entry.entity.eid
      })
    ),
    close: (reason) =>
      shutdown ??= (async () => {
        refusal ??= reason ?? new Error('Agent is closing')
        let drained = d.stop()
        await Promise.allSettled([...operations])
        await drained
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
    const [assignment] = await g.storage.tx((tx) =>
      tx.get([session.entity.eid + ':input'])
    )
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
