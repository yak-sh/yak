import * as system from '@yaks/process/system'
import * as disk from '@yaks/file/io'
// The graph this process opens. `yak --config yak.json task list` reads that
// config file, imports the plugins it names over the SQLite file it names,
// runs the tool right here and exits — no server, no socket, nothing
// listening.
//
// That is the ordinary way a `yak` command runs. SQLite in WAL mode accepts as
// many writers as there are commands running, each one serialized by the file
// itself, so nothing bottlenecks on a process somebody has to remember to
// start. `yak serve` is one more of those commands: a tool that stays up
// answering HTTP over the same file (@yaks/api).
//
// Listing the commands opens nothing and loads nothing of this module: the
// tools a graph offers are declared in its plugins' `./vocab` (./words.ts), so
// the usage page, a help page and a mistyped word cost no database
// (./subcommands.ts). Running one opens the graph for the roles that
// command's process serves (host.ts `compose`): the graph, and whatever else
// its tool declares it needs — `serve` answers HTTP, so its process serves
// `web`.
//
// A command line runs a tool through the tool runner. A read-only command
// opens SQLite read-only and records nothing; a writing command records its
// call and result. What came back is shown through
// the plugins' views (./answer.ts). Recorded work uses the same rules,
// post-commit effects and attribution whichever door asked for it.
//
// The effect pool and the plugins' services are never this thread's. A host
// that stays up explicitly starts them through `host.duties()` (@yaks/threads),
// so a command passing through never claims work it cannot finish.
//
// This module is imported only by a command that runs against a graph,
// because importing it pulls in everything that opens one — a cost `yak help`
// should not pay, nor `yak login` on a machine with no graph.

import type { Actor, Bundle, Graph } from '@yaks/graph'
import { mint } from '@yaks/graph/identity'
import { signed } from '@yaks/graph/provenance'
import type { AnatomyObservation } from '@yaks/code/anatomy'
import type { Vocab } from '@yaks/vocab'
import { EFFECT } from '@yaks/effects'
import { answerOf, faulted, structured, toolEid } from '@yaks/tools/result'
import { registry, terminal } from './answer.ts'
import { show } from './terminal.ts'
import {
  type Config,
  exported,
  pluginTui,
  pluginViews,
  read,
  used,
} from './config.ts'
import { asides, hosts } from './held.ts'
import type { Listing } from './subcommands.ts'
import { VIA } from './rpc.ts'
import type { Ctx } from './run.ts'
import {
  type CliCommand,
  compose,
  dbOf,
  type Declared,
  facet,
  person,
  type Role,
  type Served,
} from './host.ts'
import { readThread } from './read_thread.ts'
import { stalls } from './stall.ts'
import { sampler } from './stall_profile.ts'
import { thread } from '@yaks/threads'
import { during, peek } from '@yaks/trace'
import { dutyRoles, rolesOf, workerRoles } from './roles.ts'
import { declarations } from './declarations.ts'
import { readinessPid } from './runtime.ts'
import { lifetime } from './lifetime.ts'
export { rolesOf } from './roles.ts'

/** The duty roles of a config's graph that a process serving `mine` does not
 * cover already: the effect pool, where the graph keeps one, and each plugin's
 * service. A plugin that exports no `./service` has none (`has`, the resolver
 * asked rather than the module imported). */
export let dutiesOf = (
  vocab: Vocab,
  config: Config,
  mine: readonly Role[],
  has: (plugin: string, facet: string) => boolean = exported,
): Role[] => dutyRoles(config, !!vocab.comp(EFFECT), mine, has)

// A process that stays up answers its committed reads in a read thread beside
// it (./read_thread.ts), lent to its graph (@yaks/graph `Lent`): a slow read,
// whoever asked it, holds a worker's lane and never the thread its requests,
// duties, leases and sockets run on. A write, and the reads in its own
// transaction, still run here, and a read sent after a write commits sees it.
// A passing command opens none; it would wait on the workers starting.
let lend = (path: string, config: Config) =>
  dbOf(config) != ':memory:' ? readThread(path) : undefined

