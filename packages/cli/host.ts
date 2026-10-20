import { getStarts } from './get_starts.ts'
import { workspaceCapabilities } from './workspaces.ts'
import { resolveHome } from './machines.ts'
import { sandboxCapabilities } from './sandboxes.ts'
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

import { UNNUMBERED } from './init.ts'
import type { Actor, Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
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
import type { Store } from '@yaks/sqlite'
import { migrations, migrationSchema } from '@yaks/sqlite/migration'
import { add, follow, printOf } from '@yaks/sqlite/follow'
import { filler, SCHEMA_DUTY, tend } from '@yaks/sqlite/owe'
import type { Opened } from '@yaks/sqlite/db'
import {
  adopt,
  fields as searched,
  find,
  heal,
  type Hit,
  schema as textSchema,
  search,
} from '@yaks/fts'
import { EFFECT, effects, expiration, released } from '@yaks/effects'
import { type Local, peek, warm } from '@yaks/secrets'
import { command, reporter, revision } from './report.ts'
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
import { persist } from '@yaks/tools/persist'
import { files } from '@yaks/tracker/file'
import type { Traces } from './traces.ts'
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
  /** Local tool invocations that can finish without opening a graph. Undefined
   * delegates to the ordinary tool runner. Arguments are already validated. */
  tools?: Record<
    string,
    (
      args: Record<string, unknown>,
      context: Ctx,
    ) => number | undefined | Promise<number | undefined>
  >
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
  /** Open SQLite read-only and record no process or tool-call bookkeeping. A
   * reader never changes the schema; every other host brings the file to its
   * composed schema as it opens (@yaks/sqlite `follow`). */
  readOnly?: boolean
  /** the thread running the duties this host hands off */
  thread?: Thread
  /** The web read door; this host closes an owned reader before telemetry. */
  reader?: Pick<Graph, 'read' | 'rows' | 'get'> & {
    close?: () => void | Promise<void>
  }
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
    { command: command(Deno.args), roles: roles.join(',') },
  )
  let cleanup = async (step: string, release: () => void | Promise<void>) => {
    try {
      await release()
    } catch (error) {
      await report(error, { tags: { step } })
    }
  }
  let opened: Opened | undefined
  let open = async (): Promise<Opened> => {
    let driver = opts.readOnly
      ? await import('@yaks/sqlite/read-db')
      : await import('@yaks/sqlite/db')
    return driver.open(path)
  }
  let recorded: Traces | undefined
  let captureControl: ReturnType<typeof traceControl> | undefined
  try {
    // An existing graph can refuse before any plugin runtime is imported.
    // Keep its connection; absent graphs wait for a valid assembly before
    // creating a file or its directory.
    let exists = false
    if (path != ':memory:') {
      try {
        Deno.statSync(path)
        exists = true
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error
      }
    }
    if (exists) {
      part?.('sqlite')
      opened = await open()
      part?.('migrations')
      migrations(opened).ready()
    }
    // Where this graph's secrets are kept (./vault.ts), and each secret an
    // option names read once now, so the option has it the first time a factory
    // looks. Only those: a secret code reads at the moment it is used (`reveal`)
    // is fetched then, and a command does not wait on 1Password for it.
    part?.('vault')
    let trace = opts.process !== false && (config.tracker || path != ':memory:')
      ? await import('./traces.ts')
      : undefined
    let vault = vaultOf(path)
    await warm(vault, (config.plugins ?? []).flatMap((p) => bound(given(p))))
    let secretDeclarations = (config.plugins ?? []).flatMap((p) =>
      secretNames(given(p)).map((name) => ({ name, package: used(p) }))
    )
    let plugins = named(config, vault)
    let declared = load === facet ? await declarations(config) : undefined
    let stored = new Map(
      declared?.vocabs.filter((v) => v.value !== null).map((
        v,
      ) => [v.plugin, v]),
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
      readOnly: opts.readOnly,
    })
    let { storage } = opts.readOnly
      ? await import('@yaks/sqlite/read-store')
      : await import('@yaks/sqlite')
    let { vocab, derived, backed } = plan.words

    if (!opened) {
      part?.('sqlite')
      opened = await open()
      part?.('migrations')
      // A new file has no migration control yet; a writer adds it first.
      if (!opts.readOnly) add(opened, migrationSchema())
    } else part?.('migrations')
    let sql = opened
    // Facet imports may have awaited while another process announced work.
    // Refuse again on the retained connection before domain schema or factories.
    migrations(sql).ready()
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
    let record = (bundles: Bundle[]) =>
      persist(
        () => g!.apply(bundles, { trusted: true }),
        (error) =>
          report(error, {
            during: { process: selfEid() },
            tags: { step: 'process write' },
          }),
      )
    let finish = async (holder: Eid, end: Bundle) => {
      for (;;) {
        try {
          return await record([...await released(g!, holder), end])
        } catch (error) {
          if (!(error instanceof Stale)) throw error
        }
      }
    }
    let doing: Host['duties'] | undefined
    let stopping = new AbortController()
    let self = writer(vocab)
    let built = plan.bind({
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
          await finish(holder, { entity: { eid: holder }, [EXIT]: {} })
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
          number: config.numbers
            ? {
              except: [
                ...new Set([
                  ...UNNUMBERED,
                  ...typeof config.numbers == 'object'
                    ? config.numbers.except
                    : [],
                ]),
              ],
            }
            : false,
          adopt: config.adopt ?? false,
        })
        return store
      },
      // The text index follows plugin compilers, preserving their precedence.
      extend: () => text.length ? [search(text, sql)] : [],
      // One print covers everything this file needs: the store's tables, the
      // ones beside them, the plugins' own and the text indexes. A file that
      // recorded it opens with no DDL; one that did not adds what is missing.
      // What the pass leaves undone (a table whose rows do not fit, a unique
      // index they break) or a pass that fails is reported, and the graph
      // opens with the shape it holds; the print stays unrecorded, so the
      // next opener tries again.
      schema: opts.readOnly ? undefined : (_built, stmts) => {
        let beside = [...migrationSchema(), ...blobSchema(), ...stmts]
        let indexes = textSchema(text, derived)
        let print = printOf(store!.print(), [...beside, ...indexes])
        let told = (error: unknown) =>
          void report(error, {
            during: { process: selfEid() },
            tags: { step: 'schema' },
          })
        try {
          follow(sql, print, () => {
            let left = [
              ...store!.install([...beside, ...indexes]),
              ...add(sql, beside),
            ]
            if (text.length) {
              adopt(sql, text, derived, { heal: false, fill: filler(sql) })
            }
            left.forEach(told)
            return !left.length
          })
        } catch (error) {
          told(error)
        }
      },
      effects: (built, disabled) => {
        return effects(vocab, {
          owes: roles.includes('effects') ? 'handled' : 'declared',
          disabled,
          write: (b) => built.graph.apply(b, { trusted: true }),
          owner: built.me,
          lease: config.lease,
          gone: built.gone,
          nudge: opts.thread?.nudge,
          // Runs another process commits wake this one's pool at once.
          watch: (heard) => store?.watch?.(EFFECT, heard) ?? (() => {}),
          report: (error, job) =>
            void report(error, {
              during: {
                ...job.event ? { entity: job.event.entity.eid } : {},
                process: built.me,
              },
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
        // An unconfigured private memory graph has no telemetry destination
        // or PID-local capture sidecar. Keeping its channel subscribed would
        // build and discard a complete tree for every startup/catalogue write.
        if (opts.process !== false && (config.tracker || path != ':memory:')) {
          captureControl = config.tracker ? traceControl(path) : undefined
          recorded = trace!.traces(g, {
            getStart: getStarts(path),
            process: selfEid(),
            take: captureControl?.take ??
              (() => Promise.resolve({ requested: false, rate: 0 })),
            sink: config.tracker
              ? spool(files(config.tracker.spool).append)
              : undefined,
          })
        }
        built.workspaces = workspaceCapabilities(built, config)
        built.sandboxes = sandboxCapabilities(built, config)
        built.resolveHome = resolveHome(built, config)
      },
      search: (built) => {
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
              built.meaning?.(words, { limit: count }) ?? Promise.resolve([]),
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
    host = built.host
    g = host.graph
    // A shutdown may need the runner, but opening a graph does not. Keep its
    // tool declarations lazy until a caller actually asks for them.
    let calls = () => host.runner
    let fx = host.fx
    let effecting = roles.includes('effects')
    // Whoever works the effects also works off the schema work a pass owed
    // (@yaks/sqlite/owe), one process at a time under its lease, and does the
    // file's upkeep: its statistics, and once a day a check that each text
    // index holds every row, refilling in windows one that drifted.
    let duties = effecting && !opts.readOnly
      ? [...built.services, {
        name: SCHEMA_DUTY,
        run: (signal: AbortSignal) =>
          tend(sql, {
            signal,
            daily: text.length
              ? [{
                name: 'heal',
                run: (d) => void heal(d, text, { derived, fill: filler(d) }),
              }]
              : [],
            report: (error, work) =>
              void report(error, {
                during: { process: selfEid() },
                tags: { step: 'schema', work },
              }),
          }),
      }, {
        name: '@yaks/effects',
        run: (signal: AbortSignal) =>
          expiration(host.graph, {
            owner: selfEid(),
            signal,
            report: (error) =>
              void report(error, {
                during: { process: selfEid() },
                tags: { step: 'expiration' },
              }),
          }),
      }]
      : built.services
    // Started together and stopped together, by one signal: a host shutting
    // down is one fact, and a duty that outlived the database it
    // reads would be a crash nobody asked for. One that throws is reported
    // and that plugin's duty stops — the others keep going, the way a failing
    // effect is telemetry rather than a broken host. The duties this host
    // handed to a thread of its own run beside these, under the same signal.
    // A config that turned them off (`duties: false`) takes no lease, works
    // no effects and runs none of them, in either form. The CLI's
    // `--no-duties` disables inline duties; web still restores external workers:
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
      fx: effecting && !opts.readOnly ? fx : undefined,
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
    // A draining process is alive but no longer covers its duty roles. Publish
    // that before waiting for in-flight steps, so the web can replace it.
    let retiring: Promise<unknown> | undefined
    let retire = () =>
      retiring ??= self && opts.process !== false && !opts.readOnly
        ? Promise.resolve(record([{
          entity: { eid: selfEid() },
          process: {
            roles: roles.filter((role) => role == 'graph' || role == 'web'),
          },
        }])).catch((error) =>
          report(error, { tags: { step: 'retire duties' } })
        )
        : Promise.resolve()
    // Its effects, drained once: begun by the first of `stop` and `close`,
    // and awaited by `close`.
    let draining: Promise<void> | undefined
    let drained = () => draining ??= drain(fx, (line) => console.error(line))
    let closing: Promise<void> | undefined
    // This process, written in, with the roles it serves. First among the
    // writes, because everything after is attributed to it and `created.by`
    // is a reference: a process attributing writes to an entity nothing
    // created would store a dangling id on its very first write. What a
    // process starting owes is owed when it starts working the effects
    // (@yaks/effects `start`), not here.
    part?.('process')
    if (self && opts.process !== false && !opts.readOnly) {
      await record([started({ roles: [...roles] })])
    }
    let lifecycle = {
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
        void retire()
        stopping.abort()
        dutiesHost.stop()
        if (effecting && !opts.readOnly) void drained()
      },
      close: (code?: number) =>
        closing ??= (async () => {
          let wait = async <T>(name: string, work: () => T | Promise<T>) => {
            let timer = setTimeout(
              () => console.error(`host drain — ${name}`),
              5000,
            )
            try {
              return await work()
            } finally {
              clearTimeout(timer)
            }
          }
          await wait('retire', retire)
          stopping.abort()
          dutiesHost.stop()
          await wait('duty thread', () => opts.thread?.close().catch(lose))
          await wait('thread ending', () => ending)
          if (effecting && !opts.readOnly) await wait('effects', drained)
          await wait('duties', () => dutiesHost.close())
          await wait('plugins', () => cleanup('dispose plugins', built.close))
          let shut = async () => {
            await wait('capture', () =>
              cleanup('close capture', () => captureControl?.close()))
            await wait('traces', () =>
              cleanup('close traces', () =>
                recorded?.close()))
            await wait('reader', () =>
              cleanup('close reader', () =>
                opts.reader?.close?.()))
            await wait('storage', () =>
              cleanup('close storage', () =>
                sql.close()))
            await wait('reports', () =>
              report.close())
          }
          // A call whose tool has not returned by now never will in this
          // process. Ended as interrupted, rather than left claimed for a sweep
          // to run again in a process nobody asked — a server, a tail, a land in
          // somebody else's checkout.
          if (!opts.readOnly) {
            await wait('interrupt calls', () =>
              calls().interrupt(
                `interrupted: this process ended${
                  code == null ? '' : ` with code ${code}`
                } before the tool returned`,
              ).catch((e) =>
                report(e, { tags: { step: 'interrupt calls' } })
              ))
          }
          if (!self || opts.process === false || opts.readOnly) {
            return shut()
          }
          try {
            await wait('process ending', () =>
              finish(selfEid(), ended(code)))
          } catch (e) {
            await report(e, { tags: { step: 'close host' } })
          }
          await shut()
        })(),
    }
    // Spreading Host would invoke its lazy tools/runner getters here.
    return Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(host),
      ...Object.getOwnPropertyDescriptors(lifecycle),
    }) as Served
  } catch (error) {
    try {
      await report(error, { tags: { step: 'compose host' } })
      await cleanup('close capture', () => captureControl?.close())
      await cleanup('close traces', () => recorded?.close())
      await cleanup('close storage', () => opened?.close())
    } finally {
      await report.close()
    }
    throw error
  }
}

export type { Reader } from './reader.ts'
export let reader = async (
  ...args: Parameters<typeof import('./reader.ts').reader>
): Promise<import('./reader.ts').Reader> =>
  (await import('./reader.ts')).reader(...args)
