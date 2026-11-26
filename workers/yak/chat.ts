// yaks.app's chat platforms (D-465): the platforms it loads, as data
// the chatters that post the Operator's answers; socket and webhook intake;
// and routing messages to the space that connected the platform.
//
// A space connects a chat integration (`integration.chat`) and that is the
// whole setup: yaks.app's own bot added to a server is a connection the
// space owns, its account the server's id; a bot the space brought is a
// connection whose pasted key is its token, which keeps the servers the bot
// is in (`chat_serves`), and all it hears is the space's. A message said to
// a bot (a mention, a reply to it, a direct message) is the next words of
// its writer's conversation with that space's Operator: their own when
// their platform account is linked to a person here (the platform's `user`
// integration), else a guest's, who has no seat and so only what the space
// lets anyone do. In the room the space chose in its
// Operator's settings (`chat_hears`), everything said is heard, in the
// room's one conversation, and the Operator answers only what is for it.
// Named in any other room, it is given what was said there since its last
// answer, and reads further back (`recent`, operator-rooms.ts).
//
// Every message heard in a server is also kept in each app of the space
// that `uses` the connection, as @yaks/chat's rows, for the app's own rules
// to take up. An app holds no bot: a message it writes to a room is posted
// by its connection's, and only into that connection's server
// (`appChatters`).

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import { type Line, line } from '@yaks/query'
import { after, type Clock, system } from '@yaks/fp'
import { recall } from './lib/hops.ts'
import {
  type Answer,
  type Basics,
  carryDirect as carry,
  confined,
  directDeadline,
  type DirectMessage,
  directUntil,
  kept,
  type Media,
  messageEid,
  type Page,
  type Platform,
  platforms,
  type Present,
  type Press,
  reading,
  type Room,
  roomEid,
  type Said,
  type Seated,
  type Voice,
  within,
} from '@yaks/chat'
import {
  type Listener,
  listener,
  type Socket,
  upgraded,
  WATCH,
} from '@yaks/chat/listen'
import { type Act, voiceRooms } from '@yaks/chat/voice'
import { receive } from '@yaks/chat/events'
import { discord } from '@yaks/discord'
import { slack } from '@yaks/slack'
import type { Chatter } from '@yaks/host/senders'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import type { chatRows } from './connections.ts'
import type { Integration } from '@yaks/connections'
import {
  accountLink,
  integrationLogo,
  managePath,
  OPERATOR_ICON,
} from '@yaks/platform/routes'
import { url as hostUrl } from '@yaks/platform/host'
import { CallError } from '@yaks/tools/errors'
import { named } from '@yaks/session/turn'

// What answering and hearing need, loaded when they first run: the
// Operator's channels import the platform list alone.
let need = async () => ({
  ...await import('@yaks/connections'),
  ...await import('./connections.ts'),
  ...await import('./vault.ts'),
  ...await import('./directory.ts'),
  ...await import('./meta.ts'),
  ...await import('./defects.ts'),
})
let CONNECTION = 'connection'
let HEARS = 'chat_hears'
let SERVES = 'chat_serves'

/** The chat platforms yaks.app hears and answers on, by name. */
export let PLATFORMS: Map<string, Platform> = platforms([discord, slack])

/** A bot that listens on `via`'s socket: yaks.app's own, or the one a space
 * brought, which its `connection` names. */
export type Bot = { via: string; connection?: string }

/** The objects listening on chat platforms' sockets (index.ts `Chats`), one
 * per bot: `platform:<name>` for yaks.app's own, `connection:<eid>` for one
 * a space brought. */
export type Chats = {
  idFromName(name: string): unknown
  get(
    id: unknown,
  ): {
    listen(bot: Bot): Promise<unknown>
    stop(): Promise<void>
    voice(ask: VoiceAsk): Promise<string>
    voiced(server: string, account: string): Promise<string | null>
  }
}

/** What the Operator asks of its bot's voice: to join `room` of `server`,
 * streaming the room's audio to `stream`, or, with `room` null, to leave the
 * one it is in there. */
export type VoiceAsk = { server: string; room: string | null; stream?: string }

/** The object listening as `bot`. */
export let listening = (chats: Chats, bot: Bot) =>
  chats.get(chats.idFromName(
    bot.connection ? `connection:${bot.connection}` : `platform:${bot.via}`,
  ))

// The credential of the bot that speaks on `p` for `connection`
// (@yaks/connections `botOf`).
let speaker = async (env: Env, p: Platform, connection?: string) => {
  let { botOf, ctxOf } = await need()
  let token = connection
    ? await botOf(ctxOf(env), connection)
    : await platformBot(env, p.name)
  if (!token) {
    throw new Error(
      `No ${p.title} bot speaks for this connection now: connect ${p.title} again.`,
    )
  }
  return token
}

let operatorAppearance = async (env: Env, connection: string) => {
  let [held] = await read(env, line`.entity.eid=${connection}&.${CONNECTION}`)
  let { owner } = comp(held, CONNECTION)
  if (!owner) return
  let { directoryOf } = await need()
  let space = await directoryOf(env.STORE).at(String(owner))
  if (space && !space.trashed) {
    return { name: space.operator, icon: hostUrl(env, OPERATOR_ICON) }
  }
}

/** The chatters stores post through, one per platform. Each uses the bot of
 * the connection and, where supported, the Operator's current appearance. */
export let chatters = (
  env: Env,
  from: 'operator' | 'app',
): Record<string, Chatter> =>
  Object.fromEntries(
    [...PLATFORMS.values()].map((p) => {
      let { working } = p
      return [
        p.name,
        {
          post: async (chat) => {
            let token = await speaker(env, p, chat.connection)
            let appearance = from == 'operator' && p.messageAppearance &&
                chat.connection
              ? await operatorAppearance(env, chat.connection)
              : undefined
            return p.send(token, { ...chat, appearance })
          },
          ...working
            ? {
              working: {
                every: working.every,
                show: async (at) =>
                  working.show(await speaker(env, p, at.connection), at.room),
              },
            }
            : {},
        } satisfies Chatter,
      ]
    }),
  )

/** The chatters an app's store posts its rows through (graph.ts), one per
 * platform that says which server a room is in: the shared chatters,
 * {@link confined} to the servers of a connection that `at()`'s space owns,
 * the app `uses`, and that chats on that platform, connected
 * ({@link serves}). So an app's row reaches only rooms of its own
 * connection's servers. */
export let appChatters = (
  env: Env,
  at: () => { space?: string | null; app?: string | null },
): Record<string, Chatter> => {
  let all = chatters(env, 'app')
  return Object.fromEntries(
    [...PLATFORMS.values()].filter((p) => p.server).map((p) => [
      p.name,
      confined(all[p.name], {
        serves: async (connection) => {
          let { space, app } = at()
          if (!space || !app) return []
          let { usedBy, installed, ctxOf } = await need()
          let b = await usedBy(env, space, app, connection) ?? undefined
          let c = comp(b, CONNECTION)
          if (c.status != 'connected') return []
          let i = (await installed(ctxOf(env).graph.read))
            .find((i) => i.name == c.integration)
          return i?.chat == p.name ? serves(b) : []
        },
        server: async ({ connection, room }) =>
          p.server!(await speaker(env, p, connection), room),
      }),
    ]),
  )
}

/**
 * The messages of `at.room` said before `page.before`, oldest first. The
 * Operator can read a room in a server its connection serves, or its own
 * conversation's DMs through the platform bot.
 */
