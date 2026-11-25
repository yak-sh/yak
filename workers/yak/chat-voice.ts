// The Operator in a chat platform's voice room (T-2362): `voice_join`, asked
// in a room of a server, takes its bot into the voice room the asker is in
// there, and the room's audio streams through the relay that holds it
// (@yaks/discord-voice) to `/<via>/stream`, the door a phone call's audio
// streams to. From there the call is a call (operator-calls.ts): the same
// talking model and the same conversation, its words whoever spoke last's,
// read with what their account proves and their role here, as a room's are.
// The bot leaves once nobody but bots is left in the room (@yaks/chat/voice),
// when the call's time is up, or when asked to.
//
// Asked to take notes of a call there, `voice_notes` marks it, and once it
// ends the Operator writes them from the lines its conversation kept
// (operator-calls.ts `notesOf`); asked of a call that is over, at once.
//
// A worker cannot hold UDP, which a platform's voice needs, so the relay is
// a small process elsewhere, at VOICE_RELAY (env.ts); unset, the tool says
// voice is not set up.

import type { Comp } from '@yaks/graph'
import { messageEid } from '@yaks/chat'
import type { Tool } from '@yaks/session'
import { apex } from '@yaks/platform/host'
import { line } from '@yaks/query'
import { guestId, guestOf, PLATFORMS, voice, voicedIn } from './chat.ts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { seal } from './lib/token.ts'
import { callOf, notesOf, type Ticket } from './operator-calls.ts'
import type { Operator } from './operator.ts'
import { roomAt, roomsOf } from './operator-rooms.ts'
import type { OperatorStore } from './operator-store.ts'
import { refuse } from './tool.ts'

/** How long the Operator stays in a voice room at most, in minutes. */
export let MINUTES = 60

type Store = Pick<OperatorStore, 'g'>

// The account that wrote message `id` heard on `via`, as kept beside it.
let authorOf = async (store: Store, via: string, id: string) => {
  let [message] = await store.g.get([messageEid(via, id)], ['chat_message'])
  let author = (message?.chat_message as Comp | undefined)?.author
  if (!author) return undefined
  let [account] = await store.g.get([String(author)], ['chat_account'])
  let held = (account?.chat_account as Comp | undefined)?.id
  return held ? String(held) : undefined
}

/**
 * The call a voice room is, sealed into the address its audio streams to:
 * the room's one conversation, as a room heard in full has one, under the
 * guest who stands for it (chat.ts `guestOf`).
 */
export let roomCall = async (
  env: Env,
  space: Space,
  room: NonNullable<Ticket['room']>,
  asker: string,
  now = Date.now(),
) => {
  let ticket: Ticket = {
    space: space.eid,
    person: await guestOf(env, room.via, `room:${room.room}`),
    call: `${room.via}:${room.room}:${now}`,
    from: asker,
    to: room.room,
    via: room.via,
    at: now,
    room,
    minutes: MINUTES,
  }
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set')
  let sealed = await seal('call', ticket, env.SESSION_SECRET)
  return `wss://${apex(env)}/${room.via}/stream?call=${
    encodeURIComponent(sealed)
  }`
}

/** The Operator's `voice_join`, on a turn in a chat room of a platform whose
 * bot talks in voice rooms. */
