// The gather plate's E cannot be stolen by another hero or a villager.
import { equal, test } from '@yaks/testing'
import { friendlyKey, interaction, nearby, workTarget } from './interact.ts'
import type { Frame } from './play.ts'
import type { Job } from './work.ts'

test('E acts on the node offering it even beside another hero', () => {
  let f = { talk: { id: 'villager' }, peer: { eid: 'peer' } } as Pick<
    Frame,
    'talk' | 'peer'
  >
  let job = { near: { eid: 'tree' }, bench: null, board: null } as Pick<
    Job,
    'near' | 'bench' | 'board'
  >
  equal(interaction(f, job), 'node')
  equal(workTarget(interaction(f, job)), true)
  job.near = null
  equal(interaction(f, job), 'talk')
  f.talk = null
  equal(interaction(f, job), 'peer')
})

test('pointed and clicked friendly targets own both the prompt and E', () => {
  let at = (x: number, z: number) => ({ x, y: 0, z })
  let f = {
    talk: { id: 'villager', ...at(1, 0), near: 1 },
    peer: { eid: 'peer', body: at(0, 2) },
    point: at(0, 2),
    friendly: '',
  } as Pick<
    Frame,
    'talk' | 'peer' | 'point' | 'friendly'
  >
  let job = {
    near: { eid: 'tree', at: [0, 0, 1], near: 1 },
    bench: { craft: 'smith', at: [2, 0, 0], near: 2 },
    board: null,
  } as Pick<
    Job,
    'near' | 'bench' | 'board'
  >
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
