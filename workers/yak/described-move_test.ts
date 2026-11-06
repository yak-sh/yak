// An app's store loses the description rows an earlier deploy wrote, reading
// past the view that derives them, and keeps its own rows and lens package.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Bundle, graph, identityEid } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, metaDoc, type VocabDoc } from '@yaks/vocab'
import { codeDoc } from '../../packages/code/vocab.ts'
import { described, describing } from '@yaks/code/described'
import { docs as lensDocs } from '../../packages/lens/vocab.ts'
import { describedRule } from './described-move.ts'

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
let app: VocabDoc = {
  package: '@t/trip',
  $defs: {
    outing: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { day: { type: 'string' } },
    },
  },
}
let vocab = loadVocab(
  [entity, edgeDoc, docDoc, codeDoc, metaDoc, ...lensDocs, app],
  [edgeKeywords],
)
// The store as an earlier deploy left it, described in rows, and as it is
// served now, deriving its description when read.
let storage = ram(vocab)
let was = graph({ vocab, storage, plugins: [edges(vocab)] })
await was.apply(await described(was, vocab.docs), { trusted: true })
let g = graph({ vocab, storage, plugins: [edges(vocab), describing] })
let own = identityEid('_package', ['@t/lens'])
await g.apply([
  { entity: { eid: 'mine' }, doc: { title: 'Lisbon' }, outing: { day: 'mon' } },
  { entity: { eid: own }, _package: { name: '@t/lens' } },
  {
    entity: { eid: identityEid('_lens', [own, '1']) },
    _lens: { package: own, step: 1 },
  },
], { trusted: true })

let held = async () => (await g.read(describedRule.find, { native: true }))
let sweep = async () => {
  let read = (line: string) => g.read(line, { native: true }) as Bundle[]
  let rows = await held()
  let patch = rows.flatMap((row) => describedRule.move(row, read))
  if (patch.length) await g.apply(patch, { trusted: true })
  return patch.length
}

test('the description rows go, and the person’s rows and the lens package stay', async () => {
  let before = (await held()).length
  assertEquals(before > 20, true)
  assertEquals(await sweep(), before - 1)
  assertEquals((await held()).map((b) => b.entity.eid), [own])
  assertEquals(await sweep(), 0)
  assertEquals(
    (await g.read('.doc', { native: true })).map((b) => b.entity.eid),
    ['mine'],
  )
  assertEquals((await g.read('._comp.name=outing')).length, 1)
})
