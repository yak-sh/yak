// What a commit means about a transcript: the effect handlers exported as
// `@yaks/session/effects`.
//
// One component so far, and it is not one of this package's. A `process` row
// created here, where it is the row this run wrote for itself (@yaks/process
// `started`), means the application is starting up — and start-up is the one
// moment there is a fresh, reliable answer about the locks in this graph.
//
// Nothing expires on its own. A lease with a timeout would have to be renewed,
// and a worker that is merely thinking hard would lose its lock mid-edit, so
// the correction cannot be a sweep on a timer: it happens when a process opens
// the graph and can see which holders are sessions it still has (./reap.ts).
//
// The pass runs under a lease, because every process does this and only one of
// them should: a release is a write, and fifty of them made twice is fifty
// batches of nothing. The lease is taken and not released — the answer this
// pass wrote is good for as long as the lease stands, and the next process to
// find it expired runs the pass again.

import type { Eid, Graph } from '@yaks/graph'
import { take, type Watch } from '@yaks/effects'
import { reapLeases } from './reap.ts'

/** The name of @yaks/process's `process` component, written out here rather
 * than imported: that package imports this one's component names for a
 * process's output, and a component name is just a string in either
 * direction. */
export let PROCESS = 'process'

/** The lease name for the background job of freeing the locks whose holder is
 * gone — one process does it at a time. */
export let REAP = '@yaks/session'

/** What these handlers are given: the graph, the eid of this process's own
 * `process` row (@yaks/cli `Host.me`), and whether it runs background jobs
 * (@yaks/cli `Config.jobs`). */
export type Host = { graph: Graph; me: Eid; config?: { jobs?: boolean } }

/** The effect handlers this module exports: when this process's own `process`
 * row is created, free every lock whose holder is not a session in this graph.
 * They take no options — there is nothing to configure about a lock nobody
 * holds. */
export let effects = (host: Host): Watch[] => [{
  comp: PROCESS,
  doc: 'free the locks whose holder is gone, once per process start',
  created: async (e) => {
    if (e.entity.eid != host.me || host.config?.jobs == false) return
    if (!await take(host.graph, REAP, { holder: host.me })) return
    await reapLeases(host.graph.storage)
  },
}]
