// A topic's name as every door writes it: folded on the way in, so a name
// typed in any case or spacing is the name topic_new would have stored.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { type Comp, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { topicDoc } from './vocab.ts'
import { plugins } from './graph.ts'

let vocab = loadVocab([docDoc, topicDoc, {
  $defs: { session: { component: true, type: 'object', kind: true } },
}])
let fresh = () => graph({ storage: ram(vocab), vocab, plugins: plugins() })

type G = ReturnType<typeof fresh>
let names = async (g: G) =>
  (await g.read('.topic')).map((b) => (b.topic as Comp).name)

let stored = async (name: string) => {
  let g = fresh()
  await g.apply([{ entity: { eid: '$q' }, topic: { name } }])
  return await names(g)
}

for (
  let [typed, name] of [
    ['Breads', 'breads'],
    ['  Sourdough   Breads ', 'sourdough breads'],
    ['breads', 'breads'],
  ]
) {
  test(`a name written as ${JSON.stringify(typed)} is stored as ${name}`, async () =>
    equal(await stored(typed), [name]))
}

test('a name typed in another case is the one topic, not a second', async () => {
  let g = fresh()
  await g.apply([{ entity: { eid: '$a' }, topic: { name: 'breads' } }])
  await assertRejects(async () =>
    await g.apply([{ entity: { eid: '$b' }, topic: { name: 'Breads' } }])
  )
  equal(await names(g), ['breads'])
})
