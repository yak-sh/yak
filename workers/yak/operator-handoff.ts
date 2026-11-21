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
import type { Tool } from '@yaks/session'
import { builderOf, SPACE } from './build-door.ts'
import { directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { answered } from './meta.ts'
import { owns } from './operator-access.ts'
import type { Request } from './operator-channels.ts'
import { receive } from './operator-channels.ts'
import { rootAt, spaceOf } from './operator-root.ts'
import type { OperatorStore } from './operator-store.ts'
import { notification } from './operator-updates.ts'
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

let asked = (row: Bundle) => ({
  handoff: row.entity.eid,
  ...row.operator_handoff as SentHandoff,
  space_name: (row.doc as { title?: string })?.title,
  say: (row.doc as { body?: string })?.body,
  at: (row.created as { at?: string } | undefined)?.at,
})

/** The handoffs sent for `person` that have no reply yet, newest first. */
export let waiting = async (store: OperatorStore, person: string) =>
  (await store.g.read(
    line`.operator_handoff.person=${person}&!completed&!failed&.order=-created.at&.limit=20&.fields=operator_handoff,doc,created`,
  )).map((row) => {
    let { handoff, space_name, say, at } = asked(row)
    return { handoff, space: space_name, say, at }
  })

export let handoffTool = (
  env: Env,
  store: OperatorStore,
  from: Space,
  person: string,
): Tool => ({
  name: 'operator_handoff',
  title: 'Hand off to another space’s Operator',
  step: { doing: 'Handing off…', done: 'Handed off' },
  description:
    'Send a message or give work to the Operator of another space the person owns or administers. Use this after space_new to let its Operator set up the new space. Send only the context it needs. The receiving Operator works for the same person in that space with their permissions there. This returns a receipt immediately. The reply comes back to this conversation when ready. Set notify when the person is waiting for the outcome or asked to hear about it. Carry on with independent work while it runs.',
  parameters: {
    type: 'object',
    properties: {
      space: {
        type: 'string',
        description: 'The destination space slug or id for a new handoff.',
      },
      handoff: {
        type: 'string',
        description: 'To follow up, use the id from operator_handoffs.',
      },
      say: { type: 'string', description: 'The message or job to hand off.' },
      notify: {
        type: 'boolean',
        description: 'Alert the person when the reply arrives.',
      },
    },
    required: ['say'],
  },
  run: async ({ space, handoff, say, notify }, context) => {
    let text = typeof say == 'string' ? say.trim() : ''
    if (!text) throw refuse('arguments', 'Say what to hand off.')
    if (
      !context || !await owns(store, context.session, {
        space: from.eid,
        person,
      })
    ) {
      throw refuse('access', 'Use your own Operator conversation to hand off.')
    }
    let dir = directoryOf(env.STORE)
    let previous = typeof handoff == 'string' ? handoff : ''
    let [earlier] = previous
      ? await store.g.get([previous], ['operator_handoff'])
      : []
    let sent = earlier?.operator_handoff as SentHandoff | undefined
    if (previous && sent?.person != person) {
      throw refuse('missing', 'No handoff of yours has that id.')
    }
    let name = String(space ?? '')
    if (!sent && !name) throw refuse('arguments', 'Name a space or a handoff.')
    let to = sent
      ? await dir.at(sent.space)
      : await dir.space(name) ?? await dir.at(name)
    if (
      !to || to.trashed || to.eid == from.eid ||
      await dir.role(to, person) != 'owner'
    ) {
      throw refuse('access', 'Choose another space you own or administer.')
    }
    let id = derivedEid(`operator-handoff|${context.call.entity.eid}`)
    let task = sent?.task ?? handoffTask(id)
    let root = await rootAt(store, from.eid, person)
    let body = `Handed off to [${to.slug}'s Operator](${
      chatPath(to.slug, task)
    }).\n\n${text}`
    await store.g.apply([
      {
        entity: { eid: id },
        operator_handoff: {
          person,
          space: to.eid,
          session: context.session,
          task,
          ...previous ? { previous } : {},
          ...notify === true ? { notify } : {},
        },
        doc: { title: to.slug, body: text },
        $actor: { by: from.eid, via: context.session },
      },
      ...[...new Set([context.session, root])].map((session) =>
        handoffNote(session, id, from.eid, body)
      ),
    ], { trusted: true })
    return JSON.stringify({ handoff: id, space: to.slug, status: 'queued' })
  },
})

export let handoffsTool = (store: OperatorStore, person: string): Tool => ({
  name: 'operator_handoffs',
  title: 'List work handed off to other Operators',
  description:
    'List the most recent handoffs you sent for this person, what you asked and when, whether each has a report, any failure, and which are stalled (no reply after an hour). Use a handoff id with operator_handoff to follow up in its destination conversation.',
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
    { ...report, notify: sent.notify },
    from,
    root,
    asked!.entity.eid,
    mine,
    (notice) => notification({ ...notice, to: report.person }),
  )
}
