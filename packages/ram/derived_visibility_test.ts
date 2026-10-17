/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { col, eq, select, sub, table } from '@yaks/sql'
import { preparedStore, snapshot } from '../sqlite/testing.ts'
import { ram } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    public: {
      component: true,
      properties: {
        value: { type: 'string', computed: true },
      },
    },
    private: {
      component: true,
      properties: { text: { type: 'string' } },
    },
    pointer: {
      component: true,
      properties: {
        to: { type: 'string', ref: 'entity' },
        neighbor: { type: 'string', ref: 'entity' },
      },
    },
  },
})
let derived = {
  'public.value': {
    tag: 'text' as const,
    expr: (owner: ReturnType<typeof col>) =>
      sub(select({
        cols: [col('text', 'p')],
        from: table('private', 'p'),
        where: eq(col('entity', 'p'), owner),
      })),
  },
}
let base = { derived }
let sql = preparedStore(vocab, base, snapshot(vocab, base))
let stores = {
  RAM: ram(vocab, {
    computed: {
      'public.value': (b, among) =>
        (among.of(b.entity.eid)?.private as Record<string, unknown>)?.text ??
          null,
    },
  }),
  SQL: sql,
}
for (let [name, storage] of Object.entries(stores)) {
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'other' },
      public: {},
      private: { text: 'secret' },
    }])
  )
  let g = graph({
    vocab,
    storage,
    plugins: [{
      name: 'owner',
      scope: () => ({ components: { private: '.entity.eid=owner' } }),
    }],
  })
  let value = (rows: Bundle[]) => rows[0].public
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'owner-1' },
      private: { text: 'mine' },
    }])
  )
  let owner = graph({
    vocab,
    storage,
    plugins: [{
      name: 'owner',
      scope: () => ({ components: { private: '.entity.eid=owner-1' } }),
    }],
  })
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'link' },
      pointer: { to: 'other', neighbor: 'owner-1' },
    }])
  )
  let refs = graph({
    vocab,
    storage,
    plugins: [{
      name: 'owner',
      scope: () => ({ entity: '!private|.entity.eid=owner-1' }),
    }],
  })
  test(`${name} reference presence excludes a hidden target`, () =>
    assertEquals(refs.rows('.pointer.to'), []))
  test(`${name} reference presence counts exclude hidden targets`, () =>
    assertEquals(refs.rows('.pointer.to .count'), [{ value: '', n: 0 }]))
  test(`${name} a hidden reference is absent on its public owner`, () =>
    assertEquals(refs.rows('.pointer !pointer.to'), [{ eid: 'link' }]))
  test(`${name} conjoined reference presence excludes a hidden target`, () =>
    assertEquals(refs.rows('.pointer.to .pointer.neighbor'), []))
  test(`${name} mixed reference presence reads visible target values`, () =>
    assertEquals(refs.rows('!pointer.to .pointer.neighbor'), [{ eid: 'link' }]))
  test(`${name} owner scopes compare canonical ids that resemble human ids`, () =>
    assertEquals((owner.get(['owner-1']) as Bundle[])[0].private, {
      text: 'mine',
    }))
  test(`${name} owner component selection keeps the owner's private aspect`, () =>
    assertEquals(owner.rows('.private'), [{ eid: 'owner-1' }]))
  test(`${name} computed getters use visible sources`, () =>
    assertEquals(value(g.get(['other']) as Bundle[]), {}))
  test(`${name} computed predicates use visible sources`, () =>
    assertEquals(g.rows('.public.value=secret'), []))
  test(`${name} computed projections use visible sources`, () =>
    assertEquals(g.rows('.public .fields=public.value'), [
      { eid: 'other', 'public.value': null },
    ]))
}

// A gathered value needs one public owner and its hidden source. The pointer
// and second owner above exercise other read shapes, not this gathering.
let gatherVocab = loadVocab({
  $defs: {
    public: vocab.def('public')!,
    private: vocab.def('private')!,
  },
})
for (
  let [name, storage] of Object.entries({
    RAM: ram(gatherVocab, {
      computed: {
        'public.value': (b, among) =>
          (among.of(b.entity.eid)?.private as Record<string, unknown>)?.text ??
            null,
      },
    }),
    SQL: preparedStore(gatherVocab, base, snapshot(gatherVocab, base)),
  })
) {
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'other' },
      public: {},
      private: { text: 'secret' },
    }])
  )
  let gathered = parse('.public')
  let hidden = parse('.entity.eid=owner')
  let g = graph({
    vocab: gatherVocab,
    storage,
    plugins: [{
      name: 'owner',
      scope: () => ({ components: { private: hidden } }),
    }],
  })
  test(`${name} gathered computed values use visible sources`, () =>
    assertEquals((g.read(gathered) as Bundle[])[0].public, { value: null }))
}
