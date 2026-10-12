import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  type Bundle,
  graph,
  type ReadOpts,
  type Row,
  type Storage,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { preparedDriver, snapshot } from './testing.ts'
import { storage as sqliteStorage } from './mod.ts'
import { reader } from './reader.ts'

let vocab = loadVocab({
  $defs: {
    entity: {
      component: true,
      properties: { num: { type: 'number', stamped: true } },
    },
    post: {
      component: true,
      properties: { title: { type: 'string' } },
    },
    comment: {
      component: true,
      properties: { post: { type: 'string', ref: 'post' } },
    },
  },
})
let seed = [
  { entity: { eid: 'parent' }, post: { title: 'Parent' } },
  { entity: { eid: 'guest-0' }, comment: { post: 'parent' } },
  { entity: { eid: 'later' }, comment: { post: 'parent' } },
]
let selected = { eids: ['guest-0'] } as ReadOpts
let cases: [string, string, string][] = [
  ['ram', '.entity.eid=C-2 .comment.post.post.title=Parent', 'guest-0'],
  ['sqlite', '.entity.eid=C-2 .comment.post=parent', 'guest-0'],
]
for (let [name, query, eid] of cases) {
  let sqlite = name == 'sqlite' ? preparedDriver(snapshot(vocab)) : undefined
  let storage: Storage = sqlite
    ? sqliteStorage(sqlite, vocab, { number: true, schemaReady: () => true })
    : ram(vocab, { number: true })
  let g = graph({ vocab, storage })
  g.apply(seed)
  let ids = (rows: Bundle[] | Promise<Bundle[]>) =>
    (rows as Bundle[]).map((b) => b.entity.eid)
  let relation = '.comment.post.post.title=Parent'
  let checks: [string, () => unknown, unknown][] = [
    [
      'exact subjects keep referenced entities',
      () => g.rows(relation, selected),
      [{ eid }],
    ],
    [
      'human identity operands retain their meaning',
      () => g.rows(query, selected),
      [{ eid }],
    ],
    [
      'a window selects within canonical subjects',
      () => g.rows(`${relation} .limit=1`, selected),
      [{ eid }],
    ],
    [
      'an aggregate counts only canonical subjects',
      () => g.rows(`${relation} .count`, selected),
      [{ value: '', n: 1 }],
    ],
    [
      'projection reaches outside the candidate set',
      () => g.rows(`${relation} .fields=comment.post.post.title`, selected),
      [{ eid, 'comment.post.post.title': 'Parent' }],
    ],
    [
      'whole reads keep canonical subjects',
      () => ids(g.read(relation, selected)),
      [eid],
    ],
    [
      'empty canonical candidates select nothing',
      () => g.rows(relation, { eids: [] }),
      [],
    ],
    [
      'candidate windows retain component presence',
      () => g.rows('.post .limit=1', selected),
      [],
    ],
    [
      'candidate aggregates retain component presence',
      () => g.rows('.post .count', selected),
      [{ value: '', n: 0 }],
    ],
    [
      'canonical candidates leave visibility relations intact',
      () =>
        g.rows(relation, {
          ...selected,
          visibility: { entity: '.comment|.post' },
        }),
      [{ eid }],
    ],
    [
      'hidden referents stay hidden with canonical candidates',
      () =>
        g.rows(relation, { ...selected, visibility: { entity: '.comment' } }),
      [],
    ],
    [
      'transactions select canonical subjects',
      () => storage.tx((tx) => ids(tx.read(relation, selected))),
      [eid],
    ],
  ]
  if (sqlite) {
    checks.push([
      'installed readers select canonical subjects',
      () => reader(sqlite, vocab).rows(relation, selected),
      [{ eid }],
    ])
  }
  for (let [behavior, read, expected] of checks) {
    test(`${name} ${behavior}`, () => assertEquals(read(), expected))
  }
  test(`${name} repeated queries retain their own candidate sets`, () => {
    let q = parse('.comment')
    let scopes = [selected, { eids: ['later'] }, selected, { eids: [] }, {}]
    assertEquals(
      scopes.map((opts) => (g.rows(q, opts) as Row[]).map((r) => r.eid).sort()),
      [
        [eid],
        ['later'],
        [eid],
        [],
        [eid, 'later'],
      ],
    )
  })
}
