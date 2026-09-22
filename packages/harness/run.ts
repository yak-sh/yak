import {
  type ModelSelection,
  modelSelection,
  modelUsing,
  selectedUsing,
} from './model_selection.ts'
import { responses as openrouter } from '@yaks/openrouter'
import { OPENROUTER_AUTH, providerAuthorization } from './provider_auth.ts'
import { providerResolver } from './providers.ts'
import type { MCPAuthAction, MCPAuthReply } from './mcp_auth.ts'
import { type EntrySource, entrySource, type SourceRequest } from './detail.ts'
import { mcpTools } from './mcp.ts'
import { watchMigrations } from '@yaks/sqlite'
import { inheritedInstructions } from './legacy_instructions.ts'
import { stepLock } from './step_lock.ts'
import { type RuntimeAction, runtimeAction, runtimeRows } from './runtime.ts'
import {
  type TranscriptPage,
  transcriptUsage,
  type TranscriptWindow,
  transcriptWindow,
} from '@yaks/session'
import { streamingEnabled } from './streaming.ts'
import { imageContext } from './artifact_tools.ts'
import { configuredImages, type ImageOptions, readImage } from './images.ts'
import { outputView } from '@yaks/context'
import { diagnostics } from './diagnostics.ts'
import { promptEntry } from '@yaks/context'
import { instructionFiles } from '@yaks/context/host'
import { homeAt, workspace } from './workspace.ts'
import { worktrees } from './paths.ts'
import { collecting, going, homes, sweep } from './worktrees.ts'
import { render as tree } from '@yaks/preact'
import type { VNode } from 'preact'
import { transcriptViews } from './transcript.ts'
// The harness running: the rows every transcript is read from, the daemon over
// them, and the four operations a caller needs — start a session, send it a
// message, list sessions, read one back.
//
// Everything in and out of here is a bundle or a query. Nothing writes SQL,
// nothing reads a table, and no state lives in this process that the graph does
// not already hold: which sessions are running is `.session.status=running`,
// what was written is `.entry.session=<s>`, and the harness could be pointed at
// the fleet's graph tomorrow with none of this changing. The one thing it keeps
// in memory is the daemon's queue, which is a position in a queue rather than
// state.
//
// Seeding is idempotent because the ids are derived from the names — the
// vocabulary declares `name` the identity of a provider, a model and a tool,
// and a provider's offering of a model is a `serves` edge, whose id is derived
// from its two ends — so a second startup patches the rows the first one wrote
// instead of creating a second set. That is what makes `using{model}` on an
// entry mean the same thing across restarts.

import { type Bundle, type Comp, type Eid, identityEid } from '@yaks/graph'
import { MODEL, type Model, PROVIDER, TOOL } from '@yaks/model'
import { credential, responses } from '@yaks/openai'
import { toolEid } from '@yaks/tools'
import {
  admit,
  type ChildLimits,
  children,
  CONTENT,
  type Daemon,
  daemon,
  deliverChild,
  ENTRY,
  type Step,
  taskEntry,
  type Tool,
  transcript,
  views,
} from '@yaks/session'
import { render } from '@yaks/text'
import { dbPath, type Harness, open } from './store.ts'
import { harnessTools } from './tools.ts'

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

/** How a harness is started: what it stores in, what serves it, and what the
 * agent may do. */
// A Harness must be passed under `h`, never spread into the options. Explicit
// exclusions also catch spreads, which TypeScript's excess-property check skips.
type NotHarness = { [K in keyof Harness]?: never }

export type Opts = ChildLimits & NotHarness & {
  /** initial default directory; session home is discovered here */
  cwd?: string
  /** the graph to run over (default: the one at `HARNESS_DB`) */
  h?: Harness
  /** what serves an ask (default: @yaks/openai over the found credential) */
  model?: Model
  /** the model to ask for by name (default `gpt-6-astra`) */
  name?: string
  /** Default provider for new sessions; model selection remains graph data. */
  provider?: string
  /** Host implementations keyed by provider.name, for embedding and testing. */
  providers?: Record<string, Model>
  /** Enable native OpenAI image generation with durable external blobs. */
  web?: boolean
  images?: ImageOptions | false
  /** what the agent may call (default: the shell and the graph) */
  tools?: Tool[]
  /** Stream responses by default; false overrides HARNESS_STREAM. */
  streaming?: boolean
  /** Alias for streaming. If both are supplied, streaming takes precedence. */
  stream?: boolean
  /** Cooperating migrations must allow at least this polling interval. */
  migrationPollMs?: number
  checkpointMs?: number
  /** The system prompt every ask carries. */
  instructions?: string
  /** Maximum tool-result code points before model-facing handle projection. */
  outputLimit?: number
  /** each step of every transcript, as it lands */
  each?: (step: Step) => void
}

