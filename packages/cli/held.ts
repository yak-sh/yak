// The graphs this process holds open, however each was opened (./local.ts),
// and how they end: what a command does with them when it is done or
// interrupted (./yak.ts), whether or not it opened any. A module of its own,
// so a command that opens nothing never loads the code that opens a graph.

import type { Aside } from '@yaks/threads'
import type { Served } from './host.ts'

/** One graph per config path and set of roles, for the life of the process:
 * every call a command makes goes through the same assembled graph, and
 * opening the file twice for the same roles would mean two writers in one
 * process for no reason. */
export let hosts = new Map<string, Promise<Served>>()

/** The duty threads those graphs started, for a close that cannot wait on
 * them. */
export let asides = new Set<Aside<string>>()

/** Ask every graph this process opened to wind down (host.ts `stop`): it
 * takes no new request, effect or step, and the command in flight finishes
 * what it started and returns on its own. False when it opened none, and
 * there is nothing to wait for. */
export let stop = (): boolean => {
  for (let host of hosts.values()) host.then((h) => h.stop(), () => {})
  return hosts.size > 0
}

/** Stop waiting on what is winding down: every duty thread this process
 * started is ended where it stands (@yaks/threads `end`), so a close waiting on
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
