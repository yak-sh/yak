// Discord for @yaks/chat. A bot hears messages only over Discord's Gateway, a
// websocket it holds open (https://discord.com/developers/docs/events/gateway),
// so `socket` is the Gateway's handshake, heartbeat and resume as pure steps,
// and `send` posts a reply with the REST API. A bot's token is all either
// needs: yaks.app's own bot's, or the one a space brings.

import type { Addressed, Platform, Said, Socket, Step } from '@yaks/chat'
import { Unsent } from '@yaks/host/senders'

let API = 'https://discord.com/api/v10'
let GATEWAY = 'wss://gateway.discord.gg'
let QUERY = '/?v=10&encoding=json'

/** The Gateway intents asked for: servers, their messages, direct messages,
 * and the words of messages (Message Content, privileged), so a bot hears a
 * room it was given and not only the messages that name it. */
export let INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15)

/** The Gateway's opcodes this bot reads or sends (opcodes-and-status-codes). */
let OP = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  resume: 6,
  reconnect: 7,
  invalid: 9,
  hello: 10,
  ack: 11,
}

/** What a bot remembers of its Gateway session: the last sequence number,
 * the session and the address to resume it at, its own user id, and whether
 * its last heartbeat was answered. */
export type Session = {
  seq: number | null
  session?: string
  resume?: string
  me?: string
  acked: boolean
}

type Frame = { op: number; d?: unknown; s?: number | null; t?: string | null }
type User = {
  id: string
  username: string
  global_name?: string | null
  bot?: boolean
}
type Message = {
  id: string
  channel_id: string
  guild_id?: string
  author: User
  content: string
  timestamp: string
  mentions?: { id: string }[]
  message_reference?: { message_id?: string }
  referenced_message?: { author?: { id: string } } | null
}

/** A message Discord sent the bot, as @yaks/chat reads one: none for a bot's
 * own, or another bot's, so two bots never talk to each other forever. It is
 * addressed `direct` outside a server, as a `reply` when it answers one of
 * the bot's own (which Discord also counts a mention), and as a `mention`
 * when it names the bot; its words lose that mention. */
export let said = (m: Message, me?: string): Said | undefined => {
  if (m.author.bot || m.author.id == me) return
  let addressed: Addressed | undefined = !m.guild_id
    ? 'direct'
    : me && m.referenced_message?.author?.id == me
    ? 'reply'
    : me && (m.mentions ?? []).some((u) => u.id == me)
    ? 'mention'
    : undefined
  let text = me
    ? m.content.replaceAll(`<@${me}>`, '').replaceAll(`<@!${me}>`, '')
    : m.content
  return {
    id: m.id,
    room: m.channel_id,
    ...m.guild_id ? { server: m.guild_id } : {},
    author: {
      id: m.author.id,
      name: m.author.global_name || m.author.username,
    },
    text: text.trim(),
    at: m.timestamp,
    ...addressed ? { addressed } : {},
    ...m.message_reference?.message_id
      ? { reply_to: m.message_reference.message_id }
      : {},
  }
}

/** Close codes after which the same token must not connect again
 * (opcodes-and-status-codes, Gateway Close Event Codes). */
let ENDS: Record<number, string> = {
  4004: 'Discord refused the bot token. Give a new one.',
  4010: 'Discord refused the shard this bot connected as.',
  4011: 'This bot is in too many servers to connect without sharding.',
  4012: 'Discord no longer serves the Gateway version this bot uses.',
  4013: 'Discord refused the intents this bot asked for.',
  4014:
    'Turn on Message Content Intent under Bot in the Discord Developer Portal.',
}