// The graph a command opens: composed for its own roles, with its duty roles
// external for web, otherwise planned in a thread beside it. Only a host
// explicitly serving duties starts that thread. Every commit still records the effects it owes for a worker to
// claim, whether this command or another process wrote it.
let open = async (
  path: string,
  roles: Role[],
  duties: boolean,
  readOnly = false,
): Promise<Served> => {
  let config = read(path)
  let web = roles.includes('web')
  let reader = web ? lend(path, config) : undefined
  // A web listens first and warms after, when its server asks (@yaks/api
  // `serve`): its reader's workers start, so a read is as fast as the next,
  // its main thread is watched ({@link watched}), and then workers start for
  // the duty roles nothing covers. Until then its reads run on the graph's
  // own connection, and the CPU goes to answering. A warming that fails
  // rejects, and the server ends.
  let host: Served | undefined
  let cover = (): void => {}
  let warming: Promise<void> | undefined
  let warm = web
    ? () =>
      warming ??= (reader ? watched(host!, reader.ready()) : Promise.resolve())
        .then(() => cover())
    : undefined
  if (
    readOnly || config.duties === false || (!duties && !web)
  ) {
    return host = await compose({ ...config, duties: false }, roles, facet, {
      reader,
      warm,
      readOnly,
    })
  }
  if (web) {
    let served = host = await compose(config, roles, facet, { reader, warm })
    cover = () => void covered(served, path, config, roles)
    return served
  }
  let aside = thread<string>(new URL('./duties.ts', import.meta.url))
  asides.add(aside)
  host = await compose(config, roles, facet, {
    thread: aside,
    reader,
  })
  try {
    aside.plan({ data: path, roles: dutiesOf(host.vocab, config, roles) })
  } catch (error) {
    await host.close()
    await reader?.close()
    throw error
  }
  return host
}

// Workers for the duty roles of a web's graph that no live process serves,
// started and watched for as long as the web is up. Only a web host starts
// them, so only it loads how. What fails is reported, and the web stays up.
let covered = async (
  host: Served,
  path: string,
  config: Config,
  roles: Role[],
): Promise<void> => {
  try {
    let { external } = await import('./external.ts')
    if (host.stopping.aborted) return
    let coverage = external(
      host.graph,
      path,
      dutiesOf(host.vocab, config, roles),
      {
        signal: host.stopping,
        report: (error, role) =>
          host.report?.(error, {
            tags: { step: 'duty coverage', ...role ? { role } : {} },
          }),
        feed: host.feed,
      },
    )
    let close = host.close
    host.close = async (code) => {
      await coverage.close()
      await close(code)
    }
    await coverage.checked
  } catch (error) {
    await host.report?.(error, { tags: { step: 'duty coverage' } })
  }
}

// A process that stays up tells of a main thread held so long that its
// timers, sockets and requests all waited on it (./stall.ts), with the stacks
// sampled while it was held (./stall_profile.ts). Watching starts once `ready`
// settles, and the host's close stops it.
let watched = (
  host: Served,
  ready: Promise<unknown> = Promise.resolve(),
): Promise<void> => {
  let profile: Awaited<ReturnType<typeof sampler>> | undefined
  let unwatch = () => {}
  let done = (async () => {
    await ready
    let started = profile = await sampler()
    // Silent once started: its samples are told only in a stall's report.
    unwatch = stalls({
      sample: (ms, held) =>
        started.take(ms, held)?.catch((error) => {
          void host.report?.(error, {
            tags: { step: 'main thread sampling' },
          })
          return `stack sampling failed: ${String(error)}`
        }),
      report: (error) =>
        void host.report?.(error, { tags: { step: 'main thread' } }),
    })
  })()
  let close = host.close
  host.close = async (code) => {
    await done.catch(() => {})
    unwatch()
    try {
      await profile?.close()
    } finally {
      await close(code)
    }
  }
  return done
}

/** The graph a config names, open for the roles a command's own thread serves,
 * with duties available to a host that explicitly starts them. `--no-duties`
 * disables inline duties, not external web recovery; config `duties: false`
 * disables both. Assembled once per config path and roles; {@link close}
 * closes it when the command is done. */
export let opened = (
  path: string,
  roles: Role[],
  duties = true,
  readOnly = false,
): Promise<Served> => {
  let key = JSON.stringify([path, roles, readOnly])
  let host = hosts.get(key)
  if (!host) hosts.set(key, host = open(path, roles, duties, readOnly))
  return host
}

