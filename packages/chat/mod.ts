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
  /** whether these are its words as edited since it was first said: a
   * platform gives an edit as heard with the message's own id, and the
   * listener takes it only where it is addressed, as a message it has not
   * answered yet (an edit that adds a mention) */
  edited?: boolean
}

/** How a message was said to a bot: naming it; replying to one of its own,
 * or to one that named it, so a thread with it goes on unnamed; or to it
 * alone. */
export type Addressed = 'mention' | 'reply' | 'direct'

/** A reply to post into a room, answering a message where it names one. */
export type Reply = { room: string; text: string; reply_to?: string }

/** A refusal that knows the bot may not write to that person directly: they
 * take no direct messages from it, or share no server with it. It says
 * where they are not reached, not that anything broke. */
export class Unreachable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Unreachable'
  }
}

/** What a platform answers when it took a reply: its id for it. */
export type Posted = { id?: string }

/** A room of a server, as a platform lists them: its id and its name. */
export type Room = { id: string; name: string }

/** A server (a Discord guild) as its platform tells it: what it is called,
 * and the address of its icon where it has one. */
export type Server = { name: string; icon?: string }

/** Which of a room's messages to read back: the `limit` newest said before
 * the message `before`. */
export type Page = { before: string; limit: number }

/**
 * What a platform's API lets a bot read for whoever talks to it there, as
 * data: where the API is (`base`), the word a bot's credential is sent
 * after in the authorization header (`scheme`), and the paths a member of a
 * room could read (`reads`). In a path, `{server}` and `{room}` name the
 * server and room it is read in, which a host confines to its bot's
 * servers; any other `{name}` is one segment, such as a message's id.
 */
export type Api = { base: string; scheme: string; reads: string[] }

/** What a person in a room sees without asking: its server, with its icon,
 * the room and its topic, and the people talking, with their roles there. */
export type Basics = {
  server?: { id: string; name: string; icon?: string }
  room: { id: string; name?: string; topic?: string }
  people: { id: string; name: string; roles: string[] }[]
}

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
  /** what a close with `code` leaves the socket remembering, where it
   * connects again changed rather than ending: asking less of the platform
   * after it refused what was asked */
  closed?: (state: S, code: number) => S | undefined
}

export type Step<S> = {
  state: S
  send?: unknown[]
  /** beat every this many milliseconds from now on */
  every?: number
  heard?: Said[]
  /** what the platform said of the servers the bot is in */
  servers?: Seated
  /** whether people the bot can see are about, as the platform said */
  present?: Present[]
  /** close and connect again, at `url(state)` */
  again?: boolean
}

/** Whether someone on a platform is about: their account there and the
 * status the platform shows for them. */
