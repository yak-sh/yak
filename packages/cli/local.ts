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
// The effect pool and the plugins' services are never this thread's. A host
// that stays up explicitly starts them through `host.duties()` (./thread.ts),
// so a command passing through never claims work it cannot finish.
//
// This module is imported only by a command that named a config, because
// importing it pulls in the graph and every plugin's words — a cost `yak login`
// on a machine with no graph should not pay.

import { type Actor, mint, offered } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { EFFECT } from '@yaks/effects'
import { answerOf, faulted, structured, toolEid } from '@yaks/tools'
import { registry, show, terminal } from './answer.ts'
import { type Config, exported, read, used } from './config.ts'
import { VIA } from './rpc.ts'
import type { Command, Ctx } from './run.ts'
import {
  compose,
  dbOf,
  type Declared,
  facet,
  person,
  type Role,
  type Served,
  words,
} from './host.ts'
import { external } from './external.ts'
import { readThread } from './read_thread.ts'
import { type Aside, thread } from './thread.ts'
import { reconcile } from '@yaks/tools'

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
 * pool and the plugins' services are not among them ({@link dutiesOf}); the
 * one exception is a graph that keeps no pool (`pooled` false), whose effects
 * can only run where they were committed.
 *
 * TODO(T-39522): a process that stays up takes the roles its config gives it;
 * which config key says so is the owner's to pick.
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

// The graph a command opens: composed for its own roles, with its duty roles
// external for web, otherwise planned in a thread beside it. Only a host
// explicitly serving duties starts that thread. Every commit still records the effects it owes for a worker to
// claim, whether this command or another process wrote it.
let open = async (
  path: string,
  roles: Role[],
  duties: boolean,
): Promise<Served> => {
  let config = read(path)
  let reader = roles.includes('web') && dbOf(config) != ':memory:'
    ? readThread(path)
    : undefined
  let withReader = (host: Served): Served => {
    let close = host.close
    host.close = async (code) => {
      try {
        await close(code)
      } finally {
        await reader?.close()
      }
    }
    return host
  }
  if (!duties) {
    return withReader(
      await compose({ ...config, duties: false }, roles, facet, {
        reader,
      }),
    )
  }
  if (roles.includes('web')) {
    let host = await compose(config, roles, facet, { reader })
    try {
      await external(host.graph, path, dutiesOf(host.vocab, config, roles))
    } catch (error) {
      await host.close()
      await reader?.close()
      throw error
    }
    return withReader(host)
  }
  let aside = thread()
  asides.add(aside)
  let host = await compose(config, roles, facet, {
    thread: aside,
    reader,
  })
  try {
    aside.plan({ config: path, roles: dutiesOf(host.vocab, config, roles) })
  } catch (error) {
    await host.close()
    await reader?.close()
    throw error
  }
  return withReader(host)
}

/** The graph a config names, open for the roles a command's own thread serves,
 * with duties available to a host that explicitly starts them. `duties: false`
 * (`--no-duties`) disables them. Assembled once per config path and roles;
 * {@link close} closes it when the command is done. */
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

/** The independent duty process. Its graph is registered with the same wind
 * down path as any command: stop claims, finish in-flight work, then close.
 * Readiness means the pool's handlers and graph are assembled, not that old
 * singleton services have surrendered their leases. */
export let work = async (
  path: string,
  ready?: string,
  only?: string[],
): Promise<void> => {
  let config = read(path)
  let said = await words(config)
  let duties = dutiesOf(said.vocab, config, [])
  if (only?.some((role) => !duties.includes(role))) {
    throw new Error('work was asked for a role this config does not serve')
  }
  let roles = ['graph', ...only ?? duties]
  let key = JSON.stringify([path, roles])
  let opening = compose(config, roles, facet)
  hosts.set(key, opening)
  let host = await opening
  await host.bury()
  let running = Promise.all([host.duties(), reconcile(host.runner)])
  try {
    if (ready) await Deno.writeTextFile(ready, `${Deno.pid}\n`)
    await running
  } finally {
    if (ready) {
      await Deno.remove(ready).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error
      })
    }
  }
}

/** Ask every graph this process opened to wind down (host.ts `stop`): it
 * takes no new request, effect or step, and the command in flight finishes
 * what it started and returns on its own. False when it opened none, and
 * there is nothing to wait for. */
export let stop = (): boolean => {
  for (let host of hosts.values()) host.then((h) => h.stop(), () => {})
  return hosts.size > 0
}

/** Stop waiting on what is winding down: every duty thread this process
 * started is ended where it stands (./thread.ts `end`), so a close waiting on
 * one goes on to its last write. What a second interrupt does before it
 * closes (./yak.ts). */
export let cut = (): void => asides.forEach((a) => a.end())

/** Close every graph this process opened, stamping how the command ended on
 * the `process` row each of them holds. */
export let close = (code?: number): Promise<void> =>
  // One close at a time: an interrupt's (./yak.ts) and the command's own
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
  let by = !via && typed ? await person(host) : undefined
  if (by) return { $actor: { ...actor, by } }
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
  let direct = (await Promise.all(
    plugins().map(async (plugin) =>
      (await facet(plugin, 'cli'))?.commands ?? []
    ),
  )).flat()
  let tools = said.tools().filter(offered('cli')).map((declared) => ({
    ...declared,
    // A tool arrives declaring its arguments as JSON Schema — the same
    // document `tools/list` sends — so a command typed against a local graph
    // and the same command typed against an MCP server are written
    // identically. Nothing is converted here: a transport that wants them in
    // another form restates them on its own side (@yaks/mcp `core`).
    run: async (args: Record<string, unknown>): Promise<number> => {
      // A tool that declares terminal behavior receives the global display
      // choice through the same input it declares for every other argument.
      let props = declared.inputSchema?.properties
      if (props && typeof props == 'object' && 'tui' in props) {
        args.tui = c.tui
      }
      let host = await opened(
        c.config!,
        rolesOf(declared, !!said.vocab.comp(EFFECT)),
        c.duties,
      )
      // Write the `tool` rows a call's `to` points at first: a call naming an
      // entity nothing created would be a dangling reference. Done once per
      // process, by whichever caller gets there first (@yaks/tools `ensure`).
      await host.runner.ensure()
      let id = mint()
      let landed = await host.runner.call({
        entity: { eid: id },
        call: { to: toolEid(declared.name), args: args ?? {} },
        ...await signer(host, c.via),
      })
      // `--json` prints the answer as data, the same object an MCP client
      // reads as `structuredContent` (@yaks/tools `structured`).
      let answer = answerOf(landed, id)
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
      return faulted(landed, id) ? 1 : 0
    },
  }))
  let controls: Command[] = direct.map(({ run, ...declared }) => ({
    ...declared,
    run: async (args, context) => {
      let host = await opened(
        context.config!,
        rolesOf(declared, !!said.vocab.comp(EFFECT)),
        context.duties,
      )
      return await run(args, host, context)
    },
  }))
  return [...controls, ...tools]
}
