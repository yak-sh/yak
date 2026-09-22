// The platform's own schedules: the rows the directory is born holding. There
// is no heartbeat over any of it — every store arms its Durable Object alarm
// for the earliest wake it owes and fires them itself (graph.ts `tick`), so
// what is left here is the seeding, the job tag those rows wear, and where a
// failed job is written down.
//
// Seeds are insert-once: a restart must not rewind `at`, erase `fired`, or
// undo a schedule someone deliberately paused. A new recurring seed starts
// at its first calendar instant at or after the moment it was discovered.
import { type Graph, Stale } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import { next, span } from '@yaks/wake'
import type { Env } from './env.ts'
import type { Wake } from './plugin.ts'

/** The job a directory wake asks its plugin to do when `fired` is written. */
export let sweepDoc: VocabDoc = {
  $defs: {
    sweep: {
      component: true,
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['git', 'meter', 'trash'] },
      },
    },
  },
}

/** Seed missing schedule rows without resetting a wake already held. */
export let seeded = async (
  graph: Pick<Graph, 'read' | 'apply'>,
  rows: Wake[],
  now: number,
): Promise<void> => {
  for (let row of rows) {
    let eid = row.entity.eid
    if ((await graph.read(`.eid=${eid}`)).length) continue
    let every = row.wake.every
    let at = row.wake.at !== undefined
      ? row.wake.at
      : every
      ? next(every, span(every) == null ? now - 1 : now)
      : null
    try {
      await graph.apply([{
        ...row,
        $was: { entity: { num: null } },
        wake: { ...row.wake, at },
      }])
    } catch (error) {
      // A concurrent heartbeat seeded the row first. Its occurrence wins.
      if (!(error instanceof Stale)) throw error
    }
  }
}

// Job failures and refused wake writes share the platform's exception log.
let reported = async (env: Env, job: string, error: unknown): Promise<void> => {
  let { fault } = await import('./unseen.ts')
  await fault(env, `wake ${job}`, error)
}

/** Keep a failed platform job in the directory's exception log. */
export let reporting = async (
  env: Env,
  job: string,
  run: () => Promise<unknown>,
): Promise<undefined> => {
  try {
    await run()
  } catch (error) {
    await reported(env, job, error)
    throw error
  }
}
