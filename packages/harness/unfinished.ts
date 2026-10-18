// A native final that leaves claimed work unfinished, reported after each step.
// Step durations are not compared here: a session's own earlier steps are no
// baseline on a shared box, and the `harness-steps` benchmark guards overhead.

import type { Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Host } from '@yaks/host'
import type { Runner, Step } from '@yaks/session'

/** Await the check before a step returns; a failed check cannot change it. */
export let unfinishedEach = (
  host: Host,
  each?: Runner['each'],
): NonNullable<Runner['each']> =>
async (step, session) => {
  await each?.(step, session)
  if (!session || step.did == 'nothing') return
  try {
    await unfinishedNativeFinal(host, session, step)
  } catch (error) {
    try {
      await host.report?.(error, {
        during: { session },
        tags: { handler: 'unfinished' },
      })
    } catch (failure) {
      console.error('unfinished reporter failed', failure)
    }
  }
}

/** A native final with unblocked claimed work is not successful completion.
 * Report the idle handoff; do not resume it automatically or spend another turn. */
export let unfinishedNativeFinal = async (
  host: Host,
  session: string,
  step: Step,
): Promise<void> => {
  if (step.status != 'settled' || step.did != 'asked') return
  let [native] = await host.graph.read(
    `.entity.eid=${session}&.native&.fields=entity.eid`,
  )
  if (!native) return
  let tasks = await host.graph.read(
    `.task&.claim.session=${session}&!completed&!cancelled&!blocked&.fields=entity.eid,doc.title`,
  )
  // Heal's follower owns continuation of an open fixer, including the quiet
  // interval between its final answer and the next tracker reconciliation.
  // A fixer mark alone is history; disabled heal must not suppress reports.
  const heal = host.config?.plugins?.find((plugin) =>
    typeof plugin == 'object' && plugin.use == '@yaks/heal'
  )
  const enabled = typeof heal == 'object' && !!heal.with?.provider
  const [fixer] = enabled
    ? await host.graph.get([session], ['fixer', 'stop', 'exit'])
    : []
  const bug = (fixer?.fixer as Comp | undefined)?.bug
  for (let task of tasks) {
    if (bug && !fixer?.stop && !fixer?.exit) {
      const [muted] = await host.graph.read(
        `.entity.eid=${task.entity.eid}&.filed.project.nofix&.fields=entity.eid`,
      )
      const [owned] = await host.graph.read(
        `.about&.edge.from=${task.entity.eid}&.edge.to=${
          String(bug)
        }&.fields=entity.eid&.limit=1`,
      )
      if (!muted && (owned || task.entity.eid == bug)) continue
    }
    let waiting = await host.graph.read(
      `(.requires|.contains)&.edge.from=${task.entity.eid}&.edge.to.task&!edge.to.completed&!edge.to.cancelled&.fields=entity.eid&.limit=1`,
    )
    if (waiting.length) continue
    let final = step.added.findLast((b) => b.ask)?.entity.eid ??
      step.added.at(-1)?.entity.eid
    if (!final) continue
    await host.report?.(
      new Error(
        `Native session settled with unfinished claimed work: ${
          String((task.doc as Comp | undefined)?.title ?? task.entity.eid)
        }`,
      ),
      {
        eid: derivedEid(
          `native-unfinished|${session}|${task.entity.eid}|${final}`,
        ),
        during: { session, entity: task.entity.eid },
        tags: { step: final, condition: 'settled-unfinished' },
      },
    )
  }
}
