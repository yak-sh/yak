// Shared test fixtures (not part of the published package — see deno.json): a
// graph with personas in it, over @yaks/ram, so the tests need no database and
// no server.
//
// The two edge relations are declared here rather than imported: `contains` is
// @yaks/task's and `reads` is @yaks/kernel's, and a test of what a persona
// includes has no business loading a to-do list to find out. A composed server
// loads the packages that own them; this declares the same two components.

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
    contains: { component: true, type: 'object', edge: true },
    reads: { component: true, type: 'object', edge: true },
    memory: { component: true, type: 'object', kind: true, prefix: 'M' },
  },
}

/** A vocabulary with the persona components, both relations, and ids. */
export let said: Vocab = loadVocab(
  [edgeDoc, docDoc, personaDoc, doc],
  [edgeKeywords, idKeywords],
)

let { contains: _carries, ...rest } = doc.$defs ?? {}

/** The same vocabulary without `contains` — a server that did not compose
 * @yaks/task. */
export let thin: Vocab = loadVocab(
  [edgeDoc, docDoc, personaDoc, { $defs: rest }],
  [edgeKeywords, idKeywords],
)

/** A graph over a fresh in-memory store. */
export let world = (vocab: Vocab = said): Graph =>
  graph({ storage: ram(vocab, { number: true }), vocab })

/** The storage a graph is keeping its entities in. */
export let held = (g: Graph): Storage => g.storage

/** One entity with a `doc` on it, plus any other components given. */
export let says = (
  eid: string,
  title: string,
  body: string,
  wears: Record<string, Comp> = {},
): Bundle => ({ ...wears, entity: { eid }, doc: { title, body } })

/** A persona: a doc whose body is the instruction text. */
export let voiced = (eid: string, title: string, body: string): Bundle =>
  says(eid, title, body, { persona: {} })

/** A memory: a doc somebody wrote. */
export let memory = (eid: string, title: string, body: string): Bundle =>
  says(eid, title, body, { memory: {} })

export { link }
