import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { preparedStore } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    note: {
      component: true,
      properties: { rank: { type: 'number' } },
    },
    private: { component: true, properties: {} },
  },
})
let storage = preparedStore(vocab)
storage.tx((tx) =>
  tx.patch([
    { entity: { eid: 'a' }, note: { rank: 1 } },
    { entity: { eid: 'hidden' }, note: { rank: 2 }, private: {} },
    { entity: { eid: 'b' }, note: { rank: 3 } },
    { entity: { eid: 'c' }, note: { rank: 4 } },
  ])
)
let g = graph({
  vocab,
  storage,
  plugins: [{ name: 'privacy', scope: () => ({ entity: '!private' }) }],
})
let pages = [
  {
    name: 'default',
    query: '.note .after=c',
    storageOrder: false,
    ids: ['b', 'a'],
  },
  {
    name: 'physical',
    query: '.note .after=a',
    storageOrder: true,
    ids: ['b', 'c'],
  },
  {
    name: 'ordered',
    query: '.note .order=note.rank .after=b',
    storageOrder: false,
    ids: ['c'],
  },
  {
    name: 'hidden anchor',
    query: '.note .after=hidden',
    storageOrder: false,
    ids: ['c', 'b', 'a'],
  },
]
for (let page of pages) {
  let rows = () => g.rows(page.query, { storageOrder: page.storageOrder })
  rows()
  test(`scoped ${page.name} cursor pages only visible rows`, () =>
    equal(rows(), page.ids.map((eid) => ({ eid }))))
}
