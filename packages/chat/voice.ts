// A bot in voice rooms, whatever the platform, as pure steps: who the
// platform says is in each server's voice rooms (`Voice`), where it says the
// bot's own audio goes (`Media`), and the rooms its host asked it into. Each
// step answers what the host does next: send a frame on the bot's socket to
// join or leave a room, hand a relay the session it joins with, or let a room
// go. The bot stays while anyone but bots is in its room, and leaves once
// nobody is.

import type { Media, Voice } from './mod.ts'

/** What a relay is handed to join a room: the bot's session there, where its
 * audio goes, and the address the room's audio streams to. */
export type Joined = {
  server: string
  room: string
  me: string
  session: string
  endpoint: string
  token: string
  stream: string
}

/** What the host does next: join a room (or leave one, `room` null) with a
 * frame on its socket, hand the relay a session, or let a room go. */
export type Act =
  | { join: { server: string; room: string | null } }
  | { relay: Joined }
  | { left: string }

export type Rooms = {
  /** the host asks the bot into `room`, its audio streamed to `stream` */
  ask: (server: string, room: string, stream: string) => Act[]
  /** the host asks the bot out of the room it is in on `server` */
  leave: (server: string) => Act[]
  /** the platform said who is in voice rooms */
  voices: (all: Voice[]) => Act[]
  /** the platform said where the bot's audio goes */
  media: (media: Media) => Act[]
  /** where `account` is on `server`, if in a voice room */
  where: (server: string, account: string) => string | undefined
  /** the people in `room` of `server`, bots and the bot itself left out */
  people: (server: string, room: string) => string[]
}

/**
 * The voice rooms one bot is in.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { voiceRooms } from '@yaks/chat/voice'
 * let r = voiceRooms()
 * let v = (account: string, room: string | null, me = false) =>
 *   ({ server: 's', account, room, session: `x-${account}`, ...me ? { me: true as const } : {} })
 * equal(r.voices([v('ana', 'lounge')]), [])
 * equal(r.where('s', 'ana'), 'lounge')
 * equal(r.ask('s', 'lounge', 'wss://h/x'), [{ join: { server: 's', room: 'lounge' } }])
 * equal(r.voices([v('bot', 'lounge', true)]), [])
 * equal(r.media({ server: 's', endpoint: 'e', token: 't' }), [{
 *   relay: { server: 's', room: 'lounge', me: 'bot', session: 'x-bot', endpoint: 'e', token: 't', stream: 'wss://h/x' },
 * }])
 * equal(r.people('s', 'lounge'), ['ana'])
 * equal(r.voices([v('ana', null)]), [{ join: { server: 's', room: null } }, { left: 's' }])
 * equal(r.voices([v('bot', null, true)]), [])
 * r.voices([v('ana', 'lounge')])
 * equal(r.ask('s', 'lounge', 'wss://h/y'), [{ join: { server: 's', room: 'lounge' } }])
 * equal(r.voices([v('bot', 'lounge', true)]), [])
 * equal(r.voices([v('bot', null, true)]), [{ left: 's' }])
 * ```
 */
export let voiceRooms = (): Rooms => {
  // Who is in which room, by server and account.
  let people = new Map<string, Map<string, Voice>>()
  // The rooms the host asked the bot into, by server.
  let asked = new Map<string, { room: string; stream: string }>()
  let medias = new Map<string, Media>()
  // The session last handed to the relay, by server, so one is handed once.
  let handed = new Map<string, string>()

  let mine = (server: string) =>
    [...people.get(server)?.values() ?? []].find((v) => v.me)
  let inRoom = (server: string, room: string) =>
    [...people.get(server)?.values() ?? []]
      .filter((v) => v.room == room && !v.me && !v.bot)
      .map((v) => v.account)
  let forget = (server: string) => {
    asked.delete(server)
    medias.delete(server)
    handed.delete(server)
  }
  // The relay handed the session, once it has all it needs and the bot is
  // in the room it was asked into, or moved to by someone there.
  let ready = (server: string): Act[] => {
    let ask = asked.get(server)
    let me = mine(server)
    let media = medias.get(server)
    if (!ask || !me?.room || !media) return []
    if (me.room != ask.room) asked.set(server, ask = { ...ask, room: me.room })
    let relay: Joined = {
      server,
      room: ask.room,
      me: me.account,
      session: me.session,
      endpoint: media.endpoint,
      token: media.token,
      stream: ask.stream,
    }
    let key = JSON.stringify(relay)
    if (handed.get(server) == key) return []
    handed.set(server, key)
    return [{ relay }]
  }
  // Out of a room nobody is left in.
  let alone = (server: string): Act[] => {
    let ask = asked.get(server)
    let me = mine(server)
    if (!ask || me?.room != ask.room || inRoom(server, ask.room).length) {
      return []
    }
    forget(server)
    return [{ join: { server, room: null } }, { left: server }]
  }

  return {
    ask: (server, room, stream) => {
      asked.set(server, { room, stream })
      handed.delete(server)
      return mine(server)?.room == room
        ? ready(server)
        : [{ join: { server, room } }]
    },
    leave: (server) => {
      if (!asked.has(server)) return []
      forget(server)
      return [{ join: { server, room: null } }, { left: server }]
    },
    voices: (all) => {
      let servers = new Set<string>()
      let out = new Set<string>()
      for (let v of all) {
        let held = people.get(v.server) ?? new Map<string, Voice>()
        people.set(v.server, held)
        if (v.room) held.set(v.account, v)
        else held.delete(v.account)
        servers.add(v.server)
        if (v.me && !v.room) out.add(v.server)
      }
      return [...servers].flatMap((server): Act[] => {
        // Taken out of its room by someone, or by the platform.
        if (out.has(server) && asked.has(server)) {
          forget(server)
          return [{ left: server }]
        }
        return [...ready(server), ...alone(server)]
      })
    },
    media: (media) => {
      medias.set(media.server, media)
      return ready(media.server)
    },
    where: (server, account) =>
      people.get(server)?.get(account)?.room ?? undefined,
    people: inRoom,
  }
}
