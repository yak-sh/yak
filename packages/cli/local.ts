// The graph THIS PROCESS opens. `yak --config yak.json task list` reads that
// config, composes the plugins it names over the SQLite file it names, runs
// the tool right here and exits — no server, no socket, nothing listening.
//
// That is the ordinary way a `yak` line runs. SQLite in WAL mode takes as many
// writers as there are lines typed, each one serialized by the file itself, so
// nothing bottlenecks on a process somebody has to remember to start. `yak
// serve` is one more process over the same file, the one that answers HTTP.
//
// A line runs a tool the same way a door does: it writes a CALL, the runner
// answers it, and what came back is printed. So the transcript says the same
// thing about a tool a person typed and a tool an agent asked for, and the
// rules, the effects and the attribution are one set for both.
//
// It is imported only by a line that named a config, because importing it
// opens a database and pulls in every plugin the config names — a cost `yak
// login` on a box with no graph should not pay.

import { answerOf, faulted, toolEid, worded } from '@yaks/tools'
import { read } from './config.ts'
import type { Command, Ctx } from './run.ts'
import { compose, type Served } from './serve.ts'

// One graph per config path, for the life of the process: the table of tools
// and the line that runs one are the same composition, and opening the file
// twice would be two writers in one process.
let held = new Map<string, Promise<Served>>()

/** The graph a config names, open. Composed once per path; {@link close}
 * lets it go when the line is done. */
export let opened = (path: string): Promise<Served> => {
  let host = held.get(path)
  if (!host) held.set(path, host = compose(read(path)))
  return host
}

/** Let go of every graph this process opened. */
export let close = async (): Promise<void> => {
  for (let host of held.values()) (await host).close()
  held.clear()
}

/** The tools of the graph a config names, as commands a person types — the
 * table a `cli` gathers where the line named a config (run.ts `more`). */
export let commands = async (c: Ctx): Promise<Command[]> => {
  let host = await opened(c.config!)
  return host.tools.map((tool) => ({
    ...tool,
    run: async (args: Record<string, unknown>): Promise<number> => {
      // The `tool` rows a call's `to` points at, first: a call naming an
      // entity nothing minted would be a dangling reference. Once per process,
      // whoever asks (@yaks/tools `ensure`).
      await host.runner.ensure()
      let landed = await host.runner.call([{
        entity: { eid: '$call' },
        call: { to: toolEid(tool.name), args: JSON.stringify(args ?? {}) },
        ...(host.config.actor ? { $actor: { by: host.config.actor } } : {}),
      }])
      c.out(
        c.json
          ? JSON.stringify(answerOf(landed), null, 2)
          : worded(answerOf(landed)),
      )
      // A refusal is data, not a throw: the words are printed either way and
      // the exit code is what says which it was — the runner's own word, since
      // a tool that ANSWERS fault rows did not fail.
      return faulted(landed) ? 1 : 0
    },
  }))
}