export let recent = async (
  env: Env,
  via: string,
  at: { connection?: string; room: string; server?: string },
  page: Page,
) => {
  let p = PLATFORMS.get(via)
  if (!p?.recent) return []
  let { token, server } = await roomSpeaker(env, p, at)
  return (await p.recent(token, at.room, page)).map((s) => ({ ...s, server }))
}

/** The message `id` of `at.room`, as {@link recent} reads it. */
export let message = async (
  env: Env,
  via: string,
  at: { connection?: string; room: string; server?: string },
  id: string,
): Promise<Said | undefined> => {
  let p = PLATFORMS.get(via)
  if (!p?.message) return
  let { token, server } = await roomSpeaker(env, p, at)
  return { ...await p.message(token, at.room, id), server }
}

/**
 * What room `at.room` is called, as its connection's bot reads the rooms of
 * its server, only in a server that connection serves, as {@link recent}
 * reads it; none where the platform lists no rooms or this one is not among
 * them.
 */
export let roomName = async (
  env: Env,
  via: string,
  at: { connection: string; room: string; server?: string },
): Promise<string | undefined> => {
  let p = PLATFORMS.get(via)
  if (!p?.rooms) return
  let { token, server } = await heldBy(env, p, at)
  return (await p.rooms(token, server))?.find((r) => r.id == at.room)?.name
}

/** What a person in `at.room` sees without asking, as its connection's
 * bot reads it ({@link Platform.basics}), with each of `people` by their id
 * there: only in a server that connection serves, as {@link recent} reads;
 * none where the platform tells none. */
export let basicsOf = async (
  env: Env,
  via: string,
  at: { connection: string; room: string; server?: string },
  people: string[],
): Promise<Basics | undefined> => {
  let p = PLATFORMS.get(via)
  if (!p?.basics) return
  let { token } = await heldBy(env, p, at)
  return await p.basics(token, at.room, people)
}

/** What a read through a platform's API answered: its status and body. */
export type Answered = { status: number; body: string }

/**
 * GET `path` of `via`'s API as the bot of `at.connection`
 * ({@link Platform.api}): a path one of its reads names, with any query, in
 * a server that connection serves; a room only where the reader was in it
 * (`at.rooms`, the platform's ids) or every member of its server sees it
 * ({@link Platform.open}). Anything else is refused, saying why, before the
 * platform is asked.
 */
export let apiRead = async (
  env: Env,
  via: string,
  at: { connection: string; rooms: string[] },
  path: string,
): Promise<Answered> => {
  let p = PLATFORMS.get(via)
  let api = p?.api
  if (!p || !api) {
    throw new CallError('missing', `${p?.title ?? via} gives no API to read.`)
  }
  let base = new URL(api.base)
  let url = new URL(
    /^https?:/.test(path)
      ? path
      : base.href + (path.startsWith('/') ? '' : '/') + path,
  )
  let rest = url.pathname.slice(base.pathname.length)
  let ids =
    url.origin == base.origin && url.pathname.startsWith(base.pathname + '/')
      ? reading(api, rest)
      : undefined
  if (!ids) {
    throw new CallError(
      'arguments',
      `${p.title}'s API reads only ${api.reads.join(', ')}, under ${api.base}.`,
    )
  }
  let [c] = await read(env, line`.entity.eid=${at.connection}&.${CONNECTION}&*`)
  let held = comp(c, CONNECTION).status == 'connected' ? serves(c) : []
  if (!held.length) {
    throw new CallError(
      'access',
      `No ${p.title} server is connected for this space now.`,
    )
  }
  let token = await speaker(env, p, at.connection)
  if (ids.server && !held.includes(ids.server)) {
    throw new CallError(
      'access',
      `Server ${ids.server} is not one this space's ${p.title} bot serves.`,
    )
  }
  if (ids.room) {
    let room = ids.room
    await within(
      { connection: at.connection, room },
      held,
      () => p.server ? p.server(token, room) : Promise.resolve(undefined),
    ).catch(
      () => {
        throw new CallError(
          'access',
          `Room ${room} is not in a server this space's ${p.title} bot serves.`,
        )
      },
    )
    if (!at.rooms.includes(room) && !await p.open?.(token, room)) {
      throw new CallError(
        'access',
        `Room ${room} is one only some members see, and nobody talking to you was in it.`,
      )
    }
  }
  let res = await fetch(url, {
    headers: { authorization: `${api.scheme} ${token}` },
  })
  return { status: res.status, body: await res.text() }
}

// The bot speaking in a room the Operator was addressed in.
let roomSpeaker = async (
  env: Env,
  p: Platform,
  at: { connection?: string; room: string; server?: string },
) => {
  if (at.connection) return heldBy(env, p, { ...at, connection: at.connection })
  if (at.server) throw new Error('A server room needs its chat connection')
  return { token: await speaker(env, p), server: undefined }
}

// The bot token of `at.connection` and the server of `at.room`, refused
// where the room is outside the servers the connection serves.
let heldBy = async (
  env: Env,
  p: Platform,
  at: { connection: string; room: string; server?: string },
) => {
  let [c] = await read(env, line`.entity.eid=${at.connection}&.${CONNECTION}&*`)
  let held = comp(c, CONNECTION).status == 'connected' ? serves(c) : []
  let token = held.length ? await speaker(env, p, at.connection) : ''
  let server = await within(
    at,
    held,
    async () => at.server ?? await p.server?.(token, at.room),
  )
  return { token, server }
}

let read = async (env: Env, q: string) =>
  await (await need()).ctxOf(env).graph.read(q as never) as Bundle[]
let comp = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp

// The built integrations yaks.app's own bot speaks through for `via`: those
// that chat there and are signed in to, not pasted.
let ours = async (env: Env, via: string) => {
  let { ctxOf, installed, keyed } = await need()
  return (await installed(ctxOf(env).graph.read)).filter((i) =>
    i.chat == via && !keyed(i)
  )
}

/** yaks.app's own bot on `via`: the one its OAuth client keeps, read from
 * the vault alone (the integrations are this build's own seeds), and none
 * where no vault is set up. */
export let platformBot = async (env: Env, via: string) => {
  let { registered, seeds, keyed, vaultOf, vaulted } = await need()
  if (!vaulted(env)) return undefined
  for (let i of seeds().filter((i) => i.chat == via && !keyed(i))) {
    let bot = i.client && (await registered(vaultOf(env), i.client))?.bot
    if (bot) return bot
  }
}

// The signing secret of a platform's Events API lives with its OAuth client.
let signing = async (env: Env, via: string) => {
  let { registered, seeds, vaultOf, vaulted } = await need()
  if (!vaulted(env)) return
  let i = seeds().find((i) => i.chat == via && i.chat_grant)
  let client = i?.client ? await registered(vaultOf(env), i.client) : undefined
  return client?.secret ? client.signing : undefined
}

let keptOn = async (env: Env, p: Platform) =>
  !!await (p.hook ? signing(env, p.name) : platformBot(env, p.name))

// Whether yaks.app's own bot is kept for `p`, asked once a request
// (hops.ts `recall`), so a page asks it as it starts (`keptAhead`).
let botKept = (env: Env, p: Platform) =>
  recall('vault', `chat kept ${p.name}`, () => keptOn(env, p))

/** Ask the vault which platforms yaks.app's own bots are kept for, which
 * says where an Operator can be added (`reached`), as a page starts: the
 * answer is the platform's, not the space's, so it need not wait on the
 * read that learns the space. A failure is the page's to meet when it asks. */
