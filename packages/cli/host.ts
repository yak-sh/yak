import { resolveSessionHome } from './session_home.ts'
import { machineCapabilities } from './machines.ts'
/**
 * The graph a config file names, opened by a process for the roles it serves.
 *
 * A plugin says what it contributes, one facet per subpath: the components and
 * tools it declares (`@yaks/mail/vocab`), what it adds to a graph (`/graph`), the
 * functions behind its tools (`/tools`), what runs after a commit
 * (`/effects`), the work it keeps doing while a process is up (`/service`), the
 * HTTP it adds (`/routes`), its terminal controls (`/cli`), and how its
 * entities are drawn (`/views`, `/tui`) and dressed (`/ui`, their kits, UX kits, themes and skins).
 * It never says where any of that runs. A process serves roles, and imports
 * only the facets of the roles it serves:
 *
 * ```
 * graph       vocab, graph, tools   open the file, admit writes, run tool calls
 * web         routes, ui            the HTTP a listener answers with
 * effects     effects               the code behind the effects a commit owes
 * @yaks/mail  that plugin's service the timer or poll one plugin keeps up
 * ```
 *
 * The first three are {@link ROLES}, which every graph has; a plugin with a
 * `./service` brings a role of its own, named by its package. The config names
 * the plugins; each process picks its roles. `yak serve` serves `web`, the
 * role @yaks/api's `serve` declares. A `yak` command serves commands and
 * rendering, which are its own (./run.ts, ./answer.ts), and reaches the graph
 * either through a server or by composing the graph role here itself
 * (local.ts). A host that stays up explicitly starts duty roles in a thread
 * of the same process (@yaks/threads), a host of its own. A role
 * this process does not serve costs it nothing: its facets
 * are never imported, so a command that opens the graph to read it never loads
 * a line of HTTP, and a process that serves no `web` never asks a plugin for a
 * route.
 *
 * {@link compose} opens the box's SQLite file, vault and capabilities and calls
 * {@link assembly} in @yaks/host to load facets and build the graph over the
 * plugins' rules and the other roles' contributions. A subpath a package does not export is skipped;
 * one that exists and fails to import is an error, never a skip. Nothing here
 * binds a port: `serve`, declared and implemented by
 * {@link https://jsr.io/@yaks/api | @yaks/api}, listens with the
 * {@link Host.handler} built here, and only a config naming @yaks/api has one.
 *
 * ```ts
 * import { compose } from '@yaks/cli/host'
 *
 * // let config = { db: 'graph.db', plugins: ['@yaks/task'] }
 * // let host = await compose(config, ['graph'])
 * // console.log(await host.graph.read('.task'))
 * ```
 *
 * @module
 */

import type { Actor, Comp, Eid, Graph } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import {
  ended,
  EXIT,
  gone,
  PROCESS,
  selfEid,
  started,
  store as machine,
  vanished,
} from '@yaks/process'
import { lit } from '@yaks/sql'
import {
  columns,
  installMigrations,
  migrations,
  storage,
  type Store,
} from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { adopt, fields as searched, find, type Hit, search } from '@yaks/fts'
import { effects, released } from '@yaks/effects'
import { type Local, peek, warm } from '@yaks/secrets'
import { reporter, revision } from './report.ts'
import {
  artifactsAt,
  type Backend,
  backend,
  type Blobs,
  blobSchema,
  sqliteBlobs,
} from '@yaks/blob'
import { type Config, dbOf, given, type Options, used } from './config.ts'
import { chosen, type Configured, facetsOf } from '@yaks/host/config'
import { facet } from './words.ts'
import { assembly, type Facets, type Load, type MeaningHit } from '@yaks/host'
export { every } from '@yaks/host/roles'
import { declarations } from './declarations.ts'
import { ROLES } from './roles.ts'
export { ROLES } from './roles.ts'
import { drain } from './drain.ts'
import { vaultOf } from './vault.ts'
import type { Command, Ctx } from './run.ts'
import { roles as serveRoles, type Thread } from '@yaks/threads'
export type { Thread } from '@yaks/threads'
import { during, outcome, peek as tracing, type Span } from '@yaks/trace'
import { compositionAnatomy, secretNames } from '@yaks/host/anatomy'
import { AsyncLocalStorage } from 'node:async_hooks'
import { type Context as TraceContext, installContext } from '@yaks/trace'
import { spool } from '@yaks/tracker/report'
import { CallError } from '@yaks/tools/errors'
import { files } from '@yaks/tracker/file'
import { type Traces, traces } from './traces.ts'
import { traceControl } from './trace_control.ts'

