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
// Listing the commands opens nothing: the tools a graph offers are declared in
// its plugins' `./vocab` (host.ts `words`), so the usage page, a help page and
// a mistyped word cost no database. Running one opens the graph for the roles
// that command's process serves (host.ts `compose`): the graph, and whatever
// else its tool declares it needs — `serve` answers HTTP, so its process
// serves `web`.
//
// A command line runs a tool exactly as the HTTP server does: it writes a
// `call` row, the tool runner executes it, and what came back is shown through
// the plugins' views (./answer.ts). So the record of a tool a person typed and
// a tool an agent requested is identical, and the rules, the post-commit
// effects and the attribution are one set for both.
//
// The effect pool and the plugins' services are never this thread's. Where no
// process that stays up is running them, a thread of this process takes them
// (./thread.ts), so the command and the answer it draws are never waiting on a
// letter being sent; where one is, this process never imports their code.
//
// This module is imported only by a command that named a config, because
// importing it pulls in the graph and every plugin's words — a cost `yak login`
// on a machine with no graph should not pay.

import { type Actor, type Eid, type Graph, offered } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { EFFECT, held, type Lease, working } from '@yaks/effects'
import { answerOf, faulted, structured, toolEid } from '@yaks/tools'
import { registry, show, terminal } from './answer.ts'
import { type Config, exported, read, used } from './config.ts'
import { VIA } from './rpc.ts'
import type { Command, Ctx } from './run.ts'
import {
  compose,
  type Declared,
  facet,
  type Role,
  type Served,
  words,
} from './host.ts'
import { type Aside, thread } from './thread.ts'

// One graph per config path and set of roles, for the life of the process:
// every call a command makes goes through the same assembled graph, and
// opening the file twice for the same roles would mean two writers in one
// process for no reason.
let hosts = new Map<string, Promise<Served>>()
// The duty threads those graphs started, for a close that cannot wait on them.
let asides = new Set<Aside>()

/**
 * The roles a command's own thread serves: the graph, and whatever its tool
 * declares it needs — `serve` answers HTTP, so it serves `web`. The effect
 * pool and the plugins' services are not among them ({@link unserved}); the
 * one exception is a graph that keeps no pool (`pooled` false), whose effects
 * can only run where they were committed.
 *
 * TODO(T-39522): a process that stays up takes the roles its config gives it;
 * which config key says so is Jeff's to pick.
 */
export let rolesOf = (
  tool: Pick<Declared, 'roles'>,
  pooled: boolean,
): Role[] => [
  ...new Set(['graph', ...pooled ? [] : ['effects'], ...tool.roles ?? []]),
]

/** The duty roles of a config's graph that a process serving `mine` does not
 * cover already: the effect pool, where the graph keeps one, and each plugin's
 * service. A plugin that exports no `./service` has none (`has`, the resolver
 * asked rather than the module imported). */
export let dutiesOf = (
  vocab: Vocab,
  config: Config,
  mine: readonly Role[],
  has: (plugin: string, facet: string) => boolean = exported,
): Role[] =>
  [
    ...vocab.comp(EFFECT) ? ['effects'] : [],
    ...(config.plugins ?? []).map(used).filter((p) => has(p, 'service')),
  ].filter((r) => !mine.includes(r))

// Whether a lease is held, right now, by a process other than this one.
let taken = (lease: Lease | undefined, me: Eid, now: number): boolean =>
  !!lease?.holder && lease.holder != me &&
  Date.parse(String(lease.until)) > now

/** The duty roles no live process is serving: the effect pool where no
 * process that stays up is working it (@yaks/effects `working`), and each
 * service whose lease nobody live holds. A holder known to have ended without
 * letting go (`gone`) serves nothing. */
export let unserved = async (
  g: Graph,
  roles: readonly Role[],
  me: Eid,
  now: number = Date.now(),
  gone?: (holder: Eid) => boolean | Promise<boolean>,
): Promise<Role[]> => {
  let busy = await Promise.all(
    roles.map(async (r) => {
      if (r == 'effects') return await working(g, { except: me, now, gone })
      let lease = await held(g, r)
      return taken(lease, me, now) && !await gone?.(lease!.holder as Eid)
    }),
  )
  return roles.filter((_, i) => !busy[i])
}

// The graph a command opens: composed for its own roles, with its duty roles
// handed to a thread beside it. Where one of them is idle, the thread starts
// now and runs one pass of each idle one on the way in — beside the command,
// never ahead of it, and never on a role another process is serving, which
// would only be a second writer waiting on the same lock; where all are
// served, it starts only if the process asks for its duties to go on
// (`serve`). A command passing through is not a lesser kind of process: on a
// machine where nobody runs a server it is the only one there is, and a graph
// must not require one.
let open = async (
  path: string,
  roles: Role[],
  duties: boolean,
): Promise<Served> => {
  let config = read(path)
  if (!duties) return compose({ ...config, duties: false }, roles)
  let aside = thread()
  asides.add(aside)
  let host = await compose(config, roles, facet, { thread: aside })
  try {
    let duties = dutiesOf(host.vocab, config, roles)
    aside.plan({ config: path, roles: duties, me: host.me })
    let idle = await unserved(
      host.graph,
      duties,
      host.me,
      Date.now(),
      host.gone,
    )
    if (idle.length) aside.start(idle)
  } catch (error) {
    await host.close()
    throw error
  }
  void host.duties(AbortSignal.abort())
  return host
}