export let keptAhead = (env: Env): void => {
  for (let p of PLATFORMS.values()) botKept(env, p).catch(() => {})
}

/** A platform's HTTPS intake. The provider verifies the envelope; the
 * installation account selects the same connection as socket messages. */
export let events = async (req: Request, env: Env, via: string) => {
  let platform = PLATFORMS.get(via)
  if (!platform?.hook) return null
  let secret = await signing(env, via)
  if (!secret) return new Response(null, { status: 503 })
  return receive(req, platform.hook, secret, async (account, said) => {
    let [held] = await serving(env, via, account)
    if (held) {
      await arrived(env, platform, said, { via, connection: held.entity.eid })
    }
  })
}

/** Ask `bot` to listen: what connecting a space to it does, and harmless
 * when it already is. */
export let listen = async (env: Env, bot: Bot) => {
  if (!env.CHATS || !PLATFORMS.get(bot.via)?.socket) return
  await listening(env.CHATS, bot).listen(bot)
}

/** Ask the bot that speaks for `connection` into a voice room of `server`,
 * or out of the one it is in there ({@link VoiceAsk}): answered as
 * {@link Listening.voice} answers. */
export let voice = async (
  env: Env,
  connection: string,
  ask: VoiceAsk,
): Promise<string> => {
  let bot = await botFor(env, connection)
  if (!env.CHATS || !bot) return 'No bot speaks for this connection now.'
  return await listening(env.CHATS, bot).voice(ask)
}

/** The voice room of `server` that `account` is in, as the bot that speaks
 * for `connection` sees it; null in none. */
export let voicedIn = async (
  env: Env,
  connection: string,
  server: string,
  account: string,
) => {
  let bot = await botFor(env, connection)
  if (!env.CHATS || !bot) return null
  return await listening(env.CHATS, bot).voiced(server, account)
}

/** Take the bot out of a voice room a call was in: what hanging up on it
 * does (operator-calls.ts). */
export let leaveVoice = async (
  env: Env,
  room: { connection: string; server: string },
) => {
  await voice(env, room.connection, { server: room.server, room: null })
}

/** The bot that speaks for `connection`, if it chats: the one the space
 * brought, whose token is its pasted key, or else yaks.app's own on its
 * platform. */
export let botFor = async (
  env: Env,
  connection: string,
): Promise<Bot | undefined> => {
  let [b] = await read(
    env,
    line`.entity.eid=${connection}&.${CONNECTION}&*`,
  )
  let name = String(comp(b, CONNECTION).integration ?? '')
  let { ctxOf, installed, keyed } = await need()
  let i = (await installed(ctxOf(env).graph.read)).find((i) => i.name == name)
  if (!i?.chat) return undefined
  return keyed(i) ? { via: i.chat, connection } : { via: i.chat }
}

/** After a space connects an integration: if it chats, its bot listens
 * (connections.ts). yaks.app's own bot added to a server serves it for that
 * space alone from now on: another space's connection to the same server
 * ends, so a server moves from one space's Operator to another's whole. The
 * bot goes by its Operator's name in the servers it serves ({@link naming}). */
export let connected = async (env: Env, connection: string) => {
  let bot = await botFor(env, connection)
  if (!bot) return
  let [c] = await read(env, line`.entity.eid=${connection}&.${CONNECTION}&*`)
  if (!bot.connection) {
    let { account } = comp(c, CONNECTION)
    let others = account
      ? (await serving(env, bot.via, String(account)))
        .filter((o) => o.entity.eid != connection)
      : []
    let { ended } = await need()
    for (let o of others) await ended(env, o.entity.eid)
  }
  await listen(env, bot)
  await Promise.all([naming(env, c), titled(env, c)])
}

/** Each bot that speaks for one of `space`'s chat connections goes by its
 * Operator's name again, in every server it serves: what renaming the
 * Operator does (operator-channels.ts `operator_named`). */
export let renamed = async (env: Env, space: string) => {
  let held = await read(
    env,
    line`.${CONNECTION}.owner=${space}&.${CONNECTION}.status=connected&*`,
  )
  await Promise.all(held.map((c) => naming(env, c)))
}

// The bot that speaks for connection `c` goes by the name of its space's
// Operator in each of `servers`, where its platform names a bot per server
// ({@link Platform.named}): yaks.app's own bot, whose global name is
// yaks.app's, and a bot a space brought, which keeps the name its owner gave
// it everywhere else. A server that refuses it is reported and the others
// are still named.
let naming = async (env: Env, c: Bundle | undefined, servers = serves(c)) => {
  let { integration, owner, status } = comp(c, CONNECTION)
  if (!c || status != 'connected' || !servers.length) return
  let { caught, ctxOf, directoryOf, installed } = await need()
  let via = (await installed(ctxOf(env).graph.read))
    .find((i) => i.name == integration)?.chat
  let p = via ? PLATFORMS.get(via) : undefined
  if (!p?.named) return
  let space = await directoryOf(env.STORE).at(String(owner))
  if (!space || space.trashed) return
  let tags = { request: `${p.name} nickname`, connection: c.entity.eid }
  let token = await speaker(env, p, c.entity.eid).catch((e) => {
    caught(e, tags)
  })
  if (!token) return
  await Promise.all(
    servers.map((server) =>
      p.named!(token, server, space.operator)
        .catch((e) => caught(e, { ...tags, server }))
    ),
  )
}

/** After a space disconnects `bot`'s connection: a bot the space brought
 * stops listening, and yaks.app's own listens on for every other server. */
export let quiet = async (env: Env, bot: Bot) => {
  if (env.CHATS && bot.connection) await listening(env.CHATS, bot).stop()
}

/** The servers a chat connection posts into: the one yaks.app's own bot was
 * added to, its `account`, or every one a bot the space brought is in
 * (`chat_serves`). */
export let serves = (c: Bundle | undefined): string[] => {
  let { servers } = comp(c, SERVES)
  if (Array.isArray(servers)) return servers.map(String)
  let { account } = comp(c, CONNECTION)
  return account ? [String(account)] : []
}

// What a bot a space brought says of the servers it is in, kept on its
// connection (`chat_serves`), written only when it changed; in each server
// it joined, it goes by its Operator's name.
let seated = async (env: Env, connection: string, s: Seated) => {
  let [c] = await read(env, line`.entity.eid=${connection}&.${CONNECTION}&*`)
  if (!c) return
  let had = comp(c, SERVES).servers as string[] | undefined ?? []
  let now = [
    ...new Set(
      'all' in s
        ? s.all
        : 'joined' in s
        ? [...had, s.joined]
        : had.filter((id) => id != s.left),
    ),
  ].sort()
  if (now.join() != had.join() || !comp(c, SERVES).servers) {
    let { KERNEL, meta } = await need()
    await meta(env).apply(
      [{ entity: { eid: connection }, [SERVES]: { servers: now } }],
      KERNEL,
    )
    await naming(env, c, now.filter((id) => !had.includes(id)))
  }
  await titled(env, c, now)
}

