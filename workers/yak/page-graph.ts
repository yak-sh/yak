// The graph one app page can use: its own store and the homes of components
// it declares as uses. A filter naming one of those components reads through
// the same composition as the agent door; other filters stay app-local.
import { listed, type Row } from './listing.ts'
import { type App, appStore, directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { copyOf } from './directory-copy.ts'
import { type Door, USES } from './door.ts'
import { bound, type Env } from './env.ts'
import { sandboxed } from './installed.ts'
import { answered, answeredBody, metaOf } from './meta.ts'
import { borrows, type Reach, read, vocabAt } from './reach.ts'
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
    return read(
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
    await metaOf(store, headers).query(line, { live, listing: true }),
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
  caught(answeredBody(response.status, body), tags)
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
      let doc = await vocabAt(env, space, home)
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
