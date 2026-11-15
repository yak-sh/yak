// The graph one app page can use: its own store and the homes of components
// it declares as uses. A filter naming one of those components reads through
// the same composition as the agent door; other filters stay app-local.
import { attach, type Frame, type Socket } from '@yaks/api'
import { reached } from '@yaks/api/reached'
import type { Bundle, Reduced } from '@yaks/graph'
import { listed, type Row } from '@yaks/platform/listing'
import { stringify } from '@yaks/vocab/wire'
import { workerUpgrade } from '@yaks/workerd'
import { mistaken } from './mistake.ts'
import { noted, serving } from './unseen.ts'
import { type App, appStore, directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { copyOf } from './directory-copy.ts'
import { USES } from './door.ts'
import { type Door } from '@yaks/durable-object/door'
import { bound, type Env } from './env.ts'
import { sandboxed } from '@yaks/platform/installs'
import { answered, answeredBody, metaOf } from './meta.ts'
import { borrows } from '@yaks/reach'
import type { Reach } from './reach.ts'
import { vouched, type Who } from './session.ts'
import { caught } from './defects.ts'
import type { VocabDoc } from '@yaks/vocab'
import { mode, reads } from '@yaks/member'

export let local = (app: App) => app.scope == 'store' || sandboxed(app)

let usesAnswer = async (r: Response) => {
  if (!r.ok) {
    await r.body?.cancel()
    return {} as Record<string, string>
  }
  return await r.json() as Record<string, string>
}

export let usesOf = (env: Env, space: Space, app: App) => {
  if (local(app)) {
    return Promise.resolve({} as Record<string, string>)
  }
  return appStore(env.STORE, space, app).consume('/uses', usesAnswer)
}

let appsAt = async (env: Env, space: Space, slugs: string[]) => {
  if (!slugs.length) return []
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
  return (await Promise.all(slugs.map((s) => dir.app(space, s))))
    .filter((a): a is App => !!a && !sandboxed(a))
}

// The stores a page's graph is read from: its own, then the home of each
// word it uses that the caller may read.
export let homed = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  uses: Record<string, string>,
  headers: Record<string, string> = {},
) => {
  if (local(app)) {
    return { uses: {}, reach: [{ space, app, who, headers }] as Reach[] }
  }
  let slugs = [...new Set(Object.values(uses))]
  let homes = (await appsAt(env, space, slugs))
    .filter((one) => reads(mode(one.access), who.role))
    .map((one) => ({ space, app: one, who }))
  return { uses, reach: [{ space, app, who, headers }, ...homes] as Reach[] }
}

export let sources = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  headers: Record<string, string> = {},
) => homed(env, space, app, who, await usesOf(env, space, app), headers)

export let borrowed = async (env: Env, space: Space, app: App, who: Who) =>
  (await sources(env, space, app, who)).reach.slice(1)

let shown = (rows: unknown, line: string) =>
  Array.isArray(rows) ? listed(rows as Row[], line) : rows

export let reading = async (
  env: Env,
  { uses, reach }: Awaited<ReturnType<typeof sources>>,
  line: string,
  live = false,
  headers: Record<string, string> = {},
): Promise<unknown> => {
  if (borrows(line, uses)) {
    return (await import('./reach.ts')).read(
      env,
      reach.map((r, i) =>
        i == 0 ? { ...r, headers: { ...r.headers, ...headers } } : r
      ),
      line,
      live,
    )
  }
  let { space, app, who } = reach[0]
  let store = appStore(env.STORE, space, app, env)
  let rows = await metaOf(store, { ...vouched(who), ...headers }).query(line, {
    live,
    listing: true,
    names: true,
  })
  return shown(rows, line)
}

// A page's query costs one round trip to its own store: the store answers a
// line of its own words and says beside it which words the app uses
// (graph.ts `#paged`), so a line naming one comes back unanswered and is
// composed from the store and those homes. A store still on the code before
// that says nothing, and is asked the way it was then.
export let queryFrom = async (
  store: Door,
  line: string,
  borrowed: (uses: Record<string, string>) => Promise<unknown>,
  { local = false, live = false, headers = {} }: {
    local?: boolean
    live?: boolean
    headers?: Record<string, string>
  } = {},
) => {
  let heard = local ? null : await store.consume(
    `/query?q=${encodeURIComponent(line)}${
      live ? '&live=1' : ''
    }&listing=1&uses=1`,
    async (r) => {
      let said = r.headers.get(USES)
      if (said == null) return void await r.body?.cancel()
      if (r.status == 204) {
        return { uses: JSON.parse(said) as Record<string, string> }
      }
      if (!r.ok) throw await answered(r)
      return { rows: await r.json() as unknown }
    },
    {},
    headers,
  )
  if (heard && 'rows' in heard) return shown(heard.rows, line)
  let uses = heard
    ? heard.uses
    : local
    ? {}
    : await store.consume('/uses', usesAnswer)
  if (borrows(line, uses)) return borrowed(uses)
  return shown(
    await metaOf(store, headers).query(line, {
      live,
      listing: true,
      names: true,
    }),
    line,
  )
}

export let queried = (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  line: string,
  live = false,
  headers: Record<string, string> = {},
) =>
  queryFrom(
    appStore(env.STORE, space, app, env),
    line,
    async (uses) =>
      reading(
        env,
        await homed(env, space, app, who, uses),
        line,
        live,
        headers,
      ),
    { local: local(app), live, headers: { ...vouched(who), ...headers } },
  )

