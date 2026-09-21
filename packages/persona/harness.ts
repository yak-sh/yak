// Shared test fixtures (not part of the published package — see deno.json): a
// graph with personas in it, over @yaks/ram, so the tests need no database and
// no host.
//
// The two tier relations are stated here rather than imported: `contains` is
// @yaks/task's word and `reads` is @yaks/kernel's, and a test of what a persona
// holds has no business loading a to-do list to say so. A composed host loads
// the packages that own them; this loads the same two words.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import {
  type Bundle,
  type Comp,
  type Graph,
  graph,
  type Storage,
} from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { docDoc } from '@yaks/doc'
import { idKeywords } from '@yaks/id'
import { ram } from '@yaks/ram'
import { personaDoc } from './comp.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    contains: { component: true, type: 'object', relation: true },
    reads: { component: true, type: 'object', relation: true },
    memory: { component: true, type: 'object', kind: true, prefix: 'M' },
  },
}

/** A vocabulary with the persona words, both tier relations, and ids. */
export let said: Vocab = loadVocab(
  [edgeDoc, docDoc, personaDoc, doc],
  [edgeKeywords, idKeywords],
)

let { contains: _carries, ...rest } = doc.$defs ?? {}

/** The same vocabulary with no `contains` — a host that composed no @yaks/task. */
export let thin: Vocab = loadVocab(
  [edgeDoc, docDoc, personaDoc, { $defs: rest }],
  [edgeKeywords, idKeywords],
)

/** A graph over a fresh in-memory store. */
export let world = (vocab: Vocab = said): Graph =>
  graph({ storage: ram(vocab, { number: true }), vocab })

/** The storage a graph is keeping its entities in. */
export let held = (g: Graph): Storage => g.storage

/** One entity with a doc on it, plus whatever else it wears. */
export let says = (
  eid: string,
  title: string,
  body: string,
  wears: Record<string, Comp> = {},
): Bundle => ({ ...wears, entity: { eid }, doc: { title, body } })

/** A persona: a doc that is the voice. */
export let voiced = (eid: string, title: string, body: string): Bundle =>
  says(eid, title, body, { persona: {} })

/** A memory: a doc somebody said. */
export let memory = (eid: string, title: string, body: string): Bundle =>
  says(eid, title, body, { memory: {} })

export { link }
