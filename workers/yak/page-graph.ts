// The graph one app page can use: its own store and the homes of components
// it declares as uses. A filter naming one of those components reads through
// the same composition as the agent door; other filters stay app-local.
import { asking, listed, type Row } from './listing.ts'
import { type App, appStore, directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { sandboxed } from './installed.ts'
import { answered, metaOf } from './meta.ts'
import { type Reach, read, split, vocabAt } from './reach.ts'
import { vouched, type Who } from './session.ts'
import { caught } from './sentry.ts'
import type { VocabDoc } from '@yaks/vocab'
import { mode, reads } from '@yaks/member'

export let usesOf = (env: Env, space: Space, app: App) => {
  if (sandboxed(app)) {
    return Promise.resolve({} as Record<string, string>)
  }
  return appStore(env.STORE, space, app).consume('/uses', async (r) => {
    if (!r.ok) {
      await r.body?.cancel()
      return {} as Record<string, string>
    }
    return await r.json() as Record<string, string>
  })
}

let appsAt = async (env: Env, space: Space, slugs: string[]) => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  return (await Promise.all(slugs.map((s) => dir.app(space, s))))
    .filter((a): a is App => !!a && !sandboxed(a))
}

export let sources = async (env: Env, space: Space, app: App, who: Who) => {
  let uses = await usesOf(env, space, app)
  let slugs = [...new Set(Object.values(uses))]
  let homes = (await appsAt(env, space, slugs))
    .filter((one) => reads(mode(one.access), who.role))
    .map((one) => ({ space, app: one, who }))
  return { uses, reach: [{ space, app, who }, ...homes] as Reach[] }
}

export let borrowed = async (env: Env, space: Space, app: App, who: Who) =>
  (await sources(env, space, app, who)).reach.slice(1)

export let reading = async (
  env: Env,
  { uses, reach }: Awaited<ReturnType<typeof sources>>,
  line: string,
  live = false,
): Promise<unknown> => {
  let asked = asking(line)
  let names = [...split(line).parts.keys()]
  if (names.some((name) => uses[name])) return read(env, reach, asked, live)
  let { space, app, who } = reach[0]
  let store = appStore(env.STORE, space, app, env)
  let rows = await metaOf(store, vouched(who)).query(asked, { live })
  return Array.isArray(rows) ? listed(rows as Row[], asked) : rows
}

export let queried = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  line: string,
  live = false,
) => reading(env, await sources(env, space, app, who), line, live)

// The local graph uses the store's core documents plus only the borrowed
// words declared by this app. A home may speak other words; those are not
// implicitly part of the borrower's vocabulary.
export let vocabulary = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
) => {
  let { uses, reach } = await sources(env, space, app, who)
  let store = appStore(env.STORE, space, app, env)
  let result = await store.consume(
    '/vocab.json',
    async (response) => {
      if (response.ok) return { docs: await response.json() as VocabDoc[] }
      let body = await response.text()
      let failed = new Response(body, response)
      caught(await answered(failed.clone()), {
        request: 'GET /api/vocab.json',
        space: space.slug,
        app: app.slug,
      })
      return { failed }
    },
    {},
    vouched(who),
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
