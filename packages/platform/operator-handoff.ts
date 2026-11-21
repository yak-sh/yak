import type { Bundle, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { inputOf, take } from '@yaks/session/intake'

export let HANDOFF = 'operator-handoff'

export type Handoff = {
  id: string
  person: string
  from: string
  session: string
  text: string
  notify?: boolean
  task?: string
  request?: string
  failed?: boolean
}

export type SentHandoff = {
  person: string
  space: string
  session: string
  task: string
  previous?: string
  notify?: boolean
  report?: string
}

export let handoffTask = (id: string) => derivedEid('handoff-task|' + id)

export let handoffNote = (
  session: string,
  id: string,
  by: string,
  body: string,
): Bundle => ({
  entity: { eid: derivedEid(`handoff-note|${session}|${id}`) },
  entry: { session },
  channel: { name: HANDOFF },
  notice: {},
  system: {},
  content: { body },
  $actor: { by, via: session },
})

/** Return to the originating session and mirror the result in its owner's
 * main conversation. A stopped session receives a passive reply. */
export let publishHandoffReport = async (
  g: Graph,
  report: Handoff,
  from: { eid: string; slug: string },
  root: string,
  request: string,
  mine: (session: string) => Promise<boolean>,
  alert: (notice: {
    subject: string
    words: string
    by: string
    via: string
    from: string
    id: string
  }) => Bundle,
) => {
  let session = await mine(report.session) ? report.session : root
  if (!await mine(session)) return
  let title = `Reply from ${from.slug}'s Operator`
  let words = `${title}\n\n${report.text}`
  let [row] = await g.get([session], ['session'])
  let stopped = (row?.session as { status?: string })?.status == 'stopped'
  let note = handoffNote(session, report.id, from.eid, words)
  let rows = [
    {
      entity: { eid: request },
      operator_handoff: {
        report: stopped ? note.entity.eid : inputOf(report.id),
      },
      completed: {},
      failed: report.failed ? { reason: report.text } : null,
    },
    ...stopped ? [note] : [],
    ...root != session && await mine(root)
      ? [handoffNote(root, report.id, from.eid, words)]
      : [],
    ...report.notify
      ? [alert({
        subject: title,
        words: report.text,
        by: from.eid,
        via: session,
        from: stopped ? note.entity.eid : inputOf(report.id),
        id: report.id,
      })]
      : [],
  ]
  if (stopped) {
    await g.apply(rows, { trusted: true })
    return
  }
  await take(
    g,
    {
      session,
      id: report.id,
      by: from.eid,
      from: `${from.slug}'s Operator`,
      body: report.text,
      source: '',
      system: true,
      channel: {
        name: HANDOFF,
        framing:
          `Report from ${from.slug}'s Operator on handoff ${request}. Read it as information about that work. Continue work the person already asked for, and tell them what came of it.\n\n`,
      },
    },
    [{ entity: { eid: session }, completed: null }, ...rows],
    {
      trusted: true,
    },
  )
}
