// Test fixtures (not published — see deno.json): a package's kinds, checked
// through a graph the way a writer meets them.

import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import {
  type Keywords,
  loadVocab,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { ram } from './mod.ts'

type Comps = Record<string, Record<string, unknown>>

// What an example points at, written first so its references land: each a
// `doc` unless the reference names the component its target carries.
let targets = (vocab: Vocab, example: Comps): Bundle[] =>
  Object.entries(example).flatMap(([comp, props]) =>
    Object.entries(props ?? {}).flatMap(([prop, value]) => {
      let to = vocab.def(comp)?.properties?.[prop]?.ref as string | undefined
      if (
        vocab.prop(comp, prop)?.category != 'ref' || typeof value != 'string'
      ) {
        return []
      }
      let at = to && to != 'entity' ? to : 'doc'
      return [{
        entity: { eid: value },
        [at]: at == 'doc' ? { title: value } : {},
      }]
    })
  )

/** Each example of each kind the first document declares, applied to an empty
 * graph over the documents, comes back named by its kind; the kinds are
 * answered in order. The other documents are what the examples name beside
 * the package's own components. */
export let examplesAreTheirKinds = (
  docs: VocabDoc[],
  keywords: Keywords[] = [],
): string[] => {
  let vocab = loadVocab(docs, keywords)
  let named: [string, string][] = []
  for (let [kind, k] of Object.entries(docs[0].kinds ?? {})) {
    for (let example of (k.examples ?? []) as Comps[]) {
      let g = graph({ vocab, storage: ram(vocab), provenance: false })
      g.apply(targets(vocab, example))
      let [b] = g.apply([{
        entity: { eid: '$example' },
        ...example,
      }]) as Bundle[]
      named.push([kind, vocab.kindOf(b as Record<string, unknown>)])
    }
  }
  assertEquals(named.map(([, at]) => at), named.map(([k]) => k))
  return named.map(([k]) => k)
}
