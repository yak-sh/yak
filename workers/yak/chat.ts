// yaks.app's chat platforms (D-465): the platforms it loads, as data
// (@yaks/chat, @yaks/discord); the chatters the Operator's store posts its
// answers through; the objects that listen on each bot's socket; and where a
// message a bot hears goes. Nothing here names a platform but the list it
// loads.
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

import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { line } from '@yaks/query'
import {
  confined,
  kept,
  type Page,
  type Platform,
  platforms,
  type Room,
  roomEid,
  type Said,
  type Seated,
  within,
} from '@yaks/chat'
import { type Listener, listener, type Socket, WATCH } from '@yaks/chat/listen'
import { discord } from '@yaks/discord'
import type { Chatter } from '@yaks/host/senders'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import type { chatRows } from './connections.ts'

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
export let PLATFORMS: Map<string, Platform> = platforms([discord])

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
  ): { listen(bot: Bot): Promise<unknown>; stop(): Promise<void> }
}

let listening = (chats: Chats, bot: Bot) =>
  chats.get(chats.idFromName(
    bot.connection ? `connection:${bot.connection}` : `platform:${bot.via}`,
  ))

// The credential of the bot that speaks on `p` for `connection`
// (@yaks/connections `botOf`).
let speaker = async (env: Env, p: Platform, connection: string) => {
  let { botOf, ctxOf } = await need()
  let token = await botOf(ctxOf(env), connection)
  if (!token) {
    throw new Error(
      `No ${p.title} bot speaks for this connection now: connect ${p.title} again.`,
    )
  }
  return token
}

/** The chatters the Operator's store posts its answers through, one per
 * platform: each posts with the bot that speaks for the answer's connection
 * (@yaks/connections `botOf`), and shows a room it is working on an answer
 * where its platform can. */