/** A running harness. */
export type Agent = {
  authorizeMCP: (
    action: MCPAuthAction,
    name?: string,
    callback?: string,
  ) => Promise<MCPAuthReply>
  h: Harness
  d: Daemon
  tools: Tool[]
  /** the model entity every new session is started under */
  model: Eid
  /** what to call a model or tool entity, for the views */
  names: Record<string, string>
  /** start a transcript with one instruction; the daemon takes it from there */
  start: (prompt: string, o?: { effort?: string; model?: Eid }) => Promise<Eid>
  /** the configured models, and what this session asks for next */
  models: (session?: Eid) => Promise<ModelSelection>
  /** record a passive model choice; the next request honours it */
  selectModel: (session: Eid, model: Eid) => Promise<void>
  /** say something more to a transcript that is already going */
  send: (session: Eid, text: string) => Promise<Eid>
  /** mint and delegate unfiled work under an existing session */
  taskEntry: (session: Eid, text: string) => Promise<{ task: Eid; child: Eid }>
  /** every session, oldest first, each carrying its derived status */
  archive: (session: Eid, archived: boolean) => Promise<void>
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
  image: (eid: string) => Promise<Uint8Array>
  entry: (b: Bundle) => VNode | null
  line: (b: Bundle, view?: string, ctx?: Record<string, unknown>) => string
  /** Explicit instruction admission; appends a snapshot, never a user turn. */
  instruct: (session: Eid, text: string, source?: string) => Promise<Eid>
  runtime: (session: Eid) => Promise<Bundle[]>
  control: (session: Eid, action: RuntimeAction) => Promise<string>
  close: () => Promise<void>
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
 * Start the harness: open the graph, seed what serves it, and put the daemon
 * on its entries.
 *
 * ```ts
 * import { agent } from '@yaks/harness'
 *
 * let a = agent({ h: open(':memory:'), model: fake })
 * let s = await a.start('reply with the word pong')
 * await a.idle(s)
 * ```
 */
export let agent = (opts: Opts = {}): Agent => {
  // Check before opening any database: a misspelled handle must not fall back
  // to the user's persistent store, including for untyped JavaScript callers.
  for (let key of ['path', 'db', 'store', 'g', 'fx', 'vocab', 'close']) {
    if (Object.hasOwn(opts, key)) {
      throw new TypeError(
        'Pass the harness as agent({ h: open(...) }), not spread options',
      )
    }
  }
  let h = opts.h ?? open()
  let detachDiagnostics = diagnostics().attach(h.g)
  const provider = opts.provider ?? 'openai'
  if (provider !== 'openai' && !opts.name) {
    throw new Error('Choose an explicit model name for a non-default provider')
  }
  let name = opts.name ?? ASTRA
  let model = opts.model ??
    responses({
      credential: credential(Deno.env.get, (p) => Deno.readTextFile(p)),
      images: configuredImages(opts.images),
      web: opts.web ?? Deno.env.get('HARNESS_WEB') != '0',
    })
  const providerAuth = providerAuthorization(h.g)
  const implementations = {
    openai: model,
    openrouter: openrouter({ key: providerAuth.key }),
    ...opts.providers,
  }
  const resolveModel = providerResolver(h.g, implementations, opts.model)
  let tools = opts.tools ?? harnessTools(h.g, opts)
  let remoteSignature = ''
  // The remote tools each session's newest ask was offered. A tool is its
  // name, and a server reconfigured mid-ask serves that name from somewhere
  // else: the calls an ask issued run on the handlers it was offered.
  const offered = new Map<Eid, Tool[]>()
  const mcp = mcpTools(h.g)
  h.fx.created('mcp_server', mcp.refresh).changed('mcp_server', mcp.refresh)
    .removed('mcp_server', mcp.refresh)
  // A child's own checkout is garbage the moment its session is over: no
  // further step runs in it until somebody resumes it, and a resume cuts it
  // again where it stood (worktrees.ts). The path is the one workspace.ts cut
  // — named after the child — so a child that merely inherited its parent's
  // home is not mistaken for the owner of it, and one without a checkout of
  // its own finds nothing there.
  collecting(
    h.g,
    h.fx,
    (error, session) =>
      diagnostics().report(error, { phase: 'worktree', session }),
  )
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
        const remote = await mcp.snapshot()
        offered.set(session, remote)
        const all = [...tools, ...remote]
        if (
          new Set(all.map((t) => t.name)).size !== all.length
        ) throw new Error('Duplicate local/MCP tool name')
        const signature = JSON.stringify(
          remote.map((t) => [t.name, t.description, t.parameters]),
        )
        if (signature !== remoteSignature) {
          await h.g.apply(seed({ provider, model: name, tools: remote }), {
            trusted: true,
          })
          remoteSignature = signature
        }
        return all
      },
      streaming: streamingEnabled(opts),
      checkpointMs: opts.checkpointMs,
      instructions: opts.instructions,
      resolveInstructions: (inherited) =>
        inheritedInstructions(inherited, opts.instructions),
      contextItems: (window, entries) =>
        imageContext(h.g, window, entries, opts.images),
      resultText: tools.some((t) => t.name == 'graph_value_read')
        ? (entry) => outputView(h.g, entry, opts.outputLimit)
        : undefined,
      report: (error, session, phase) =>
        diagnostics().report(error, { session, phase }),
    },
    opts.each,
    (error, session) =>
      diagnostics().report(error, { phase: 'daemon', session }),
    h.path == ':memory:' ? undefined : stepLock(h.path),
  )

  let using = {
    provider: identityEid(PROVIDER, [provider]),
    model: identityEid(MODEL, [name]),
  }
  let names: Record<string, string> = {
    [using.model]: name,
    ...Object.fromEntries(tools.map((t) => [toolEid(t.name), t.name])),
  }
  let entries = (session: Eid) => transcript(h.g, session)
  // What attributes a write made here: the transcript it is about. The harness
  // runs for whoever is at the keyboard and holds no entity for them, so the
  // instrument is recorded and the actor is left unset rather than guessed; a
  // model turn attributes itself (@yaks/session react.ts).
  let through = (session: Eid) => ({ via: session })

  let migrationError: Error | undefined
  let migrationWatch: ReturnType<typeof watchMigrations> | undefined
  let closing = false
  let shutdown: Promise<void> | undefined
  let operations = new Set<Promise<unknown>>()
  let a: Agent = {
    h,
    d,
    tools,
    names,
    model: using.model,
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
    start: (prompt, o = {}) =>
      admit(h.g, undefined, opts, async () => {
        const chosen = o.model
          ? await modelUsing(h.g, o.model, implementations)
          : {}
        let home = await homeAt(h.g, opts.cwd ?? Deno.cwd())
        let session = crypto.randomUUID() as Eid
        let files = await instructionFiles(opts.cwd ?? Deno.cwd())
        let context = files.map((f, i) =>
          promptEntry(session, i + 1, f.body, f.source, 'shared', f.revision)
        )
        await h.g.apply([
          ...context,
          {
            entity: { eid: session },
            session: { id: session.slice(0, 8) },
            home,
            $actor: through(session),
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
      }),
    authorizeMCP: async (action, name, callback) => {
      if (name === OPENROUTER_AUTH) {
        return providerAuth.control(action, callback)
      }
      const reply = await mcp.authorize(action, name, callback)
      if (action === 'list' && await providerAuth.listed()) {
        reply.servers = [...reply.servers ?? [], OPENROUTER_AUTH]
      }
      return reply
    },
    send: async (session, text) => {
      // Admission is independent of the provider/tool execution queue. The
      // session plugin assigns seq inside this write's transaction.
      let eid = crypto.randomUUID() as Eid
      await h.g.apply([{
        entity: { eid },
        [ENTRY]: { session },
        [CONTENT]: { body: text },
        $actor: through(session),
      }])
      return eid
    },
    taskEntry: (session, text) =>
      taskEntry(h.g, session, text, {
        ...workspace(h.g, opts.cwd),
        ...opts,
      }),
    archive: async (session, archived) => {
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
    },
    sessions: async () =>
      Promise.all(
        (await h.g.read('.session')).toSorted(byBirth).slice(-LISTED).map(
          async (b) => ({
            ...b,
            session: {
              ...b.session as Comp,
              title: await sessionTitle(h.g, b),
            },
          }),
        ),
      ),
    runtime: (session) => runtimeRows(h.g, session),
    control: (session, action) => runtimeAction(a, session, action),
    children: (session) => children(h.g, session),
    tasks: async () =>
      (await h.g.read('.task.status=open,wip')).toSorted(byBirth)
        .slice(-LISTED),
    entrySource: (session, eid, request) =>
      entrySource(h.g, session, eid, request),
    transcript: entries,
    usage: (session) => transcriptUsage(h.g, session),
    transcriptWindow: (session, request) =>
      transcriptWindow(h.g, session, request),
    resume: async () => {
      let live = await h.g.read('.session.status=pending,running,queued')
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
          (error) => {
            diagnostics().report(error, {
              phase: 'resume-receipt',
              session: parent,
            })
          },
        )
      }
      // What abnormal endings left in the worktree root, taken back by the
      // same test one child's end applies — plus the checkouts Git itself has
      // forgotten. Only the harness running out of its own home sweeps: a
      // store somebody named explicitly (a test, a probe) is not this one, and
      // its run must never reach the live root.
      if (h.path == dbPath()) {
        sweep(h.g, worktrees(), await homes(h.g, await going(h.g))).catch(
          (error) => diagnostics().report(error, { phase: 'worktree-sweep' }),
        )
      }
      let woken = live.map((b) => b.entity.eid)
      for (let s of woken) d.wake(s)
      return woken
    },
    idle: (session) => d.idle(session),
    image: (eid) => readImage(h.g, eid, opts.images),
    entry: (b) =>
      tree(transcriptViews, b, 'Transcript', h.vocab, {
        inlineImages: Deno.env.get('HARNESS_GRAPHICS') == 'kitty',
        image: (eid: string) => a.image(eid),
        names,
        anchor: model.anchor,
      }),
    line: (b, view = 'Line', ctx = {}) =>
      render(views, b, view, h.vocab, {
        names,
        anchor: model.anchor,
        ...ctx,
      }, 'plain'),
    instruct: (session, text, source = 'explicit') =>
      d.enqueue(session, async () => {
        let entry = promptEntry(
          session,
          undefined,
          text,
          source,
          'local',
        )
        await h.g.apply([entry])
        return entry.entity.eid
      }),
    close: () =>
      shutdown ??= (async () => {
        closing = true
        providerAuth.cancel()
        let drained = d.stop()
        await Promise.allSettled([...operations])
        await drained
        await mcp?.close()
        await diagnostics().drain()
        detachDiagnostics()
        h.close()
      })(),
  }
  // Lifecycle bookkeeping only; all application state remains in the graph.
  for (
    let key of [
      'start',
      'authorizeMCP',
      'send',
      'taskEntry',
      'archive',
      'resume',
      'idle',
      'sessions',
      'tasks',
      'children',
      'transcript',
      'instruct',
      'image',
    ] as const
  ) {
    let method = a[key] as (...args: unknown[]) => Promise<unknown>
    Object.assign(a, {
      [key]: (...args: unknown[]) => {
        if (migrationError) return Promise.reject(migrationError)
        if (closing) return Promise.reject(new Error('Agent is closing'))
        let pending = method(...args)
        operations.add(pending)
        pending.then(
          () => operations.delete(pending),
          () => operations.delete(pending),
        )
        return pending
      },
    })
  }
  migrationWatch = watchMigrations(h.migrations, (reason) => {
    migrationError = reason
    // Stop scheduling immediately, but leave SQLite open for admitted work to
    // drain. Restart is an explicit owner action, not a migration side effect.
    void a.close().catch((error) =>
      diagnostics().report(error, { phase: 'migration-drain' })
    )
    console.error(reason.message)
  }, opts.migrationPollMs ?? 1000)
  // Daemon-only shutdown is also a supported restart boundary: a replacement
  // agent can reuse h and later close it. The old host must not keep polling
  // that connection (or its cached, now-finalized native statements).
  let stopDaemon = d.stop
  d.stop = () => {
    migrationWatch?.stop()
    return stopDaemon()
  }
  return a
}

/** Child assignment is explicit admission data; copied fork context is not its title. */
export let sessionTitle = async (
  g: Agent['h']['g'],
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
        '&.content&.prompt=&.notice=&.order=entry.seq&.limit=1',
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
