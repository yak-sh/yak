// Chat platforms as plugins. A platform (Discord, Slack, Telegram) is a value
// its own package gives (`Platform`): how its messages arrive, how a reply is
// posted, and how long one may be. This package names no platform. It reads
// what a platform heard as `Said`, keeps it as rows, and says it to whoever
// answers it, so a host wires every platform the same way.

import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { type Chat, type Chatter, Unsent } from '@yaks/host/senders'

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

/** A room of a server, as a platform lists them: its id and its name. */
export type Room = { id: string; name: string }

/** Which of a room's messages to read back: the `limit` newest said before
 * the message `before`. */
export type Page = { before: string; limit: number }

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
  /** what the platform said of the servers the bot is in */
  servers?: Seated
  /** close and connect again, at `url(state)` */
  again?: boolean
}

/** The servers a bot is in, as its platform says them over its socket: all
 * of them at once, or one it joined or left. */
export type Seated = { all: string[] } | { joined: string } | { left: string }

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
  /** the platform's id for the server a room belongs to, as the bot with
   * `credential` sees it; none for a direct room. What a chatter
   * {@link confined} to a server asks. */
  server?: (
    credential: string,
    room: string,
    fetch?: typeof globalThis.fetch,
  ) => Promise<string | undefined>
  /** the rooms of `server` that people write in, as the bot with
   * `credential` reads them, where the platform lists them: what a space
   * chooses the room its listener hears in full from (`chat_hears`); null
   * where the bot is not in that server */
  rooms?: (
    credential: string,
    server: string,
    fetch?: typeof globalThis.fetch,
  ) => Promise<Room[] | null>
  /** the messages of `room` said before `page.before`, oldest first, as the
   * bot with `credential` reads them, where the platform keeps them: none is
   * `addressed`, since none was said to the bot as it is read now, and a
   * bot's own are read too */
  recent?: (
    credential: string,
    room: string,
    page: Page,
    fetch?: typeof globalThis.fetch,
  ) => Promise<Said[]>
  /** give the bot with `credential` the name `name` in `server`, where the
   * platform lets a bot go by its own name in each server: how it goes by
   * the name of the Operator it speaks for */
  named?: (
    credential: string,
    server: string,
    name: string,
    fetch?: typeof globalThis.fetch,
  ) => Promise<void>
  /** how a bot shows a room it is working on an answer, where the platform
   * can: `show` once lasts `every` milliseconds ({@link Working}) */
  working?: Working<
    (
      credential: string,
      room: string,
      fetch?: typeof globalThis.fetch,
    ) => Promise<void>
  >
}

/** Showing a room that an answer is being worked on, as a platform's typing
 * indicator does: `show` once lasts `every` milliseconds, so it is shown
 * again that often while the work goes on. */
export type Working<F> = { every: number; show: F }

/**
 * Show that an answer is being worked on: `show` at once, and again every
 * `every` milliseconds for as long as `still()` says the work goes on, and
 * never past `most`. A show refused for now ({@link Unsent}, a rate limit)
 * waits for the next; any other refusal ends it, thrown.
 */
export let showing = async (
  working: Working<() => Promise<void>>,
  still: () => Promise<boolean>,
  o: { most?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<void> => {
  let {
    most = 10 * 60_000,
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = o
  for (let spent = 0; spent < most; spent += working.every) {
    if (!await still()) return
    await working.show().catch((e) => {
      if (!(e instanceof Unsent)) throw e
    })
    await wait(working.every)
  }
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
 * the room and who said it, and the connection whose bot heard it, which
 * an answer is posted by. Kept again, they write the same rows. */
export let kept = (via: string, said: Said, connection?: string): Bundle[] => [
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
      ...connection ? { connection } : {},
    },
    doc: { body: said.text },
  },
]

/**
 * A chatter that posts only into rooms of the servers its connection serves:
 * `serves(connection)` names those servers, and `server(chat)` the one the
 * room is in. A connection serving none, or a room elsewhere or in none, is
 * refused before `chatter` sees it. So whoever writes a message without
 * holding the bot (an app's row) reaches only the servers its connection
 * was made for.
 */
export let confined = (
  chatter: Chatter,
  where: {
    serves: (connection: string) => Promise<string[]>
    server: (chat: Pick<Chat, 'connection' | 'room'>) => Promise<
      string | undefined
    >
  },
): Chatter => ({
  ...chatter.waiting ? { waiting: chatter.waiting } : {},
  post: async (chat) => {
    await within(
      chat,
      await where.serves(chat.connection),
      () => where.server(chat),
    )
    return chatter.post(chat)
  },
})

/** The server a room is in, refused when it is outside the servers its
 * connection `serves`, or in none: what a {@link confined} chatter posts by,
 * and what a host reads a room's {@link Platform.recent} messages by. Where
 * the room is (`server()`) is asked only of a connection serving any. */
export let within = async (
  at: Pick<Chat, 'connection' | 'room'>,
  serves: string[],
  server: () => Promise<string | undefined>,
): Promise<string> => {
  if (!serves.length) {
    throw new Error(`connection ${at.connection} posts into no server here`)
  }
  let where = await server()
  if (!where || !serves.includes(where)) {
    throw new Error(`room ${at.room} is not in its connection's servers`)
  }
  return where
}

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
 * A room's messages read back ({@link Platform.recent}), one line each,
 * oldest first: when and who said it, the bot's own (`mine`, by the
 * platform's ids) as said by `you`.
 */
export let recounted = (
  said: Said[],
  mine: Set<string> = new Set(),
): string =>
  said.map((s) =>
    `[${s.at.slice(0, 16).replace('T', ' ')}] ${
      mine.has(s.id) ? 'you' : s.author.name
    }: ${s.text}`
  ).join('\n')

/**
 * The messages of a room read back that came after the bot's last answer
 * there (`last`, the platform's id for it), or all of them when it is not
 * among them.
 */
export let since = (said: Said[], last?: string): Said[] =>
  said.slice(said.findIndex((s) => s.id == last) + 1)

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
