// Escalation between two of an Operator's conversations (T-151880). Someone
// replying to a letter or text the Operator sent for a person is talked with
// in their own conversation, with only their permissions (D-151808). What
// needs the person it was sent for (a time to choose, their calendar, their
// say) that conversation raises with theirs (`escalate`): a request on the
// `escalated` channel, decided there with the person's permissions, a step
// removed from the writer's words. What comes back is only what the person's
// side chooses to say (`escalation_answer`), a note in the writer's
// conversation that starts no turn. Each side's words say where they came
// from (operator-channels.ts `BY`, operator-draw.ts `VIA`).
import { addressed, type Bundle, type Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { short } from '@yaks/id'
import type { Tool, ToolContext } from '@yaks/session'
import type { Space } from './directory.ts'
import type { Request } from './operator-channels.ts'
import { rootAt } from './operator-root.ts'
import type { operatorStore } from './operator-store.ts'
import { whoseOf } from './operator-wakes.ts'
import { type Ctx, refuse } from './tool.ts'

type Store = ReturnType<typeof operatorStore>
let part = <T>(b: Bundle | undefined, name: string) => b?.[name] as T

/** The channels a reply to the Operator's letter or text comes on. */
export let REPLIES = ['letter', 'texted']

// The row `id` names, read in full, and its request.
let named = async (store: Store, id: string) => {
  let [row] = await store.g.get(await addressed(store.g, [id]))
  return { row, request: part<Request | undefined>(row, 'operator_request') }
}

// An id for what a call writes, the same each time the call is replayed.
let once = (what: string, context?: ToolContext) =>
  derivedEid(
    `operator-${what}|${context?.call?.entity.eid ?? crypto.randomUUID()}`,
  )

/** What a reply was to: a letter or a text. */
export let kindOf = (request?: Request) =>
  request?.channel == 'texted' ? 'text' : 'letter'

/**
 * The `escalate` tool of a conversation with someone who replied to what the
 * Operator sent for a person: it raises something with that person's own
 * conversation, on the `escalated` channel, naming this conversation as the
 * one it came `from`.
 */
export let escalate = (store: Store, space: Space): Tool => ({
  name: 'escalate',
  title: 'Raise it with the person',
  step: { doing: 'Raising it…', done: 'Raised it' },
  description:
    "Raise something with the person you sent your letter or text for, in their own conversation with you: a time the writer proposes, a question only that person can answer, anything that needs their choice or what is theirs. Say it in your own words, in a line or two, with what of the writer's it needs. It reaches that conversation marked as raised from this one, and is decided there with that person's permissions, who may write back to the writer themselves. Name the letter or text id the writer's words came with. What that conversation chooses to tell you comes back here as a note, and starts nothing; tell the writer you have passed it on, and promise nothing for that person.",
  parameters: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description:
          "The letter or text id of the writer's reply, as their words name it.",
      },
      say: { type: 'string', description: 'What to raise, in a line or two.' },
    },
    required: ['reply', 'say'],
  },
  run: async (args, context) => {
    let say = String(args.say ?? '').trim()
    if (!say) throw refuse('arguments', 'Say what to raise.')
    let { person } = await whoseOf(store, context)
    let { row, request } = await named(store, String(args.reply ?? ''))
    // Only a reply of this conversation's own, to what was sent for someone.
    if (
      !request || request.person != person ||
      !REPLIES.includes(request.channel)
    ) {
      throw refuse('missing', `There is no reply ${args.reply} of yours.`)
    }
    let [sent] = request.about ? await store.g.get([request.about]) : []
    let kind = kindOf(request)
    let member = String(
      part<Comp | undefined>(sent, `operator_${kind}`)?.person ?? '',
    )
    if (!member || member == person) {
      throw refuse(
        'missing',
        `That ${kind} was sent for nobody else to raise it with.`,
      )
    }
    let { receive } = await import('./operator-channels.ts')
    let id = await receive(
      store,
      {
        space: space.eid,
        person: member,
        channel: 'escalated',
        about: row.entity.eid,
        ...request.address ? { address: request.address } : {},
        from: await rootAt(store, space.eid, person),
      },
      say,
      { id: once('escalated', context) },
    )
    return JSON.stringify({ escalation: id })
  },
})

/**
 * The `escalation_answer` tool of a person's conversation: what it chooses to
 * tell the conversation that raised something with it, a note there that
 * starts no turn.
 */
export let escalationAnswer = (
  store: Store,
  ctx: Ctx,
  space: Space,
): Tool => ({
  name: 'escalation_answer',
  title: 'Answer the conversation that raised it',
  step: { doing: 'Answering…', done: 'Answered' },
  description:
    "Tell the conversation that raised something with you (an escalation, from your conversation with someone who replied to what you sent) what you choose to say: what was decided, or what to tell its writer when they write again. Only these words cross. That conversation has only the writer's permissions, so send nothing of the person's that the writer should not know. When you act, write back to the writer yourself, on the thread; this only tells the other conversation, and starts no turn there.",
  parameters: {
    type: 'object',
    properties: {
      escalation: {
        type: 'string',
        description: 'The escalation id, as its words name it.',
      },
      say: { type: 'string', description: 'What to tell that conversation.' },
    },
    required: ['escalation', 'say'],
  },
  run: async (args, context) => {
    let say = String(args.say ?? '').trim()
    if (!say) throw refuse('arguments', 'Say what to tell them.')
    let { person } = await whoseOf(store, context)
    let { row, request } = await named(store, String(args.escalation ?? ''))
    if (
      !request?.from || request.person != person ||
      request.channel != 'escalated'
    ) {
      throw refuse(
        'missing',
        `Nothing was raised with you as ${args.escalation}.`,
      )
    }
    let [there] = await store.g.get([request.from], ['session'])
    if (!there?.session) throw refuse('missing', 'That conversation is gone.')
    let name = (await ctx.dir.known(person))?.name || 'the person'
    let note = once('escalation', context)
    await store.g.apply([{
      entity: { eid: note },
      entry: { session: request.from, from: `your conversation with ${name}` },
      content: {
        body:
          `The conversation with ${name}, the person you sent it for, answering what you raised (escalation ${
            short(row.entity.eid)
          }). These are the words that conversation chose to send you, and yours to pass on to ${
            request.address ?? 'the writer'
          }: ${say}`,
      },
      // The Operator's own words from another conversation, said in one
      // quiet line under where they came from (operator-draw.ts `system`),
      // starting no turn.
      notice: {},
      system: {},
      operator_channel: { channel: 'escalation' },
      $actor: { by: space.eid, via: context?.session ?? request.from },
    }], { trusted: true })
    return JSON.stringify({ told: request.from })
  },
})
