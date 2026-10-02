// One nearby interaction owns both the prompt and the E action. Work wins
// while its plate offers E; otherwise talk to one villager or one hero.
import type { Frame } from './play.ts'
import type { Job } from './work.ts'

export let interaction = (
  f: Pick<Frame, 'talk' | 'peer'>,
  job: Pick<Job, 'near' | 'bench' | 'board'>,
) =>
  job.near
    ? 'node'
    : job.bench
    ? 'bench'
    : job.board
    ? 'board'
    : f.talk
    ? 'talk'
    : f.peer
    ? 'peer'
    : null

export let workTarget = (target: ReturnType<typeof interaction>) =>
  target == 'node' || target == 'bench' || target == 'board'
