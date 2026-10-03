// The gather plate's E cannot be stolen by another hero or a villager.
import { equal, test } from '@yaks/testing'
import {
  friendlyKey,
  interaction,
  nearby,
  prompted,
  workTarget,
} from './interact.ts'
type Friendly = Parameters<typeof interaction>[0]
type Targets = Parameters<typeof interaction>[1]

test('E acts on the node offering it even beside another hero', () => {
  let f: Friendly = {
    talk: { id: 'villager', x: 1, y: 0, z: 0, near: 1 },
    peer: { eid: 'peer', body: { x: 0, y: 0, z: 2 } },
  }
  let job: Targets = {
    near: { eid: 'tree', at: [0, 0, 1], near: 1 },
    bench: null,
    board: null,
  }
  equal(interaction(f, job), 'node')
  equal(workTarget(interaction(f, job)), true)
  job.near = null
  equal(interaction(f, job), 'talk')
  f.talk = null
  equal(interaction(f, job), 'peer')
})

test('pointed and clicked friendly targets own both the prompt and E', () => {
  let at = (x: number, z: number) => ({ x, y: 0, z })
  let f: Friendly = {
    talk: { id: 'villager', ...at(1, 0), near: 1 },
    peer: { eid: 'peer', body: at(0, 2) },
    point: at(0, 2),
    friendly: '',
  }
  let job: Targets = {
    near: { eid: 'tree', at: [0, 0, 1], near: 1 },
    bench: { craft: 'forge', at: [2, 0, 0], near: 2 },
    board: null,
  }
  equal(interaction(f, job), 'peer')
  equal(workTarget(interaction(f, job)), false)
  f.point = at(2, 0)
  equal(interaction(f, job), 'bench')
  equal(workTarget(interaction(f, job)), true)
  f.friendly = 'villager'
  equal(interaction(f, job), 'talk')
  f.friendly = 'peer'
  equal(interaction(f, job), 'peer')
  f.friendly = friendlyKey(job.bench!.craft, job.bench!.at)
  equal(interaction(f, job), 'bench')
  job.bench = null
  f.point = at(0, 1)
  equal(interaction(f, job), 'node')
})

test('friendly selection follows the mouse among reachable villagers', () => {
  let rows = [{ id: 'near', x: 0, z: 1, near: 1 }, {
    id: 'pointed',
    x: 2,
    z: 0,
    near: 2,
  }]
  let choose = (id?: string) =>
    nearby(rows, { x: 2, y: 0, z: 0 }, id, (r) => r.id, (r) => r, (r) => r.near)
      ?.id
  equal(choose(), 'pointed')
  equal(choose('near'), 'near')
  equal(choose('gone'), 'pointed')
})

test('only the selected interaction keeps a prompt', () => {
  let job = {
    near: { eid: 'node' },
    bench: { craft: 'forge' },
    board: { id: 'board' },
    doing: { k: 0.5 },
  }
  let peer = prompted(job, 'peer')
  equal([peer.near, peer.bench, peer.board], [null, null, null])
  equal(peer.doing, job.doing)
  let node = prompted(job, 'node')
  equal(node.near, job.near)
  equal([node.bench, node.board], [null, null])
})
