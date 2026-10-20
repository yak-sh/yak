import { insert } from '@yaks/sql'
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { mem } from './testing.ts'
import { watch } from './watch.ts'

let vocab = loadVocab([{
  $defs: { item: { component: true }, other: { component: true } },
}])
let d = mem()
let change = () => {}
let file = {
  ...d,
  watch: (changed: () => void) => {
    change = changed
    return () => {}
  },
}
for (let [entity, name] of [[1, 'item'], [2, 'other']] as const) {
  d.query({
    t: 'create table',
    name,
    cols: [{ name: 'entity', type: 'integer', pk: true }],
  })
  d.query(insert(name, { entity }))
}
let heard = 0
watch(file, vocab, 'item', () => heard++)

test("a watch hears a row added to its component, not another's", () => {
  d.query(insert('other', { entity: 3 }))
  change()
  equal(heard, 0)
  d.query(insert('item', { entity: 4 }))
  change()
  change()
  equal(heard, 1)
})

test('a driver that hears nothing, or a component with no table, watches nothing', () => {
  equal(watch(d, vocab, 'item', () => {})(), undefined)
  equal(watch(file, vocab, 'missing', () => {})(), undefined)
})
