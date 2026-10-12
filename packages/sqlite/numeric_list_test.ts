import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { mem } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    entity: {
      component: true,
      properties: { num: { type: 'number', stamped: true } },
    },
    point: {
      component: true,
      properties: {
        x: { type: 'number', index: true },
        text: { type: 'string', index: true },
      },
    },
  },
})
let edge = Number.MAX_SAFE_INTEGER
let values = [
  -edge,
  -edge + 1,
  -edge + 2,
  -4,
  -3.5,
  -3,
  -2,
  -1,
  0,
  0.25,
  1,
  1.5,
  2,
  3,
  10,
  10.5,
  11,
  12,
  13,
  100,
  101,
  102,
  103,
  edge - 2,
  edge - 1,
  edge,
]
let eidOf = (n: number) =>
  `00000000-0000-4000-8000-${String(values.indexOf(n) + 1).padStart(12, '0')}`
let bundles: Bundle[] = values.map((x) => ({
  entity: { eid: eidOf(x) },
  point: { x, text: String(x) },
}))
bundles.push({ entity: { eid: 'absent' }, point: {} })
bundles.push({ entity: { eid: 'missing' } })
let stored = graph({ vocab, storage: storage(mem(), vocab) })
let memory = graph({ vocab, storage: ram(vocab) })
stored.storage.install()
for (let g of [stored, memory]) g.apply(bundles)
let queries = [
  '.point.x=1,2,3',
  '.point.x=3,2,1,2',
  '.point.x=-4,-3,-2,-1,0',
  `.point.x=${edge - 2},${edge - 1},${edge}`,
  `.point.x=${-edge},${-edge + 1},${-edge + 2}`,
  '.point.x=10,11,12,13,100,101,102,103',
  '.point.x=1,2,3|.point.x=10,11,12,13',
  '.point.x!=1,2,3',
  '.point.x=1,2,3,1.5',
  '.point.x=1,2,3,bad',
  '.point.text=1,2,3',
]
let ids = (bs: Bundle[]) => bs.map((b) => b.entity.eid).sort()
for (let q of queries) {
  let expected = ids(await memory.read(q))
  test(`numeric lists preserve query membership: ${q}`, async () => {
    equal(ids(await stored.read(q)), expected)
  })
}

for (
  let [q, count] of [
    ['.point.x=10,11,12,13 .count', 4],
    ['.point.x=10000,10001,10002,10003 .count', 0],
  ] as const
) {
  test(`numeric list gates preserve counts: ${q}`, async () => {
    equal(Number((await stored.rows(q))[0].n), count)
  })
}
let page = '.point.x=10,11,12,13 .order=-point.x .limit=2'
test('numeric list gates preserve ordered pages', async () => {
  equal((await stored.read(page)).map((b) => b.entity.eid), [
    eidOf(13),
    eidOf(12),
  ])
})
test('numeric list gates preserve page cursors', async () => {
  equal(
    (await stored.read(`${page} .after=${eidOf(12)}`)).map((b) => b.entity.eid),
    [
      eidOf(11),
      eidOf(10),
    ],
  )
})
let scopedQuery = '.point.x=10,11,12,13'
let scope = { visibility: { entity: `.point.x=10,12` } }
let visible = ids(await memory.read(scopedQuery, scope))
test('numeric lists preserve scoped visibility', async () => {
  equal(ids(await stored.read(scopedQuery, scope)), visible)
})