// What each of `servers` of connection `c` is called, kept on it
// (`chat_serves{names}`) so its Operator's page names them without asking
// the platform on every load: asked of the platform for each it has no name
// for yet. One the bot is not in, or that could not be named now, is asked
// again the next time its bot is seated.
let titled = async (env: Env, c: Bundle, servers = serves(c)) => {
  let names = comp(c, SERVES).names as Record<string, string> | undefined ??
    {}
  let missing = servers.filter((id) => !names[id])
  let { integration, status } = comp(c, CONNECTION)
  if (!missing.length || status != 'connected') return
  let { caught, ctxOf, installed, KERNEL, meta } = await need()
  let via = (await installed(ctxOf(env).graph.read))
    .find((i) => i.name == integration)?.chat
  let p = via ? PLATFORMS.get(via) : undefined
  let about = p?.about
  if (!p || !about) return
  let tags = { request: `${p.name} server`, connection: c.entity.eid }
  let token = await speaker(env, p, c.entity.eid).catch((e) => {
    caught(e, tags)
  })
  if (!token) return
  let found = (await Promise.all(missing.map(async (server) =>
    [
      server,
      (await about(token, server).catch((e) => {
        caught(e, { ...tags, server })
        return null
      }))?.name,
    ] as const
  ))).filter(([, name]) => name)
  if (!found.length) return
  await meta(env).apply([{
    entity: { eid: c.entity.eid },
    [SERVES]: { names: { ...names, ...Object.fromEntries(found) } },
  }], KERNEL)
}

// The connected connections through which yaks.app's own bot speaks on
// `via`, of those `where` selects.
let through = async (env: Env, via: string, where: string) => {
  let names = new Set((await ours(env, via)).map((i) => i.name))
  return (await read(
    env,
    `${where}&${line`.${CONNECTION}.status=connected`}&*`,
  )).filter((b) => names.has(String(comp(b, CONNECTION).integration)))
}

// Those through which a space added yaks.app's own bot to `server`.
let serving = (env: Env, via: string, server: string) =>
  through(env, via, line`.${CONNECTION}.account=${server}`)

/** The person here whose `platform.user` account is `id`, if one linked it:
 * a connection they hold. The account is personal (@yaks/connections
 * `Integration.personal`), so connecting it from a space's settings makes it
 * the person's own, never the space's. */
export let linked = async (env: Env, platform: Platform, id: string) =>
  (await linkedAll(env, platform, [id])).get(id)

/** {@link linked} for many accounts at once, in one read of their
 * connections: those linked here, each to its person. */
export let linkedAll = (
  env: Env,
  platform: Platform,
  ids: string[],
): Promise<Map<string, string>> =>
  Promise.resolve(linkedAccounts((q) => read(env, q), platform.user, ids))

/** Linked people read through either the directory door or its transaction. */
export let linkedAccounts = (
  read: (q: Line) => Bundle[] | Promise<Bundle[]>,
  integration: string | undefined,
  ids: string[],
) => {
  if (!integration || !ids.length) return new Map<string, string>()
  return after(
    read(
      line`.${CONNECTION}.integration=${integration}&.${CONNECTION}.account=${ids}&.${CONNECTION}.status=connected&.${CONNECTION}.owner.person&*`,
    ),
    (rows) => {
      let found = new Map<string, string>()
      for (let b of rows) {
        let { owner, account } = comp(b, CONNECTION)
        if (owner && !found.has(String(account))) {
          found.set(String(account), String(owner))
        }
      }
      return found
    },
  )
}

/** Where the Operator of a space writes to one of its people alone on a
 * platform: the platform (`via`), the space's connection whose bot speaks
 * for it there, and the person's account there. */
export type Direct = { via: string; connection: string; account: string }

/** Where `space`'s Operator writes to `person` directly on `via`
 * ({@link Direct}): the account linked to them there, the other way round
 * from {@link linkedAll} (one they hold, or one `space` holds while they are
 * its only owner), and the bot of a connection `space` holds there, its own
 * or yaks.app's. None when the platform writes to no one directly, or either
 * is missing. */
export let directTo = async (
  env: Env,
  via: string,
  space: string,
  person: string,
): Promise<Direct | undefined> => {
  let p = PLATFORMS.get(via)
  if (!p?.direct || !p.user) return undefined
  let { ctxOf, directoryOf, installed } = await need()
  let chats = new Set(
    (await installed(ctxOf(env).graph.read)).filter((i) => i.chat == via)
      .map((i) => i.name),
  )
  let rows = await read(
    env,
    line`.${CONNECTION}.owner=${[
      person,
      space,
    ]}&.${CONNECTION}.status=connected&*`,
  )
  let bot = rows.find((b) =>
    comp(b, CONNECTION).owner == space &&
    chats.has(String(comp(b, CONNECTION).integration))
  )
  let accounts = rows.filter((b) =>
    comp(b, CONNECTION).integration == p.user && comp(b, CONNECTION).account
  )
  let theirs = async () => {
    let dir = directoryOf(env.STORE)
    let s = await dir.at(space)
    let owners = s ? await dir.owners(s) : []
    return owners.length == 1 && owners[0] == person
  }
  let mine = accounts.find((b) => comp(b, CONNECTION).owner == person) ??
    (accounts.length && await theirs() ? accounts[0] : undefined)
  if (!bot || !mine) return undefined
  return {
    via,
    connection: bot.entity.eid,
    account: String(comp(mine, CONNECTION).account),
  }
}

/** Say `text` to the person at `to` alone, through the bot that speaks for
 * its connection, cut to what one message there may carry. Refused as the
 * platform refuses it (@yaks/chat `Unreachable`, `Unsent`). */
export let sayDirect = async (env: Env, to: Direct, text: string) => {
  let p = PLATFORMS.get(to.via)
  if (!p?.direct) throw new Error(`${to.via} writes to no one directly`)
  let said = text.length > p.limit ? text.slice(0, p.limit - 1) + '…' : text
  return p.direct(await speaker(env, p, to.connection), to.account, said)
}

/** Who a platform says is about, kept as the whereabouts of each linked to a
 * person here (whereabouts.ts); anyone else is nobody we know. */
let present = async (env: Env, platform: Platform, all: Present[]) => {
  let status = new Map(all.map((p) => [p.account, p.status]))
  let people = await linkedAll(env, platform, [...status.keys()])
  if (!people.size) return
  let { present } = await import('./whereabouts.ts')
  type Channel = import('@yaks/notify/whereabouts').Channel
  for (let [account, person] of people) {
    await present(env, {
      person,
      channel: platform.name as Channel,
      state: status.get(account)!,
    })
  }
}

/** The person's own accounts on each platform whose bot yaks.app keeps, as
 * Profile shows them (side.ts `personRows`, `chatLink`): the platform, the
 * integration a person links their account there with, and the names of
 * those they linked, which tell every space's Operator it is them
 * ({@link linked}). `rows` are the connections the person connected as
 * themselves (directory.ts `ownConnections`). */
export let ownLinks = async (env: Env, rows: Bundle[]) => {
  let all = await Promise.all(
    [...PLATFORMS.values()].map(async (p) =>
      p.user && await platformBot(env, p.name)
        ? [{
          platform: p.title,
          integration: p.user,
          accounts: rows.filter((b) =>
            comp(b, CONNECTION).integration == p.user
          ).map((b) =>
            String(comp(b, CONNECTION).title ?? comp(b, CONNECTION).account)
          ),
        }]
        : []
    ),
  )
  return all.flat()
}

/** What a space's Operator settings offer for each platform whose bot
 * yaks.app keeps, or that a bot the space brought is on (operator-page.ts
 * `chatCard`): the integration that adds yaks.app's bot, and the one a
 * person links their account there with, known from this build's seeds;
 * whether yaks.app keeps its bot, without which there is nothing to add;
 * and each of the space's connections there, with the rooms it may hear in
 * full ({@link servers}). */
