/// <reference lib="deno.ns" />
// Merging three ways per property: each case one entity's component at the
// fork, on the branch and on main, and what the merge writes or which
// conflicts it answers instead.

import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import type { Comp } from '@yaks/graph'
import type { Change } from '@yaks/graph/storage'
import { type Choice, merged } from './merge.ts'

let vocab = loadVocab([{
  $defs: {
    page: {
      component: true,
      properties: {
        title: { type: 'string' },
        n: { type: 'number' },
        at: { type: 'string', stamped: true },
      },
    },
    pinned: { component: true, properties: {} },
    seen: {
      component: true,
      properties: { at: { type: 'string', stamped: true } },
    },
    done: {
      component: true,
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}])

type C = Comp | null
let page = (fork: C, branch: C, main: C): Change => ({
  eid: 'e',
  comp: 'page',
  fork,
  branch,
  main,
})
let grave = (fork: C, branch: C, main: C): Change => ({
  eid: 'e',
  comp: 'tombstone',
  fork,
  branch,
  main,
})
let pick = (prop: string, take: Choice['take']): Choice => ({
  eid: 'e',
  comp: 'page',
  prop,
  take,
})
let conflict = (
  prop: string,
  fork: unknown,
  branch: unknown,
  main: unknown,
) => ({ eid: 'e', comp: 'page', prop, fork, branch, main })
let at = (title: string, n = 1) => ({ title, n })

let cases: [string, Change[], Choice[], unknown][] = [
  [
    'only the branch changed it: main takes the branch’s value',
    [
      page(at('a'), at('b'), at('a')),
    ],
    [],
    { writes: [{ page: { title: 'b' }, $was: { page: {} } }] },
  ],
  [
    'only main changed it: nothing is written',
    [
      page(at('a'), at('a'), at('b')),
    ],
    [],
    { writes: [] },
  ],
  [
    'each changed a different property: both kept',
    [
      page(at('a'), at('a', 2), at('b')),
    ],
    [],
    { writes: [{ page: { n: 2 }, $was: { page: {} } }] },
  ],
  [
    'both changed it the same way: nothing is written',
    [
      page(at('a'), at('b'), at('b')),
    ],
    [],
    { writes: [] },
  ],
  [
    'both changed it apart: a conflict, side by side, and nothing written',
    [
      page(at('a'), at('b'), at('c')),
    ],
    [],
    { conflicts: [conflict('title', 'a', 'b', 'c')] },
  ],
  [
    'a pick for the branch writes its value',
    [
      page(at('a'), at('b'), at('c')),
    ],
    [pick('title', 'branch')],
    {
      writes: [{ page: { title: 'b' }, $was: { page: {} } }],
    },
  ],
  [
    'a pick for main writes nothing',
    [
      page(at('a'), at('b'), at('c')),
    ],
    [pick('title', 'main')],
    { writes: [] },
  ],
  [
    'a stamped property is main’s to stamp, never merged',
    [
      page({ at: '1' }, { at: '2' }, { at: '3' }),
    ],
    [],
    { writes: [] },
  ],
  [
    'a component the server stamps whole is main’s to stamp',
    [{ eid: 'e', comp: 'seen', fork: null, branch: { at: '1' }, main: null }],
    [],
    { writes: [] },
  ],
  [
    'a mark the branch made is made',
    [{ eid: 'e', comp: 'done', fork: null, branch: { at: '1' }, main: null }],
    [],
    { writes: [{ done: {} }] },
  ],
  [
    'a component of no properties the branch added is added',
    [{ eid: 'e', comp: 'pinned', fork: null, branch: {}, main: null }],
    [],
    { writes: [{ pinned: {} }] },
  ],
  [
    'a component the branch added is added',
    [
      page(null, at('a'), null),
    ],
    [],
    { writes: [{ page: { title: 'a', n: 1 } }] },
  ],
  [
    'a component the branch removed is removed',
    [
      page(at('a'), null, at('a')),
    ],
    [],
    { writes: [{ page: null }] },
  ],
  [
    'a removal against main’s edit is a conflict',
    [
      page(at('a'), null, at('b')),
    ],
    [],
    { conflicts: [conflict('title', 'a', null, 'b')] },
  ],
  [
    'an edit against main’s removal is a conflict',
    [
      page(at('a'), at('b'), null),
    ],
    [],
    { conflicts: [conflict('title', 'a', 'b', null)] },
  ],
  [
    'an entity the branch deleted is deleted',
    [
      page(at('a'), null, at('a')),
      grave(null, {}, null),
    ],
    [],
    { writes: [{ $delete: true }] },
  ],
  [
    'a deletion main’s edit is picked over keeps the entity',
    [
      page(at('a'), null, at('b')),
      grave(null, {}, null),
    ],
    [pick('title', 'main')],
    {
      writes: [{ page: { n: null }, $was: { page: {} } }],
    },
  ],
]

// What a merge comes to: its conflicts, or what each bundle writes, the
// guards' tokens left out.
let outcome = (changes: Change[], picks: Choice[]) => {
  let m = merged(vocab, changes, picks)
  if (m.conflicts.length) return { conflicts: m.conflicts }
  return {
    writes: m.bundles.map(({ entity: _, $was, ...rest }) => ({
      ...rest,
      ...$was
        ? { $was: Object.fromEntries(Object.keys($was).map((c) => [c, {}])) }
        : {},
    })),
  }
}

for (let [name, changes, picks, want] of cases) {
  test(name, () => equal(outcome(changes, picks), want))
}

test('a guard holds main’s value of each property written', () =>
  equal(
    Object.keys(
      merged(vocab, [page(at('a'), at('b'), at('a'))]).bundles[0].$was!.page,
    ),
    ['title'],
  ))
