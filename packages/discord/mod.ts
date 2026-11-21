// Discord for @yaks/chat. A bot hears messages only over Discord's Gateway, a
// websocket it holds open (https://discord.com/developers/docs/events/gateway),
// so `socket` is the Gateway's handshake, heartbeat and resume as pure steps,
// and `send` posts a reply with the REST API. A bot's token is all either
// needs: yaks.app's own bot's, or the one a space brings.

import type {
  Addressed,
  Api,
  Basics,
  Linker,
  Page,
  Platform,
  Present,
  Room,
  Said,
  Server,
  Socket,
  Step,
} from '@yaks/chat'
import { Unsent } from '@yaks/host/senders'

let API = 'https://discord.com/api/v10'
let GATEWAY = 'wss://gateway.discord.gg'
let QUERY = '/?v=10&encoding=json'

/** The Gateway intents a bot cannot do without: servers, their messages and
 * direct messages, as said and as edited (MESSAGE_CREATE and MESSAGE_UPDATE),
 * and the words of messages (Message Content, privileged),
 * so it hears a room it was given and not only the messages that name it. */
export let NEEDED: number = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15)

/** The Gateway intents asked for: the {@link NEEDED} ones, and the two
 * other privileged ones, server members and presence, so the bot knows who
 * is in a server and who is about. A bot whose owner has not turned those
 * on is refused them (4014) and asks for the needed ones alone. */
export let INTENTS: number = NEEDED | (1 << 1) | (1 << 8)

/** What yaks.app's authorize link asks of a server, as Discord's
 * permissions integer: View Channels and Read Message History; Send
 * Messages, in threads too, with embeds, files, polls, reactions and
 * outside emoji and stickers; create and manage threads; manage and pin
 * messages; create and manage events; and Change Nickname. */
export let PERMISSIONS: bigint = [
  6, // Add Reactions
  10, // View Channels
  11, // Send Messages
  13, // Manage Messages
  14, // Embed Links
  15, // Attach Files
  16, // Read Message History
  18, // Use External Emojis
  26, // Change Nickname
  33, // Manage Events
  34, // Manage Threads
  35, // Create Public Threads
  36, // Create Private Threads
  37, // Use External Stickers
  38, // Send Messages in Threads
  44, // Create Events
  49, // Send Polls
  51, // Pin Messages
].reduce((all, bit) => all | 1n << BigInt(bit), 0n)

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
  /** the intents it identifies with, {@link INTENTS} where none */
  intents?: number
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
  edited_timestamp?: string | null
  mentions?: { id: string }[]
  message_reference?: { message_id?: string }
  referenced_message?:
    | { author?: { id: string }; mentions?: { id: string }[] }
    | null
}

/** A message Discord sent the bot, as @yaks/chat reads one: none for a bot's
 * own, or another bot's, so two bots never talk to each other forever. It is
 * addressed `direct` outside a server, as a `reply` when it answers one of
 * the bot's own (which Discord also counts a mention) or one that named the
 * bot, and as a `mention` when it names the bot; its words lose that
 * mention. */
export let said = (m: Message, me?: string): Said | undefined => {
  if (m.author.bot || m.author.id == me) return
  let names = (m?: { mentions?: { id: string }[] } | null) =>
    !!me && (m?.mentions ?? []).some((u) => u.id == me)
  let to = m.referenced_message
  let addressed: Addressed | undefined = !m.guild_id
    ? 'direct'
    : me && (to?.author?.id == me || names(to))
    ? 'reply'
    : names(m)
    ? 'mention'
    : undefined
  let text = me
    ? m.content.replaceAll(`<@${me}>`, '').replaceAll(`<@!${me}>`, '')
    : m.content
  return { ...read({ ...m, content: text }), ...addressed ? { addressed } : {} }
}

// A message as it was said, whoever said it.
let read = (m: Message): Said => ({
  id: m.id,
  room: m.channel_id,
  ...m.guild_id ? { server: m.guild_id } : {},
  author: { id: m.author.id, name: m.author.global_name || m.author.username },
  text: m.content.trim(),
  at: m.timestamp,
  ...m.message_reference?.message_id
    ? { reply_to: m.message_reference.message_id }
    : {},
})