/** The Gateway for a bot with `token`. */
export let gateway = (token: string): Socket<Session> => ({
  start: { seq: null, acked: true },
  url: (s) => (s.session && s.resume ? s.resume : GATEWAY) + QUERY,
  step: (s, raw): Step<Session> => {
    let f = raw as Frame
    let seq = f.s ?? s.seq
    let state = { ...s, seq }
    switch (f.op) {
      case OP.hello: {
        let d = f.d as { heartbeat_interval: number }
        let hello = s.session
          ? { op: OP.resume, d: { token, session_id: s.session, seq: s.seq } }
          : {
            op: OP.identify,
            d: {
              token,
              intents: INTENTS,
              properties: {
                os: 'linux',
                browser: 'yaks.app',
                device: 'yaks.app',
              },
            },
          }
        return {
          state: { ...state, acked: true },
          send: [hello],
          every: d.heartbeat_interval,
        }
      }
      case OP.ack:
        return { state: { ...state, acked: true } }
      case OP.heartbeat:
        return { state, send: [{ op: OP.heartbeat, d: seq }] }
      case OP.reconnect:
        return { state, again: true }
      case OP.invalid:
        // A session Discord says it can resume is resumed; any other starts
        // afresh, with a new identify.
        return {
          state: f.d === true ? state : { seq: null, acked: true, me: s.me },
          again: true,
        }
      case OP.dispatch: {
        if (f.t == 'READY') {
          let d = f.d as {
            session_id: string
            resume_gateway_url: string
            user: User
          }
          return {
            state: {
              ...state,
              session: d.session_id,
              resume: d.resume_gateway_url,
              me: d.user.id,
            },
          }
        }
        if (f.t == 'MESSAGE_CREATE') {
          let heard = said(f.d as Message, s.me)
          return { state, ...heard ? { heard: [heard] } : {} }
        }
        return { state }
      }
      default:
        return { state }
    }
  },
  // A beat Discord never answered means the connection is dead though open:
  // connect again and resume (gateway, "Sending Heartbeats").
  beat: (s) =>
    s.acked
      ? {
        state: { ...s, acked: false },
        send: [{ op: OP.heartbeat, d: s.seq }],
      }
      : { state: s, again: true },
  ends: (code) => ENDS[code],
})

/** Post `reply` as the bot with `token`, answering the message it names
 * when there still is one, and pinging nobody. A 429 or a 5xx never took it,
 * so it is {@link Unsent} and tried again; any other refusal is thrown with
 * what Discord said. */
export let send: Platform['send'] = async (token, reply, fetcher = fetch) => {
  let res = await fetcher(`${API}/channels/${reply.room}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      content: reply.text,
      allowed_mentions: { parse: [] },
      ...reply.reply_to
        ? {
          message_reference: {
            message_id: reply.reply_to,
            fail_if_not_exists: false,
          },
        }
        : {},
    }),
  })
  let body = await res.json().catch(() => ({})) as {
    id?: string
    message?: string
    retry_after?: number
  }
  if (res.status == 429 || res.status >= 500) {
    throw new Unsent(
      `Discord did not take the reply: ${res.status}`,
      Math.ceil((body.retry_after ?? 1) * 1000),
    )
  }
  if (!res.ok) {
    throw new Error(
      `Discord refused the reply: ${res.status} ${body.message ?? ''}`.trim(),
    )
  }
  return { id: body.id }
}

/** Show the room `room` that the bot with `token` is typing, which Discord
 * shows for ten seconds or until the bot's next message there
 * (POST /channels/{id}/typing). A 429 or a 5xx is {@link Unsent}, shown
 * again at the next beat. */
export let typing = async (
  token: string,
  room: string,
  fetcher: typeof fetch = fetch,
): Promise<void> => {
  let res = await fetcher(`${API}/channels/${room}/typing`, {
    method: 'POST',
    headers: { authorization: `Bot ${token}` },
  })
  let body = await res.json().catch(() => ({})) as { message?: string }
  if (res.status == 429 || res.status >= 500) {
    throw new Unsent(`Discord did not show typing: ${res.status}`)
  }
  if (!res.ok) {
    throw new Error(
      `Discord refused to show typing: ${res.status} ${body.message ?? ''}`
        .trim(),
    )
  }
}

/** The server (guild) the room `room` belongs to, as the bot with `token`
 * sees it (GET /channels/{id}), none for a direct one. A 429 or a 5xx is
 * {@link Unsent}; a room the bot cannot see is refused with what Discord
 * said. */
export let server = async (
  token: string,
  room: string,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> => {
  let res = await fetcher(`${API}/channels/${room}`, {
    headers: { authorization: `Bot ${token}` },
  })
  let body = await res.json().catch(() => ({})) as {
    guild_id?: string
    message?: string
  }
  if (res.status == 429 || res.status >= 500) {
    throw new Unsent(`Discord did not say where ${room} is: ${res.status}`)
  }
  if (!res.ok) {
    throw new Error(
      `Discord refused to show room ${room}: ${res.status} ${
        body.message ?? ''
      }`.trim(),
    )
  }
  return body.guild_id
}

/** Discord, as @yaks/chat takes a platform. */
export let discord: Platform = {
  name: 'discord',
  title: 'Discord',
  limit: 2000,
  user: 'discord-account',
  socket: gateway as (token: string) => Socket<unknown>,
  send,
  server,
  working: { every: 8000, show: typing },
}