/** The independent duty process. Its graph is registered with the same wind
 * down path as any command: stop claims, finish in-flight work, then close.
 * Readiness means the pool's handlers and graph are assembled, not that old
 * singleton services have surrendered their leases. */
export let work = async (
  path: string,
  ready?: string,
  only?: string[],
  tethered = false,
  process?: string,
): Promise<void> => {
  let config = read(path)
  let lives = await lifetime(
    dbOf(config),
    tethered ? system.stdin.readable : undefined,
  )
  let said = await declarations(config)
  let duties = dutyRoles(
    config,
    said.pooled,
    [],
    (p, name) => said.facets[p].includes(name),
  )
  let roles = workerRoles(config, duties, only, process)
  let key = JSON.stringify([path, roles])
  let reader = lend(path, config)
  let opening = compose(config, roles, facet, { reader }).catch(
    async (error) => {
      await reader?.close()
      throw error
    },
  )
  hosts.set(key, opening)
  let host = await opening
  // A worker's thread is watched as a web's is, once its reader has started:
  // a stall says what held it. A reader that cannot start is reported, and
  // its reads stay here.
  let started = reader?.ready().catch((error) =>
    host.report?.(error, { tags: { step: 'read' } })
  )
  watched(host, started).catch((error) =>
    host.report?.(error, { tags: { step: 'main thread sampling' } })
  )
  await host.bury()
  let { reconcile } = await import('@yaks/tools')
  let timer = setInterval(() => {
    void lives().then((live) => {
      if (!live) host.stop()
    }, (error) => {
      console.error(error)
      host.stop()
    })
  }, 1000)
  let running = Promise.all([host.duties(), reconcile(host.runner)])
  try {
    if (ready) {
      // Readiness identifies the launcher a caller owns and signals. The
      // graph's process row identifies the child running these duties.
      await disk.writeTextFile(
        ready,
        `${readinessPid()}\n`,
      )
    }
    await running
  } finally {
    clearInterval(timer)
    if (ready) {
      await disk.remove(ready).catch((error) => {
        if (!(error instanceof disk.errors.NotFound)) throw error
      })
    }
  }
}

export { close, cut, stop } from './held.ts'

/** Who a command line writes as: the answer the host's door gives a request
 * naming this line's session in `x-via`, exactly as it answers one arriving
 * over HTTP (@yaks/session/graph), so a session's writes are its own however
 * they reached the graph. A door that knows no such session answers this
 * process ({@link writer} in ./host.ts), and a line with no session, typed at a
 * terminal, writes as the config's `person` through it: an agent's shell always
 * names its session (run.ts `via`), so a keyboard with none is the person's. */
export let signer = async (
  host: Pick<Served, 'who' | 'config' | 'graph'>,
  via?: string,
  typed: boolean = system.stdin.isTerminal(),
): Promise<{ $actor?: Actor }> => {
  let actor = await host.who(
    new Request('http://localhost/', { headers: via ? { [VIA]: via } : {} }),
  )
  let by = !via && typed ? await person(host) : undefined
  if (by) return { $actor: { ...actor, by } }
  return actor ? { $actor: { ...actor } } : {}
}

/** Restore supplied server-owned values through normal graph admission,
 * guards, rules, stamps and journaling. The journal writer is the current
 * caller; historical component values do not grant their author authority. */
export let restoreInto = (
  graph: Graph,
  bundles: Bundle[],
  actor: Actor | null,
  opts: { check?: boolean; stamp?: boolean } = {},
): Bundle[] | Promise<Bundle[]> =>
  graph.apply(signed(bundles, actor), { ...opts, trusted: true })

/** The filesystem command's restoration door, unavailable to remote calls. */
export let restore = async (
  args: Record<string, unknown>,
  c: Ctx,
): Promise<number> => {
  let host = await opened(c.config!, ['graph'], c.duties)
  let { $actor } = await signer(host, c.via)
  let bundles = await restoreInto(
    host.graph,
    args.bundles as Bundle[],
    $actor ?? null,
    { check: args.check === true, stamp: args.stamp !== false },
  )
  c.out(JSON.stringify(bundles, null, 2))
  return 0
}

