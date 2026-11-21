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
// A worker cannot hold UDP, which a platform's voice needs, so the relay is
// a small process elsewhere, at VOICE_RELAY (env.ts); unset, the tool says
// voice is not set up.

import type { Comp } from '@yaks/graph'
import { messageEid } from '@yaks/chat'
import type { Tool } from '@yaks/session'
import { apex } from '@yaks/platform/host'
import { guestOf, PLATFORMS, voice, voicedIn } from './chat.ts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { seal } from './lib/token.ts'
import type { Ticket } from './operator-calls.ts'
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
    if (!platform?.voice || !at.server) {
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