// One carrier per runtime, not per composed graph. Multiple CLI hosts can
// coexist without replacing one another's async context.
let traceLocal = new AsyncLocalStorage<TraceContext | undefined>()
installContext({
  get: () => traceLocal.getStore(),
  run: (ctx, work) => traceLocal.run(ctx, work),
})

export { type Declared, facet, type Words, words } from './words.ts'

export {
  type Config,
  configPath,
  given,
  type Options,
  person,
  type Plug,
  read,
  used,
} from './config.ts'

import type { Host } from '@yaks/host'
export type { Feed, Host } from '@yaks/host'

/** A role: one of {@link ROLES}, or a plugin's package, for its service. */
export type Role = string

// Scores from FTS and a vector space are incomparable. Rank positions give
// each source a vote; direct word matches get a small lead, and a hit in both
// gets both votes.
let merged = (words: Hit[], meaning: MeaningHit[], limit: number) => {
  let by = new Map<Eid, {
    entity: Eid
    score: number
    snippet: string
    source: 'text' | 'meaning' | 'both'
  }>()
  words.forEach((h, i) =>
    by.set(h.entity, {
      entity: h.entity,
      score: 1.1 / (60 + i + 1),
      snippet: h.snippet,
      source: 'text',
    })
  )
  meaning.forEach((h, i) => {
    let had = by.get(h.entity)
    by.set(
      h.entity,
      had
        ? {
          ...had,
          score: had.score + 1 / (60 + i + 1),
          source: 'both',
        }
        : {
          entity: h.entity,
          score: 1 / (60 + i + 1),
          snippet: h.excerpt,
          source: 'meaning',
        },
    )
  })
  return [...by.values()]
    .sort((a, b) => b.score - a.score || a.entity.localeCompare(b.entity))
    .slice(0, limit)
}

/** A plugin's command-line control. It opens the graph but is not a persisted
 * tool call: a password prompt or OAuth attempt cannot be replayed by a
 * server after the terminal process exits. */
export type CliCommand = Omit<Command, 'run'> & {
  run: (
    args: Record<string, unknown>,
    host: Host,
    context: Ctx,
  ) => number | Promise<number>
}

/** `<plugin>/cli` — commands for the person at this terminal, not graph tools. */
export type CliFacet = {
  commands?: CliCommand[]
  /** Explicit global-input bindings for this plugin's graph tools. */
  globals?: Record<string, NonNullable<Command['globals']>>
}

/** An assembled host: everything a plugin factory was given, plus what only
 * the caller of {@link compose} needs. */
export type Served = Host & {
  storage: Store
  /** wind down, with the graph still open: {@link Host.stopping} aborts, so
   * the duties stop and whatever hangs off it ends — a server stops taking
   * requests and answers the ones in flight, a transcript starts no new step —
   * and it leaves the pool, so what is running can finish and be written
   * before {@link close} */
  stop: () => void
  /** close the graph, once the effects it started have finished: every call
   * this process's runner is still running ended as interrupted, every lease
   * it holds released and its `exit` stamped —
   * with the code it is given, or with none where nobody knows how it ended.
   * Await it when the process is about to end, or that last write races the
   * exit and the row reads as still running forever. */
  close: (code?: number) => void | Promise<void>
}