export let vocabularyAnswer = async (
  response: Response,
  tags: Record<string, string>,
) => {
  if (response.ok) return { docs: await response.json() as VocabDoc[] }
  let body = await response.text()
  caught(answeredBody(response, body), tags)
  return { failed: new Response(body, response) }
}

// The local graph uses the store's core documents plus only the borrowed
// words declared by this app. A home may speak other words; those are not
// implicitly part of the borrower's vocabulary.
export let vocabulary = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  headers: Record<string, string> = {},
) => {
  let { uses, reach } = await sources(env, space, app, who)
  let store = appStore(env.STORE, space, app, env)
  let result = await store.consume(
    '/vocab.json',
    (response) =>
      vocabularyAnswer(response, {
        request: 'GET /api/vocab.json',
        space: space.slug,
        app: app.slug,
      }),
    {},
    { ...vouched(who), ...headers },
  )
  if (result.failed) return result.failed
  let docs = result.docs!
  let borrowed = await Promise.all(
    reach.slice(1).map(async ({ app: home }) => {
      let doc = await (await import('./reach.ts')).vocabAt(env, space, home)
      let defs = Object.fromEntries(
        Object.entries(doc.$defs ?? {}).filter(([name]) =>
          uses[name] == home.slug
        ),
      )
      return { title: home.slug, $defs: defs } as VocabDoc
    }),
  )
  return Response.json([
    ...docs,
    ...borrowed.filter((doc) => Object.keys(doc.$defs!).length),
  ])
}

// A store's side of a page's socket: what its `/ws` answers when a page asks
// as `who`, opened and accepted, or null when the store answers no socket.
type Link = Socket & { accept(): void; close(): void }

let linked = async (
  req: Request,
  env: Env,
  { space, app, who }: Reach,
  headers: Record<string, string>,
): Promise<Link | null> => {
  let res = await appStore(env.STORE, space, app, env)(
    '/ws',
    req,
    { ...vouched(who), ...headers },
  ) as Response & { webSocket?: Link | null }
  if (res.status != 101 || !res.webSocket) {
    await res.body?.cancel()
    return null
  }
  let link = res.webSocket
  await new Promise<void>((resolve, reject) => {
    link.addEventListener('open', () => resolve())
    link.addEventListener(
      'error',
      () => reject(new Error('store socket failed')),
    )
    link.addEventListener(
      'close',
      () => reject(new Error('store socket closed')),
    )
    link.accept()
    if (link.readyState == 1) resolve()
  })
  return link
}

// A page's socket over every store its graph reads (@yaks/api/reached): one
// link to each store's raw feed, and each frame on any of them asks the page's
// queries again through `reading`, where ownership and composition live. The
// app store's own frames are the raw feed, its release notices go to the page
// as they came, outside any ack, and a relayed value goes to it to hold. A
// lost link closes the page's socket, so its client reconnects and refills.
export let listened = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  graph: Awaited<ReturnType<typeof sources>>,
  headers: Record<string, string> = {},
) => {
  let links: (Link | null)[] = []
  try {
    for (let [i, r] of graph.reach.entries()) {
      links.push(await linked(req, env, r, i == 0 ? headers : {}))
    }
    if (!links[0]) throw new Error('app socket unavailable')
  } catch (error) {
    for (let link of links) link?.close()
    throw error
  }
  let { socket, response } = workerUpgrade(req)
  let page = socket as Link
  let tags = { space: space.slug, app: app.slug }
  // A watch the page's code got wrong is the app's break, as its store files
  // one (graph.ts `#mistook`): once for this socket, though every change
  // asks it again.
  let filed = new Set<string>()
  let subs = reached({
    read: (line) =>
      reading(env, graph, line, false, headers) as Promise<Bundle[] | Reduced>,
    relay: (bundles) => links[0]?.send(stringify({ relay: bundles })),
    refused: (error, line) => {
      if (filed.has(line)) return
      filed.add(line)
      mistaken(req, error, 'query', {
        version: () => serving(env, space, app),
        note: (report) =>
          noted({ ...report, request: `subscribe ${line}` }, {
            env,
            space,
            app,
            request: req,
            entrypoint: 'subscribe',
          }),
      }).catch((why) =>
        caught(why, { request: 'report subscribe failure', ...tags })
      )
    },
    tags,
  })
  let closed = false
  let close = () => {
    if (closed) return
    closed = true
    for (let link of links) link?.close()
    page.close()
  }
  for (let [i, link] of links.entries()) {
    if (!link) continue
    link.addEventListener('message', (e) => {
      let frame: Frame & { release?: unknown }
      try {
        frame = JSON.parse(String(e.data))
      } catch (error) {
        return caught(error, { request: 'page source', ...tags })
      }
      // A home changing must not offer to reload the page borrowing its words.
      if (frame.release) return void (i == 0 && page.send(String(e.data)))
      if (frame.refused) return close()
      subs.hear(frame, i == 0)
    })
    link.addEventListener('close', close)
    link.send(JSON.stringify({ subscribe: true, id: 'page' }))
  }
  attach(subs, page)
  page.addEventListener('close', close)
  return response
}
