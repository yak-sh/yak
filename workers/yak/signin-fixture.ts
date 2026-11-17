// The directory's sign-in rules (facets/signin-graph.ts) over a graph holding
// a test's rows, behind a Meta that counts its trips, for a test of what
// signin.ts asks of the store.
import { type Bundle, graph, type Taken } from '@yaks/graph'
import { ram } from '@yaks/ram'
import type { Meta } from './meta.ts'
import { platformVocab } from './vocab.ts'
import { plugins } from './facets/signin-graph.ts'
import type { Options } from './facets/store.ts'
import { type Signin, signinLine } from './signin.ts'

export let held = async (rows: Bundle[], now = () => Date.now()) => {
  let vocab = platformVocab()
  let storage = ram(vocab)
  await graph({ storage, vocab }).apply(rows, { trusted: true })
  let options = { store: { now } } as unknown as Options
  let g = graph({ storage, vocab, plugins: plugins(undefined, options) })
  let trips = 0
  let at: Meta = {
    query: async (q) => (trips++, await g.read(q as Taken)),
    apply: async (bundles) => (
      trips++, await g.apply(bundles, { trusted: true })
    ),
  }
  let read = async (address: string) =>
    (await g.read(signinLine(address))) as unknown as Signin[]
  return {
    at,
    graph: g,
    trips: () => trips,
    rows: read,
    tries: async (address: string) =>
      (await read(address)).map((r) => r.signin.tries),
  }
}