type Presence = { user?: { id?: string; bot?: boolean }; status?: string }
let STATUSES = new Set(['online', 'idle', 'dnd', 'offline'])

/** Who Discord says is about, as @yaks/chat reads it: a bot is not anyone,
 * and someone invisible shows as offline, as Discord shows them. */
export let presents = (all: Presence[]): Present[] =>
  all.flatMap((p) =>
    p.user?.id && !p.user.bot
      ? [{
        account: p.user.id,
        status:
          (STATUSES.has(p.status ?? '') ? p.status : 'offline') as Present[
            'status'
          ],
      }]
      : []
  )

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
              intents: s.intents ?? INTENTS,
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
          state: f.d === true ? state : afresh(s),
          again: true,
        }
      case OP.dispatch: {
        if (f.t == 'READY') {
          let d = f.d as {
            session_id: string
            resume_gateway_url: string
            user: User
            guilds?: { id: string }[]
          }
          return {
            state: {
              ...state,
              session: d.session_id,
              resume: d.resume_gateway_url,
              me: d.user.id,
            },
            servers: { all: (d.guilds ?? []).map((g) => g.id) },
          }
        }
        // A server the bot joined, or one it was in that is reachable again;
        // one it left, unless Discord only lost it for a while.
        if (f.t == 'GUILD_CREATE') {
          let d = f.d as { id: string; presences?: Presence[] }
          let present = presents(d.presences ?? [])
          return {
            state,
            servers: { joined: d.id },
            ...present.length ? { present } : {},
          }
        }
        // Someone in a server was seen coming, going or changing status
        // (the Presence intent).
        if (f.t == 'PRESENCE_UPDATE') {
          let present = presents([f.d as Presence])
          return { state, ...present.length ? { present } : {} }
        }
        if (f.t == 'GUILD_DELETE') {
          let d = f.d as { id: string; unavailable?: boolean }
          return d.unavailable ? { state } : { state, servers: { left: d.id } }
        }
        if (f.t == 'MESSAGE_CREATE') {
          let heard = said(f.d as Message, s.me)
          return { state, ...heard ? { heard: [heard] } : {} }
        }
        // An edit, which Discord sends whole: not a link's preview filled
        // in (no `edited_timestamp`), nor one too partial to read.
        if (f.t == 'MESSAGE_UPDATE') {
          let m = f.d as Partial<Message>
          let heard = m.edited_timestamp && m.author && m.content != null &&
            said(m as Message, s.me)
          return {
            state,
            ...heard ? { heard: [{ ...heard, edited: true }] } : {},
          }
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
  // Refused an intent its owner never turned on, the bot asks for the
  // needed ones alone, afresh.
  closed: (s, code) =>
    code == 4014 && (s.intents ?? INTENTS) != NEEDED
      ? { ...afresh(s), intents: NEEDED }
      : undefined,
})

// A session started over: a new identify, as the same bot.
let afresh = (s: Session): Session => ({
  seq: null,
  acked: true,
  ...s.me ? { me: s.me } : {},
  ...s.intents ? { intents: s.intents } : {},
})

// What Discord answered a call with, read: a 429 or a 5xx never took it, so
// it is {@link Unsent}, tried again after what Discord says; any other
// refusal is thrown with Discord's own words.
let answer = async <T>(
  res: Response,
  said: { unsent: string; refused: string },
): Promise<T> => {
  let body = await res.json().catch(() => ({})) as T & {
    message?: string
    retry_after?: number
  }
  if (res.status == 429 || res.status >= 500) {
    throw new Unsent(
      `${said.unsent}: ${res.status}`,
      Math.ceil((body.retry_after ?? 1) * 1000),
    )
  }
  if (!res.ok) {
    throw new Error(
      `${said.refused}: ${res.status} ${body.message ?? ''}`.trim(),
    )
  }
  return body
}

let bot = (token: string) => ({ authorization: `Bot ${token}` })