export let offers = async (
  env: Env,
  space: string,
  rows?: Awaited<ReturnType<typeof chatRows>>,
) => {
  let { chatRows, directoryOf, keyed, seeds } = await need()
  let all = seeds()
  let [connections, each] = await Promise.all([
    rows ?? chatRows(directoryOf(env.STORE), space),
    Promise.all(
      [...PLATFORMS.values()].map(async (platform) => ({
        platform,
        bot: all.find((i) => i.chat == platform.name && !keyed(i))!,
        user: all.find((i) => i.name == platform.user),
        kept: await keptOn(env, platform),
      })),
    ),
  ])
  return await Promise.all(
    each.filter((o) => o.bot).map(async (o) => ({
      ...o,
      servers: await servers(env, o.platform, connections),
    })),
  ).then((all) => all.filter((o) => o.kept || o.servers.length))
}

/** A chat connection of a space, as its Operator settings show it: the
 * connection, the rooms people write in on the servers it serves
 * ({@link serves}), by their eids here (@yaks/chat `roomEid`), or none
 * where the platform would not list them now, whether its bot is no longer
 * in a server it serves (`away`, kicked or never added), the one its
 * Operator hears in full (`chat_hears`), and whether it is a bot the space
 * brought. */
export type Server = {
  connection: string
  rooms?: (Room & { eid: string })[] | null
  title?: string
  away?: boolean
  hears?: string
  own?: boolean
}

// The connections `space` holds on `platform`, yaks.app's own bot's and
// those of bots it brought, where the platform lists their rooms.
let servers = async (
  env: Env,
  platform: Platform,
  connections: Awaited<ReturnType<typeof chatRows>>,
): Promise<Server[]> => {
  let { rooms } = platform
  let { botFrom, caught, ctxOf, keyed } = await need()
  let ctx = ctxOf(env)
  return await Promise.all(
    connections.filter(({ integration }) => integration.chat == platform.name)
      .sort((a, b) =>
        Number(keyed(a.integration)) - Number(keyed(b.integration))
      )
      .map(async ({ row: c, integration }) => {
        if (!rooms) {
          let title = comp(c, CONNECTION).title
          return {
            connection: c.entity.eid,
            ...typeof title == 'string' ? { title } : {},
          }
        }
        let token = await botFrom(ctx, c, integration)
        // A server the bot is not in lists nothing: it was removed there,
        // and is added again from here.
        let each = token
          ? await Promise.all(serves(c).map((id) => rooms(token, id)))
            .catch((e) => {
              caught(e, { request: `${platform.name} rooms` })
              return null
            })
          : null
        let away = !!each?.length && each.every((r) => r == null)
        let listed = each && !away ? each.flatMap((r) => r ?? []) : null
        let hears = comp(c, HEARS).room
        return {
          connection: c.entity.eid,
          rooms: listed?.map((r) => ({
            ...r,
            eid: roomEid(platform.name, r.id),
          })) ?? null,
          ...away ? { away } : {},
          ...hears ? { hears: String(hears) } : {},
          ...keyed(integration) ? { own: true } : {},
        }
      }),
  )
}

/** Where a space's Operator is reached on a chat platform, as its page
 * shows it (operator-ways.ts): a server one of its connections serves
 * ({@link serves}), by the name kept on the connection (`chat_serves{names}`),
 * the room it hears in full there (`chat_hears`), if that room is in it, and
 * the address that opens them. */
export type Place = {
  platform: string
  /** where its integration's logo is drawn from (@yaks/platform/routes
   * `integrationLogo`), for @yaks/ui `Logo` */
  logo?: string
  server?: string
  room?: string
  href: string
}

/** A platform yaks.app keeps a bot on that a space has not added it to yet:
 * `integration` adds it, still in its service's testing mode where
 * `testing`. */
export type Unset = {
  platform: string
  integration: string
  /** where its logo is drawn from, as a {@link Place}'s */
  logo?: string
  testing?: boolean
}

// An integration's logo, where it has one.
let marked = (i: Integration, env: Env) => {
  let logo = integrationLogo(i, env)
  return logo ? { logo } : {}
}

/** Every place a space's Operator is reached on a chat platform, read from
 * its chat `connections` alone, and the platforms where it is not yet
 * ({@link Place}, {@link Unset}). Nothing here asks a platform: a server
 * whose name was never kept is shown unnamed. */
export let reached = async (
  env: Env,
  connections: Awaited<ReturnType<typeof chatRows>>,
): Promise<{ places: Place[]; unset: Unset[] }> => {
  let { keyed, seeds } = await need()
  let each = await Promise.all([...PLATFORMS.values()].map(async (p) => {
    let theirs = connections.filter(({ integration }) =>
      integration.chat == p.name
    )
    if (!theirs.length) {
      let bot = seeds().find((i) => i.chat == p.name && !keyed(i))
      return bot && await botKept(env, p)
        ? {
          places: [],
          unset: [{
            platform: p.title,
            integration: bot.name,
            ...marked(bot, env),
            ...bot.testing ? { testing: true } : {},
          }],
        }
        : { places: [], unset: [] }
    }
    let { link } = p
    if (!link) return { places: [], unset: [] }
    let places = theirs.flatMap(({ row, integration }) => {
      let names = comp(row, SERVES).names as Record<string, string> | undefined
      let hears = comp(row, HEARS)
      return serves(row).map((server): Place => {
        let name = names?.[server] ??
          comp(row, CONNECTION).title as string | undefined
        let room = hears.server == server && hears.id ? hears : undefined
        return {
          platform: p.title,
          ...marked(integration, env),
          ...name ? { server: name } : {},
          ...room?.name ? { room: String(room.name) } : {},
          href: link(server, room ? String(room.id) : undefined),
        }
      })
    })
    return { places, unset: [] }
  }))
  return {
    places: each.flatMap((e) => e.places),
    unset: each.flatMap((e) => e.unset),
  }
}

/** Choose the room of `connection`'s server whose every message the space's
 * Operator hears (`chat_hears`), by its id on the platform; none hears only
 * what is said to the bot. What the Operator's settings save, as `who`; a
 * connection the space does not hold is refused. */
export let choose = async (
  env: Env,
  who: Who,
  space: string,
  connection: string,
  room: string | null,
) => {
  let { ctxOf, installed } = await need()
  let [c] = await read(env, line`.entity.eid=${connection}&.${CONNECTION}&*`)
  let { owner, integration } = comp(c, CONNECTION)
  let via = (await installed(ctxOf(env).graph.read))
    .find((i) => i.name == integration)?.chat
  if (owner != space || !via) {
    let { refuse } = await import('./tool.ts')
    throw refuse('missing', 'This space holds no such chat connection.')
  }
  await ctxOf(env, who).graph.apply([{
    entity: { eid: connection },
    [HEARS]: room ? await heard(env, via, connection, room) : null,
  }])
}

// What `chat_hears` keeps of `room`, which `connection` serves on `via`:
// its eid and id, and the server it is in and its name as the platform says
// them now, so the Operator's page links and names it without asking. Where
// the platform cannot say now, that is reported and the room is heard all
// the same, unnamed.
let heard = async (env: Env, via: string, connection: string, room: string) => {
  let p = PLATFORMS.get(via)!
  let at = await heldBy(env, p, { connection, room })
    .then(async ({ token, server }) => ({
      server,
      name: (await p.rooms?.(token, server))?.find((r) => r.id == room)?.name,
    }))
    .catch(async (e) => {
      ;(await need()).caught(e, { request: `${via} room`, connection })
      return { server: null, name: null }
    })
  return {
    room: roomEid(via, room),
    id: room,
    server: at.server,
    name: at.name ?? null,
  }
}

