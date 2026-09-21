// The graph THIS PROCESS opens. `yak --config yak.json task list` reads that
// config file, imports the plugins it names over the SQLite file it names,
// runs the tool right here and exits — no server, no socket, nothing
// listening.
//
// That is the ordinary way a `yak` command runs. SQLite in WAL mode accepts as
// many writers as there are commands running, each one serialized by the file
// itself, so nothing bottlenecks on a process somebody has to remember to
// start. `yak serve` is one more process over the same file, the one that
// answers HTTP.
//
// A command line runs a tool exactly as the HTTP server does: it writes a
// `call` row, the tool runner executes it, and what came back is printed. So
// the record of a tool a person typed and a tool an agent requested is
// identical, and the rules, the post-commit effects and the attribution are
// one set for both.
//
// This module is imported only by a command that named a config, because
// importing it opens a database and pulls in every plugin the config names — a
// cost `yak login` on a machine with no graph should not pay.

import { inputSchemaOf } from '@yaks/mcp'
import { answerOf, faulted, toolEid, worded } from '@yaks/tools'
import { read } from './config.ts'
import type { Command, Ctx } from './run.ts'
import { compose, type Served } from './serve.ts'

// One graph per config path, for the life of the process: listing the tools
// and running one use the same assembled graph, and opening the file twice
// would mean two writers in one process.
let held = new Map<string, Promise<Served>>()

// On the way in, a command does whatever is overdue and nobody else is doing:
// the effect sweep a crash interrupted, the scheduled wakes that came due
// while nothing was listening (`Served.duties` in serve.ts). It is handed a
// signal that has already aborted, so each background job runs exactly one
// pass and then releases its lease — a one-shot command is not a lesser kind
// of process, it is the only one there is on a machine where nobody runs a
// server, and a graph must not require one.
let drained = async (composing: Promise<Served>): Promise<Served> => {
  let host = await composing
  await host.duties(AbortSignal.abort())
  return host
}

/** The graph a config names, open — and whatever was overdue on it, done.
 * Assembled once per config path; {@link close} closes it when the command is
 * done. */
export let opened = (path: string): Promise<Served> => {
  let host = held.get(path)
  if (!host) held.set(path, host = drained(compose(read(path))))
  return host
}

/** Close every graph this process opened, stamping how the command ended on
 * the `process` row each of them holds. */
export let close = async (code?: number): Promise<void> => {
  // Awaited, because the last batch is a WRITE: a command that closed the file
  // without waiting would leave its own row saying it is still running.
  for (let host of held.values()) await (await host).close(code)
  held.clear()
}

/** The tools of the graph a config names, as subcommands a person types — the
 * list `cli` gathers when the command named a config (run.ts `more`). */
export let commands = async (c: Ctx): Promise<Command[]> => {
  let host = await opened(c.config!)
  return host.tools.map((declared) => ({
    ...declared,
    // The command line is parsed from the tool's own arguments as JSON Schema
    // — the same document `tools/list` sends — so a command typed against a
    // local graph and the same command typed against an MCP server are written
    // identically, even for a tool that declared its arguments in Zod
    // (@yaks/mcp `inputSchemaOf`). The Zod copy is dropped: a tool declares
    // its arguments once, and the runner still validates the call against the
    // tool's own declaration (@yaks/tools `checked`).
    input: undefined,
    inputSchema: inputSchemaOf(declared),
    run: async (args: Record<string, unknown>): Promise<number> => {
      // Write the `tool` rows a call's `to` points at first: a call naming an
      // entity nothing created would be a dangling reference. Done once per
      // process, by whichever caller gets there first (@yaks/tools `ensure`).
      await host.runner.ensure()
      let landed = await host.runner.call([{
        entity: { eid: '$call' },
        call: { to: toolEid(declared.name), args: JSON.stringify(args ?? {}) },
      }])
      c.out(
        c.json
          ? JSON.stringify(answerOf(landed), null, 2)
          : worded(answerOf(landed)),
      )
      // A refusal is data, not an exception: the text is printed either way
      // and the exit code is what reports which it was — taken from the runner,
      // since a tool that returns fault rows has not itself failed.
      return faulted(landed) ? 1 : 0
    },
  }))
}