// The views an answer is drawn with, imported when one is first drawn, never
// to list; one registry per listing.
let drawing = new WeakMap<
  Listing,
  { views: ReturnType<typeof registry>; seen: AnatomyObservation[] }
>()
let drawn = (listing: Listing, host: Served) => {
  let made = drawing.get(listing)
  if (!made) {
    let seen: AnatomyObservation[] = []
    let views = registry(plugins(listing), pluginViews, (o) => seen.push(o))
    drawing.set(listing, made = { views, seen })
  }
  for (let o of made.seen) host.observe?.(o)
  return made.views
}

let plugins = (listing: Listing) => (listing.config.plugins ?? []).map(used)

// The graph a listed command runs against, opened for the roles it declares,
// with the terminal controls the listing loaded written into its anatomy.
let opening = async (
  c: Ctx,
  declared: Pick<Declared, 'roles' | 'readOnly'>,
  listing: Listing,
): Promise<Served> => {
  let host = await opened(
    c.config!,
    rolesOf(declared, listing.said.pooled),
    c.duties,
    !!declared.readOnly,
  )
  for (let { plugin, value } of listing.said.controls) {
    host.observe?.({
      package: plugin,
      facet: 'cli',
      loaded: value !== null,
      bound: true,
      value,
    })
  }
  return host
}

// A server's tool lasts for the process lifetime; its HTTP/socket requests
// must be independent roots, not children of that command.
let spanOf = (
  host: Served,
  declared: { roles?: readonly string[]; name?: string },
) =>
  declared.roles?.includes('web') ? undefined : peek(host.graph)?.begin({
    kind: 'request',
    name: `cli ${declared.name}`,
    package: '@yaks/cli',
  })

/** One of the graph's tools, run as a command line asked: the graph opened
 * for it, the call made through the tool runner, and the answer printed. */
export let tool = async (
  c: Ctx,
  declared: Declared,
  args: Record<string, unknown>,
  listing: Listing,
): Promise<number> => {
  // A tool that declares terminal behavior receives the global display
  // choice through the same input it declares for every other argument.
  let props = declared.inputSchema?.properties
  if (props && typeof props == 'object' && 'tui' in props) {
    args.tui = c.tui
  }
  let host = await opening(c, declared, listing)
  // Write the `tool` rows a call's `to` points at first: a call naming an
  // entity nothing created would be a dangling reference. Done once per
  // process, by whichever caller gets there first (@yaks/tools `ensure`).
  if (!declared.readOnly) await host.runner.ensure([declared.name])
  let id = mint()
  let invoke = declared.readOnly ? host.runner.read : host.runner.call
  let call = {
    entity: { eid: id },
    call: { to: toolEid(declared.name), args: args ?? {} },
    ...await signer(host, c.via),
  }
  let landed = await during(spanOf(host, declared), () => invoke(call))
  // `--json` prints the answer as data, the same object an MCP client
  // reads as `structuredContent` (@yaks/tools `structured`).
  let answer = answerOf(landed, id)
  if (c.json) {
    c.out(JSON.stringify(structured(declared, answer), null, 2))
  } else if (!c.tui && !c.tty && host.text) {
    let text = await host.text(answer, declared)
    if (text) c.out(text)
  } else {
    await show(
      c,
      await drawn(listing, host),
      host.vocab,
      answer,
      c.tui || c.tty
        ? {
          views: await terminal(
            plugins(listing),
            pluginViews,
            pluginTui,
            host.observe,
          ),
          config: c.config,
        }
        : {},
      {
        lookup: (eids) => host.graph.get(eids),
        query: (q) => host.graph.read(q),
      },
      declared,
    )
  }
  // A refusal is data, not an exception: the text is printed either way
  // and the exit code is what reports which it was — taken from the runner,
  // since a tool that returns fault rows has not itself failed.
  return faulted(landed, id) ? 1 : 0
}

/** A plugin's terminal control, run against the graph opened for it. */
export let control = async (
  c: Ctx,
  declared: Omit<CliCommand, 'run'>,
  run: CliCommand['run'],
  args: Record<string, unknown>,
  listing: Listing,
): Promise<number> => {
  let host = await opening(c, declared, listing)
  return await during(spanOf(host, declared), () => run(args, host, c))
}