export let chatters = (env: Env): Record<string, Chatter> =>
  Object.fromEntries(
    [...PLATFORMS.values()].map((p) => {
      let { working } = p
      return [
        p.name,
        {
          post: async (chat) =>
            p.send(await speaker(env, p, chat.connection), chat),
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
 * platform that says which server a room is in: the Operator's,
 * {@link confined} to the servers of a connection that `at()`'s space owns,
 * the app `uses`, and that chats on that platform, connected
 * ({@link serves}). So an app's row reaches only rooms of its own
 * connection's servers. */
export let appChatters = (
  env: Env,
  at: () => { space?: string | null; app?: string | null },
): Record<string, Chatter> => {
  let all = chatters(env)
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
 * The messages of `at.room` said before `page.before`, oldest first, read by
 * the bot that speaks for `at.connection` ({@link Platform.recent}), each
 * naming the room's server, and only in a server that connection serves
 * ({@link serves}, @yaks/chat `within`): what the Operator reads of a room
 * it was addressed in. `at.server` is where the room is as its bot heard it;
 * none asks the platform. A platform that keeps no messages reads none.
 */
export let recent = async (
  env: Env,
  via: string,
  at: { connection: string; room: string; server?: string },
  page: Page,
) => {
  let p = PLATFORMS.get(via)
  if (!p?.recent) return []
  let [c] = await read(env, line`.entity.eid=${at.connection}&.${CONNECTION}&*`)
  let held = comp(c, CONNECTION).status == 'connected' ? serves(c) : []
  let token = held.length ? await speaker(env, p, at.connection) : ''
  let server = await within(
    at,
    held,
    async () => at.server ?? await p.server?.(token, at.room),
  )
  return (await p.recent(token, at.room, page)).map((s) => ({ ...s, server }))
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

/** Ask `bot` to listen: what connecting a space to it does, and harmless
 * when it already is. */
export let listen = async (env: Env, bot: Bot) => {
  if (!env.CHATS || !PLATFORMS.get(bot.via)?.socket) return
  await listening(env.CHATS, bot).listen(bot)
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
 * ends, so a server moves from one space's Operator to another's whole. */
export let connected = async (env: Env, connection: string) => {
  let bot = await botFor(env, connection)
  if (!bot) return
  if (!bot.connection) {
    let [c] = await read(env, line`.entity.eid=${connection}&.${CONNECTION}&*`)
    let { account } = comp(c, CONNECTION)
    let others = account
      ? (await serving(env, bot.via, String(account)))
        .filter((o) => o.entity.eid != connection)
      : []
    let { ended } = await need()
    for (let o of others) await ended(env, o.entity.eid)
  }
  await listen(env, bot)
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
// connection (`chat_serves`), written only when it changed.
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
  if (now.join() == had.join() && comp(c, SERVES).servers) return
  let { KERNEL, meta } = await need()
  await meta(env).apply(
    [{ entity: { eid: connection }, [SERVES]: { servers: now } }],
    KERNEL,
  )
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

// Those a space holds.
let held = (env: Env, via: string, space: string) =>
  through(env, via, line`.${CONNECTION}.owner=${space}`)

/** The person here whose `platform.user` account is `id`, if one linked it:
 * a connection they hold, or one a space holds, which stands for its owner
 * as the Operator's own Google does (connections.ts `ownConnection`) when it
 * has exactly one. */
export let linked = async (env: Env, platform: Platform, id: string) => {
  if (!platform.user) return undefined
  let [b] = await read(
    env,
    line`.${CONNECTION}.integration=${platform.user}&.${CONNECTION}.account=${id}&.${CONNECTION}.status=connected&*`,
  )
  let owner = comp(b, CONNECTION).owner
  if (!owner) return undefined
  let { directoryOf } = await need()
  let dir = directoryOf(env.STORE)
  let space = await dir.at(String(owner))
  if (!space) return String(owner)
  let owners = await dir.owners(space)
  return owners.length == 1 ? owners[0] : undefined
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
        kept: !!await platformBot(env, platform.name),
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
  rooms: (Room & { eid: string })[] | null
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
  if (!rooms) return []
  let { botFrom, caught, ctxOf, keyed } = await need()
  let ctx = ctxOf(env)
  return await Promise.all(
    connections.filter(({ integration }) => integration.chat == platform.name)
      .sort((a, b) =>
        Number(keyed(a.integration)) - Number(keyed(b.integration))
      )
      .map(async ({ row: c, integration }) => {
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
    [HEARS]: room ? { room: roomEid(via, room) } : null,
  }])
}

/** The guest who speaks as `id` on `via`: a person with no seat and no
 * address, minted the first time they speak, as a stranger's number is
 * (operator-texts.ts `phonedIn`); or who stands for a group text's thread
 * (operator-texts.ts `textedOperator`). */
export let guestOf = async (env: Env, via: string, id: string) => {
  let person = derivedEid(`chatted|${via}|${id}`)
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
 * conversation of a guest who stands for the room, so a turn there has only
 * what the space lets anyone do, whoever in it is a member, and the words are
 * kept as their writer's. Elsewhere, one addressed to the bot goes to its
 * writer's own conversation with that Operator; a direct one to yaks.app's
 * own, from someone linked here, to their own space's. Anything else is not
 * for the Operator.
 */
export let arrived = async (
  env: Env,
  platform: Platform,
  said: Said,
  bot: Bot = { via: platform.name },
) => {
  let heard = bot.connection
    ? await read(
      env,
      line`.entity.eid=${bot.connection}&.${CONNECTION}.status=connected&*`,
    )
    : said.server
    ? await serving(env, platform.name, said.server)
    : []
  if (said.server) {
    await Promise.all(heard.map((c) => toApps(env, platform, said, c)))
  }
  let { directoryOf, KERNEL } = await need()
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
    if (!room && !said.addressed) return
    connection = c.entity.eid
    space = await dir.at(String(comp(c, CONNECTION).owner))
  } else if (said.addressed) {
    let person = await author()
    let { spaceFor } = await import('./operator-texts.ts')
    space = person ? await spaceFor(env, person) : null
    connection = space
      ? (await held(env, platform.name, space.eid))[0]?.entity.eid
      : undefined
  }
  if (!space || space.trashed || !connection) return
  let writer = await author() ??
    await guestOf(env, platform.name, said.author.id)
  let person = room
    ? await guestOf(env, platform.name, `room:${said.room}`)
    : writer
  let { builderOf, SPACE } = await import('./build-door.ts')
  let response = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...KERNEL,
        'x-yak-person': person,
        [SPACE]: space!.eid,
      },
      body: JSON.stringify({
        via: platform.name,
        connection,
        said,
        ...room ? { writer } : {},
      }),
    })
  )
  if (!response.ok) {
    throw new Error(
      `${platform.title} message intake failed: ${await response.text()}`,
    )
  }
  await response.body?.cancel()
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

/** A socket at a `wss://` address, opened the way a Worker opens one: an
 * upgrade asked of its `https://` twin. */
let opened = async (url: string): Promise<Socket> => {
  let res = await fetch(url.replace(/^wss:/, 'https:'), {
    headers: { upgrade: 'websocket' },
  })
  // A Worker's socket, which is accepted before it is used.
  let ws = (res as Response & { webSocket?: Socket & { accept(): void } })
    .webSocket
  if (!ws) throw new Error(`${url} did not open a socket: ${res.status}`)
  ws.accept()
  return ws
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
  #held?: Promise<Listener>
  constructor(state: State, env: Env, open = opened) {
    this.#state = state
    this.#env = env
    this.#open = open
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
    await storage.setAlarm(Date.now())
    return l.status()
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
      else await this.#state.storage.setAlarm(Date.now() + WATCH)
    }
  }
}