/** How a host is composed, beyond its roles. */
export type ComposeOpts = {
  /** Create or upgrade schema. Ordinary file-backed hosts only bind it. */
  install?: boolean
  /** Open SQLite read-only and record no process or tool-call bookkeeping. */
  readOnly?: boolean
  /** the thread running the duties this host hands off */
  thread?: Thread
  /** the graph read door a web role uses while its own graph handles writes */
  reader?: Pick<Graph, 'read' | 'rows' | 'get'>
  /** a reader beside a host records no process of its own */
  process?: boolean
}

export { dbOf } from './config.ts'

// The name in `{"secret": "NAME"}`, when the object holds nothing else.
let secretIn = (value: unknown): string | undefined => {
  let said = value as Record<string, unknown> | null
  return said && typeof said == 'object' && typeof said.secret == 'string' &&
      Object.keys(said).length == 1
    ? said.secret
    : undefined
}

// Every secret a plugin's options name, wherever in them it sits.
let bound = (value: unknown): string[] => {
  let name = secretIn(value)
  if (name) return [name]
  return value && typeof value == 'object'
    ? Object.values(value).flatMap(bound)
    : []
}

// `{"secret": "NAME"}` anywhere in a plugin's options reads that secret at the
// moment the value is accessed (@yaks/secrets `peek`): the value written
// through the graph, the 1Password value it is bound to, or else the
// environment variable of that name. It is the one thing a config file cannot
// hold in the open, and the one thing that can arrive after the host is
// already running, so a plugin that re-reads its options on each pass starts
// the moment a key is written rather than needing a restart. A secret nobody
// has provided reads as undefined rather than as a guess, so the plugin
// reports in its own words what it is waiting for.
let revealing = (value: unknown, vault: Local): unknown => {
  let name = secretIn(value)
  // A whole options object written `{"secret": …}` has no parent object to
  // define a getter on, so it is read here, once.
  if (name) return peek(vault, name)
  if (!value || typeof value != 'object') return value
  let out = (Array.isArray(value) ? [] : {}) as Record<string, unknown>
  for (let [k, v] of Object.entries(value)) {
    let said = secretIn(v)
    if (said) {
      Object.defineProperty(out, k, {
        get: () => peek(vault, said),
        enumerable: true,
        configurable: true,
      })
    } else out[k] = revealing(v, vault)
  }
  return out
}

/**
 * Who a host writes as when no request named a caller: this PROCESS, acting
 * for itself through itself.
 *
 * There is no configured actor name. A run of a program is not a singleton and
 * never was — two `yak` commands and a `yak serve` over one file are three
 * writers — so the identity is the `process` row this run wrote on the way in
 * (@yaks/process `started`). That makes `created.by` the answer to *which run*
 * wrote a thing, and lets a child process's row, written by its parent, record
 * whose child it is without needing a property for it.
 *
 * A graph whose vocabulary has no `process` component has no such row, and
 * writes go unattributed rather than attributed to an id nothing created.
 */
export let writer = (vocab: Vocab): Actor | null =>
  vocab.comp(PROCESS) ? { by: selfEid(), via: selfEid() } : null

// Each plugin a config names, with its options, a secret among them read when
// accessed.
let named = (config: Config, vault?: Local): Configured[] =>
  (config.plugins ?? []).map((plug) => [
    used(plug),
    (vault ? revealing(given(plug), vault) : given(plug)) as Options,
    chosen(plug),
    facetsOf(plug),
  ])

/**
 * Open the graph a config names, for the roles this process serves: import
 * those roles' facets and nothing else, open the database, build the graph, and
 * wire in what each role brings — the code behind the effects, and the worker
 * that runs them, for `effects`; the request handler for `web`; a plugin's
 * service for the role named by its package. Every process serves `graph`,
 * since the graph is what it opened.
 *
 * `load` is how one of a plugin's subpaths becomes a module ({@link facet}).
 * It is injectable, so a test can assemble a host from modules it wrote inline
 * rather than files on disk.
 */