/** The guest a chat account `id` on `via` speaks as while linked to nobody
 * ({@link guestOf}). */
export let guestId = (via: string, id: string) =>
  derivedEid(`chatted|${via}|${id}`)

// The original DM is held in the directory until a space takes it. The same
// gateway message, including an edit or a replay, opens at most one intake.
let queueDirect = async (env: Env, p: Platform, said: Said) => {
  let eid = messageEid(p.name, said.id)
  let { KERNEL, meta } = await need()
  await meta(env).apply([{
    entity: { eid },
    chat_dm: { via: p.name, account: said.author.id, said },
    $was: { chat_dm: { via: null } },
  }], KERNEL).catch((e) => {
    if (!(e instanceof Stale && e.eid == eid)) throw e
  })
}

/** Carry a DM to a linked sender's own conversation, or tell them how to
 * link. The destination sticks across retries, and the Builder takes the
 * message idempotently. The directory drops the words once they're taken. */
export let carryDirect = async (
  env: Env,
  graph: Graph,
  eid: string,
  replay = false,
) => {
  let [row] = await read(env, line`.entity.eid=${eid}&.chat_dm&*`)
  let dm = comp(row, 'chat_dm') as Partial<DirectMessage> & { via?: string }
  let p = PLATFORMS.get(dm.via ?? '')
  let { said } = dm
  if (!said || !p?.user) return
  let clock = env.CLOCK ?? system
  let until = directDeadline(row)
  let live = () => until > clock.now()
  if (!live()) return
  let { directoryOf, KERNEL, meta } = await need()
  let patch = (next: Comp, was?: Record<string, string | null>) =>
    meta(env).apply([{
      entity: { eid },
      chat_dm: next,
      ...was ? { $was: { chat_dm: was } } : {},
    }], KERNEL)
  let result = await carry({ ...dm, said }, {
    person: await linked(env, p, said.author.id),
    seats: directoryOf(env.STORE).seats,
    reserve: async (person, space) => {
      try {
        await patch({ person, space: space.eid }, {
          space: null,
          said: token(said),
        })
        return true
      } catch (error) {
        if (error instanceof Stale && error.eid == eid) return false
        throw error
      }
    },
    forward: async (person, space, said) => {
      if (live()) {
        await toOperator(env, space, person, {
          via: p.name,
          said,
          linked: true,
        })
      }
    },
    explain: async (why) => {
      if (!live() || replay && why == 'link') return
      await p.send(await speaker(env, p), {
        room: said.room,
        reply_to: said.id,
        text: dmAnswer(env, p, why),
      })
    },
    done: async () => {
      if (!live()) return
      try {
        await graph.book([{
          entity: { eid },
          chat_dm: { said: null, until: directUntil(clock.now()) },
          $was: { chat_dm: { said: token(said) } },
        }])
      } catch (error) {
        if (!(error instanceof Stale && error.eid == eid)) throw error
      }
    },
  })
  if (result == 'reread') await carryDirect(env, graph, eid, replay)
}

let dmAnswer = (
  env: Env,
  p: Platform,
  why: 'link' | 'empty' | 'usage' | 'access' | 'space',
) =>
  ({
    link:
      `Link your ${p.title} account to yaks.app to talk to your Operator. I’ll answer this message once you link.\n${
        accountLink(hostUrl(env), p.user!).href
      }`,
    empty: 'Send me a written message and I’ll take it to your Operator.',
    usage:
      'Send \`!space <space-slug> <message>\` to talk to that space’s Operator.',
    access:
      'You don’t have access to that space. Check your spaces on yaks.app or send your message without \`!space\` to reach your default Operator.',
    space: `Choose a space on yaks.app, then send your message again. ${
      hostUrl(env, managePath('profile'))
    }`,
  })[why]

/**
 * The chat account a person's connection `connection` links (`linked`): in
 * each space they sit in, what the guest it spoke as before raised is re-read
 * as theirs (operator-escalate.ts `linkedTo`), so a request made before
 * linking goes on without waiting for anyone its role does not need.
 */
export let linkedNow = async (env: Env, graph: Graph, connection: string) => {
  let [row] = await read(env, line`.entity.eid=${connection}&*`)
  let c = comp(row ?? undefined, CONNECTION)
  let platform = [...PLATFORMS.values()].find((p) =>
    p.user && p.user == c.integration
  )
  if (!platform || c.status != 'connected' || !c.owner || !c.account) return
  let person = String(c.owner)
  let queued = await read(
    env,
    line`.chat_dm.via=${platform.name}&.chat_dm.account=${
      String(c.account)
    }&.chat_dm.said&.order=created.at`,
  )
  for (let b of queued) await carryDirect(env, graph, b.entity.eid, true)
  let { directoryOf } = await need()
  let dir = directoryOf(env.STORE)
  let [seats, known] = await Promise.all([
    dir.seats(person),
    dir.known(person),
  ])
  let { operatorDoor } = await import('./build-door.ts')
  for (let s of seats) {
    await operatorDoor(env, s.space, { person, role: s.role }, 'linked', {
      from: guestId(platform.name, String(c.account)),
      name: known?.name ?? '',
    })
  }
}

/** The guest who speaks as `id` on `via`: a person with no seat and no
 * address, minted the first time they speak, as a stranger's number is
 * (operator-texts.ts `phonedIn`); or who stands for a group text's thread
 * (operator-texts.ts `textedOperator`). */
export let guestOf = async (env: Env, via: string, id: string) => {
  let person = guestId(via, id)
  let [had] = await read(env, line`.entity.eid=${person}&.person`)
  let { KERNEL, meta } = await need()
  if (!had) {
    await meta(env).apply([{ entity: { eid: person }, person: {} }], KERNEL)
  }
  return person
}

/** A message heard through `connection`, kept in each app of its space that
 * `uses` it (@yaks/chat `kept`), for the app's own rules to take up. */
let toApps = async (
  env: Env,
  platform: Platform,
  said: Said,
  connection: Bundle,
) => {
  let users = await read(
    env,
    line`.edge.to=${connection.entity.eid}&.uses&*`,
  )
  if (!users.length) return
  let { appStore, caught, directoryOf, KERNEL, metaOf } = await need()
  let dir = directoryOf(env.STORE)
  let space = await dir.at(String(comp(connection, CONNECTION).owner))
  if (!space || space.trashed) return
  let from = new Set(users.map((l) => String(comp(l, 'edge').from)))
  let rows = kept(platform.name, said, connection.entity.eid)
  await Promise.all(
    (await dir.apps(space)).filter((a) => from.has(a.eid) && !a.trashed).map(
      (app) =>
        metaOf(appStore(env.STORE, space, app, env)).apply(rows, KERNEL)
          .catch((e) =>
            caught(e, {
              request: `${platform.name} message`,
              space: space.slug,
              app: app.slug,
            })
          ),
    ),
  )
}