export let voiceJoin = (env: Env, store: Store, space: Space): Tool => ({
  name: 'voice_join',
  title: 'Join a voice room',
  step: { doing: 'Joining the voice room…', done: 'Joined the voice room' },
  description:
    `Join a voice room (a Discord voice channel) to listen and talk there: the one the person who asked is in, in the server of a chat room you were addressed in during this conversation. Use it when someone asks you to join voice, hop in a call, or talk with them out loud. Everyone in the voice room hears you and can talk to you; you leave on your own once only bots are left, or after ${MINUTES} minutes. With leave, leave the voice room you are in there.`,
  parameters: {
    type: 'object',
    properties: {
      room: {
        type: 'string',
        description:
          "The chat room you were asked in: the platform's id for it, as its messages' framing gives it, or its eid; left out, the room you were last addressed in.",
      },
      leave: {
        type: 'boolean',
        description: 'Leave the voice room you are in, rather than join one.',
      },
    },
  },
  run: async (args, context) => {
    let at = roomAt(
      context?.session ? await roomsOf(store, context.session) : [],
      args.room,
    )
    let platform = PLATFORMS.get(at.via)
    if (!platform?.voice || !at.server || !at.connection) {
      throw refuse('arguments', `There is no voice room to join from there.`)
    }
    if (args.leave) {
      await voice(env, at.connection, { server: at.server, room: null })
      return 'Left the voice room.'
    }
    if (!env.VOICE_RELAY) {
      throw refuse('missing', 'Voice rooms are not set up on yaks.app yet.')
    }
    let asker = await authorOf(store, at.via, at.message)
    let room = asker &&
      await voicedIn(env, at.connection, at.server, asker)
    if (!asker || !room) {
      throw refuse(
        'missing',
        `Whoever asked is in no voice room ${platform.title} shows the bot; they join one first, then ask again.`,
      )
    }
    let where = {
      via: at.via,
      connection: at.connection,
      server: at.server,
      room,
    }
    let said = await voice(env, at.connection, {
      server: at.server,
      room,
      stream: await roomCall(env, space, where, asker),
    })
    if (said != 'joined') throw refuse('missing', said)
    return `Joined voice room ${room}. You are speaking there now: what you say aloud there is your voice's.`
  },
})

/** The call a voice room was last on, as its conversation kept it: `room`'s
 * on `via`, or the newest of any room's there. A room's call is named
 * `<via>:<room>:<when>` (`roomCall`), and kept under the room's guest. */
let lastCall = async (store: Store, via: string, room?: string) => {
  let began = await store.g.read(
    line`.operator_call.began=true .order=-created.at .limit=50 .fields=operator_call`,
  )
  let prefix = room ? `${via}:${room}:` : `${via}:`
  let call = began.map((b) => String((b.operator_call as Comp).call))
    .find((c) => c.startsWith(prefix))
  if (!call) return undefined
  let to = call.slice(via.length + 1, call.lastIndexOf(':'))
  return { call, to, via, person: guestId(via, `room:${to}`) }
}

/** The Operator's `voice_notes`, beside `voice_join`: notes of a voice
 * room's call, written from what was said on it, never its audio. */
export let voiceNotes = (
  store: Store,
  space: Space,
  note: Operator['note'],
  env: Env,
): Tool => ({
  name: 'voice_notes',
  title: 'Take notes of a voice call',
  step: {
    doing: 'Taking notes of the call…',
    done: 'Taking notes of the call',
  },
  description:
    'Take notes of a call in a voice room (a Discord voice channel) of the server of a chat room you were addressed in: when someone asks you to take notes, keep minutes or sum up a voice call, while it goes on or after it. Everything said on a call is kept as text, so notes never need its audio. On a call going on, the notes are written once it ends; on one that is over, or with now, at once. Either way they go in the Updates of everyone in the space; say so in a few words.',
  parameters: {
    type: 'object',
    properties: {
      room: {
        type: 'string',
        description:
          "The chat room you were asked in: the platform's id for it, as its messages' framing gives it, or its eid; left out, the room you were last addressed in.",
      },
      now: {
        type: 'boolean',
        description:
          'Write the notes of what was said so far now, rather than once the call ends.',
      },
    },
  },
  run: async (args, context) => {
    let at = roomAt(
      context?.session ? await roomsOf(store, context.session) : [],
      args.room,
    )
    let platform = PLATFORMS.get(at.via)
    if (!platform?.voice || !at.server || !at.connection) {
      throw refuse('arguments', `There is no voice room there.`)
    }
    // The asker's voice room where they are in one, else the call last on.
    let asker = await authorOf(store, at.via, at.message)
    let room = asker
      ? await voicedIn(env, at.connection, at.server, asker)
      : undefined
    let call = await lastCall(store, at.via, room ?? undefined) ??
      await lastCall(store, at.via)
    if (!call) {
      throw refuse(
        'missing',
        `No call in a ${platform.title} voice room was kept here.`,
      )
    }
    if (callOf(space.eid, call.person) && !args.now) {
      await note({ person: call.person }, space, '', {
        call: call.call,
        notes: true,
      })
      return "Marked: the call's notes are written once it ends, in everyone's Updates."
    }
    if (!await notesOf(store, space, call, call.call, true)) {
      throw refuse('missing', 'Nothing was said on that call yet.')
    }
    return "The call's notes are being written now, from what was said on it, and go in everyone's Updates."
  },
})
