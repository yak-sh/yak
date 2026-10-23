import { type Comp, graph, signed, type Tx } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { graph as readonly } from '@yaks/graph/read'
import { backed, ddl, journal, log } from '@yaks/journal'
import { journalDoc } from '@yaks/journal/vocab'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { personal } from './personal.ts'
let sync = <T>(v: T | Promise<T>): T => {
  if (v instanceof Promise) throw Error('expected synchronous RAM')
  return v
}

let defs = {
  $defs: {
    entity: { component: true, type: 'object' },
    person: {
      component: true,
      type: 'object',
      properties: {
        name: { type: 'string' },
        friend: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
    draft: {
      component: true,
      type: 'object',
      properties: {
        by: { type: 'string', ref: 'entity', death: 'keep' },
        parent: { type: 'string', ref: 'entity', death: 'cascade' },
        text: { type: 'string' },
      },
    },
    preference: {
      component: true,
      type: 'object',
      properties: { color: { type: 'string' } },
    },
  },
}
let vocab = loadVocab(defs)
let fixture = (g = graph({ vocab, storage: ram(vocab) })) => {
  g.apply([
    {
      entity: { eid: 'alice' },
      person: { name: 'Alice' },
      preference: { color: 'secret' },
    },
    { entity: { eid: 'bob' }, person: { name: 'Bob' } },
    { entity: { eid: 'private' }, draft: { by: 'alice', text: 'unsent' } },
    { entity: { eid: 'burned' }, draft: { by: 'alice', text: 'torn up' } },
  ])
  g.apply([{ entity: { eid: 'burned' }, $delete: true }])
  g.use(personal(vocab, { draft: 'by', preference: 'entity' }))
  return g
}
let read = fixture()
for (let person of ['bob', null]) {
  for (
    let [shape, ask, expected] of [
      ['query', () => read.read('.draft *', { person }), []],
      ['get', () => read.get(['private'], undefined, { person }), []],
      ['count', () => read.rows('.draft .count', { person }), [{
        value: '',
        n: 0,
      }]],
      [
        'distinct',
        () => read.rows('.draft .distinct=draft.text', { person }),
        [],
      ],
    ] as const
  ) {
    test(`private drafts hide ${shape} from ${person ?? 'guests'}`, () =>
      equal<unknown>(ask(), expected))
  }
}
test('private aspects preserve public person names', () =>
  equal(read.get(['alice'], undefined, { person: 'bob' }), [{
    entity: { eid: 'alice' },
    person: { name: 'Alice' },
  }]))
test('native answers hide metadata describing another person private aspects', () =>
  equal(
    read.answer([{
      entity: { eid: 'alice', archetype: 'private-setting-shape' },
      person: { name: 'Alice' },
    }], { person: 'bob', native: true }),
    [{
      entity: { eid: 'alice' },
      person: { name: 'Alice' },
    }],
  ))
test('native answers mask references to foreign private entities', () =>
  equal(
    read.answer([{
      entity: { eid: 'bob' },
      person: { name: 'Bob', friend: 'private' },
    }], { person: 'bob', native: true }),
    [{
      entity: { eid: 'bob' },
      person: { name: 'Bob', friend: null },
    }],
  ))
// A deleted draft holds nothing left to say whose it was. A store that keeps
// a history (@yaks/journal) says it, so its author's answers name it and no
// one else's do; where no history is kept, nobody's do.
let logged = loadVocab([defs, journalDoc])
let db = open(':memory:')
let store = storage(db, logged, { backed: backed(logged) })
store.install()
for (let s of ddl()) db.query(s)
let kept = fixture(graph({
  vocab: logged,
  storage: store,
  plugins: [journal(log({ rows: (s) => db.query(s) }), logged)],
}))
let friend = (g: typeof read, person: string) =>
  (sync(g.answer([{
    entity: { eid: 'bob' },
    person: { name: 'Bob', friend: 'burned' },
  }], { person, native: true }))[0].person as Comp).friend
let friends = [read, kept].map((g) => ['alice', 'bob'].map((p) => friend(g, p)))
test('native answers name a deleted draft to its author alone, as its history says', () =>
  equal(friends, [[null, null], ['burned', null]]))
test('native answers preserve references to public people', () =>
  equal(
    read.answer([{
      entity: { eid: 'bob' },
      person: { name: 'Bob', friend: 'alice' },
    }], { person: 'bob', native: true }),
    [{
      entity: { eid: 'bob' },
      person: { name: 'Bob', friend: 'alice' },
    }],
  ))
test('private aspects do not match foreign predicates', () =>
  equal(read.rows('.preference.color=secret .count', { person: 'bob' }), [{
    value: '',
    n: 0,
  }]))
test('people read their own drafts and preferences', () => {
  equal(sync(read.read('.draft', { person: 'alice' })).length, 1)
  equal(sync(read.read('.preference', { person: 'alice' })).length, 1)
})
for (
  let [label, by, eid, patch] of [
    ['foreign edit', 'bob', 'private', { draft: { text: 'stolen' } }],
    ['foreign transfer', 'bob', 'private', { draft: { by: 'bob' } }],
    ['foreign removal', 'bob', 'private', { draft: null }],
    ['foreign delete', 'bob', 'private', { $delete: true }],
    ['forged creation', 'bob', 'new', {
      draft: { by: 'alice', text: 'forged' },
    }],
    ['owner transfer', 'alice', 'private', { draft: { by: 'bob' } }],
    ['owner removal', 'alice', 'private', { draft: null }],
    ['foreign preference', 'bob', 'alice', {
      preference: { color: 'changed' },
    }],
    ['foreign person delete', 'bob', 'alice', { $delete: true }],
  ] as const
) {
  let g = fixture()
  test(`person ownership refuses ${label}`, () =>
    assertThrows(() =>
      g.apply(signed([{ entity: { eid }, ...patch }], { by }))
    ))
}
let creating = fixture()
test('creation binds an omitted owner to the authenticated person', () => {
  creating.apply(
    signed([{ entity: { eid: 'new' }, draft: { text: 'mine' } }], {
      by: 'bob',
    }),
  )
  equal(sync(creating.get(['new']))[0].draft, { by: 'bob', text: 'mine' })
})
test('administrative reads are explicit and ordinary ownership still applies', () => {
  equal(
    sync(read.read('.draft', { person: 'bob', administrative: true })).length,
    1,
  )
  equal(read.read('.draft', { person: 'bob' }), [])
})
let guardedCas = fixture()
let enclosing = fixture()
test('another person cannot enclose a private setting in their own private entity', () => {
  assertThrows(() =>
    enclosing.apply(signed([{
      entity: { eid: 'alice' },
      draft: { by: 'bob', text: 'take over' },
    }], { by: 'bob' }))
  )
})
for (let eid of ['bob', 'game']) {
  for (let by of ['bob', undefined]) {
    let enclosing = fixture()
    enclosing.apply([{ entity: { eid: 'game' } }], { trusted: true })
    test(`public ${eid} cannot become private with ${by ?? 'bound'} ownership`, () => {
      assertThrows(() =>
        enclosing.apply(signed([{
          entity: { eid },
          draft: { ...by ? { by } : {}, text: 'take over' },
        }], { by: 'bob' }))
      )
    })
  }
}
let generated = fixture()
generated.use({
  name: 'generated-edit',
  hooks: {
    rules: (bundles) => [...bundles, {
      entity: { eid: 'private' },
      draft: { text: 'generated theft' },
    }],
  },
})
test('generated writes obey the initiating person ownership', () => {
  assertThrows(() =>
    generated.apply(signed([{
      entity: { eid: 'bob' },
      person: { name: 'Robert' },
    }], { by: 'bob' }))
  )
  equal((sync(generated.get(['private']))[0].draft as Comp).text, 'unsent')
})
let cascading = fixture()
cascading.apply(signed([{
  entity: { eid: 'private' },
  draft: { parent: 'bob' },
}], { by: 'alice' }))
test('reference cascades cannot delete another person private rows', () => {
  assertThrows(() =>
    cascading.apply(signed([{
      entity: { eid: 'bob' },
      $delete: true,
    }], { by: 'bob' }))
  )
  equal((sync(cascading.get(['private']))[0].draft as Comp).text, 'unsent')
})
let trusted = fixture()
let unowned = graph({ vocab, storage: ram(vocab) })
unowned.apply([{ entity: { eid: 'legacy' }, draft: { text: 'unowned' } }])
unowned.use(personal(vocab, { draft: 'by' }))
test('guests cannot read legacy private rows missing their owner', () =>
  equal(unowned.read('.draft *', { person: null }), []))
test('native answers keep ownerless private rows hidden from guests', () =>
  equal(
    unowned.answer([{
      entity: { eid: 'legacy' },
      draft: { text: 'unowned' },
    }], { person: null, native: true }),
    [],
  ))
test('trusted server writes retain their explicit authority', () => {
  trusted.apply([{ entity: { eid: 'private' }, draft: { text: 'server' } }], {
    trusted: true,
  })
  equal(sync(trusted.get(['private']))[0].draft, {
    by: 'alice',
    text: 'server',
  })
})
test('foreign conditional writes refuse before disclosing current private values', () => {
  let error = assertThrows(() =>
    guardedCas.apply(signed([{
      entity: { eid: 'private' },
      draft: { text: 'changed' },
      $was: { draft: { text: '0'.repeat(64) } },
    }], { by: 'bob' }))
  )
  equal(error instanceof Error ? error.name : undefined, 'Denied')
})

let pending = ram(vocab)
test('transaction ownership remembers pending rows and still refuses owner changes', () => {
  let gets = 0
  pending.tx((tx) => {
    let tracked = personal(vocab, { draft: 'by' }).track!(
      {
        ...tx,
        get: (...args) => {
          gets++
          return tx.get(...args)
        },
      } as Tx,
      () => undefined,
      {
        graph: {},
        bundles: signed([{ entity: { eid: 'pending' } }], { by: 'alice' }),
      },
    ).tx
    tracked.patch([{ entity: { eid: 'pending' }, person: { name: 'Alice' } }])
    tracked.patch([{ entity: { eid: 'pending' }, person: { name: 'Alicia' } }])
    tracked.patch([{
      entity: { eid: 'pending' },
      draft: { by: 'alice', text: 'unsent' },
    }])
    tracked.patch([{ entity: { eid: 'pending' }, draft: { text: 'updated' } }])
    assertThrows(() =>
      tracked.patch([{
        entity: { eid: 'pending' },
        draft: { by: 'bob' },
      }])
    )
    assertThrows(() =>
      tracked.patch([{
        entity: { eid: 'pending' },
        draft: null,
      }])
    )
    equal(gets, 1)
  })
  equal(sync(pending.get(['pending']))[0].draft, {
    by: 'alice',
    text: 'updated',
  })
})

let gathered = ram(vocab)
test('transaction ownership uses gathered absence before pending writes', () => {
  gathered.tx((tx) => {
    let tracked = personal(vocab, { draft: 'by' }).track!(
      {
        ...tx,
        get: () => {
          throw Error('ownership already gathered')
        },
      } as Tx,
      () => null,
      {
        graph: {},
        bundles: signed([{ entity: { eid: 'gathered' } }], { by: 'alice' }),
      },
    ).tx
    tracked.patch([{ entity: { eid: 'gathered' }, person: { name: 'Alice' } }])
    tracked.patch([{
      entity: { eid: 'gathered' },
      draft: { by: 'alice', text: 'mine' },
    }])
    assertThrows(() =>
      tracked.patch([{
        entity: { eid: 'gathered' },
        draft: { by: 'bob' },
      }])
    )
  })
  equal(sync(gathered.get(['gathered']))[0].draft, {
    by: 'alice',
    text: 'mine',
  })
})

// The read-only graph scopes what a person reads exactly as the writer does.
for (let person of ['alice', 'bob', null]) {
  for (let native of [false, true]) {
    let g = readonly({ vocab, storage: read.storage })
    g.use(personal(vocab, { draft: 'by', preference: 'entity' }))
    let opts = { person, native }
    let who = `${person ?? 'guest'}, native ${native}`
    for (let q of ['.draft', '.draft .fields=draft.text', '.draft .count']) {
      test(`read-only personal scopes: ${q} (${who})`, () => {
        if (!q.endsWith('.count')) equal(g.read(q, opts), read.read(q, opts))
        equal(g.rows(q, opts), read.rows(q, opts))
      })
    }
    test(`read-only personal scopes: get (${who})`, () => {
      equal(
        g.get(['alice', 'private'], undefined, opts),
        read.get(['alice', 'private'], undefined, opts),
      )
      if (person != 'alice') equal(g.get(['private'], undefined, opts), [])
    })
  }
}