/**
 * A message `bot` heard on `platform`: yaks.app's own, whose connection for
 * a server is the one that added the bot there, or one a space brought,
 * whose connection is its own wherever it was said. One said in a server is
 * kept in each app that uses that connection ({@link toApps}). In a server,
 * one said in the room the connection's space chose for its Operator to hear
 * in full (`chat_hears`) goes to that room's one conversation, as a group
 * text goes to its group's (operator-texts.ts `textedOperator`): the
 * conversation of a guest who stands for the room, the words kept as their
 * writer's. A turn there acts for a member whose linked account wrote the
 * newest words, with that member's tools, and for anyone else has only what
 * the space lets anyone do (operator.ts `actorOf`). Elsewhere, one addressed to the bot, or
 * naming its Operator in words as a group text does (`calledBy`), goes to its
 * writer's own conversation with that Operator; a direct one to yaks.app's
 * own, from someone linked here, to their own space's. Anything else is not
 * for the Operator. An edit is taken only where it is addressed, as a
 * message said then: one the Operator already took is not answered again
 * (operator-channels.ts `hear`), so an edit that adds a mention is answered
 * and any other is not; in a room heard in full, where it took the message
 * unaddressed, one that adds a mention is answered unless it was already
 * (operator-channels.ts `chatHeard`).
 */
export let arrived = async (
  env: Env,
  platform: Platform,
  said: Said,
  bot: Bot = { via: platform.name },
) => {
  if (!bot.connection && !said.server) {
    if (said.edited) return
    if (said.addressed == 'direct' && platform.user) {
      await queueDirect(env, platform, said)
    }
    return
  }
  let heard = bot.connection
    ? await read(
      env,
      line`.entity.eid=${bot.connection}&.${CONNECTION}.status=connected&*`,
    )
    : said.server
    ? await serving(env, platform.name, said.server)
    : []
  // An edit is kept where it was said to the bot, as one said then.
  if (said.server && (!said.edited || said.addressed)) {
    await Promise.all(heard.map((c) => toApps(env, platform, said, c)))
  }
  let { directoryOf } = await need()
  let dir = directoryOf(env.STORE)
  let known: Promise<string | undefined> | undefined
  let author = () => known ??= linked(env, platform, said.author.id)
  let space: Space | null = null
  let connection: string | undefined
  let room = false
  if (said.server || bot.connection) {
    let [c] = heard
    if (!c) return
    room = !!said.server &&
      comp(c, HEARS).room == roomEid(platform.name, said.room)
    connection = c.entity.eid
    space = await dir.at(String(comp(c, CONNECTION).owner))
  }
  if (!space || space.trashed || !connection) return
  said = calledBy(said, space)
  if (said.edited && !said.addressed) return
  if (!room && !said.addressed) return
  let mine = await author()
  let writer = mine ?? await guestOf(env, platform.name, said.author.id)
  let person = room
    ? await guestOf(env, platform.name, `room:${said.room}`)
    : writer
  await toOperator(env, space, person, {
    via: platform.name,
    connection,
    said,
    ...room ? { writer } : {},
    ...mine ? { linked: true } : {},
  })
}

/** `said` as said to `space`'s Operator where its words name it, as a group
 * text's do (@yaks/session/turn `named`): its name typed without a mention
 * is a mention.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { calledBy } from './chat.ts'
 * let said = { id: '1', room: 'r', author: { id: 'a', name: 'A' }, at: '' }
 * let space = { operator: 'Ember' }
 * equal(calledBy({ ...said, text: 'ember, you there?' }, space).addressed, 'mention')
 * equal(calledBy({ ...said, text: 'remember this' }, space).addressed, undefined)
 * ```
 */
export let calledBy = (said: Said, space: Pick<Space, 'operator'>): Said =>
  said.addressed || !named(said.text, [space.operator, 'operator'])
    ? said
    : { ...said, addressed: 'mention' }

let toOperator = async (
  env: Env,
  space: Space,
  person: string,
  message: {
    via: string
    connection?: string
    said: Said
    writer?: string
    linked?: boolean
  },
) => {
  let { KERNEL } = await need()
  let { builderOf, SPACE } = await import('./build-door.ts')
  let response = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...KERNEL,
        'x-yak-person': person,
        [SPACE]: space.eid,
      },
      body: JSON.stringify(message),
    })
  )
  if (!response.ok) {
    throw new Error(
      `${message.via} message intake failed: ${await response.text()}`,
    )
  }
  await response.body?.cancel()
}

/**
 * A button pressed on a message of `bot`'s on `platform`, answered for its
 * presser alone ({@link Platform.presses}): held at once, as the platform
 * waits only moments, then answered by the Operator of the space the press
 * was in, as {@link arrived} finds it, given who the presser's account is
 * linked to here (operator-private.ts `pressAnswer`). A press the Operator
 * could not answer is reported and told so, so the presser never waits on
 * nothing.
 */
export let pressedOn = async (
  env: Env,
  platform: Platform,
  press: Press,
  credential: string,
  bot: Bot = { via: platform.name },
) => {
  let { presses } = platform
  if (!presses) return
  await presses.hold(credential, press)
  let answer: Answer
  try {
    answer = await answerOf(env, platform, press, bot)
  } catch (error) {
    ;(await need()).caught(error, {
      request: `${platform.name} press`,
      server: press.server ?? '',
      ...bot.connection ? { connection: bot.connection } : {},
    })
    answer = { text: 'That did not go through. Try again in a moment.' }
  }
  await presses.answer(credential, press, answer)
}

// What the Operator of the space `press` was in answers it: the space of
// the connection that heard its server, or for a direct room, the
// presser's own.
let answerOf = async (
  env: Env,
  platform: Platform,
  press: Press,
  bot: Bot,
): Promise<Answer> => {
  let { directoryOf, KERNEL } = await need()
  let dir = directoryOf(env.STORE)
  let who = await linked(env, platform, press.author.id)
  let space: Space | null = null
  if (bot.connection || press.server) {
    let [c] = bot.connection
      ? await read(
        env,
        line`.entity.eid=${bot.connection}&.${CONNECTION}.status=connected&*`,
      )
      : await serving(env, platform.name, press.server!)
    space = c ? await dir.at(String(comp(c, CONNECTION).owner)) : null
  } else if (who) {
    let { spaceFor } = await import('./operator-texts.ts')
    space = await spaceFor(env, who)
  }
  if (!space || space.trashed) {
    return { text: 'This is not for anyone here any more.' }
  }
  let { builderOf, SPACE } = await import('./build-door.ts')
  let response = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/press', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...KERNEL,
        [SPACE]: space!.eid,
      },
      body: JSON.stringify({ via: platform.name, press, who: who ?? null }),
    })
  )
  if (!response.ok) {
    throw new Error(
      `${platform.title} press failed: ${await response.text()}`,
    )
  }
  return await response.json() as Answer
}

// How long a voice join waits for the platform and the relay.
let JOINING = 10_000

