import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { snapshot, textual } from './testing.ts'
import { storage } from './mod.ts'
import {
  col,
  type Driver,
  eq,
  type Expr,
  insert,
  render,
  select,
  sub,
  table,
  val,
} from '@yaks/sql'
import { mem } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    doc: { component: true, properties: { text: { type: 'string' } } },
    private: {
      component: true,
      properties: { by: { type: 'string', ref: 'entity' } },
    },
    pointer: {
      component: true,
      properties: { to: { type: 'string', ref: 'entity' } },
    },
  },
})
let fixture = () => {
  let db = textual({}, snapshot(vocab)), reads = 0
  let driver: Driver = {
    query: (stmt) => {
      let q = render(stmt)
      if (/^select|^with/i.test(q.sql)) reads++
      return db.run(q.sql, q.params)
    },
  }
  let store = storage(driver, vocab, { schemaReady: () => true })
  let g = graph({
    vocab,
    storage: store,
    plugins: [{
      name: 'policy',
      scope: (ctx) =>
        ctx.opts.person === undefined ? undefined : {
          entity: `!private|.private.by=${ctx.opts.person}`,
        },
    }],
  })
  store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'alice' }, doc: { text: 'Alice' } },
      { entity: { eid: 'bob' }, doc: { text: 'Bob' } },
      {
        entity: { eid: 'draft' },
        doc: { text: 'secret' },
        private: { by: 'alice' },
      },
      { entity: { eid: 'link' }, pointer: { to: 'draft' } },
    ])
  )
  let get = (person = 'alice', eids = ['draft', 'link'], comps?: string[]) =>
    store.get(eids, comps, {
      person,
      visibility: g.scope({ person }).visibility,
    }) as Bundle[]
  for (let n = 0; n < 3; n++) get()
  reads = 0
  let transfer = () =>
    store.tx((tx) =>
      tx.patch([{ entity: { eid: 'draft' }, private: { by: 'bob' } }])
    )
  return { store, driver, get, transfer, reads: () => reads }
}
let reuse = fixture(),
  changed = fixture(),
  refs = fixture(),
  separate = fixture(),
  removed = fixture(),
  rollback = fixture(),
  publicTarget = fixture()
let missing = fixture()
missing.store.get(['absent'])
let mutable = fixture()
let selection = structuredClone(parse('.doc.text=secret'))
mutable.store.rows(selection)
mutable.store.rows(selection)
let predicate = selection.clauses[0]
if (predicate.kind == 'pred' && predicate.value?.kind == 'scalar') {
  predicate.value.raw = 'other'
}
let selected = fixture()
let unchanged = fixture()
let pending = fixture()
let presence = fixture()
let visitor = { visibility: { entity: '!private|.private.by=bob' } }
presence.store.tx((tx) =>
  tx.patch([{ entity: { eid: 'link' }, pointer: { to: 'alice' } }])
)
presence.store.rows('.pointer.to', visitor)
presence.store.rows('.pointer.to', visitor)
let queryOpts = { visibility: { entity: '!private|.private.by=alice' } }
// A scope that sees no entity holding nothing, so no deleted one.
let owned = { visibility: { entity: '.pointer|.private.by=alice' } }
selected.store.rows('.pointer.to=draft', queryOpts)
selected.store.rows('.pointer.to=draft', queryOpts)
unchanged.store.rows('.pointer.to=draft', queryOpts)
unchanged.store.rows('.pointer.to=draft', queryOpts)
let partial = fixture()
let fresh = storage(partial.driver, vocab, { schemaReady: () => true })
fresh.get(['link'], ['private'])
fresh.tx((tx) =>
  tx.patch([{ entity: { eid: 'link' }, doc: { text: 'public' } }])
)
let partialReads = partial.reads()
test('a partial admission read survives a patch to another aspect', () => {
  assertEquals(fresh.get(['link'], ['private'])[0].private, undefined)
  assertEquals(partial.reads() - partialReads, 0)
})
test('scoped identities reuse authoritative payloads and permission decisions', () => {
  assertEquals(reuse.get()[0].doc, { text: 'secret' })
  assertEquals(reuse.reads(), 0)
})
test('warmed identities follow a change of owner', () => {
  changed.transfer()
  assertEquals(changed.get().map((b) => b.entity.eid), ['link'])
})
test('a transferred identity remains readable to its current owner', () => {
  assertEquals(changed.get('bob')[0].doc, { text: 'secret' })
})
test('warmed reference targets follow a change of owner', () => {
  refs.transfer()
  assertEquals(refs.get()[0].pointer, { to: null })
})
test('caller scopes remain separate on a warmed identity cache', () => {
  assertEquals(separate.get('bob').map((b) => b.entity.eid), ['link'])
  assertEquals(separate.get()[0].doc, { text: 'secret' })
})
test('a warmed reference selector follows the target ownership', () => {
  selected.transfer()
  assertEquals(selected.store.rows('.pointer.to=draft', queryOpts), [])
})
test('a warmed presence selector follows a newly hidden reference value', () => {
  presence.store.tx((tx) =>
    tx.patch([{ entity: { eid: 'link' }, pointer: { to: 'draft' } }])
  )
  assertEquals(presence.store.rows('.pointer.to', visitor), [])
})
test('an identity selector stands through a change of selected values', () => {
  unchanged.store.tx((tx) =>
    tx.patch([{ entity: { eid: 'link' }, doc: { text: 'changed' } }])
  )
  let reads = unchanged.reads()
  assertEquals(unchanged.store.rows('.pointer.to=draft', queryOpts), [{
    eid: 'link',
  }])
  assertEquals(unchanged.reads() - reads, 0)
})
test('a reference operand admits a target created in the transaction', () => {
  pending.store.tx((tx) => {
    tx.patch([
      { entity: { eid: 'new-target' }, private: { by: 'alice' } },
      { entity: { eid: 'new-link' }, pointer: { to: 'new-target' } },
    ])
    let q = '.pointer.to=new-target'
    assertEquals(pending.store.rows(q, owned), [{ eid: 'new-link' }])
  })
})
test('a warmed reference operand remains restricted to its owner', () => {
  assertEquals(
    pending.store.rows('.pointer.to=new-target', {
      visibility: { entity: '!private|.private.by=bob' },
    }),
    [],
  )
})
test('a reference operand follows a target removed in the transaction', () => {
  pending.store.tx((tx) => {
    tx.remove([{ eid: 'new-target' }])
    assertEquals(tx.read('.pointer.to=new-target', owned), [])
  })
})
// A deleted entity is judged by its history (@yaks/sql `ghostly`), and this
// store keeps none, so even a scope that would see an entity holding nothing
// finds no deleted target.
test('a reference operand finds no deleted target its store keeps no history of', () => {
  let q = '.pointer.to=new-target'
  assertEquals(pending.store.tx((tx) => tx.read(q, queryOpts)), [])
})
test('removing a known absent identity leaves it absent', () => {
  missing.store.tx((tx) => {
    tx.remove([{ eid: 'absent' }])
    assertEquals(tx.get(['absent']), [])
  })
  assertEquals(missing.store.get(['absent']), [])
})
test('a kept selection retains its query when the caller edits its AST', () => {
  mutable.store.tx((tx) =>
    tx.patch([{ entity: { eid: 'draft' }, doc: { text: 'changed' } }])
  )
  assertEquals(mutable.store.rows('.doc.text=secret'), [])
})
test('a removed component leaves no cached aspect', () => {
  removed.store.tx((tx) => tx.patch([{ entity: { eid: 'draft' }, doc: null }]))
  assertEquals(removed.get()[0].doc, undefined)
})
test('rolled-back ownership changes restore a warmed caller view', () => {
  assertThrows(() =>
    rollback.store.tx((tx) => {
      tx.patch([{ entity: { eid: 'draft' }, private: { by: 'bob' } }])
      throw new Error('rollback')
    })
  )
})
test('the restored caller reads the rolled-back owner state', () => {
  assertEquals(rollback.get('alice', ['draft'], ['doc'])[0].doc, {
    text: 'secret',
  })
})

