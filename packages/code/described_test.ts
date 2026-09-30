// A graph describing the vocabulary it is served with, as the vocabulary a
// store is served with changes under it.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Comp, graph, identityEid } from '@yaks/graph'
import { gitDoc } from '@yaks/git'
import { ram } from '@yaks/ram'
import { loadVocab, metaDoc, type PropSchema, type VocabDoc } from '@yaks/vocab'
import { codeDoc } from './vocab.ts'
import { described } from './described.ts'

let entity = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}
let base = [entity, edgeDoc, gitDoc, docDoc, codeDoc, metaDoc]

let note = (properties: Record<string, PropSchema>, before = ['doc']) => ({
  component: true,
  type: 'object',
  kind: true,
  before,
  properties,
})
let p = (props: Record<string, PropSchema>, before?: string[]): VocabDoc => ({
  package: '@t/p',
  $defs: { note: note(props, before) },
})
let q: VocabDoc = {
  package: '@t/q',
  $defs: {
    note: {
      component: true,
      extends: true,
      properties: { c: { type: 'boolean' } },
    },
  },
}

// One store, each graph over it served with its own vocabulary, as a server
// restarted over new code is; `serve` also describes it, as a worker starting
// does (./effects.ts).
let store = () => {
  let storage = ram(loadVocab(base, [edgeKeywords]))
  return async (docs: VocabDoc[]) => {
    let vocab = loadVocab([...base, ...docs], [edgeKeywords])
    let g = graph({ storage, vocab, plugins: [edges(vocab)] })
    await g.apply(await described(g, g.vocab.docs), { trusted: true })
    return g
  }
}

test('a graph describes what it is served with, and stops describing what it is not', async () => {
  let serve = store()
  let g = await serve([])
  // What the codebase says of the package: its manifest's description.
  await g.apply([{
    entity: { eid: '$m' },
    package: { name: '@t/p' },
    doc: { title: '@t/p', body: 'Notes.' },
  }])
  g = await serve([p({ a: { type: 'string' }, b: { type: 'number' } }), q])
  let titles = async (q: string) =>
    (await g.read(`${q} ?doc`)).map((b) => (b.doc as Comp).title).sort()
  let note = identityEid('_comp', ['note'])
  let befores = async () => (await g.read(`._before .edge.from=${note}`)).length

  assertEquals(await titles('._package'), ['@t/p', '@t/q'])
  let [pkg] = await g.read('._package.name=@t/p ?doc')
  assertEquals((pkg.doc as Comp).body, 'Notes.')
  assertEquals(await titles('._comp.package._package.name=@t/p'), ['note'])
  assertEquals(await titles('._prop.comp._comp.name=note'), [
    'note.a',
    'note.b',
    'note.c',
  ])
  assertEquals(await titles('._prop.package._package.name=@t/q'), ['note.c'])
  assertEquals(await befores(), 1)
  // Described already, so a worker starting writes nothing.
  assertEquals(await described(g, g.vocab.docs), [])

  // A property and a `before` no longer served are cleared, and so is a
  // package no longer listed, with what it added.
  g = await serve([p({ a: { type: 'string' } }, [])])
  assertEquals(await titles('._prop.comp._comp.name=note'), ['note.a'])
  assertEquals(await titles('._package'), ['@t/p'])
  assertEquals(await befores(), 0)

  // A component no longer served is cleared; served again, it is back on
  // the same entity.
  g = await serve([])
  assertEquals(await titles('._comp.name=note'), [])
  g = await serve([p({ a: { type: 'string' } })])
  assertEquals((await g.read('._comp.name=note'))[0].entity.eid, note)
})
