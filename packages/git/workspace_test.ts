// Stable filesystem identity and foreign-target refusal through Git's public
// workspace API, without processes or caller-directory assumptions.
import { equal, ok, test, throws } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { fixture } from './testing.ts'
import { filesystem, retained, workspaceGit } from './workspace.ts'
import { repositoryEid } from './host.ts'

let g = fixture({
  docs: [{
    $defs: {
      sandbox: { component: true, type: 'object' },
      home: {
        component: true,
        type: 'object',
        properties: { workspace: { type: 'string' }, cwd: { type: 'string' } },
      },
      process: {
        component: true,
        type: 'object',
        properties: { workspace: { type: 'string' }, cwd: { type: 'string' } },
      },
      exit: { component: true, type: 'object' },
    },
  }],
}).g
await g.apply([
  { entity: { eid: 'one' }, machine: { address: 'ssh://one' } },
  { entity: { eid: 'two' }, machine: { address: 'ssh://two' } },
  { entity: { eid: 'a' }, workspace: { machine: 'one', root: '/repo' } },
  { entity: { eid: 'b' }, workspace: { machine: 'one', root: '/elsewhere' } },
  { entity: { eid: 'c' }, workspace: { machine: 'two', root: '/repo' } },
  {
    entity: { eid: 'box' },
    sandbox: {},
    workspace: { machine: 'one', root: '/repo' },
  },
  {
    entity: { eid: 'inside' },
    workspace: { machine: 'one', root: '/repo', sandbox: 'box' },
  },
  {
    entity: { eid: 'wrong' },
    workspace: { machine: 'two', root: '/repo', sandbox: 'box' },
  },
  { entity: { eid: 'unknown' }, workspace: { root: '/repo' } },
  {
    entity: { eid: 'child' },
    workspace: { machine: 'one', root: '/repo/src' },
  },
  { entity: { eid: 'command' }, process: { workspace: 'child' } },
])
let a = await filesystem(g, 'a'),
  b = await filesystem(g, 'b'),
  c = await filesystem(g, 'c')
let inside = await filesystem(g, 'inside')

test('directory defaults share repository identity; computers and sandboxes do not', () => {
  equal(
    repositoryEid('/repo/.git', a.entity.eid),
    repositoryEid('/repo/.git', b.entity.eid),
  )
  ok(
    repositoryEid('/repo/.git', a.entity.eid) !=
      repositoryEid('/repo/.git', c.entity.eid),
  )
  ok(
    repositoryEid('/repo/.git', a.entity.eid) !=
      repositoryEid('/repo/.git', inside.entity.eid),
  )
  equal(inside.entity.eid, 'box')
})

test('unknown and contradictory placement refuses without executing a transport', async () => {
  let calls = 0
  let transport = {
    execute: () => {
      calls++
      return Promise.resolve('')
    },
  }
  await throws(() => workspaceGit(g, 'unknown', transport))
  await throws(() => workspaceGit(g, 'wrong', transport))
  equal(calls, 0)
})

test('a process keeps its launch subtree after the session switches elsewhere', async () =>
  equal(await retained(g, 'a'), true))
test('a process on another computer cannot keep this checkout', async () =>
  equal(await retained(g, 'c'), false))

let cwdGuard = fixture({
  docs: [{
    $defs: {
      process: {
        component: true,
        type: 'object',
        properties: {
          workspace: { type: 'string' },
          cwd: { type: 'string' },
        },
      },
      exit: { component: true, type: 'object' },
    },
  }],
}).g
await cwdGuard.apply([
  { entity: { eid: 'computer' }, machine: { address: 'ssh://box' } },
  { entity: { eid: 'root' }, workspace: { machine: 'computer', root: '/' } },
  {
    entity: { eid: 'tree' },
    workspace: { machine: 'computer', root: '/repo' },
  },
  {
    entity: { eid: 'process' },
    process: { workspace: 'root', cwd: '/repo/src' },
  },
])
test('an ancestor launch workspace with a checkout cwd also keeps its files', async () =>
  equal(await retained(cwdGuard, 'tree'), true))

let store = ram(g.vocab)
let watched = graph({ vocab: g.vocab, storage: store })
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'tree' }, workspace: { machine: 'box', root: '/repo' } },
    {
      entity: { eid: 'outside' },
      workspace: { machine: 'box', root: '/away' },
    },
    ...Array.from({ length: 1000 }, (_, i) => [
      {
        entity: { eid: `place${i}` },
        workspace: { machine: 'box', root: '/away' },
      },
      {
        entity: { eid: `process${i}` },
        process: { workspace: `place${i}`, cwd: '/away' },
      },
      {
        entity: { eid: `home${i}` },
        home: { workspace: `place${i}`, cwd: '/away' },
      },
    ]).flat(),
  ])
)
let read = watched.read.bind(watched),
  returned = 0,
  calls = 0,
  inject = Infinity
watched.read = async (q, opts) => {
  let rows = await read(q, opts)
  returned += rows.length
  if (++calls == inject) {
    store.tx((tx) =>
      tx.patch([{
        entity: { eid: 'late' },
        process: { workspace: 'tree' },
      }])
    )
  }
  return rows
}
let kept = await retained(watched, 'tree'), cost = returned, reads = calls
test('checkout retention does not load unrelated process and home histories', () => {
  equal(kept, false)
  ok(
    cost < 10,
    `${cost} rows returned beside 1000 unrelated homes and processes`,
  )
})
for (let at = 1; at < reads; at++) {
  store.tx((tx) => tx.patch([{ entity: { eid: 'late' }, process: null }]))
  calls = 0
  inject = at
  let kept = await retained(watched, 'tree')
  test(`a process attaching after read ${at} still keeps its checkout`, () => {
    equal(kept, true)
  })
}
inject = Infinity
store.tx((tx) =>
  tx.patch([
    {
      entity: { eid: 'box-a' },
      sandbox: {},
      workspace: { machine: 'box', root: '/' },
    },
    {
      entity: { eid: 'box-b' },
      sandbox: {},
      workspace: { machine: 'box', root: '/' },
    },
    {
      entity: { eid: 'boxed' },
      workspace: { machine: 'box', root: '/repo', sandbox: 'box-a' },
    },
    {
      entity: { eid: 'foreign-process' },
      process: { workspace: 'box-b', cwd: '/repo/src' },
    },
    {
      entity: { eid: 'lookalike' },
      workspace: { machine: 'box', root: '/repoish', sandbox: 'box-a' },
    },
    {
      entity: { eid: 'similar-home' },
      home: { workspace: 'lookalike', cwd: '/repoish/src' },
    },
  ])
)
let foreign = await retained(watched, 'boxed')
test('another sandbox and a similar path cannot keep a checkout', () => {
  equal(foreign, false)
})
store.tx((tx) =>
  tx.patch([{
    entity: { eid: 'ancestor-process' },
    process: { workspace: 'box-a', cwd: '/repo/src' },
  }])
)
let ancestor = await retained(watched, 'boxed')
test('a process launched at its sandbox root keeps a checkout by cwd', () => {
  equal(ancestor, true)
})