export let compose = (
  config: Config,
  roles: readonly Role[],
  load: Load = facet,
  opts: ComposeOpts = {},
): Promise<Served> => {
  // The config exists before its graph does, so a consumer can subscribe to
  // its channel before any startup work. No recorder is created by a host.
  let c = tracing(config)
  if (!c) return composed(config, roles, load, opts)
  let root = c.begin({
    kind: 'process-start',
    name: '@yaks/cli.compose',
    package: '@yaks/cli',
  })
  let part: Span | undefined
  let next = (name: string) => {
    part?.end()
    part = c.begin({
      kind: 'phase',
      name: `@yaks/cli.compose.${name}`,
      package: '@yaks/cli',
      parent: root?.id,
    })
  }
  return during(root, async () => {
    try {
      let host = await composed(config, roles, load, opts, next)
      part?.end()
      return host
    } catch (error) {
      part?.end({ outcome: outcome(error) })
      throw error
    }
  }) as Promise<Served>
}

let composed = async (
  config: Config,
  roles: readonly Role[],
  load: Load,
  opts: ComposeOpts,
  part?: (name: string) => void,
): Promise<Served> => {
  part?.('reporter')
  if (!roles.includes('graph')) {
    throw new CallError(
      'config',
      'a host opens a graph — its roles include graph',
    )
  }
  let path = dbOf(config)
  let report = reporter(
    opts.readOnly ? {} : config,
    { by: selfEid(), via: selfEid() },
    // Asked now and awaited only by a report: the commit is this run's, and
    // a command that reports nothing does not wait on git to learn it.
    config.tracker && !opts.readOnly ? revision() : undefined,
  )
  // Where this graph's secrets are kept (./vault.ts), and each secret an
  // option names read once now, so the option has it the first time a factory
  // looks. Only those: a secret code reads at the moment it is used (`reveal`)
  // is fetched then, and a command does not wait on 1Password for it.
  part?.('vault')
  let vault = vaultOf(path)
  await warm(vault, (config.plugins ?? []).flatMap((p) => bound(given(p))))
  let secretDeclarations = (config.plugins ?? []).flatMap((p) =>
    secretNames(given(p)).map((name) => ({ name, package: used(p) }))
  )
  let plugins = named(config, vault)
  let declared = load === facet ? await declarations(config) : undefined
  let stored = new Map(
    declared?.vocabs.filter((v) => v.value !== null).map((v) => [v.plugin, v]),
  )
  part?.('roles')
  let observed = compositionAnatomy(
    (config.plugins ?? []).map((p) => ({
      name: used(p),
      facets: facetsOf(p),
    })),
    roles,
    ROLES,
    secretDeclarations,
  )
  // A declaration hit substitutes data only while its sources agree. The
  // assembly sees the same facets as an ordinary loader, without CLI policy.
  let preparedLoad: Load = Object.assign(
    async <F extends keyof Facets>(
      plugin: string,
      name: F,
    ): Promise<Facets[F] | null> => {
      let data = name == 'vocab' ? stored.get(plugin) : undefined
      return data && !data.factories
        ? data.value as Facets[F] | null
        : declared && !declared.facets[plugin].includes(name)
        ? null
        : await load(plugin, name)
    },
    {
      together: (requests: readonly (readonly [string, keyof Facets])[]) =>
        load.together?.(
          requests.filter(([plugin, name]) =>
            (!declared || declared.facets[plugin].includes(name)) &&
            (name != 'vocab' || !declared || !!stored.get(plugin)?.factories)
          ),
        ) ?? Promise.resolve(),
    },
  )
  let plan = await assembly(config, roles, preparedLoad, {
    plugins,
    observed,
    part,
  })
  let { vocab, derived, backed } = plan.words

  part?.('sqlite')
  let installing = opts.install ?? path == ':memory:'
  if (installing && opts.readOnly) {
    throw new Error('a reader cannot install a graph')
  }
  let sql = open(path, { readOnly: opts.readOnly })
  part?.('migrations')
  let recorded: Traces | undefined
  let captureControl: ReturnType<typeof traceControl> | undefined
  try {
    if (installing) {
      installMigrations(sql)
      for (let statement of blobSchema()) sql.query(statement)
    }
    migrations(sql).ready()
    // Before explicit expansion, ordinary CLI reads still work over old homes.
    // Only this SQLite boundary knows the absent destination; plugins see a
    // canonical empty machine reference, and provisioning waits for expansion.
    if (
      !installing && vocab.prop('home', 'machine') &&
      columns(sql, 'home').includes('worktree') &&
      !columns(sql, 'home').includes('machine')
    ) {
      derived['home.machine'] = { tag: 'number', expr: () => lit(null) }
    }

    part?.('host')
    let chosen = plugins.find(([name]) => name == '@yaks/blob')?.[1].store as
      | Backend
      | undefined
    let selected: { store?: Blobs; waiting?: string } = chosen
      ? backend(chosen, { blobs: sqliteBlobs(sql) })
      : { store: artifactsAt(path) }
    let artifacts = selected.store
    if (!artifacts) throw new Error(`@yaks/blob: ${selected.waiting}`)
    let store: Store | undefined
    // Search is a property of the declaration: a property marked `search: true`
    // is indexed, whoever declared it, so wiring @yaks/fts here rather than in
    // a plugin is what takes the vocabulary at its word. Two things follow
    // from that one list of properties — a bare word in any query compiles to a
    // text match (one more clause compiler beside the plugins'), and `/mcp`
    // lists a ranked `search` tool.
    let text = searched(vocab)

    let host: Host
    let g: Graph | undefined
    let doing: Host['duties'] | undefined
    let stopping = new AbortController()
    let self = writer(vocab)
    let bound = plan.bind({
      host: {
        vault,
        blobs: sqliteBlobs(sql),
        artifacts,
        reader: opts.reader,
        me: selfEid(),
        stopping: stopping.signal,
        report: (error, context = {}) =>
          report(error, {
            ...context,
            during: { process: selfEid(), ...context.during },
          }),
        duties: (signal, only) => {
          if (!doing) throw new Error('the duties are not built yet')
          return doing(signal, only)
        },
        end: async (holder, why) => {
          // A thread that failed before it wrote itself in holds nothing.
          if (!self || !g || !(await g.get([holder])).length) return
          if (!opts.readOnly) await host.runner.interrupt(why, holder)
          await g.apply([
            ...await released(g, holder),
            { entity: { eid: holder }, [EXIT]: {} },
          ])
        },
        bury: async () => {
          if (!self || !g) return []
          let dead = await vanished(machine(g), { me: selfEid() })
          for (let b of dead) {
            let pid = (b[PROCESS] as Comp | undefined)?.pid
            await host.end(
              b.entity.eid,
              `interrupted: process ${pid} ended without closing`,
            )
          }
          return dead
        },
        gone: async (holder) =>
          !!self && !!g && await gone(machine(g), holder, { me: selfEid() }),
      },
      actor: self,
      process: started({ roles: [...roles] })[PROCESS] as Comp,
      readOnly: opts.readOnly,
      storage: (built, extend) => {
        host = built
        store = storage(sql, vocab, {
          derived,
          backed,
          extend,
          number: config.numbers ?? false,
          adopt: config.adopt ?? false,
        })
        return store
      },
      // The text index follows plugin compilers, preserving their precedence.
      extend: () => text.length ? [search(text, sql)] : [],
      install: installing ? (built) => built.storage.install() : undefined,
      effects: (built, disabled) => {
        return effects(vocab, {
          owes: roles.includes('effects') ? 'handled' : 'declared',
          disabled,
          write: (b) => built.graph.apply(b, { trusted: true }),
          owner: built.me,
          lease: config.lease,
          gone: built.gone,
          nudge: opts.thread?.nudge,
          report: (error, job) =>
            void report(error, {
              during: { entity: job.event.entity.eid, process: built.me },
              tags: { handler: job.handler },
            }),
        })
      },
      ready: (built) => {
        host = built
        g = built.graph
        // Read workers return their recorded trees to their caller rather than
        // duplicating delivery. A passing CLI and every duty/web process observe
        // their graph, without composing tracker tables into the watched store.
        if (opts.process !== false) {
          captureControl = config.tracker ? traceControl(path) : undefined
          recorded = traces(g, {
            process: selfEid(),
            take: captureControl?.take ??
              (() => Promise.resolve({ requested: false, rate: 0 })),
            sink: config.tracker
              ? spool(files(config.tracker.spool).append)
              : undefined,
          })
        }
        built.machines = machineCapabilities(built, config, path)
        built.machines.resolveHome = resolveSessionHome(sql, () => built.graph)
      },
      search: (built, meaning) => {
        part?.('fts')
        if (installing && text.length) adopt(sql, text, derived)
        part?.('search')
        return text.length
          ? async (words, opts) => {
            let limit = Math.max(
              0,
              Math.min(100, Math.trunc(opts?.limit ?? 20)),
            )
            if (!limit) return []
            let count = Math.max(20, limit * 2)
            let [literal, similar] = await Promise.all([
              Promise.resolve(find(sql, text, words, { limit: count })),
              meaning?.(words, { limit: count }) ?? Promise.resolve([]),
            ])
            let hits = merged(literal, similar, limit)
            let found = await built.graph.get(hits.map((h) => h.entity))
            let at = new Map(found.map((b) => [b.entity.eid, b]))
            return hits.flatMap((h) => {
              let b = at.get(h.entity)
              if (!b) return []
              let title = Object.values(b).flatMap((c) =>
                c && typeof c == 'object' && 'title' in c &&
                  typeof c.title == 'string'
                  ? [c.title]
                  : []
              )[0] ?? ''
              return [{
                entity: b.entity,
                hit: {
                  kind: vocab.kindOf(b) || 'entity',
                  title,
                  snippet: h.snippet,
                  source: h.source,
                  ...(b.entry && typeof b.entry == 'object' &&
                      'session' in b.entry && typeof b.entry.session == 'string'
                    ? {
                      session: b.entry.session,
                      speaker: b.output ? 'output' : 'input',
                    }
                    : {}),
                },
              }]
            })
          }
          : undefined
      },
    })
    host = bound.host
    g = host.graph
    let calls = host.runner
    let fx = host.fx
    let duties = bound.services
    let effecting = roles.includes('effects')
    // Started together and stopped together, by one signal: a host shutting
    // down is one fact, and a duty that outlived the database it
    // reads would be a crash nobody asked for. One that throws is reported
    // and that plugin's duty stops — the others keep going, the way a failing
    // effect is telemetry rather than a broken host. The duties this host
    // handed to a thread of its own run beside these, under the same signal.
    // A config that turned them off (`duties: false`, `yak --no-duties`)
    // takes no lease, works no effects and runs none of them, in either form:
    // what it commits is left written down for a process that does.
    //
    // A thread gone without closing — ended where it stood, or failed — ran in
    // this process's pid, which goes on, so nobody can tell it is over until
    // this host writes its ending: once, however many of its promises say so.
    let ending: Promise<void> | undefined
    let lose = (error: unknown) => {
      void report(error, {
        during: { process: host.me },
        tags: { step: 'duty thread' },
      })
      return ending ??= host.end(
        opts.thread!.me,
        'interrupted: its thread ended before it closed',
      ).catch((e) => report(e, { tags: { step: 'end duty thread' } }))
    }
    let dutiesHost = serveRoles(g, {
      me: selfEid(),
      roles: [...effecting ? ['effects'] : [], ...duties.map((d) => d.name)],
      fx,
      services: Object.fromEntries(duties.map((d) => [d.name, d.run])),
      hold: config.lease,
      gone: host.gone,
      report: (error, role) =>
        report(error, {
          during: { process: host.me },
          tags: role == 'effects' ? { step: 'effects' } : { role },
        }),
    })
    doing = config.duties == false ? async () => {} : (signal, only) => {
      let until = signal ?? stopping.signal
      return Promise.all([
        ...(opts.thread ? [opts.thread.duties(until).catch(lose)] : []),
        dutiesHost.duties(until, only),
      ]).then(() => {})
    }
    // Its effects, drained once: begun by the first of `stop` and `close`,
    // and awaited by `close`.
    let draining: Promise<void> | undefined
    let drained = () =>
      draining ??= drain(fx, g!, (line) => console.error(line))
    // This process, written in, with the roles it serves. First among the
    // writes, because everything after is attributed to it and `created.by`
    // is a reference: a process attributing writes to an entity nothing
    // created would store a dangling id on its very first write. What a
    // process starting owes is owed when it starts working the effects
    // (@yaks/effects `start`), not here.
    part?.('process')
    if (self && opts.process !== false && !opts.readOnly) {
      await g.apply([started({ roles: [...roles] })])
    }
    return {
      ...host,
      storage: store!,
      graph: g,
      fx,
      // The last transaction, then the file: every lease this process holds
      // released, and its ending stamped. One transaction, because they are
      // one fact — a process that is over is not doing any work, and the next
      // process to ask should not have to wait out a lease nobody is using.
      // Last, because an absent `exit` is what running means, so a process
      // that closed without stamping one reads as still running forever.
      //
      // First of all, the abort: the duties stop and every timer a
      // plugin hung off {@link Host.stopping} is cancelled, so nothing is
      // still pending over a database that is about to be closed. It leaves
      // the pool, so what it commits from then on, its last transaction
      // included, is left written down for another, and the effects it
      // started are let finish, for as long as each takes (./drain.ts). Then
      // the thread beside it closes, draining the same way. A thread that does
      // not close, this host writes the ending of. The calls this process was
      // still running are ended first, as interrupted, so none is left to
      // lapse.
      stop: () => {
        stopping.abort()
        dutiesHost.stop()
        if (!opts.readOnly) void drained()
      },
      close: async (code?: number) => {
        stopping.abort()
        dutiesHost.stop()
        await opts.thread?.close().catch(lose)
        await ending
        if (!opts.readOnly) await drained()
        await dutiesHost.close()
        let shut = async () => {
          await recorded?.close()
          captureControl?.close()
          await report.close()
          try {
            sql.close()
          } catch { /* already closed */ }
        }
        // A call whose tool has not returned by now never will in this
        // process. Ended as interrupted, rather than left claimed for a sweep
        // to run again in a process nobody asked — a server, a tail, a land in
        // somebody else's checkout.
        if (!opts.readOnly) {
          await calls?.interrupt(
            `interrupted: this process ended${
              code == null ? '' : ` with code ${code}`
            } before the tool returned`,
          ).catch((e) => report(e, { tags: { step: 'interrupt calls' } }))
        }
        if (!self || opts.process === false || opts.readOnly) return shut()
        try {
          await g!.apply([...await released(g!, selfEid()), ended(code)])
        } catch (e) {
          await report(e, { tags: { step: 'close host' } })
        }
        await shut()
      },
    }
  } catch (error) {
    await recorded?.close()
    captureControl?.close()
    await report(error, { tags: { step: 'compose host' } })
    await report.close()
    sql.close()
    throw error
  }
}

export { type Reader, reader } from './reader.ts'
