// The platform's own schedules: the rows the directory is born holding. There
// is no heartbeat over any of it — every store arms its Durable Object alarm
// for the earliest wake it owes and fires them itself (graph.ts `tick`), so
// what is left here is the seeding, the job tag those rows wear, where a
// failed job is written down, and what becomes of a job its object died under.
//
// A job runs in the object that fired it, and a deploy resets that object
// wherever the job is: no catch runs and no report leaves an object that no
// longer exists, and the occurrence is spent (@yaks/wake runs an effect at
// most once). So a run is marked on its own row while it lasts
// (`sweep.began`), and the next incarnation reads a mark older than itself as
// a run that died: it says so and fires the job again (`resumed`). Every job
// here is a sweep that can run twice.
//
// Seeds are insert-once: a restart must not rewind `at`, erase `fired`, or
// undo a schedule someone deliberately paused. A new recurring seed starts
// at its first calendar instant at or after the moment it was discovered.
import { type Graph, Stale } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import { next, span } from '@yaks/wake'
import type { Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'
import type { Wake } from './plugin.ts'

/** The job a directory wake asks its plugin to do when `fired` is written. */
export let sweepDoc: VocabDoc = {
  $defs: {
    sweep: {
      component: true,
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['git', 'meter', 'trash'] },
        began: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when the run under way began; null once it ends',
        },
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

/** The wake row a job fired from, as its rule is handed it. */
export type Fired = { entity: { eid: string }; sweep?: unknown }

let jobOf = (row: Fired) =>
  (row.sweep as { kind?: string } | undefined)?.kind ?? row.entity.eid

/** Run a platform job with its row marked begun until it ends, and keep a
 * failure in the directory's exception log. */
export let reporting = async (
  env: Env,
  row: Fired,
  run: () => Promise<unknown>,
): Promise<undefined> => {
  let mark = (began: string | null) =>
    meta(env).apply([{ entity: row.entity, sweep: { began } }], KERNEL)
  await mark(new Date().toISOString())
  try {
    await run()
  } catch (error) {
    await reported(env, jobOf(row), error)
    throw error
  } finally {
    await mark(null).catch((e) => reported(env, jobOf(row), e))
  }
}

/** The jobs an object died in the middle of: a run marked begun before this
 * incarnation was `born`, which only a dead one could have left. Each is
 * reported and fired again, unless its wake was paused; a run this
 * incarnation began is still going and is left alone. */
export let resumed = async (
  graph: Pick<Graph, 'read' | 'apply'>,
  born: number,
  report: (job: string, error: Error) => Promise<unknown>,
): Promise<void> => {
  for (let row of await graph.read('.sweep&?wake')) {
    let began = (row.sweep as { began?: string | null }).began
    if (!began || Date.parse(began) >= born) continue
    let job = jobOf(row as Fired)
    await report(
      job,
      new Error(`wake ${job}: the run begun ${began} died unfinished`),
    )
    let paused = (row.wake as { at?: string | null } | undefined)?.at == null
    await graph.apply([{
      entity: row.entity,
      sweep: { began: null },
      ...(paused ? {} : { wake: { at: new Date().toISOString() } }),
    }])
  }
}
