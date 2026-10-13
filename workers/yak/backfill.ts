// One-time (T-123629): every release deployed before T-65378 is given the
// declaration snapshot its deploy would have kept (declaration.ts
// `keepDeclaration`), so `declarationOf` reads one shape and its file-only
// reconstruction can go. Deleted with that reconstruction once the platform
// run finds nothing missing.
//
//   GET  /api/declarations                     every space, trashed ones too
//   POST /api/declarations?space=<slug>        that space's missing snapshots
//                                              written; `&rehearse=1` writes
//                                              nothing and compares what each
//                                              Store serves with discovery's
//                                              reconstruction
//
// A space's snapshots are computed together before any is written: the
// reconstruction homes words in app order and reads a sibling's snapshot where
// one exists. Trashed apps are included, since a restore puts their pointer
// back without a deploy. Both read each live app's Store; neither writes to a
// Store or an app file.
import {
  type App,
  appStore,
  directory,
  releaseOf,
  type Space,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { adminWho } from './identity.ts'
import { r2RawObjects } from './lib/objects.ts'
import {
  type Declaration,
  keepDeclaration,
  key,
  legacy,
} from './declaration.ts'
import { readTools } from './tool-grammar.ts'

export let PATH = '/api/declarations'

/** One app's line: whether its serving release had a snapshot, and what the
 * backfill made of it. */
export type Backfilled = {
  app: string
  trashed: boolean
  release: string
  had: boolean
  wrote: boolean
  store?: string | { vocab: Differ; tools: Differ }
}

/** Each name whose value differs: the Store's, and the reconstruction's. */
type Differ = Record<string, { store: unknown; built: unknown }>

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

// Key order is not meaning: compare values with their keys sorted.
let canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v == 'object'
    ? Object.fromEntries(
      Object.keys(v).sort().map((k) => [
        k,
        canonical((v as Record<string, unknown>)[k]),
      ]),
    )
    : v

let differing = (
  store: Record<string, unknown>,
  built: Record<string, unknown>,
): Differ =>
  Object.fromEntries(
    [...new Set([...Object.keys(store), ...Object.keys(built)])].sort()
      .filter((name) =>
        JSON.stringify(canonical(store[name])) !=
          JSON.stringify(canonical(built[name]))
      )
      .map((name) => [name, { store: store[name], built: built[name] }]),
  )

// What the Store serves for the release, read the way readers read it before
// T-65378, or why it did not answer. A trashed app's Store is asleep.
let served = async (
  env: Env,
  space: Space,
  app: App,
): Promise<Declaration | string> => {
  if (app.trashed || space.trashed) return 'unread'
  let read = (path: string) =>
    appStore(env.STORE, space, app).consume(
      path,
      async (r) =>
        r.ok ? await r.text() : `unread ${r.status}: ${await r.text()}`,
    )
  let [vocab, tools] = await Promise.all([read('/vocab'), read('/tools')])
  for (let said of [vocab, tools]) if (said.startsWith('unread')) return said
  return { vocab: JSON.parse(vocab), tools: readTools(tools) }
}

let compared = (store: Declaration | string, built: Declaration) => {
  if (typeof store == 'string') return store
  let diff = {
    vocab: differing(store.vocab.$defs ?? {}, built.vocab.$defs ?? {}),
    tools: differing(store.tools, built.tools),
  }
  return Object.keys(diff.vocab).length || Object.keys(diff.tools).length
    ? diff
    : 'same'
}

// The snapshot: the words the Store accepted, which only it knows (a retired
// column it emptied, a word whose home it took over), and the commands
// discovery serves today, the release's manifest through today's generator,
// so no command a caller now sees goes away. An asleep Store leaves the
// reconstruction whole.
let snapshot = (store: Declaration | string, built: Declaration) =>
  typeof store == 'string' ? built : { vocab: store.vocab, tools: built.tools }

export let backfill = async (
  env: Env,
  space: Space,
  rehearse: boolean,
): Promise<Backfilled[]> => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let blobs = r2RawObjects(env.BLOBS)
  let kept = new Set(await blobs.list(`${space.slug}/.declarations/`))
  let apps = (await dir.apps(space)).filter((app) => releaseOf(app) != '0')
  let missing = apps.filter((app) => !kept.has(key(space, app, releaseOf(app))))
  let built = await Promise.all(missing.map((app) => legacy(env, space, app)))
  let out: Backfilled[] = apps.filter((app) => !missing.includes(app)).map((
    app,
  ) => ({
    app: app.slug,
    trashed: !!app.trashed,
    release: releaseOf(app),
    had: true,
    wrote: false,
  }))
  let stores = await Promise.all(missing.map((app) => served(env, space, app)))
  let writes: Promise<void>[] = []
  for (let [i, app] of missing.entries()) {
    let store = stores[i]
    // A live Store that did not answer is reported, never guessed at.
    let failed = typeof store == 'string' && store != 'unread'
    let wrote = !rehearse && !failed
    if (wrote) {
      writes.push(
        keepDeclaration(
          env,
          space,
          app,
          releaseOf(app),
          snapshot(store, built[i]),
        ),
      )
    }
    out.push({
      app: app.slug,
      trashed: !!app.trashed,
      release: releaseOf(app),
      had: false,
      wrote,
      ...rehearse || failed ? { store: compared(store, built[i]) } : {},
    })
  }
  await Promise.all(writes)
  return out
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let meta = await dir.space(dirPart.META.space)
  if (!meta) return json(503, 'no_platform', 'the directory has not seeded yet')
  let url = new URL(req.url)
  let slug = url.searchParams.get('space')
  let space = slug
    ? (await dir.all()).find((one) => one.slug == slug) ?? null
    : null
  if (slug && !space) return json(404, 'no_space', `no space is named ${slug}`)
  // The platform's owner may backfill any space; a space's owner their own.
  let who = await adminWho(
    env,
    req,
    async (person) =>
      await dir.role(meta, person) == 'owner'
        ? 'owner'
        : space
        ? await dir.role(space, person)
        : null,
  )
  if (who.role != 'owner') {
    return json(403, 'not_owner', "a backfill is an owner's")
  }
  if (req.method == 'GET') {
    return Response.json((await dir.all()).map((one) => one.slug))
  }
  if (req.method != 'POST' || !space) {
    return json(405, 'method_not_allowed', 'list the spaces, or post to one')
  }
  return Response.json(
    await backfill(env, space, url.searchParams.get('rehearse') == '1'),
  )
}
