// Where this door's calls live, and why they do not live in the caller's data.
//
// @yaks/tools records a tool call as it runs one: `call{to, args}` before,
// `result{call}` after. Every other host keeps that record in the graph the
// tools work on, and is right to: a call is a fact worth keeping. This door
// cannot. The
// graph @yaks/mcp is mounted on here is a composition over other people's app
// stores (agent.ts `reaching`) — it declares no `call` word, its `apply` routes
// every component to the app that owns it, and it runs no effect phase at all,
// so a call written there would be somebody's row in somebody's app. An app's own store (graph.ts `door`) declares no
// such word either: `call`, `result` and `tool` are not what a cookbook is
// about.
//
// So the invocation lives in a graph of its own, in memory, for the life of
// one door: the call, its result and the words a tool answered are written
// here and thrown away with the isolate. What that costs is the audit — a
// connector call leaves no trace a person can read afterwards, where a call on
// the fleet's own graph does. What it buys is that a stranger asking `about`
// writes nothing into anyone's store, and that a question is never mistaken
// for data.
//
// What a tool wrote still goes where it belongs. A bundle wearing nothing but
// invocation words is this graph's; anything else is the caller's data and is
// forwarded to the graph the tools work on, which routes each word to the app
// that owns it exactly as it always did. Nothing a read answered ever arrives
// here: @yaks/tools lands a reading tool's bookkeeping alone and hands its
// bundles straight back, so a query is never a patch of the rows it found.
//
// It speaks the door's whole vocabulary rather than a bare one, so a word it
// forwards is a word it can admit in the first place. Two that the platform
// and @yaks/tools both spell — `error` and `exception` — are declared here as
// the UNION of both meanings, so a refusal's `code` and a break row's
// `message` both land instead of one of them refusing the other.

import {
  type ApplyOpts,
  type Bundle,
  comps,
  type Graph,
  graph,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import {
  loadVocab,
  type PropSchema,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools'
import { appKeywords } from './vocab.ts'

/** The words an invocation is made of: what stays in the ledger. */
let INVOCATION = [
  'call',
  'result',
  'execution',
  'content',
  'output',
  'error',
  'exception',
  'tool',
]

/** The two words both vocabularies claim. */
let SHARED = ['error', 'exception']

// A document without the words the ledger declares itself.
let without = (doc: VocabDoc, names: string[]): VocabDoc => ({
  ...doc,
  $defs: Object.fromEntries(
    Object.entries(doc.$defs ?? {}).filter(([name]) => !names.includes(name)),
  ),
})

// A property of a shared word as the ledger takes it: plainly, whoever wrote
// it. The platform's own are `stamped` — the server writes them, a client may
// not — and an untrusted landing would drop exactly the values a read came back
// with, so here they are ordinary properties on an ordinary in-memory row.
let told = (props: Record<string, PropSchema>): PropSchema => ({
  component: true,
  type: 'object',
  properties: props,
})

// `error` and `exception` as both vocabularies mean them: what @yaks/tools
// writes about a refused call, and what a break row in an app carries.
let both: Record<string, PropSchema> = {
  error: told({
    code: { type: 'string' },
    at: { type: 'string', format: 'date-time' },
    message: { type: 'string' },
  }),
  exception: told({
    at: { type: 'string', format: 'date-time' },
    message: { type: 'string' },
    stack: { type: 'string' },
    request: { type: 'string' },
    version: { type: 'number' },
  }),
}

// The ledger's own vocabulary: the door's words, with the invocation's added
// and the two they share declared once, widely enough for both.
// The invocation as the ledger declares it: @yaks/tools' own words and rules,
// with the two both vocabularies spell widened to mean both things.
let invocationDoc: VocabDoc = {
  title: 'invocation',
  $defs: { ...without(toolsDoc, SHARED).$defs, ...both },
}

let speaking = (speaks: Vocab): Vocab =>
  loadVocab([
    // Every word of the invocation comes from that one document, including
    // the ones the door's own vocabulary now carries: an app's store speaks
    // `call`, `result` and the two rules itself (vocab.ts `invocationDoc`),
    // and a word may only be declared once.
    ...speaks.docs.map((d) =>
      without(d, Object.keys(invocationDoc.$defs ?? {}))
    ),
    invocationDoc,
  ], appKeywords)

// Is this bundle the invocation's own? A bundle that says nothing at all — a
// bare delete — is the caller's, since what it deletes is their data.
let mine = (b: Bundle): boolean => {
  let said = comps(b)
  return said.length > 0 && said.every(([name]) => INVOCATION.includes(name))
}

/**
 * One door's call ledger: an in-memory graph speaking this door's words plus
 * the invocation vocabulary, for @yaks/mcp to record its calls in
 * (`Options.calls`). What a tool wrote passes through to `host`.
 */
export let ledger = (host: Graph): Graph => {
  let vocab = speaking(host.vocab)
  let self = graph({ vocab, storage: ram(vocab) })
  let door: Graph = {
    ...self,
    use: (plugin) => (self.use(plugin), door),
    // The caller's data first, the invocation's bookkeeping after. Two
    // stores are two transactions — nothing can make one batch of them — so
    // the order is what decides how a half-landed batch reads: a write the
    // store refuses takes the whole apply with it before a `result` or an
    // `execution{done}` has been written, which is what lets the runner
    // record the refusal as this call's failure. The other way round, a
    // refusal was already a success by the time it was raised. A check is a
    // check on both sides: dropped, it would keep what it was only checking.
    apply: async (bundles: Bundle[], opts?: ApplyOpts) => {
      let batch = (Array.isArray(bundles) ? bundles : [bundles]) as Bundle[]
      let here = batch.filter(mine)
      let there = batch.filter((b) => !mine(b))
      let sent = there.length ? await host.apply(there, opts) : []
      let kept = here.length ? await self.apply(here, opts) : []
      return [...sent, ...kept]
    },
  }
  return door
}
