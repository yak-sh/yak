// Chat platforms as plugins. A platform (Discord, Slack, Telegram) is a value
// its own package gives (`Platform`): how its messages arrive, how a reply is
// posted, and how long one may be. This package names no platform. It reads
// what a platform heard as `Said`, keeps it as rows, and says it to whoever
// answers it, so a host wires every platform the same way.

import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'

/** A message as a platform's plugin reads it: where it was said, by whom, in
 * which words, and whether it was said to the bot that heard it. */
export type Said = {
  /** the platform's id for the message */
  id: string
  /** the platform's id for the room it was said in */
  room: string
  /** the server or workspace the room belongs to; none in a direct one */
  server?: string
  author: { id: string; name: string }
  /** its words, with the bot's own mention taken out */
  text: string
  at: string
  /** how it was said to the bot that heard it, where it was; whether to
   * answer is the listener's to decide */
  addressed?: Addressed
  /** the platform's id for the message it answers */
  reply_to?: string
}

/** How a message was said to a bot: naming it, replying to one of its own,
 * or to it alone. */
export type Addressed = 'mention' | 'reply' | 'direct'

/** A reply to post into a room, answering a message where it names one. */
export type Reply = { room: string; text: string; reply_to?: string }

/** What a platform answers when it took a reply: its id for it. */
export type Posted = { id?: string }

/**
 * A long-lived socket a platform sends its messages over (Discord's Gateway),
 * as pure steps a generic holder runs (./socket.ts): where to connect, and
 * for each frame that arrives, what to send back, how often to beat, what
 * was heard, and whether to connect again. `S` is what it remembers between
 * frames and across a reconnect.
 */
export type Socket<S> = {
  start: S
  url: (state: S) => string
  step: (state: S, frame: unknown) => Step<S>
  /** what keeps the socket alive, due every `Step.every` milliseconds: a
   * frame to send, or `again` when the last beat went unanswered */
  beat: (state: S) => Step<S>
  /** why a socket closed with `code` cannot be opened again with the same
   * credential, in words for whoever holds it; none means try again */
  ends?: (code: number) => string | undefined
}

export type Step<S> = {
  state: S
  send?: unknown[]
  /** beat every this many milliseconds from now on */
  every?: number
  heard?: Said[]
  /** close and connect again, at `url(state)` */
  again?: boolean
}

/** A chat platform, given as data by its own package. */
export type Platform = {
  /** its plugin's name, which `integration.chat` names (@yaks/connections) */
  name: string
  /** what people call it */
  title: string
  /** the most characters one message may carry */
  limit: number
  /** the integration someone signs in to it with (@yaks/connections), whose
   * connection's `account` is their id there: how a person here is known
   * when they speak on it */
  user?: string
  /** its socket, opened with a bot's credential, where it sends messages
   * over one */
  socket?: (credential: string) => Socket<unknown>
  /** post a reply with a bot's credential */
  send: (
    credential: string,
    reply: Reply,
    fetch?: typeof globalThis.fetch,
  ) => Promise<Posted>
}

/** Platforms by name, as a host lists the ones it loads. */
export let platforms = (list: Platform[]): Map<string, Platform> =>
  new Map(list.map((p) => [p.name, p]))

export let messageEid = (via: string, id: string): string =>
  derivedEid(`chat-message|${via}|${id}`)
export let roomEid = (via: string, id: string): string =>
  derivedEid(`chat-room|${via}|${id}`)
export let accountEid = (via: string, id: string): string =>
  derivedEid(`chat-account|${via}|${id}`)

/** The rows that keep a message heard on `via`: the message with its words,
 * the room and who said it. Kept again, they write the same rows. */
export let kept = (via: string, said: Said): Bundle[] => [
  {
    entity: { eid: roomEid(via, said.room) },
    chat_room: {
      via,
      id: said.room,
      ...said.server ? { server: said.server } : {},
    },
  },
  {
    entity: { eid: accountEid(via, said.author.id) },
    chat_account: { via, id: said.author.id, name: said.author.name },
  },
  {
    entity: { eid: messageEid(via, said.id) },
    chat_message: {
      via,
      room: roomEid(via, said.room),
      author: accountEid(via, said.author.id),
      message_id: said.id,
      at: said.at,
      ...said.addressed ? { addressed: said.addressed } : {},
      ...said.reply_to ? { reply_to: said.reply_to } : {},
    },
    doc: { body: said.text },
  },
]

/** How a message heard on a platform is said before its words to whoever
 * answers it: where it came from, who wrote it, and how it was said to the
 * bot, which is what the listener decides whether to answer by. */
export let framing = (
  platform: Pick<Platform, 'title'>,
  said: { name: string; addressed?: Addressed },
) => `On ${platform.title}, ${HOW[said.addressed ?? 'heard']} ${said.name}: `

let HOW: Record<Addressed | 'heard', string> = {
  direct: 'directly, from',
  mention: 'naming you, from',
  reply: 'replying to you, from',
  heard: 'in a room you hear but were not addressed in, from',
}

/**
 * An answer cut to fit a platform's `limit`: at the last paragraph break
 * that fits, else the last line break, else the last space, else hard at the
 * limit. Nothing is lost; blank pieces are dropped.
 */
export let pieces = (text: string, limit: number): string[] => {
  let out: string[] = []
  let rest = text.trim()
  while (rest.length > limit) {
    let head = rest.slice(0, limit)
    let cut = ['\n\n', '\n', ' '].map((at) => head.lastIndexOf(at))
      .find((i) => i > 0) ?? limit
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out.filter(Boolean)
}
