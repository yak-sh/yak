import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph, Refused } from '@yaks/graph'
import { idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { storage } from '@yaks/sqlite'
import { SIZES } from '@yaks/sqlite/owe'
import { mem } from '@yaks/sqlite/testing'
import { col, eq, val } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { letterRule, printed } from './letter-move.ts'
import { numbered } from './vocab.ts'

let kind = (prefix?: string) => ({
  component: true,
  kind: true,
  properties: { note: { type: 'string' } },
  ...prefix ? { prefix } : {},
})
let vocab = loadVocab([idDoc, {
  $defs: {
    entity: { component: true, properties: {} },
    exception: kind(),
    memory: kind('M'),
    space: kind(),
  },
}], [idKeywords])

// A directory as it stood: a spine whose number is unique on its own, and
// every entity numbered by the one count it kept, with no letter.
let d = mem()
d.query({
  t: 'create table',
  name: 'entity',
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'eid', type: 'text', notNull: true, unique: true },
    { name: 'num', type: 'integer', unique: true },
  ],
})
let old = storage(d, vocab)
old.install()
old.tx((tx) =>
  tx.patch([
    { entity: { eid: 'broke' }, exception: {} },
    { entity: { eid: 'kept' }, memory: {} },
    { entity: { eid: 'home' }, space: {} },
  ])
)
for (let [num, eid] of ['broke', 'kept', 'home'].entries()) {
  d.query({
    t: 'update',
    table: 'entity',
    set: { num: val(num + 1) },
    where: eq(col('eid'), val(eid)),
  })
}
// Too big to move at install, as the directory is (@yaks/sqlite `respined`):
// its spine keeps the number unique on its own until its own migration.
let store = storage(d, vocab, {
  number: numbered(vocab),
  sizes: { ...SIZES, copy: 3 },
})
store.install()
let g = graph({ storage: store, vocab, plugins: [ids(vocab)] })
let find = async () => (await g.read(letterRule.find)) as Bundle[]
let found = await find()
await g.apply(found.flatMap((row) => letterRule.move(row, undefined, vocab)), {
  trusted: true,
})
let opened = async (id: string) => {
  try {
    return ((await g.read(`.entity.eid=${id}`)) as Bundle[]).map((r) =>
      r.entity.eid
    )
  } catch (e) {
    if (e instanceof Refused) return []
    throw e
  }
}

test('a number is copied under the letter it printed with, and opens what it opened', async () => {
  assertEquals(found.map((r) => printed(vocab, r)), ['E', 'M', 'S'])
  assertEquals(await find(), [])
  assertEquals(await opened('E-1'), ['broke'])
  assertEquals(await opened('M-2'), ['kept'])
  assertEquals(await opened('S-3'), ['home'])
  // Its number no longer answers under another letter.
  assertEquals(await opened('M-1'), [])
})

test('after the move, only a declared prefix numbers, past the numbers its series holds', async () => {
  await g.apply([
    { entity: { eid: 'later' }, exception: {} },
    { entity: { eid: 'saved' }, memory: {} },
  ])
  let [later, saved] = (await g.read('.entity.eid=later,saved')) as Bundle[]
  assertEquals([later.entity.num ?? null, saved.entity], [null, {
    ...saved.entity,
    prefix: 'M',
    num: 3,
  }])
})
