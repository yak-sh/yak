// What start-up owes a managed session: the `boot` facet a host takes
// (`@yaks/spawn/boot`).
//
// The agent outlives the server on purpose, so a restart finds runs it has no
// memory of — a pid in a row, a log file with lines in it nobody has read. One
// pass picks both back up: liveness from the pidfile, and the transcript from
// where it stands.
//
// It is the facet rather than the effects factory because a boot is a MOMENT,
// not an observation: a one-shot command composes the same host to ask one
// question and must not adopt another process's children.

import type { Graph } from '@yaks/graph'
import { type Opts, resume } from './run.ts'
import type { Options } from './effects.ts'

/** What the facet is handed: the graph, once it is open. */
export type Host = { graph: Graph }

/** The boot pass, with providers of your own. */
export let booting =
  (o: Opts = {}) => async (host: Host, options: Options = {}): Promise<void> =>
    void await resume(host.graph, { ...options, ...o })

/** The facet a host takes: adopt every managed session still running. */
export let boot: (host: Host, options?: Options) => Promise<void> = booting()
