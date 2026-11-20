// yaks.app's chat platforms (D-465): the platforms it loads, as data
// (@yaks/chat, @yaks/discord); the chatters the Operator's store posts its
// answers through; the object that listens on yaks.app's own bot's socket;
// and where a message it hears goes. Nothing here names a platform but the
// list it loads.
//
// A space connects a chat integration (`integration.chat`) and that is the
// whole setup: yaks.app's own bot added to a server is a connection the
// space owns, its account the server's id. A message said there that is
// addressed to the bot (a mention, a reply to it, a direct message) is the
// next words of its writer's conversation with that space's Operator: their
// own when their platform account is linked to a person here (the
// platform's `user` integration), else a guest's, who has no seat and so
// only what the space lets anyone do.
//
// Every message heard in a server is also kept in each app of the space
// that `uses` the connection, as @yaks/chat's rows, for the app's own rules
// to take up. An app holds no bot: a message it writes to a room is posted
// by its connection's, and only into that connection's server
// (`appChatters`).

import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { line } from '@yaks/query'
import { confined, kept, type Platform, platforms, type Said } from '@yaks/chat'
import { type Listener, listener, type Socket, WATCH } from '@yaks/chat/listen'
import { discord } from '@yaks/discord'
import type { Chatter } from '@yaks/host/senders'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'

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

/** The chat platforms yaks.app hears and answers on, by name. */
export let PLATFORMS: Map<string, Platform> = platforms([discord])

/** The objects listening on chat platforms' sockets (index.ts `Chats`), one
 * per bot: `platform:<name>` for yaks.app's own. */
export type Chats = {
  idFromName(name: string): unknown
  get(id: unknown): { listen(via: string): Promise<unknown> }
}

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
 * {@link confined} to the server of a connection that `at()`'s space owns,
 * the app `uses`, and that chats on that platform, connected. So an app's
 * row reaches only rooms of its own connection's server. */
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
          if (!space || !app) return undefined
          let { usedBy, installed, ctxOf } = await need()
          let c = comp(
            await usedBy(env, space, app, connection) ?? undefined,
            CONNECTION,
          )
          if (c.status != 'connected' || !c.account) return undefined
          let i = (await installed(ctxOf(env).graph.read))
            .find((i) => i.name == c.integration)
          return i?.chat == p.name ? String(c.account) : undefined
        },
        server: async ({ connection, room }) =>
          p.server!(await speaker(env, p, connection), room),
      }),
    ]),
  )
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

/** Ask yaks.app's own bot on `via` to listen: what connecting a space to it
 * does, and harmless when it already is. */
export let listen = async (env: Env, via: string) => {
  if (!env.CHATS || !PLATFORMS.get(via)?.socket) return
  await env.CHATS.get(env.CHATS.idFromName(`platform:${via}`)).listen(via)
}

/** After a space connects an integration: if it chats, its platform's bot
 * listens (connections.ts `callback`). */
export let connected = async (env: Env, connection: string) => {
  let [b] = await read(
    env,
    line`.entity.eid=${connection}&.${CONNECTION}&*`,
  )
  let name = String(comp(b, CONNECTION).integration ?? '')
  let { ctxOf, installed, keyed } = await need()
  let i = (await installed(ctxOf(env).graph.read)).find((i) => i.name == name)
  if (i?.chat && !keyed(i)) await listen(env, i.chat)
}

// The connected connections through which a space added yaks.app's own bot
// to `server`.
let serving = async (env: Env, via: string, server: string) => {
  let names = new Set((await ours(env, via)).map((i) => i.name))
  return (await read(
    env,
    line`.${CONNECTION}.account=${server}&.${CONNECTION}.status=connected&*`,
  )).filter((b) => names.has(String(comp(b, CONNECTION).integration)))
}

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
 * yaks.app keeps: the integration that adds that bot, and the one a person
 * links their account there with (operator-page.ts `chatCard`), known from
 * this build's seeds, so the page asks the directory nothing more. Before the
 * bot is kept there is nothing to add. */
export let offers = async (env: Env) => {
  let { keyed, seeds } = await need()
  let all = seeds()
  let each = await Promise.all(
    [...PLATFORMS.values()].map(async (platform) => ({
      platform,
      bot: all.find((i) => i.chat == platform.name && !keyed(i))!,
      user: all.find((i) => i.name == platform.user),
      kept: !!await platformBot(env, platform.name),
    })),
  )
  return each.filter((o) => o.bot && o.kept)
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
 * A message yaks.app's own bot heard on `platform`. One said in a server is
 * kept in each app that uses a connection that added the bot there
 * ({@link toApps}). One addressed to the bot in a server goes to the
 * Operator of the space that added it there; a direct one, from someone
 * linked here, to their own space's. Anything else is not for the
 * Operator: a room the space chose for it to hear in full is T-1644's next
 * step.
 */
export let arrived = async (env: Env, platform: Platform, said: Said) => {
  let heard = said.server ? await serving(env, platform.name, said.server) : []
  await Promise.all(heard.map((c) => toApps(env, platform, said, c)))
  if (!said.addressed) return
  let { directoryOf, KERNEL } = await need()
  let dir = directoryOf(env.STORE)
  let person = await linked(env, platform, said.author.id)
  let space: Space | null = null
  let connection: string | undefined
  if (said.server) {
    let [c] = heard
    if (!c) return
    connection = c.entity.eid
    space = await dir.at(String(comp(c, CONNECTION).owner))
  } else if (person) {
    let { spaceFor } = await import('./operator-texts.ts')
    space = await spaceFor(env, person)
    let names = new Set((await ours(env, platform.name)).map((i) => i.name))
    let [c] = space
      ? (await read(
        env,
        line`.${CONNECTION}.owner=${space.eid}&.${CONNECTION}.status=connected&*`,
      )).filter((b) => names.has(String(comp(b, CONNECTION).integration)))
      : []
    connection = c?.entity.eid
  }
  if (!space || space.trashed || !connection) return
  person ??= await guestOf(env, platform.name, said.author.id)
  let { builderOf, SPACE } = await import('./build-door.ts')
  let response = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...KERNEL,
        'x-yak-person': person!,
        [SPACE]: space!.eid,
      },
      body: JSON.stringify({ via: platform.name, connection, said }),
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
 * own bot on a platform, named `platform:<name>`. `listen` starts it; its
 * alarm keeps the socket open, every {@link WATCH}, for as long as the
 * object is asked to. */
export class Listening {
  #state: State
  #env: Env
  #held?: Listener
  constructor(state: State, env: Env) {
    this.#state = state
    this.#env = env
  }
  #listener(via: string) {
    let platform = PLATFORMS.get(via)
    if (!platform) throw new Error(`yaks.app hears no platform ${via}`)
    return this.#held ??= listener({
      platform,
      credential: () => platformBot(this.#env, via),
      open: opened,
      heard: async (said) => {
        let { caught } = await need()
        for (let s of said) {
          await arrived(this.#env, platform, s).catch((e) =>
            caught(e, { request: `${via} message`, server: s.server ?? '' })
          )
        }
      },
      report: (e) =>
        void need().then(({ caught }) =>
          caught(e, { request: `${via} socket` })
        ),
    })
  }
  async listen(via: string) {
    await this.#state.storage.put('via', via)
    await this.#state.storage.setAlarm(Date.now())
    return this.#listener(via).status()
  }
  async alarm() {
    let via = await this.#state.storage.get<string>('via')
    if (!via) return
    try {
      return await this.#listener(via).alarm()
    } finally {
      await this.#state.storage.setAlarm(Date.now() + WATCH)
    }
  }
}
