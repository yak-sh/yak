// What a host does about @yaks/code when a process starts: the
// `@yaks/code/effects` entry point, the code behind `vocab_describe`
// (./vocab.json). A `process` row is written by every process on its way in
// (@yaks/process `started`), and whichever process works the effects brings
// the graph's description of its vocabulary into line with the vocabulary it
// serves (./described.ts), trusted, since those rows are `wire: false`.
//
// A process starting is when the served vocabulary can change: a landed
// change reaches it when the server restarts, and a config lists or drops a
// plugin the same way. A graph that already describes it is checked by the
// hash its `_vocab` holds, and written nothing.

import type { Handlers } from '@yaks/effects'
import type { Graph } from '@yaks/graph'
import { described } from './described.ts'

/** What the handler is given: the graph. */
export type Host = { graph: Graph }

/** The graph's vocabulary described in it, whenever a process starts. */
export let effects = (host: Host): Handlers => ({
  vocab_describe: async () => {
    let g = host.graph
    let change = await described(g, g.vocab.docs)
    if (change.length) await g.apply(change, { trusted: true })
  },
})