let transformed = () => {
  let d = mem()
  d.query({
    t: 'create table',
    name: 'phrases',
    cols: [{ name: 'key', type: 'text' }, { name: 'value', type: 'text' }],
  })
  d.query(insert('phrases', { key: 'a', value: 'first' }))
  let text = (stored: Expr) =>
    sub(
      select({
        cols: [col('value', 'phrases')],
        from: table('phrases'),
        where: eq(col('key', 'phrases'), stored),
      }),
    )
  let derived = {
    'doc.text': {
      stable: true,
      tag: 'text' as const,
      text,
      expr: (owner: Expr) =>
        text(
          sub(
            select({
              cols: [col('text', 'doc')],
              from: table('doc'),
              where: eq(col('entity', 'doc'), owner),
            }),
          ),
        ),
    },
  }
  let s = storage(d, vocab, { derived })
  s.install()
  s.tx((tx) => tx.patch([{ entity: { eid: 'public' }, doc: { text: 'a' } }]))
  let g = graph({
    vocab,
    storage: s,
    plugins: [{ name: 'policy', scope: () => ({ entity: '!private' }) }],
  })
  let get = () => (g.get(['public']) as Bundle[])[0].doc
  get()
  return { d, s, get }
}
let auxiliary = transformed(), vanished = transformed()
test('stable stored-value transforms follow auxiliary source changes', () => {
  auxiliary.d.query({
    t: 'update',
    table: 'phrases',
    set: { value: val('second') },
  })
  assertEquals(auxiliary.get(), { text: 'second' })
})
test('a removed derived-bearing component leaves no cached aspect', () => {
  vanished.s.tx((tx) => tx.patch([{ entity: { eid: 'public' }, doc: null }]))
  assertEquals(vanished.get(), undefined)
})
test('a public reference cannot expose a newly private target', () => {
  publicTarget.store.tx((tx) =>
    tx.patch([{ entity: { eid: 'draft' }, private: null }])
  )
  publicTarget.get('bob')
  publicTarget.store.tx((tx) =>
    tx.patch([{ entity: { eid: 'draft' }, private: { by: 'alice' } }])
  )
  assertEquals(publicTarget.get('bob')[0].pointer, { to: null })
})
