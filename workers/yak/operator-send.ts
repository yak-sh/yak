// How one of the Operator's sessions speaks to another: `session_send`, a
// session id and a note. The session answers in its own voice, with its own
// person's permissions, wherever it is:
//
// - one of this person's own here (a helper of theirs, another of their
//   conversations): the note is its next words, from the session that sent
//   them;
// - another person's conversation in this space, such as their thread in a
//   room (operator-threads.ts): a request on the `thread` channel, which
//   wakes it with the note as the sender's thread's words, never its
//   person's (operator-channels.ts `BY`); its turn holds what a turn on
//   words from outside does, reads and telling its person, so a note carries
//   no authority over their tools;
// - another space's Operator conversation this person handed work to
//   (operator-handoff.ts): the note follows up there. Given `space` and no
//   session, a new handoff starts one there.
//
// A stranger's turn wakes only the other threads of the rooms it was
// addressed in, the ones it is told of.
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { line } from '@yaks/query'
import { type Tool, type ToolContext, topOf } from '@yaks/session'
import { take } from '@yaks/session/intake'
import { directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { ownerOf } from './operator-access.ts'
import { receive, THREAD } from './operator-channels.ts'
import { handOff } from './operator-handoff.ts'
import { threadsOf } from './operator-threads.ts'
import type { OperatorStore } from './operator-store.ts'
import { refuse } from './tool.ts'

/** What a session_send may reach beyond the person's own sessions. */
export type Reach = {
  /** another space's Operator, by a handoff */
  handoff: boolean
  /** the person is a member who writes here: any conversation of the space,
   * not only the other threads of the rooms they talk in */
  member: boolean
}

// Words to one of the person's own sessions, from `own`: its next input.
let toOwn = async (
  store: OperatorStore,
  space: Space,
  context: ToolContext,
  session: string,
  say: string,
) => {
  let id = derivedEid(`session-send|${context.call.entity.eid}`)
  await take(
    store.g,
    {
      session,
      id,
      by: space.eid,
      from: `your session ${context.session}`,
      body: say,
      system: true,
      channel: {
        name: 'session',
        framing:
          `From your session ${context.session}, working for the same person. Take it up as part of your work here; your answer goes back to it only if you send one with session_send.\n\n`,
      },
    },
    [{ entity: { eid: session }, completed: null }],
    { trusted: true },
  )
  return { session, status: 'sent' }
}

// A note to another person's conversation `top`, waking it on the `thread`
// channel as the words of `person`'s thread.
let toThread = async (
  env: Env,
  store: OperatorStore,
  space: Space,
  person: string,
  context: ToolContext,
  to: { session: string; person: string },
  say: string,
) => {
  let dir = directoryOf(env.STORE)
  let own = await topOf(store.g, context.session)
  // Named as the directory knows them, else as their thread goes by in a
  // room the two share.
  let [known, role, rooms] = await Promise.all([
    dir.known(person),
    dir.role(space, person),
    threadsOf(store, to.session, false),
  ])
  let named = rooms.flatMap((r) => r.threads).find((t) => t.session == own)
  await receive(
    store,
    {
      space: space.eid,
      person: to.person,
      channel: THREAD,
      about: to.session,
      from: context.session,
      address: known?.name || named?.name || 'someone',
      ...role ? { role } : {},
    },
    say,
    { id: derivedEid(`session-send|${context.call.entity.eid}`) },
  )
  return { session: to.session, status: 'queued' }
}

/** The Operator's one tool for speaking to another session. */
export let sessionSend = (
  env: Env,
  store: OperatorStore,
  space: Space,
  person: string,
  reach: Reach,
): Tool => ({
  name: 'session_send',
  title: 'Send a note to another session',
  step: { doing: 'Sending a note…', done: 'Sent a note' },
  description:
    `Wake another session with a note: another person's thread (its session is on its line among your other threads), one of your helpers or conversations${
      reach.handoff
        ? ", or another space's Operator: a conversation you handed off to (operator_handoffs lists each one's session), or, with space and no session, a new one in a space the person owns or administers, such as after space_new to let its Operator set up the new space"
        : ''
    }. The session takes a turn of its own and answers its own person itself, with their permissions, never yours; a thread reads your note as your thread's words, not its person's. Send only the context it needs. It answers here only when it sends you a note back${
      reach.handoff
        ? ", except another space's Operator, whose reply comes back to this conversation when ready: set notify when the person is waiting for it"
        : ''
    }. Returns at once; carry on with independent work.`,
  parameters: {
    type: 'object',
    properties: {
      session: {
        type: 'string',
        description: 'The session to wake, by its id.',
      },
      ...reach.handoff
        ? {
          space: {
            type: 'string',
            description:
              'For a new handoff, the slug or id of the space whose Operator starts a conversation; left out when you name a session.',
          },
          notify: {
            type: 'boolean',
            description:
              "Alert the person when another space's Operator replies.",
          },
        }
        : {},
      say: {
        type: 'string',
        description: 'The note: what it should know or do.',
      },
    },
    required: ['say'],
  },
  run: async ({ session, space: to, say, notify }, context) => {
    let text = typeof say == 'string' ? say.trim() : ''
    if (!text) throw refuse('arguments', 'Say what the note says.')
    if (!context) throw refuse('access', 'Send it from a conversation.')
    let id = typeof session == 'string' ? session.trim() : ''
    let answer = (value: unknown) => JSON.stringify(value)
    if (!id) {
      if (!reach.handoff || typeof to != 'string' || !to.trim()) {
        throw refuse('arguments', 'Name the session to wake.')
      }
      return answer(
        await handOff(env, store, space, person, context, {
          space: to.trim(),
          say: text,
          notify: notify === true,
        }),
      )
    }
    let own = await topOf(store.g, context.session)
    let owner = await ownerOf(store, id)
    if (owner?.space == space.eid) {
      if (id == context.session) {
        throw refuse('arguments', 'That is this session; name another.')
      }
      if (owner.person == person) {
        return answer(await toOwn(store, space, context, id, text))
      }
      let top = await topOf(store.g, id)
      let theirs = reach.member ||
        (await threadsOf(store, context.session, false)).some((r) =>
          r.threads.some((t) => t.session == top)
        )
      if (!theirs || top == own) {
        throw refuse('access', `No session ${id} you may wake.`)
      }
      return answer(
        await toThread(env, store, space, person, context, {
          session: top,
          person: owner.person,
        }, text),
      )
    }
    let [sent]: Bundle[] = reach.handoff
      ? await store.g.read(
        line`.operator_handoff.task=${id}&.operator_handoff.person=${person}&.order=-created.at&.limit=1&.fields=entity.eid,operator_handoff`,
      )
      : []
    if (!sent) throw refuse('missing', `No session ${id} you may wake.`)
    return answer(
      await handOff(env, store, space, person, context, {
        sent,
        say: text,
        notify: notify === true,
      }),
    )
  },
})