export type Present = {
  account: string
  status: 'online' | 'idle' | 'dnd' | 'offline'
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
  /** how a message there writes a link ({@link linked}); as plain text,
   * {@link plainLink}, where none */
  links?: Linker
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
  /** say `text` to the person whose id there is `user` alone, from the bot
   * with `credential`, where the platform lets a bot write to someone
   * directly: their direct room is opened and posted to. One the platform
   * will not let the bot reach is {@link Unreachable} */
  direct?: (
    credential: string,
    user: string,
    text: string,
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
  /** the message `id` of `room`, as the bot with `credential` reads it,
   * where the platform reads one alone: what a reply's {@link chain} is
   * read up by */
  message?: (
    credential: string,
    room: string,
    id: string,
    fetch?: typeof globalThis.fetch,
  ) => Promise<Said>
  /** the address that opens `server` in the platform's app or site, or its
   * room `room` there: how a page links to where its Operator is reached */
  link?: (server: string, room?: string) => string
  /** what `server` is called and its icon's address, as the bot with
   * `credential` reads it; null where the bot is not in that server. Its
   * name is asked when the bot joins a server and kept, so a page names it
   * without asking */
  about?: (
    credential: string,
    server: string,
    fetch?: typeof globalThis.fetch,
  ) => Promise<Server | null>
  /** give the bot with `credential` the name `name` in `server`, where the
   * platform lets a bot go by its own name in each server: how it goes by
   * the name of the Operator it speaks for */
  named?: (
    credential: string,
    server: string,
    name: string,
    fetch?: typeof globalThis.fetch,
  ) => Promise<void>
  /** what its bot may read of its API for people there ({@link Api}) */
  api?: Api
  /** whether every member of the server `room` is in sees it, as the bot
   * with `credential` reads its permissions: a room nobody named the bot
   * in is read through {@link Api} only then */
  open?: (
    credential: string,
    room: string,
    fetch?: typeof globalThis.fetch,
  ) => Promise<boolean>
  /** what a person in `room` sees without asking ({@link Basics}), as the
   * bot with `credential` reads it, the `people` by their ids there */
  basics?: (
    credential: string,
    room: string,
    people: string[],
    fetch?: typeof globalThis.fetch,
  ) => Promise<Basics>
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

/** Where a message was said: the platform's ids for its room and for it,
 * and for the message it replies to, if any, which is what a reply to it
 * names; the room's name there, or that it is a direct room. */
export type Place = {
  room: string
  name?: string
  direct?: boolean
  message: string
  reply_to?: string
}

/** How a message heard on a platform is said before its words to whoever
 * answers it: where it came from (`at`), who wrote it, and how it was said
 * to the bot, which is what the listener decides whether to answer by. */
export let framing = (
  platform: Pick<Platform, 'title'>,
  said: { name: string; addressed?: Addressed; at?: Place },
): string =>
  said.at
    ? `On ${platform.title} ${placed(said.at)}, ${
      said.addressed
        ? HOW[said.addressed]
        : 'which you hear but were not addressed in, from'
    } ${said.name}: `
    : `On ${platform.title}, ${HOW[said.addressed ?? 'heard']} ${said.name}: `

// A message's place, as `framing` says it.
let placed = ({ room, name, direct, ...said }: Place) =>
  `in ${
    direct ? 'direct messages' : name ? `#${name}` : 'a room'
  } (room ${room}, ${named(said)})`

// A message's ids, as `framing` and `recounted` say them: which reply to it
// names, and what it replies to.
let named = ({ message, reply_to }: Pick<Place, 'message' | 'reply_to'>) =>
  `message ${message}${reply_to ? `, replying to ${reply_to}` : ''}`

let HOW: Record<Addressed | 'heard', string> = {
  direct: 'directly, from',
  mention: 'naming you, from',
  reply: 'replying in a thread with you, from',
  heard: 'in a room you hear but were not addressed in, from',
}

/**
 * A room's messages read back ({@link Platform.recent}), one line each,
 * oldest first: when and who said it, the message's id and the one it replies
 * to (as {@link framing} says them), the bot's own (`mine`, by the
 * platform's ids) as said by `you`, and anyone else as `names` calls their
 * account, by its id on the platform, else by the name they show.
 */
export let recounted = (
  said: Said[],
  mine: Set<string> = new Set(),
  names: Map<string, string> = new Map(),
): string =>
  said.map((s) =>
    `[${s.at.slice(0, 16).replace('T', ' ')}] (${
      named({ message: s.id, reply_to: s.reply_to })
    }) ${
      mine.has(s.id) ? 'you' : names.get(s.author.id) ?? s.author.name
    }: ${s.text}`
  ).join('\n')

/** How many messages a reply's {@link chain} reads up, at most. */
export let CHAIN = 10

/**
 * The messages `said` answers, up its chain of replies to the first, oldest
 * first: at most `cap`, each read by `get`, which answers none for one it
 * cannot read, where the chain stops.
 */
export let chain = async (
  said: Pick<Said, 'reply_to'>,
  get: (id: string) => Promise<Said | undefined>,
  cap = CHAIN,
): Promise<Said[]> => {
  let up: Said[] = []
  let seen = new Set<string>()
  for (let id = said.reply_to; id && !seen.has(id) && up.length < cap;) {
    seen.add(id)
    let s = await get(id)
    if (!s) break
    up.unshift(s)
    id = s.reply_to
  }
  return up
}

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

/** How a platform writes a link to `url`: by its `words`, or by the address
 * alone where there are none. */
export type Linker = (words: string, url: string) => string

/** A link as plain text writes it: its words, then its address. */
export let plainLink: Linker = (words, url) => words ? `${words} (${url})` : url

// Code, fenced or inline, which keeps what it holds; a Markdown link, its
// address bare or in <>, with the spaces before it; an autolink; a bare URL.
let LINK =
  /(```[\s\S]*?```|`[^`\n]*`)|([ \t]*)\[([^\]\n]*)\]\(\s*(?:<([^>\n]*)>|((?:[^\s()]|\([^\s()]*\))*))\s*\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>]+)/gi

