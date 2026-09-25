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
// This module is imported only by a command that named a config, because
// importing it pulls in the graph and every plugin's words — a cost `yak login`
// on a machine with no graph should not pay.

import { type Actor, offered } from '@yaks/graph'
import { answerOf, faulted, structured, toolEid } from '@yaks/tools'
import { registry, show, terminal } from './answer.ts'
import { type Config, read, used } from './config.ts'
import { VIA } from './rpc.ts'
import type { Command, Ctx } from './run.ts'
import {
  compose,
  dbOf,
  type Declared,
  every,
  type Role,
  type Served,
  words,
} from './host.ts'

// One graph per config path and set of roles, for the life of the process:
// every call a command makes goes through the same assembled graph, and
// opening the file twice for the same roles would mean two writers in one
// process for no reason.
let held = new Map<string, Promise<Served>>()

/**
 * The roles a command's process serves: the graph, the tool's own (`serve`
 * serves `web`), and the effects and every plugin's service, one pass of each
 * on the way in — so a machine with no server still gets its duties done. The
 * effects are worked by the command only where no process that stays up is
 * working them (@yaks/effects `work`); otherwise what it writes is left
 * written down for that process.
 *
 * TODO(T-39522): a command imports the effects and service facets only where
 * no live process serves them; and a process that stays up takes the roles
 * its config gives it rather than all of them.
 */
export let rolesOf = (
  config: Config,
  tool: Pick<Declared, 'roles'>,
): Role[] => [
  ...new Set([
    ...every(config).filter((r) => r != 'web'),
    ...tool.roles ?? [],
  ]),
]

// On the way in, a command does whatever is overdue and nobody else is doing:
// the effects nobody is working, the scheduled wakes that came due while
// nothing was listening (`Host.duties` in host.ts). It is handed a
// signal that has already aborted, so each duty runs exactly one
// pass and then releases its lease — a one-shot command is not a lesser kind
// of process, it is the only one there is on a machine where nobody runs a
// server, and a graph must not require one.
let drained = async (composing: Promise<Served>): Promise<Served> => {
  let host = await composing
  await host.duties(AbortSignal.abort())
  return host
}

/** The graph a config names, open for the roles a command's process serves —
 * and whatever was overdue on it, done, unless `duties` is false
 * (`--no-duties`), which leaves every duty to another process. Assembled once
 * per config path and roles; {@link close} closes it when the command is
 * done. */
export let opened = (
  path: string,
  roles: Role[],
  duties = true,
): Promise<Served> => {
  let key = JSON.stringify([path, roles])
  let host = held.get(key)
  if (!host) {
    let config = read(path)
    held.set(
      key,
      host = drained(
        compose(duties ? config : { ...config, duties: false }, roles),
      ),
    )
  }
  return host
}

/** Close every graph this process opened, stamping how the command ended on
 * the `process` row each of them holds. */
export let close = async (code?: number): Promise<void> => {
  // Awaited, because the last batch is a write: a command that closed the file
  // without waiting would leave its own row saying it is still running.
  for (let host of held.values()) await (await host).close(code)
  held.clear()
}

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
        rolesOf(config, declared),
        c.duties,
      )
      // Write the `tool` rows a call's `to` points at first: a call naming an
      // entity nothing created would be a dangling reference. Done once per
      // process, by whichever caller gets there first (@yaks/tools `ensure`).
      await host.runner.ensure()
      let landed = await host.runner.call([{
        entity: { eid: '$call' },
        call: { to: toolEid(declared.name), args: args ?? {} },
        ...await signer(host, c.via),
      }])
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
          c.tui
            ? { views: await terminal(plugins()), db: dbOf(host.config) }
            : {},
          {
            lookup: (eids) => host.graph.storage.tx((tx) => tx.get(eids)),
            query: (q) => host.graph.read(q),
          },
        )
      }
      // A refusal is data, not an exception: the text is printed either way
      // and the exit code is what reports which it was — taken from the runner,
      // since a tool that returns fault rows has not itself failed.
      return faulted(landed) ? 1 : 0
    },
  }))
}
