// What a commit MEANS about a transcript: the `effects` facet a host takes
// (`@yaks/session/effects`).
//
// One word so far, and it is not one of this package's. A `process` born here,
// where it is the row THIS RUN wrote for itself (@yaks/process `started`), is
// the host starting — and start-up is the one moment there is a fresh, honest
// answer about the locks in this graph.
//
// Nothing expires on its own. A lease with a timeout would have to be renewed,
// and a worker that is merely thinking hard would lose its lock mid-edit, so
// the correction cannot be a sweep on a clock: it happens when a process opens
// the graph and can see which holders are sessions it still has (./reap.ts).
//
// The duty is leased, because every process does this and only one of them
// should: a release is a write, and fifty of them made twice is fifty batches
// of nothing. It is taken and not handed back — the answer this pass wrote is
// good for as long as the take stands, and the next process to find it lapsed
// asks the question again.

import type { Eid, Graph } from '@yaks/graph'
import { take, type Watch } from '@yaks/effects'
import { reapLeases } from './reap.ts'

/** The component a process wears (@yaks/process), said here rather than
 * imported: that package reads this one's words for a process's output, and a
 * word is a string in both directions. */
export let PROCESS = 'process'

/** The duty of freeing the locks whose holder is gone — one process's at a
 * time. */
export let REAP = '@yaks/session'

/** What the facet is handed: the graph, and which process this one is
 * (@yaks/cli `Host.me`). */
export type Host = { graph: Graph; me: Eid }

/** The facet a host takes: at this process's own birth, free every lock whose
 * holder is not a session in this graph. It reads no options — there is
 * nothing to configure about a lock nobody holds. */
export let effects = (host: Host): Watch[] => [{
  comp: PROCESS,
  doc: 'free the locks whose holder is gone, once per process start',
  created: async (e) => {
    if (e.entity.eid != host.me) return
    if (!await take(host.graph, REAP, { holder: host.me })) return
    await reapLeases(host.graph.storage)
  },
}]
