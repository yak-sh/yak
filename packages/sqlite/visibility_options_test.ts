import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph, type ReadOpts } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { col, eq, select, sub, table } from '@yaks/sql'
import { preparedStore } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    public: {
      component: true,
      properties: { value: { type: 'string', computed: true } },
    },
    private: {
      component: true,
      properties: { text: { type: 'string' }, by: { type: 'string' } },
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
let storage = preparedStore(vocab, { derived })
storage.tx((tx) =>
  tx.patch([{
    entity: { eid: 'one' },
    public: {},
    private: { text: 'secret', by: 'alice' },
  }])
)
let owner = 'alice'
let g = graph({
  vocab,
  storage,
  plugins: [{
    name: 'owner',
    scope: ({ opts }) =>
      opts.administrative || opts.person === undefined ? undefined : {
        components: {
          private: `.private.by=${opts.person === owner ? 'alice' : 'nobody'}`,
        },
      },
  }],
})
let reads = {
  read: (opts: ReadOpts) => (g.read('.public', opts) as Bundle[])[0].public,
  get: (opts: ReadOpts) =>
    (g.get(['one'], ['public'], opts) as Bundle[])[0].public,
  rows: (opts: ReadOpts) => g.rows('.public.value=secret', opts),
}
let callers: [string, ReadOpts, boolean][] = [
  ['owner', { person: 'alice' }, true],
  ['other', { person: 'bob' }, false],
  ['administrator', { person: 'bob', administrative: true }, true],
  ['other again', { person: 'bob' }, false],
  ['guest', { person: null }, false],
  ['internal', {}, true],
  ['owner again', { person: 'alice' }, true],
]
for (let [, opts] of callers) for (let read of Object.values(reads)) read(opts)
for (let [door, read] of Object.entries(reads)) {
  for (let [name, opts, allowed] of callers) {
    test(`scoped ${door} follows per-read options: ${name}`, () =>
      assertEquals(
        read(opts),
        door == 'rows' ? allowed ? [{ eid: 'one' }] : [] : {
          value: allowed ? 'secret' : null,
        },
      ))
  }
}
test('a scope can change with the same read options', () => {
  owner = 'bob'
  assertEquals(reads.get({ person: 'alice' }), { value: null })
})
test('scoped dynamic refresh does not replace authoritative cached values', () =>
  assertEquals((storage.get(['one'], ['public']))[0].public, {
    value: 'secret',
  }))
