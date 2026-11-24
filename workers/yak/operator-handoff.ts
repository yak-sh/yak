import { possessive } from '@yaks/text'
import {
  HANDOFF,
  type Handoff,
  handoffNote,
  handoffTask,
  publishHandoffReport,
  type SentHandoff,
} from '@yaks/platform/operator-handoff'
import { chatPath } from '@yaks/platform/routes'
import type { Bundle } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { derivedEid } from '@yaks/graph/identity'
import { writes } from '@yaks/member'
import { line } from '@yaks/query'
import type { Tool, ToolContext } from '@yaks/session'
import { builderOf, SPACE } from './build-door.ts'
import { directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { answered } from './meta.ts'
import { owns } from './operator-access.ts'
import type { Request } from './operator-channels.ts'
import { receive } from './operator-channels.ts'
import { rootAt, spaceOf } from './operator-root.ts'
import type { OperatorStore } from './operator-store.ts'
import { refuse, rejected } from './tool.ts'

/** Ask another space's Builder at the handoff door: a request or a report
 * of a handoff, or an overview of its Operator's work for a person
 * (operator-staff.ts). Answers what it answered. */
export let door = async (
  env: Env,
  to: string,
  kind: 'request' | 'report' | 'overview',
  value: Handoff | { person: string; from: string },
): Promise<unknown> => {
  let response = await builderOf(env, to)(() =>
    new Request('https://builder/operator/handoff', {
      method: 'POST',
      headers: { [SPACE]: to, 'x-yak-kernel': '1' },
      body: JSON.stringify({ kind, ...value }),
    })
  )
  if (!response.ok) {
    let error = await answered(response)
    throw response.status < 500
      ? rejected(response.status, error.message)
      : error
  }
  return await response.json()
}

// How long a handoff waits for its reply before it counts as stalled.
let STALLS = 3_600_000

// A handoff as its lists show it: `session` is the conversation it started
// in the other space, which session_send follows up in.
let asked = (row: Bundle) => {
  let { task, previous, report } = row.operator_handoff as SentHandoff
  return {
    handoff: row.entity.eid,
    session: task,
    ...previous ? { previous } : {},
    ...report ? { report } : {},
    space_name: (row.doc as { title?: string })?.title,
    say: (row.doc as { body?: string })?.body,
    at: (row.created as { at?: string } | undefined)?.at,
  }
}

/** The handoffs sent for `person` that have no reply yet, newest first. */
export let waiting = async (store: OperatorStore, person: string) =>
  (await store.g.read(
    line`.operator_handoff.person=${person}&!completed&!failed&.order=-created.at&.limit=20&.fields=operator_handoff,doc,created`,
  )).map((row) => {
    let { session, space_name, say, at } = asked(row)
    return { session, space: space_name, say, at }
  })

/**
 * Hand work to the Operator of another space `person` owns or administers
 * (session_send, operator-send.ts): a new conversation there in `space`, or a
 * follow-up in the one an earlier handoff `sent` started. Answers its receipt:
 * the destination conversation's session, which a follow-up names.
 */
export let handOff = async (
  env: Env,
  store: OperatorStore,
  from: Space,
  person: string,
  context: ToolContext,
  o: { space?: string; sent?: Bundle; say: string },
) => {
  if (!await owns(store, context.session, { space: from.eid, person })) {
    throw refuse('access', 'Use your own Operator conversation to hand off.')
  }
  let dir = directoryOf(env.STORE)
  let sent = o.sent?.operator_handoff as SentHandoff | undefined
  let previous = o.sent?.entity.eid
  let to = sent
    ? await dir.at(sent.space)
    : await dir.space(o.space!) ?? await dir.at(o.space!)
  if (
    !to || to.trashed || to.eid == from.eid ||
    await dir.role(to, person) != 'owner'
  ) {
    throw refuse('access', 'Choose another space you own or administer.')
  }
  let id = derivedEid(`operator-handoff|${context.call.entity.eid}`)
  let task = sent?.task ?? handoffTask(id)
  let root = await rootAt(store, from.eid, person)
  let body = `Handed off to [${possessive(to.slug)} Operator](${
    chatPath(to.slug, task)
  }).\n\n${o.say}`
  await store.g.apply([
    {
      entity: { eid: id },
      operator_handoff: {
        person,
        space: to.eid,
        session: context.session,
        task,
        ...previous ? { previous } : {},
      },
      doc: { title: to.slug, body: o.say },
      $actor: { by: from.eid, via: context.session },
    },
    ...[...new Set([context.session, root])].map((session) =>
      handoffNote(session, id, from.eid, body)
    ),
  ], { trusted: true })
  return { session: task, space: to.slug, status: 'queued' }
}

export let handoffsTool = (store: OperatorStore, person: string): Tool => ({
  name: 'operator_handoffs',
  title: 'List work handed off to other Operators',
  description:
    "List the most recent handoffs you sent for this person to other spaces' Operators, what you asked and when, whether each has a report, any failure, and which are stalled (no reply after an hour). Follow one up with session_send and its session, the conversation it started there.",
  readOnly: true,
  parameters: { type: 'object', properties: {} },
  run: async () =>
    JSON.stringify((await store.g.read(
      line`.operator_handoff.person=${person}&.order=-created.at&.limit=50&.fields=operator_handoff,doc,failed,completed,created`,
    )).map((row) => {
      let sent = asked(row)
      let late = Date.now() - Date.parse(sent.at ?? '') > STALLS
      return {
        ...sent,
        status: row.failed
          ? 'failed'
          : row.completed
          ? 'replied'
          : late
          ? 'stalled'
          : 'waiting',
      }
    })),
})

/** Deliver an outgoing handoff from its durable receipt. */
export let sendHandoff = async (
  env: Env,
  store: OperatorStore,
  row: Bundle,
) => {
  let sent = row.operator_handoff as SentHandoff
  let from = await spaceOf(store)
  if (!from) throw new Error('Handoff has no source space.')
  let id = row.entity.eid
  try {
    await door(env, sent.space, 'request', {
      id,
      person: sent.person,
      from,
      session: sent.session,
      text: String((row.doc as { body?: string })?.body ?? ''),
      ...sent.previous ? { task: sent.task } : {},
    })
  } catch (error) {
    if (!(error instanceof CallError)) throw error
    await acceptHandoffReport(env, store, from, {
      id: derivedEid('handoff-refused|' + id),
      request: id,
      person: sent.person,
      from: sent.space,
      session: sent.session,
      text: error.message,
      failed: true,
    })
  }
}

/** The kernel receives a request as the same person in the destination. */
export let acceptHandoff = async (
  env: Env,
  store: OperatorStore,
  space: string,
  message: Handoff,
) => {
  let dir = directoryOf(env.STORE)
  let [from, to] = await Promise.all([dir.at(message.from), dir.at(space)])
  if (
    !from || from.trashed || !to || to.trashed || from.eid == to.eid ||
    await dir.role(to, message.person) != 'owner' ||
    !writes(await dir.role(from, message.person) ?? null)
  ) throw refuse('access', 'This handoff requires access to both spaces.')
  if (
    message.task && !await owns(store, message.task, {
      space,
      person: message.person,
    })
  ) {
    throw refuse('missing', 'The destination conversation is gone.')
  }
  return receive(
    store,
    {
      space,
      person: message.person,
      channel: HANDOFF,
      from: message.session,
      from_space: from.eid,
      address: from.slug,
      ...message.task ? { task: message.task } : {},
    },
    message.text,
    { id: message.id },
  )
}

/** The answer effect delivers a report to the exact conversation that sent
 * the request, even after its turn ends. */
export let sendHandoffReport = async (
  env: Env,
  request: Request,
  answer: { id: string; text: string; request: string; failed?: boolean },
) => {
  if (!request.from_space || !request.from) {
    throw new Error('Handoff is missing its return conversation.')
  }
  await door(env, request.from_space, 'report', {
    ...answer,
    from: request.space,
    person: request.person,
    session: request.from,
  })
}

export let acceptHandoffReport = async (
  env: Env,
  store: OperatorStore,
  space: string,
  report: Handoff,
) => {
  let dir = directoryOf(env.STORE)
  let [local, from, [asked]] = await Promise.all([
    dir.at(space),
    dir.at(report.from),
    report.request ? store.g.get([report.request], ['operator_handoff']) : [],
  ])
  let sent = asked?.operator_handoff as SentHandoff | undefined
  if (
    !local || local.trashed || !from || !sent ||
    sent.person != report.person || sent.space != from.eid ||
    sent.session != report.session ||
    !writes(await dir.role(local, report.person) ?? null)
  ) return
  let root = await rootAt(store, space, report.person)
  let mine = (session: string) =>
    owns(store, session, {
      person: report.person,
      space,
    })
  await publishHandoffReport(
    store.g,
    report,
    from,
    root,
    { id: asked!.entity.eid, session: sent.task },
    mine,
  )
}
