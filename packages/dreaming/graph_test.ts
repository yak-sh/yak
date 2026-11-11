// `.order=hot` ranks by the recall curve, over a store that composed it.
import { equal, ok, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab, type PropSchema } from '@yaks/vocab'
import type { Bundle } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { stepping } from '@yaks/sqlite/testing'
import { extend } from './graph.ts'

let at: PropSchema = { type: 'string', format: 'date-time' }
let comp = (properties: Record<string, PropSchema>): PropSchema => ({
  component: true,
  type: 'object',
  properties,
})
let vocab = loadVocab({
  $defs: {
    doc: comp({ title: { type: 'string' } }),
    created: comp({ at }),
    updated: comp({ at }),
    recall: comp({ count: { type: 'number' }, first_at: at, last_at: at }),
    project: comp({}),
    archived: comp({ at }),
    filed: comp({ project: { type: 'string', ref: 'project' } }),
  },
})

let ago = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString()

test('.order=hot: recent and often-recalled first, a retired project sunk', () => {
  let db = open(':memory:')
  using _close = { [Symbol.dispose]: () => db.close() }
  let store = storage(db, vocab, { extend: extend() })
  store.install()
  store.tx((tx) =>
    tx.patch([
      {
        entity: { eid: 'old' },
        project: {},
        archived: { at: ago(1) },
        created: { at: ago(60) },
      },
      {
        entity: { eid: 'cold' },
        doc: { title: 'x' },
        created: { at: ago(60) },
      },
      {
        entity: { eid: 'fresh' },
        doc: { title: 'x' },
        created: { at: ago(0.04) },
      },
      {
        entity: { eid: 'recalled' },
        doc: { title: 'x' },
        created: { at: ago(60) },
        recall: { count: 5, first_at: ago(50), last_at: ago(2) },
      },
      {
        entity: { eid: 'sunk' },
        doc: { title: 'x' },
        created: { at: ago(0.04) },
        filed: { project: 'old' },
      },
      { entity: { eid: 'never' }, doc: { title: 'x' } },
    ])
  )
  let found = (line: string) => store.read(line).map((b) => b.entity.eid)
  assertEquals(found('.doc .order=hot'), [
    'fresh',
    'recalled',
    'sunk',
    'cold',
    'never',
  ])
  assertEquals(found('.doc .order=hot .limit=2'), ['fresh', 'recalled'])
  assertEquals(found('.doc .order=-hot').at(-1), 'fresh')
})

// A page in hot order is looked for among the newest touches and the recalled,
// and every row is ranked only where those cannot make it. Each store is
// filled once, as the file loads; a case reads it.
let indexed: PropSchema = { ...at, index: true }
let paged = loadVocab({
  $defs: {
    doc: comp({ title: { type: 'string' } }),
    created: comp({ at: indexed }),
    updated: comp({ at: indexed }),
    recall: comp({ count: { type: 'number' }, first_at: at, last_at: at }),
    project: comp({}),
    archived: comp({ at }),
    filed: comp({ project: { type: 'string', ref: 'project' } }),
  },
})
let store = (bundles: Bundle[]) => {
  let { driver, steps } = stepping()
  let s = storage(driver, paged, { extend: extend() })
  s.install()
  s.tx((tx) => tx.patch(bundles))
  return (q: string) => {
    let before = steps()
    let ids = s.rows(q).map((r) => String(r.eid))
    return { ids, steps: steps() - before }
  }
}
let docs = (n: number, name: string, f: (i: number) => Partial<Bundle>) =>
  Array.from({ length: n }, (_, i): Bundle => ({
    entity: { eid: `${name}-${i}` },
    doc: { title: name },
    ...f(i),
  }))
let history = docs(3000, 'old', (i) => ({
  created: { at: ago(30 + i / 100) },
  ...i % 3 ? {} : { updated: { at: ago(20 + i / 100) } },
  ...i % 500 ? {} : { filed: { project: 'gone' } },
}))
let gone: Bundle = {
  entity: { eid: 'gone' },
  project: {},
  archived: { at: ago(40) },
  created: { at: ago(50) },
}
let busy = store([
  gone,
  ...history,
  ...docs(40, 'fresh', (i) => ({ created: { at: ago(i / 50) } })),
  ...docs(3, 'touched', (i) => ({
    created: { at: ago(60) },
    updated: { at: ago(i / 40) },
  })),
  ...docs(3, 'recalled', (i) => ({
    created: { at: ago(90) },
    recall: { count: 40, first_at: ago(80), last_at: ago(1 + i) },
  })),
])
// The newest are all filed under a retired project, so the warmest live row
// is older than every one of them.
let buried = store([
  gone,
  ...history,
  ...docs(30, 'sunk', (i) => ({
    created: { at: ago(i / 1000) },
    filed: { project: 'gone' },
  })),
  ...docs(3, 'live', (i) => ({ created: { at: ago(0.5 + i / 10) } })),
])
// A page is the head of the whole ranking, which is read without a limit.
let whole = (read: typeof busy, q: string) => read(`${q} .order=hot`).ids
let ranked = {
  busy: whole(busy, '.doc'),
  filed: whole(busy, '.filed'),
  buried: whole(buried, '.doc'),
}
let head = (read: typeof busy, q: string, all: string[], n: number) => {
  let page = read(`${q} .order=hot .limit=${n}`)
  equal(page.ids, all.slice(0, n))
  return page
}

test('.order=hot: a page reads the newest touches, not the whole graph', () => {
  let page = head(busy, '.doc', ranked.busy, 12)
  equal(page.ids.filter((id) => id.startsWith('recalled')).length, 3)
  ok(page.steps < 40_000, `${page.steps} VM steps`)
})

test('.order=hot: a page the newest cannot make ranks every row', () => {
  equal(head(busy, '.filed', ranked.filed, 3).ids.length, 3)
  equal(head(buried, '.doc', ranked.buried, 2).ids, ['live-0', 'live-1'])
})
