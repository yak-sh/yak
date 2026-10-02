// The gather plate's E cannot be stolen by another hero or a villager.
import { equal, test } from '@yaks/testing'
import { interaction, workTarget } from './interact.ts'
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
