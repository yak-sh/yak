// What an outside agent says to a space's Operator for a person: a
// conversation of @yaks/harness's (`conversation_start`, `conversation_send`)
// run in the space's Operator store, as the person, in the project the space
// is, with the Operator's beginning and model choice (operator.ts `chats`).
// operator_chat is one of them begun or carried on, waited on for a while,
// and its answer read.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Clock } from '@yaks/fp'
import { conversations } from '@yaks/harness/conversations'
import { replyOf, statusOf, taskSession, transcript } from '@yaks/session'
import { changes } from '@yaks/session/wait'
import type { Space } from './directory.ts'
import { type Args, refuse } from './tool.ts'
import type { Operator } from './operator.ts'

/** Who the Operator's replies name: yaks.app, where it failed, and itself. */
export let NAMING = { host: 'yaks.app', name: 'the Operator' }

type Chatting = Pick<Operator, 'store' | 'chats' | 'choose'>
type Asker = Parameters<Operator['chats']>[0]

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// The conversation tools that talk, and so make the Operator.
let TALKS = new Set(['conversation_start', 'conversation_send'])

/** A conversation tool that talks, run as `held` in `space`'s Operator store, answering
 * its value. */
export let converse = async (
  operator: Pick<Operator, 'store' | 'chats'>,
  held: Asker,
  space: Space,
  tool: string,
  args: Args,
): Promise<Record<string, unknown>> => {
  if (!TALKS.has(tool)) {
    throw refuse('arguments', `There is no conversation tool ${tool}.`)
  }
  let run = conversations(await operator.chats(held, space))[tool]!
  let [said] = await run({
    entity: { eid: crypto.randomUUID() },
    call: { to: tool, args: { ...args, project: space.eid } },
    $actor: { by: held.person },
  }, operator.store.g) as Bundle[]
  return JSON.parse(String(comp(said, 'content')?.body))
}

let ENDED = new Set(['settled', 'failed', 'stopped'])

/** Whether the conversation `session` has ended its turn. */
export let ended = async (g: Graph, session: string) =>
  ENDED.has(statusOf(await transcript(g, session)))

/** Until the conversation `session` ends, or `timeout` passes, read again
 * as the store writes while its own alarm works it. */
export let settled = async (
  g: Graph,
  session: string,
  o: { timeout?: number; clock?: Clock } = {},
) => {
  for await (
    let done of changes(g, { timeout: o.timeout ?? 25_000, clock: o.clock })
  ) if (done || await ended(g, session)) return
}

/** operator_chat: the person's words begin a conversation, or carry on the
 * task one began, and are waited on (`settle`), answering the reply, or
 * that the task works on for operator_read to read. */
export let chat = async (
  operator: Chatting,
  held: Asker,
  space: Space,
  args: Args,
  settle: (session: string) => Promise<void>,
) => {
  let { g } = operator.store
  let say = typeof args.say == 'string' ? args.say : ''
  if (!say.trim()) throw refuse('arguments', 'say what you want done')
  let task = typeof args.task == 'string' ? args.task : ''
  let carried = task ? await taskSession(g, task) : undefined
  if (task && !carried) throw refuse('missing', `no operator task ${task}`)
  // A provider or an effort named alone is the model it would choose.
  let model = args.model ??
    (args.provider != null || args.effort != null
      ? (await operator.choose(
        held,
        space,
        undefined,
        args.provider as string | undefined,
      )).model
      : undefined)
  let given = {
    provider: args.provider,
    model,
    effort: args.effort,
    attachments: args.attachments,
  }
  let said = carried
    ? await converse(operator, held, space, 'conversation_send', {
      ...given,
      session: carried,
      text: say,
    })
    : await converse(operator, held, space, 'conversation_start', {
      ...given,
      prompt: say,
    })
  let session = String(said.session)
  await settle(session)
  let entries = await transcript(g, session)
  let mine = entries.slice(entries.findIndex((b) => b.entity.eid == said.input))
  let status = statusOf(entries)
  let [link] = task ? [] : await g.read(`.contains .edge.to=${session}`)
  task ||= String(comp(link, 'edge')?.from ?? '')
  // The model its words were answered in, by the name it is chosen by.
  let [input] = await g.get([String(said.input)], ['using'])
  let chosen = String(comp(input, 'using')?.model ?? '')
  let [named] = chosen ? await g.get([chosen], ['model']) : []
  return {
    task,
    session,
    text: ENDED.has(status)
      ? replyOf(mine, NAMING).text
      : `The Operator is still working. Use operator_read with task ${task} to read its progress and answer.`,
    status,
    cost: mine.reduce(
      (sum, b) => sum + Number(comp(b, 'cost')?.dollars ?? 0),
      0,
    ),
    model: String(comp(named, 'model')?.name ?? chosen),
  }
}
