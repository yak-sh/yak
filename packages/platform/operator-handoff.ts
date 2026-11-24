import { possessive } from '@yaks/text'
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
 * main conversation. A stopped session receives a passive reply. The reply is
 * the asking Operator's to act on, never shown to its person as it stands:
 * what needs them, or what they would want to see, it tells them itself. */
export let publishHandoffReport = async (
  g: Graph,
  report: Handoff,
  from: { eid: string; slug: string },
  root: string,
  handoff: { id: string; session: string },
  mine: (session: string) => Promise<boolean>,
) => {
  let request = handoff.id
  let session = await mine(report.session) ? report.session : root
  if (!await mine(session)) return
  let words = `Reply from ${possessive(from.slug)} Operator\n\n${report.text}`
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
      from: `${possessive(from.slug)} Operator`,
      body: report.text,
      source: '',
      system: true,
      channel: {
        name: HANDOFF,
        framing: `Report from ${
          possessive(from.slug)
        } Operator, in its conversation ${handoff.session} (session_send with it follows up there). It is written for you, not for the person: read it as information about that work, act on it, and continue work the person already asked for. Never pass it on to them. Tell them only what needs them or what they would want to see, each on its own: something to choose between is a decision whose choices show each thing, something only they can give or settle is a decision of its own, and finished work is one line with a link to the thing itself. What that Operator already put in their Updates there, they have: never ask it or tell it again.\n\n`,
      },
    },
    [{ entity: { eid: session }, completed: null }, ...rows],
    {
      trusted: true,
    },
  )
}