/** The graph a config names, open for the roles a command's own thread serves,
 * with a thread doing what is overdue on it beside the command — unless
 * `duties` is false (`--no-duties`), which leaves every duty to another
 * process. Assembled once per config path and roles; {@link close} closes it
 * when the command is done. */
export let opened = (
  path: string,
  roles: Role[],
  duties = true,
): Promise<Served> => {
  let key = JSON.stringify([path, roles])
  let host = hosts.get(key)
  if (!host) hosts.set(key, host = open(path, roles, duties))
  return host
}

/** Ask every graph this process opened to wind down (host.ts `stop`), so the
 * command in flight can finish and return on its own. False when it opened
 * none, and there is nothing to wait for. */
export let stop = (): boolean => {
  for (let host of hosts.values()) host.then((h) => h.stop(), () => {})
  return hosts.size > 0
}

/** Stop waiting on what is winding down: every duty thread this process
 * started is ended where it stands (./thread.ts `end`), so a close waiting on
 * one goes on to its last write. What the grace running out, or a second
 * signal, does before it closes (./signal.ts). */
export let cut = (): void => asides.forEach((a) => a.end())

/** Close every graph this process opened, stamping how the command ended on
 * the `process` row each of them holds. */
export let close = (code?: number): Promise<void> =>
  // One close at a time: a signal's (./signal.ts) and the command's own
  // ending can arrive together, and the second waits on the first.
  closing ??= (async () => {
    // Awaited, because the last batch is a write: a command that closed the
    // file without waiting would leave its own row saying it is still running.
    // A graph that failed to open has nothing to close, and the command said
    // why.
    for (let host of hosts.values()) {
      await (await host.catch(() => undefined))?.close(code)
    }
    hosts.clear()
    asides.clear()
  })().finally(() => closing = undefined)

let closing: Promise<void> | undefined

/** Who a command line writes as: the answer the host's door gives a request
 * naming this line's session in `x-via`, exactly as it answers one arriving
 * over HTTP (@yaks/session/rules), so a session's writes are its own however
 * they reached the graph. A door that knows no such session answers this
 * process ({@link writer} in ./host.ts), and a line with no session, typed at a
 * terminal, writes as the config's `person` through it: an agent's shell always
 * names its session (run.ts `via`), so a keyboard with none is the person's. */
export let signer = async (
  host: Pick<Served, 'who' | 'config' | 'graph'>,
  via?: string,
  typed: boolean = Deno.stdin.isTerminal(),
): Promise<{ $actor?: Actor }> => {
  let actor = await host.who(
    new Request('http://localhost/', { headers: via ? { [VIA]: via } : {} }),
  )
  let said = !via && typed ? host.config.person : undefined
  if (said) {
    let by = (await host.graph.address([said])).get(said) ?? said
    return { $actor: { ...actor, by } }
  }
  return actor ? { $actor: { ...actor } } : {}
}

/** The tools of the graph a config names that are offered on a command line,
 * as subcommands a person types — the list `cli` gathers when the command
 * named a config (run.ts `more`). Read off the plugins' words: nothing is
 * opened until one of them runs. */
export let commands = async (c: Ctx): Promise<Command[]> => {
  let config = read(c.config!)
  let said = await words(config)
  // The views are imported when an answer is first drawn, never to list.
  let plugins = () => (config.plugins ?? []).map(used)
  let views: ReturnType<typeof registry> | undefined
  let drawn = () => views ??= registry(plugins())
  return said.tools().filter(offered('cli')).map((declared) => ({
    ...declared,
    // A tool arrives declaring its arguments as JSON Schema — the same
    // document `tools/list` sends — so a command typed against a local graph
    // and the same command typed against an MCP server are written
    // identically. Nothing is converted here: a transport that wants them in
    // another form restates them on its own side (@yaks/mcp `core`).
    run: async (args: Record<string, unknown>): Promise<number> => {
      let host = await opened(
        c.config!,
        rolesOf(declared, !!said.vocab.comp(EFFECT)),
        c.duties,
      )
      // Write the `tool` rows a call's `to` points at first: a call naming an
      // entity nothing created would be a dangling reference. Done once per
      // process, by whichever caller gets there first (@yaks/tools `ensure`).
      await host.runner.ensure()
      let landed = await host.runner.call({
        entity: { eid: '$call' },
        call: { to: toolEid(declared.name), args: args ?? {} },
        ...await signer(host, c.via),
      })
      // `--json` prints the answer as data, the same object an MCP client
      // reads as `structuredContent` (@yaks/tools `structured`).
      let answer = answerOf(landed)
      if (c.json) {
        c.out(JSON.stringify(structured(declared, answer), null, 2))
      } else {
        await show(
          c,
          await drawn(),
          host.vocab,
          answer,
          c.tui ? { views: await terminal(plugins()), config: c.config } : {},
          {
            lookup: (eids) => host.graph.get(eids),
            query: (q) => host.graph.read(q),
          },
          !declared.readOnly,
        )
      }
      // A refusal is data, not an exception: the text is printed either way
      // and the exit code is what reports which it was — taken from the runner,
      // since a tool that returns fault rows has not itself failed.
      return faulted(landed) ? 1 : 0
    },
  }))
}