/** Post `reply` as the bot with `token`, answering the message it names
 * when there still is one, and pinging nobody. A 429 or a 5xx never took it,
 * so it is {@link Unsent} and tried again; any other refusal is thrown with
 * what Discord said. */
export let send: Platform['send'] = async (token, reply, fetcher = fetch) => {
  let res = await fetcher(`${API}/channels/${reply.room}/messages`, {
    method: 'POST',
    headers: { ...bot(token), 'content-type': 'application/json' },
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
  let { id } = await answer<{ id?: string }>(res, {
    unsent: 'Discord did not take the reply',
    refused: 'Discord refused the reply',
  })
  return { id }
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
  await answer(
    await fetcher(`${API}/channels/${room}/typing`, {
      method: 'POST',
      headers: bot(token),
    }),
    {
      unsent: 'Discord did not show typing',
      refused: 'Discord refused to show typing',
    },
  )
}

/** Give the bot with `token` the nickname `name` in the server `server`,
 * cut to the 32 characters Discord allows
 * (PATCH /guilds/{id}/members/@me, which needs Change Nickname). A 429 or a
 * 5xx is {@link Unsent}; any other refusal is thrown with what Discord said. */
export let named = async (
  token: string,
  server: string,
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<void> => {
  await answer(
    await fetcher(`${API}/guilds/${server}/members/@me`, {
      method: 'PATCH',
      headers: { ...bot(token), 'content-type': 'application/json' },
      body: JSON.stringify({ nick: [...name].slice(0, 32).join('') }),
    }),
    {
      unsent: `Discord did not rename the bot in ${server}`,
      refused: `Discord refused to rename the bot in ${server}`,
    },
  )
}

/** The kinds of channel people write messages in: text and announcement
 * (channel, "Channel Types"). */
let WRITTEN = new Set([0, 5])

/** The text channels of the server `server`, in the order Discord shows
 * them, as the bot with `token` reads them (GET /guilds/{id}/channels); null
 * where the bot is not in that server, or no longer: Discord answers 403
 * Missing Access, or 404 Unknown Guild. */
export let rooms = async (
  token: string,
  server: string,
  fetcher: typeof fetch = fetch,
): Promise<Room[] | null> => {
  let res = await fetcher(`${API}/guilds/${server}/channels`, {
    headers: bot(token),
  })
  if (res.status == 403 || res.status == 404) {
    await res.body?.cancel()
    return null
  }
  let channels = await answer<
    { id: string; name: string; type: number; position?: number }[]
  >(
    res,
    {
      unsent: 'Discord did not list the channels',
      refused: 'Discord refused to list the channels',
    },
  )
  return channels.filter((c) => WRITTEN.has(c.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(({ id, name }) => ({ id, name }))
}

/** What the server `server` is called and the address of its icon, where it
 * has one, as the bot with `token` reads it (GET /guilds/{id}); null where
 * the bot is not in it, or no longer, as {@link rooms} says. */
export let guild = async (
  token: string,
  server: string,
  fetcher: typeof fetch = fetch,
): Promise<Server | null> => {
  let res = await fetcher(`${API}/guilds/${server}`, { headers: bot(token) })
  if (res.status == 403 || res.status == 404) {
    await res.body?.cancel()
    return null
  }
  let { name, icon: hash } = await answer<
    { name: string; icon?: string | null }
  >(
    res,
    {
      unsent: `Discord did not name server ${server}`,
      refused: `Discord refused to name server ${server}`,
    },
  )
  return {
    name,
    ...hash ? { icon: icon(server, hash) } : {},
  }
}

/** The address that opens the server `server` in Discord, or its channel
 * `room`, for anyone in it. */
export let link = (server: string, room?: string) =>
  `https://discord.com/channels/${server}${room ? `/${room}` : ''}`

/** The server (guild) the room `room` belongs to, as the bot with `token`
 * sees it (GET /channels/{id}), none for a direct one. A 429 or a 5xx is
 * {@link Unsent}; a room the bot cannot see is refused with what Discord
 * said. */
export let server = async (
  token: string,
  room: string,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> => {
  let { guild_id } = await answer<{ guild_id?: string }>(
    await fetcher(`${API}/channels/${room}`, { headers: bot(token) }),
    {
      unsent: `Discord did not say where ${room} is`,
      refused: `Discord refused to show room ${room}`,
    },
  )
  return guild_id
}

/** The `page.limit` messages of `room` said before `page.before`, oldest
 * first, bots' included, as the bot with `token` reads them
 * (GET /channels/{id}/messages, at most 100). A room the bot cannot see is
 * refused with what Discord said; a 429 or a 5xx is {@link Unsent}. */
export let recent = async (
  token: string,
  room: string,
  page: Page,
  fetcher: typeof fetch = fetch,
): Promise<Said[]> => {
  let q = new URLSearchParams({
    before: page.before,
    limit: String(Math.min(100, Math.max(1, page.limit))),
  })
  let messages = await answer<Message[]>(
    await fetcher(`${API}/channels/${room}/messages?${q}`, {
      headers: bot(token),
    }),
    {
      unsent: `Discord did not read room ${room}`,
      refused: `Discord refused to read room ${room}`,
    },
  )
  return messages.map(read).reverse()
}

/** The message `id` of `room`, as the bot with `token` reads it
 * (GET /channels/{id}/messages/{id}). One the bot cannot see is refused with
 * what Discord said; a 429 or a 5xx is {@link Unsent}. */
export let message = async (
  token: string,
  room: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<Said> =>
  read(
    await answer<Message>(
      await fetcher(`${API}/channels/${room}/messages/${id}`, {
        headers: bot(token),
      }),
      {
        unsent: `Discord did not read message ${id}`,
        refused: `Discord refused to read message ${id}`,
      },
    ),
  )

// GET `path` of Discord's API as the bot with `token`, refused as
// {@link answer} says.
let get = async <T>(
  token: string,
  path: string,
  fetcher: typeof fetch,
): Promise<T> =>
  answer<T>(await fetcher(`${API}${path}`, { headers: bot(token) }), {
    unsent: `Discord did not answer ${path}`,
    refused: `Discord refused ${path}`,
  })

/** What a bot reads of Discord's API for people in a server: what any
 * member there could see (resources/guild, channel, message, user, emoji,
 * sticker, guild-scheduled-event, poll). Never the servers the bot is in,
 * which are other people's, nor what only moderators see. */
export let api: Api = {
  base: API,
  scheme: 'Bot',
  reads: [
    '/guilds/{server}',
    '/guilds/{server}/preview',
    '/guilds/{server}/channels',
    '/guilds/{server}/threads/active',
    '/guilds/{server}/roles',
    '/guilds/{server}/roles/{role}',
    '/guilds/{server}/members',
    '/guilds/{server}/members/search',
    '/guilds/{server}/members/{user}',
    '/guilds/{server}/emojis',
    '/guilds/{server}/emojis/{emoji}',
    '/guilds/{server}/stickers',
    '/guilds/{server}/stickers/{sticker}',
    '/guilds/{server}/scheduled-events',
    '/guilds/{server}/scheduled-events/{event}',
    '/guilds/{server}/scheduled-events/{event}/users',
    '/channels/{room}',
    '/channels/{room}/messages',
    '/channels/{room}/messages/pins',
    '/channels/{room}/pins',
    '/channels/{room}/messages/{message}',
    '/channels/{room}/messages/{message}/reactions/{emoji}',
    '/channels/{room}/threads/archived/public',
    '/channels/{room}/thread-members',
    '/channels/{room}/thread-members/{user}',
    '/channels/{room}/polls/{message}/answers/{answer}',
    '/users/{user}',
    '/stickers/{sticker}',
  ],
}

type Channel = {
  id: string
  type: number
  guild_id?: string
  name?: string
  topic?: string | null
  parent_id?: string | null
  permission_overwrites?: { id: string; allow: string; deny: string }[]
}
type Guild = {
  id: string
  name: string
  icon?: string | null
  roles: { id: string; name: string; permissions: string; position: number }[]
}

/** Threads: announcement, public and private (channel, "Channel Types"). */
let THREADS = new Set([10, 11, 12])
let VIEW = 1n << 10n
let ADMINISTRATOR = 1n << 3n

/** Whether every member of `guild` sees `channel` (not a thread): its
 * @everyone role's permissions, its own overwrite for @everyone applied
 * (topics/permissions, "Permission Overwrites"). */
export let everyone = (guild: Guild, channel: Channel): boolean => {
  let base = BigInt(guild.roles.find((r) => r.id == guild.id)?.permissions ?? 0)
  if (base & ADMINISTRATOR) return true
  let o = channel.permission_overwrites?.find((o) => o.id == guild.id)
  if (o) base = (base & ~BigInt(o.deny)) | BigInt(o.allow)
  return (base & VIEW) != 0n
}

/** Whether every member of the server `room` is in sees it, as the bot with
 * `token` reads it ({@link everyone}): a thread as its channel, but a
 * private one, which only its own members see; never a direct room. */
export let open = async (
  token: string,
  room: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> => {
  let c = await get<Channel>(token, `/channels/${room}`, fetcher)
  if (!c.guild_id || c.type == 12) return false
  let [guild, at] = await Promise.all([
    get<Guild>(token, `/guilds/${c.guild_id}`, fetcher),
    THREADS.has(c.type) && c.parent_id
      ? get<Channel>(token, `/channels/${c.parent_id}`, fetcher)
      : c,
  ])
  return everyone(guild, at)
}

/** Where a server's icon is served, animated ones (`a_`) as GIF
 * (reference, "Image Formatting"). */
export let icon = (server: string, hash: string): string =>
  `https://cdn.discordapp.com/icons/${server}/${hash}.${
    hash.startsWith('a_') ? 'gif' : 'png'
  }?size=512`

/** What a person in `room` sees without asking, as the bot with `token`
 * reads it: the server's name and icon, the room's name and topic, and each
 * of `people` with the server's roles they hold, highest first, but
 * @everyone. One who left the server is left out. */
export let basics = async (
  token: string,
  room: string,
  people: string[],
  fetcher: typeof fetch = fetch,
): Promise<Basics> => {
  let c = await get<Channel>(token, `/channels/${room}`, fetcher)
  let here = {
    id: room,
    ...c.name ? { name: c.name } : {},
    ...c.topic ? { topic: c.topic } : {},
  }
  if (!c.guild_id) return { room: here, people: [] }
  let server = c.guild_id
  let [guild, members] = await Promise.all([
    get<Guild>(token, `/guilds/${server}`, fetcher),
    Promise.all(
      [...new Set(people)].map((id) =>
        get<
          {
            user: User
            nick?: string | null
            roles: string[]
          }
        >(token, `/guilds/${server}/members/${id}`, fetcher).catch(() =>
          undefined
        )
      ),
    ),
  ])
  let roles = new Map(guild.roles.map((r) => [r.id, r]))
  return {
    server: {
      id: server,
      name: guild.name,
      ...guild.icon ? { icon: icon(server, guild.icon) } : {},
    },
    room: here,
    people: members.flatMap((m) =>
      m
        ? [{
          id: m.user.id,
          name: m.nick || m.user.global_name || m.user.username,
          roles: m.roles.flatMap((id) => roles.get(id) ?? [])
            .sort((a, b) => b.position - a.position).map((r) => r.name),
        }]
        : []
    ),
  }
}

/** A link as a Discord message writes one: a masked link `[words](url)`,
 * which a bot may send, or the address alone. A parenthesis in the address is
 * escaped, so it cannot end the link early. */
export let links: Linker = (words, url) =>
  words
    ? `[${words}](${url.replaceAll('(', '%28').replaceAll(')', '%29')})`
    : url

/** Discord, as @yaks/chat takes a platform. */
export let discord: Platform = {
  name: 'discord',
  title: 'Discord',
  limit: 2000,
  links,
  user: 'discord-account',
  socket: gateway as (token: string) => Socket<unknown>,
  send,
  server,
  rooms,
  recent,
  message,
  named,
  link,
  about: guild,
  api,
  open,
  basics,
  working: { every: 8000, show: typing },
}
