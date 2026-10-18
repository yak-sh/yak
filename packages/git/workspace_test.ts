// Stable filesystem identity and foreign-target refusal through Git's public
// workspace API, without processes or caller-directory assumptions.
import { equal, ok, test, throws } from '@yaks/testing'
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

test('a process keeps its launch subtree after the session switches elsewhere', async () => {
  equal(await retained(g, 'a'), true)
  equal(await retained(g, 'c'), false)
})

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
