// A provider or a model is named where its eid is expected: at every door that
// resolves ids through Graph.address, a read, a write and a caller's lookup.

import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, type Comp, graph, identityEid } from '@yaks/graph'
import { kernelKeywords, spineDoc } from '@yaks/kernel'
import { nameKeywords } from '@yaks/names'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { modelDoc, models } from './mod.ts'

let using = {
  $defs: {
    using: {
      component: true,
      type: 'object',
      properties: {
        provider: { type: 'string', ref: 'provider', death: 'keep' },
        model: { type: 'string', ref: 'model', death: 'keep' },
      },
    },
  },
}

let shelf = () => {
  let vocab = loadVocab([spineDoc, modelDoc, using], [
    kernelKeywords,
    nameKeywords,
  ])
  let g = graph({ storage: ram(vocab), vocab, plugins: [models()] })
  g.apply([
    { entity: { eid: '$p' }, provider: { name: 'codex' } },
    { entity: { eid: '$m' }, model: { name: 'gpt-6-astra' } },
  ])
  return g
}

let ASTRA = identityEid('model', ['gpt-6-astra'])
let CODEX = identityEid('provider', ['codex'])
let E = 'e0000000-0000-4000-8000-000000000001'

Deno.test('a provider or a model is addressed by its name', () => {
  let g = shelf()
  assertEquals(
    g.address(['gpt-6-astra', 'codex', 'gpt-9', E]),
    new Map([['gpt-6-astra', ASTRA], ['codex', CODEX]]),
  )
})

Deno.test('a name is accepted wherever a model reference is', () => {
  let g = shelf()
  g.apply([{ entity: { eid: E }, using: { model: 'gpt-6-astra' } }])
  let read = (q: string) =>
    (g.read(q) as Bundle[]).map((b) => [b.entity.eid, (b.using as Comp).model])
  assertEquals(read(`.eid=${E}`), [[E, ASTRA]])
  assertEquals(read('.using.model=gpt-6-astra'), [[E, ASTRA]])
})

Deno.test('a name a provider and a model both hold is refused', () => {
  let g = shelf()
  g.apply([{ entity: { eid: '$m' }, model: { name: 'codex' } }])
  assertThrows(() => g.address(['codex']), Error, 'both a provider and a model')
})
