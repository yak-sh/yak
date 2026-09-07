// The platform's clock writes rows in the directory. A Cron Trigger is only
// the heartbeat that reaches that graph; the schedules and the rules that
// react to `fired` belong to the plugins. Keeping the hop here makes the same
// scheduled path available to a Deno stand-in without importing workerd's
// WorkerEntrypoint from index.ts.
//
// Seeds are insert-once: a restart must not rewind `at`, erase `fired`, or
// undo a schedule someone deliberately paused. A new recurring seed starts
// at its first calendar instant at or after the heartbeat that discovered it.
import { type Graph, Stale } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import { next, span } from '@yaks/wake'
import type { Scheduled } from '@yaks/wake/cloudflare'
import { PLATFORM_STORE, storeOf } from './door.ts'
import type { Env } from './env.ts'
import type { Wake } from './plugin.ts'

/** The job a directory wake asks its plugin to do when `fired` is written. */
export let sweepDoc: VocabDoc = {
  $defs: {
    sweep: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['meter', 'trash'] } },
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
  let { metaBreaks, noted } = await import('./unseen.ts')
  await noted(metaBreaks(env), {
    request: `wake ${job}`,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? '' : '',
  }).catch((why) => console.error('yak: could not report', why, 'after', error))
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

/** Hand one Cloudflare heartbeat to the directory's graph and its rules. */
export let scheduled = async (event: Scheduled, env: Env): Promise<void> => {
  let res = await storeOf(env.STORE, PLATFORM_STORE)('/tick', {
    method: 'POST',
    body: JSON.stringify({ scheduledTime: event.scheduledTime }),
  }, { 'x-yak-kernel': '1' })
  if (!res.ok) throw new Error(`wake: ${res.status}: ${await res.text()}`)
  let result = await res.json() as {
    refused: { wake: Wake; error: string }[]
  }
  for (let refusal of result.refused) {
    await reported(env, refusal.wake.entity.eid, refusal.error)
  }
}
