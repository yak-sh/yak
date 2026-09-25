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
// A command line runs a tool exactly as the HTTP server does: it writes a
// `call` row, the tool runner executes it, and what came back is shown through
// the plugins' views (./answer.ts). So
// the record of a tool a person typed and a tool an agent requested is
// identical, and the rules, the post-commit effects and the attribution are
// one set for both.
//
// This module is imported only by a command that named a config, because
// importing it opens a database and pulls in every plugin the config names — a
// cost `yak login` on a machine with no graph should not pay.

import { offered } from '@yaks/graph'
import { answerOf, faulted, structured, toolEid } from '@yaks/tools'
import { registry, show } from './answer.ts'
import { read, used } from './config.ts'
import type { Command, Ctx } from './run.ts'
import { compose, type Served } from './host.ts'

// One graph per config path, for the life of the process: listing the tools
// and running one use the same assembled graph, and opening the file twice
// would mean two writers in one process.
let held = new Map<string, Promise<Served>>()

// On the way in, a command does whatever is overdue and nobody else is doing:
// the effect sweep a crash interrupted, the scheduled wakes that came due
// while nothing was listening (`Host.duties` in host.ts). It is handed a
// signal that has already aborted, so each duty runs exactly one
// pass and then releases its lease — a one-shot command is not a lesser kind
// of process, it is the only one there is on a machine where nobody runs a
// server, and a graph must not require one.
let drained = async (composing: Promise<Served>): Promise<Served> => {
  let host = await composing
  await host.duties(AbortSignal.abort())
  return host
}

/** The graph a config names, open — and whatever was overdue on it, done,
 * unless `duties` is false (`--no-duties`), which leaves every duty to
 * another process. Assembled once per config path;
 * {@link close} closes it when the command is done. */
export let opened = (path: string, duties = true): Promise<Served> => {
  let host = held.get(path)
  if (!host) {
    let config = read(path)
    held.set(
      path,
      host = drained(compose(duties ? config : { ...config, duties: false })),
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

/** The tools of the graph a config names that are offered on a command line,
 * as subcommands a person types — the list `cli` gathers when the command
 * named a config (run.ts `more`). */
export let commands = async (c: Ctx): Promise<Command[]> => {
  let host = await opened(c.config!, c.duties)
  // The views are imported when an answer is first drawn, never to list.
  let views: ReturnType<typeof registry> | undefined
  let drawn = () =>
    views ??= registry((read(c.config!).plugins ?? []).map(used))
  return host.tools.filter(offered('cli')).map((declared) => ({
    ...declared,
    // A tool arrives declaring its arguments as JSON Schema — the same
    // document `tools/list` sends — so a command typed against a local graph
    // and the same command typed against an MCP server are written
    // identically. Nothing is converted here: a transport that wants them in
    // another form restates them on its own side (@yaks/mcp `core`).
    run: async (args: Record<string, unknown>): Promise<number> => {
      // Write the `tool` rows a call's `to` points at first: a call naming an
      // entity nothing created would be a dangling reference. Done once per
      // process, by whichever caller gets there first (@yaks/tools `ensure`).
      await host.runner.ensure()
      let landed = await host.runner.call([{
        entity: { eid: '$call' },
        call: { to: toolEid(declared.name), args: args ?? {} },
      }])
      // `--json` prints the answer as data, the same object an MCP client
      // reads as `structuredContent` (@yaks/tools `structured`).
      let answer = answerOf(landed)
      if (c.json) {
        c.out(JSON.stringify(structured(declared, answer), null, 2))
      } else await show(c, await drawn(), host.vocab, answer)
      // A refusal is data, not an exception: the text is printed either way
      // and the exit code is what reports which it was — taken from the runner,
      // since a tool that returns fault rows has not itself failed.
      return faulted(landed) ? 1 : 0
    },
  }))
}
