import { graph, signed } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { personal } from './personal.ts'
let sync = <T>(v: T | Promise<T>): T => {
  if (v instanceof Promise) throw Error('expected synchronous RAM')
  return v
}

let vocab = loadVocab({
  $defs: {
    entity: { component: true, type: 'object' },
    person: {
      component: true,
      type: 'object',
      properties: { name: { type: 'string' } },
    },
    draft: {
      component: true,
      type: 'object',
      properties: {
        by: { type: 'string', ref: 'entity', death: 'keep' },
        text: { type: 'string' },
      },
    },
    preference: {
      component: true,
      type: 'object',
      properties: { color: { type: 'string' } },
    },
  },
})
let fixture = () => {
  let g = graph({ vocab, storage: ram(vocab) })
  g.apply([
    {
      entity: { eid: 'alice' },
      person: { name: 'Alice' },
      preference: { color: 'secret' },
    },
    { entity: { eid: 'bob' }, person: { name: 'Bob' } },
    { entity: { eid: 'private' }, draft: { by: 'alice', text: 'unsent' } },
  ])
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
let trusted = fixture()
let unowned = graph({ vocab, storage: ram(vocab) })
unowned.apply([{ entity: { eid: 'legacy' }, draft: { text: 'unowned' } }])
unowned.use(personal(vocab, { draft: 'by' }))
test('guests cannot read legacy private rows missing their owner', () =>
  equal(unowned.read('.draft *', { person: null }), []))
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