// The relay that holds voice rooms (@yaks/discord-voice), asked to `join`
// one or `leave` one, answering `joined`, `left`, or why not.
let relayed = async (env: Env, door: 'join' | 'leave', body: unknown) => {
  if (!env.VOICE_RELAY || !env.VOICE_RELAY_KEY) {
    return 'No voice relay is set up here.'
  }
  let res = await fetch(`${env.VOICE_RELAY}/${door}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.VOICE_RELAY_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let said = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) {
    throw new Error(
      `The voice relay refused a ${door}: ${res.status} ${said.error ?? ''}`,
    )
  }
  return door == 'join' ? 'joined' : 'left'
}

/** What a Workers runtime gives an object, as much as listening uses. */
type State = {
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put(key: string, value: unknown): Promise<void>
    setAlarm(at: number): Promise<void>
    deleteAlarm(): Promise<void>
    deleteAll(): Promise<void>
  }
}

/** The object listening on one bot's socket (index.ts `Chats`): yaks.app's
 * own on a platform, named `platform:<name>`, or one a space brought, named
 * `connection:<eid>`. `listen` starts it; its alarm keeps the socket open,
 * every {@link WATCH}, for as long as the object is asked to, which for a
 * space's own bot is while its connection has a token. */
export class Listening {
  #state: State
  #env: Env
  #open: (url: string) => Promise<Socket>
  #clock: Clock
  #held?: Promise<Listener>
  // The voice rooms its bot is in, as its socket says (@yaks/chat/voice),
  // and the joins waiting on the relay, by server.
  #rooms = voiceRooms()
  #joining = new Map<string, (said: string) => void>()
  constructor(state: State, env: Env, open = upgraded, clock = system) {
    this.#state = state
    this.#env = env
    this.#open = open
    this.#clock = clock
  }
  // The bot it was asked to listen as.
  async #bot(): Promise<Bot | undefined> {
    let { storage } = this.#state
    let via = await storage.get<string>('via')
    let connection = await storage.get<string>('connection')
    return via ? { via, ...connection ? { connection } : {} } : undefined
  }
  #listener(bot: Bot) {
    return this.#held ??= this.#made(bot).catch((e) => {
      this.#held = undefined
      throw e
    })
  }
  // What the socket's events say is heard and reported in the call that
  // made the listener (defects.ts `bound`), as the tracker sees nothing
  // outside one.
  async #made(bot: Bot) {
    let env = this.#env
    let { via, connection } = bot
    let platform = PLATFORMS.get(via)
    if (!platform) throw new Error(`yaks.app hears no platform ${via}`)
    let { bound, botOf, caught, ctxOf } = await need()
    let tags = connection ? { connection } : {}
    // What it says of its servers is kept in the order said: a frame does
    // not wait for the one before it.
    let seating = Promise.resolve()
    return listener({
      platform,
      credential: connection
        ? () => botOf(ctxOf(env), connection)
        : () => platformBot(env, via),
      open: this.#open,
      clock: this.#clock,
      heard: bound(async (said: Said[]) => {
        for (let s of said) {
          await arrived(env, platform, s, bot).catch((e) =>
            caught(e, {
              request: `${via} message`,
              server: s.server ?? '',
              ...tags,
            })
          )
        }
      }),
      // yaks.app's own bot's servers are its connections' accounts, each
      // named as a space added it.
      ...connection
        ? {
          seated: bound((s: Seated) =>
            seating = seating.then(() =>
              seated(env, connection, s).catch((e) =>
                caught(e, { request: `${via} servers`, ...tags })
              )
            )
          ),
        }
        : {},
      // A button pressed on one of its messages, answered to its presser
      // alone, each press on its own: none waits for another.
      pressed: bound(async (pressed: Press[], credential: string) => {
        await Promise.all(
          pressed.map((p) =>
            pressedOn(env, platform, p, credential, bot).catch((e) =>
              caught(e, {
                request: `${via} press`,
                server: p.server ?? '',
                ...tags,
              })
            )
          ),
        )
      }),
      // Who is about, kept for each person here it is (whereabouts.ts).
      present: bound((p: Present[]) =>
        present(env, platform, p).catch((e) =>
          caught(e, { request: `${via} whereabouts`, ...tags })
        )
      ),
      // Who is in voice rooms, and where its own audio goes: what joins the
      // relay to a room and takes the bot out of one nobody is left in.
      voices: bound((v: Voice[]) =>
        this.#act(this.#rooms.voices(v)).catch((e) =>
          caught(e, { request: `${via} voice`, ...tags })
        )
      ),
      media: bound((m: Media) =>
        this.#act(this.#rooms.media(m)).catch((e) =>
          caught(e, { request: `${via} voice`, ...tags })
        )
      ),
      report: bound((e: unknown) =>
        caught(e, { request: `${via} socket`, ...tags })
      ),
    })
  }
  async listen(bot: Bot) {
    let { storage } = this.#state
    await storage.put('via', bot.via)
    if (bot.connection) await storage.put('connection', bot.connection)
    // Asked again after its platform ended the socket for good, it tries
    // again: whoever holds the bot may have mended what was refused.
    let l = await this.#listener(bot)
    let was = l.status()
    if ('ended' in was && was.ended) l.close()
    await storage.setAlarm(this.#clock.now())
    return l.status()
  }
  // What the voice rooms say to do: join or leave a room on the socket,
  // hand the relay a session, or tell it a room was let go. A join waiting
  // on the relay hears how it went.
  async #act(acts: Act[]) {
    let l = await this.#held
    for (let act of acts) {
      if ('join' in act) {
        let { server, room } = act.join
        let frame = PLATFORMS.get((await this.#bot())?.via ?? '')?.voice
          ?.join(server, room)
        if (!l?.send(frame)) throw new Error('The bot is not connected now.')
      } else if ('relay' in act) {
        let { server } = act.relay
        let done = (said: string) => {
          this.#joining.get(server)?.(said)
          this.#joining.delete(server)
        }
        done(
          await relayed(this.#env, 'join', act.relay).catch((e) => {
            done('The voice relay could not join the room.')
            throw e
          }),
        )
      } else {
        await relayed(this.#env, 'leave', { server: act.left })
        this.#joining.get(act.left)?.('left')
        this.#joining.delete(act.left)
      }
    }
  }
  /**
   * Its bot into a voice room, or out of one ({@link VoiceAsk}): answered
   * `joined` once the relay holds the room, `left` once it let it go, or
   * in words saying why not.
   */
  async voice(ask: VoiceAsk): Promise<string> {
    let bot = await this.#bot()
    let platform = PLATFORMS.get(bot?.via ?? '')
    if (!bot || !platform?.voice) return 'This bot talks in no voice room.'
    await this.#listener(bot)
    if (ask.room === null) {
      await this.#act(this.#rooms.leave(ask.server))
      return 'left'
    }
    let { room } = ask
    if (!ask.stream) return 'A join needs the stream its audio goes to.'
    let joined = new Promise<string>((resolve) => {
      this.#joining.get(ask.server)?.('asked again')
      this.#joining.set(ask.server, resolve)
      setTimeout(() => {
        if (this.#joining.get(ask.server) != resolve) return
        this.#joining.delete(ask.server)
        resolve(`${platform.title} did not let the bot into the room in time.`)
      }, JOINING)
    })
    await this.#act(this.#rooms.ask(ask.server, room, ask.stream))
    return await joined
  }
  /** The voice room of `server` that `account` is in, as its socket last
   * said; null in none. */
  async voiced(server: string, account: string): Promise<string | null> {
    let bot = await this.#bot()
    if (bot) await this.#listener(bot)
    return this.#rooms.where(server, account) ?? null
  }
  /** Stop listening and forget the bot, until it is asked to listen again. */
  async stop() {
    let held = this.#held
    this.#held = undefined
    ;(await held)?.close()
    await this.#state.storage.deleteAlarm()
    await this.#state.storage.deleteAll()
  }
  async alarm() {
    let bot = await this.#bot()
    if (!bot) return
    // A space's own bot with no token now (its connection disconnected,
    // deleted or broken) stops, until the space connects it again.
    let gone = false
    try {
      let status = await (await this.#listener(bot)).alarm()
      gone = !!bot.connection && 'waiting' in status
      return status
    } finally {
      if (gone) await this.stop()
      else await this.#state.storage.setAlarm(this.#clock.now() + WATCH)
    }
  }
}
