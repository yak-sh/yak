// `.order=hot` ranks by the recall curve, over a store that composed it.
import { assertEquals } from '@std/assert'
import { loadVocab, type PropSchema } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { extend } from './rules.ts'

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

Deno.test('.order=hot: recent and often-recalled first, a retired project sunk', () => {
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