// A bare URL ends before the punctuation that closes its sentence, and before
// a closing parenthesis it never opened.
let ending = (url: string): [string, string] => {
  let end = url.length
  while (end) {
    let c = url[end - 1]
    let part = url.slice(0, end)
    let open = part.split('(').length < part.split(')').length
    if (!/[.,;:!?'"*_]/.test(c) && !(c == ')' && open)) break
    end--
  }
  return [url.slice(0, end), url.slice(end)]
}

let web = (href: string) => {
  let url = URL.parse(href.trim())
  return url && /^https?:$/.test(url.protocol) ? url.href : undefined
}

/**
 * A reply with every link written as its platform writes one (`form`): a
 * Markdown link `[words](url)` or `[words](<url>)`, an autolink `<url>`, and
 * a bare URL. Words that are empty or are themselves an address are none. A
 * link without words to an address the reply linked already is dropped, so a
 * page cited after the words that link it is one link. Code keeps what it
 * holds, and a link to anything but a web page stays as written.
 */
export let linked = (text: string, form: Linker = plainLink): string => {
  let seen = new Set<string>()
  // A link to `href` by `words`, or none where it is wordless and linked
  // already; anything but a web page stays as written (`whole`).
  let write = (whole: string, words: string, href: string) => {
    let url = web(href)
    if (!url) return whole
    let bare = !words || !!web(words)
    if (bare && seen.has(url)) return ''
    seen.add(url)
    return form(bare ? '' : words, href.trim())
  }
  return text.replace(
    LINK,
    (whole, code, space, words, angled, inline, auto, loose) => {
      if (code) return code
      if (auto) return write(whole, '', auto)
      if (loose) {
        let [href, after] = ending(loose)
        return write(href, '', href) + after
      }
      let out = write(whole, words.trim(), angled ?? inline)
      return out && out != whole ? space + out : out
    },
  )
}

/**
 * The ids a path binds, read through `api` ({@link Api}): each `{name}` of
 * the first read it matches, by name; none where it matches no read. A
 * segment is one of the path's own, never empty, `.` or `..`.
 */
export let reading = (
  api: Pick<Api, 'reads'>,
  path: string,
): Record<string, string> | undefined => {
  let got = path.split('/').filter(Boolean)
  if (got.some((s) => s == '.' || s == '..')) return
  for (let read of api.reads) {
    let want = read.split('/').filter(Boolean)
    if (want.length != got.length) continue
    let ids: Record<string, string> = {}
    let ok = want.every((w, i) =>
      w.startsWith('{') && w.endsWith('}')
        ? (ids[w.slice(1, -1)] = decodeURIComponent(got[i]), true)
        : w == got[i]
    )
    if (ok) return ids
  }
}

/**
 * The room's {@link Basics}, said before words said there: the server and
 * its icon, the room and its topic, and who is talking, each as `names`
 * calls their account by its id on the platform, else by the name they
 * show, with their roles there. Each id is given, for the platform's API.
 */
export let setting = (
  platform: Pick<Platform, 'title'>,
  b: Basics,
  names: Map<string, string> = new Map(),
): string => {
  let { server, room } = b
  let where = server
    ? `the ${platform.title} server “${server.name}” (id ${server.id}${
      server.icon ? `; its icon is ${server.icon}` : ''
    })`
    : platform.title
  let lines = [
    `Where this is: ${where}, in ${
      room.name ? `#${room.name}` : 'a room'
    } (id ${room.id})${room.topic ? `, whose topic is “${room.topic}”` : ''}.`,
  ]
  if (b.people.length) {
    lines.push(
      `Talking here, with their roles in the server: ${
        b.people.map((p) =>
          `${names.get(p.id) ?? p.name}, id ${p.id}: ${
            p.roles.length ? p.roles.join(', ') : 'no roles'
          }`
        ).join('; ')
      }.`,
    )
  }
  return lines.join('\n')
}
