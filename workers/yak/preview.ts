// An app's private preview link (D-136180): the app as its draft stands at
// each request, the newest `written` rows over the release (written.ts),
// against a store of the link's own and never the live one. The link is the
// app's, not one draft's (`app.followed`): a deploy releases the draft and the
// link goes on serving what was released, then the next draft. Nothing here
// selects a release in the directory or opens the serving app's store for
// writing.
//
// Each state of the draft is served as a release named for the files it holds,
// built by the first request that finds it missing (`following`) and found
// again by any isolate after. A state starts from the one before the newest
// write: what that one compiled carries over, so a page script is compiled
// once per sha (esbuild.ts), and the worker, the store's vocabulary and its
// seed rows are set up again only by the write that changed them. Each write
// is told to the link's pages (`watching`); public/release.js takes it there.
import { writes } from '@yaks/member'
import { derivedEid } from '@yaks/graph/identity'
import { appTools } from './tool-grammar.ts'
import { appVocab, stated } from './vocab.ts'
import { api, unwritten, woven } from './apps.ts'
import {
  type App,
  appStore,
  directory,
  type Space,
  storeName,
} from './directory.ts'
import * as directoryPart from './directory.ts'
import { copyOf } from './directory-copy.ts'
import { caught } from './defects.ts'
import {
  bearing,
  carried,
  granted,
  type Module,
  ran,
  upload,
} from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { report } from './accessibility.ts'
import { compiled } from './esbuild.ts'
import { configured } from './deploy_worker.ts'
import { baseOf, fileBytes, inside, prefixOf } from './files.ts'
import { spaceHost } from './host.ts'
import { r2RawObjects } from './lib/objects.ts'
import { opened, seal } from './lib/token.ts'
import { countedSpend, refusedSpend } from './meter.ts'
import { filesIn, staged } from './release.ts'
import { loaded, pinned, seedy } from './seed.ts'
import { vouched, type Who } from './session.ts'
import { clock, headed } from './timing.ts'
import {
  APP,
  type Args,
  type Ctx,
  inApp,
  refuse,
  rejected,
  type Row,
  SPACE,
  str,
  worded,
} from './tool.ts'
import { CallError } from '@yaks/tools/errors'
import { addressed, BUILT, type Files, sha256 } from './versions.ts'
import {
  AGE,
  type Draft,
  drafting,
  followed,
  newest,
  overlaid,
  served,
  type Tell,
} from './written.ts'
import type { Objects } from '@yaks/blob'
import { sourceOf } from './wrangler_app.ts'
import { decodedPath } from './request-path.ts'
import { walled } from './installed.ts'

let RATE = 0.09 / 3600
let encode = (value: string) => new TextEncoder().encode(value)
let decode = (value: Uint8Array | null) =>
  value && new TextDecoder().decode(value)

// What a link names: the app's link it follows (`app.followed`), as whom.
// A ticket sealed before links outlived a deploy names it as `draft`.
type Ticket = {
  app: string
  space: string
  person: string
  link?: string
  draft?: string
}

let privateHeaders = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
}

let privateResponse = (res: Response) => {
  let headers = new Headers(res.headers)
  for (let [name, value] of Object.entries(privateHeaders)) {
    headers.set(name, value)
  }
  return walled(headed(res, headers))
}

let no = (status = 404) =>
  privateResponse(new Response('Preview unavailable', { status }))

export let viewport = (args: Args) => {
  let dimension = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    let value = args[name] ?? fallback
    if (
      !Number.isInteger(value) || Number(value) < min || Number(value) > max
    ) {
      throw refuse('arguments', `${name}: an integer from ${min} to ${max}`)
    }
    return Number(value)
  }
  return {
    width: dimension('width', 1280, 240, 2560),
    height: dimension('height', 900, 240, 2560),
    wait: dimension('wait', 1000, 0, 3000),
  }
}

let page = (value: unknown) => {
  let path = value == null ? '' : String(value).replace(/^\/+/, '')
  let parsed = new URL(path, 'https://preview.invalid/')
  if (
    parsed.origin != 'https://preview.invalid' ||
    parsed.pathname.includes('/_preview/')
  ) {
    throw refuse(
      'arguments',
      'path: a page within this app, such as about/ or details.html',
    )
  }
  return parsed.pathname.slice(1) + parsed.search + parsed.hash
}

let post = (
  store: ReturnType<typeof appStore>,
  path: string,
  value: unknown,
  who: Who,
) =>
  store.consume(
    path,
    async (res) => {
      if (!res.ok) {
        throw rejected(
          res.status,
          `preview ${path}: ${await res.text()}`,
        )
      }
      await res.arrayBuffer()
    },
    { method: 'POST', body: JSON.stringify(value) },
    {
      ...vouched(who),
      'content-type': 'application/json',
      'x-yak-kernel': '1',
    },
  )

// The app as its link serves one state of its draft: the link's own store,
// and its own dispatch script where the state has a worker.
let previewing = (
  app: App,
  link: string,
  source: string | null,
  mount: string,
  worker = false,
): App => {
  let script = worker ? `app-${app.eid}-preview-${link}` : undefined
  return {
    ...app,
    store: `preview/${link}`,
    source,
    files: `${source}/private`,
    version: null,
    declaration: '0',
    lenses: undefined,
    scope: 'store',
    script,
    worker: script ?? '',
    access: 'private',
    mount,
  }
}

// Where one state of a draft is served from: a release named for the files
// it holds, so whichever isolate built it, the next request finds it.
let stateOf = (space: Space, app: App, link: string, files: Files) =>
  `${space.store}/.releases/${app.eid}/${
    derivedEid(
      `preview|${link}|${JSON.stringify(Object.entries(files).sort())}`,
    )
  }`

// What a built state says of itself beside its index: the digest of the
// worker it uploaded, null where it has none.
let RECORD = `${BUILT}.preview.json`
type Built = { worker: string | null }
let recorded = async (raw: Objects, source: string) => {
  let files = await filesIn(raw, source)
  let bytes = files?.[RECORD] && await raw.read(addressed(files[RECORD]))
  return bytes ? JSON.parse(decode(bytes)!) as Built : null
}

let digest = async (modules: Module[], config: unknown) =>
  await sha256(encode(JSON.stringify([
    config,
    ...await Promise.all(
      modules.map(async (m) => [m.name, await sha256(m.bytes)]),
    ),
  ])))

// The files whose change sets the store up again.
let VOCAB = ['vocab.yml', 'vocab.json', 'package.json']

/**
 * Build one state of a draft for its link: stage its files, compile what the
 * state before it did not, upload its worker if that changed, give the
 * link's store the vocabulary, tools and seed rows that changed, and only
 * then write the index that makes the state found. A state with nothing
 * before it (the link's first) sets up everything.
 */
let built = async (
  ctx: Ctx,
  space: Space,
  app: App,
  link: string,
  d: Draft,
  source: string,
  mount: string,
  who: Who,
) => {
  let raw = r2RawObjects(ctx.env.BLOBS)
  let had = await recorded(raw, source)
  if (had) return { worker: !!had.worker }
  let last = newest(d.rows)[0]?.at
  let before = stateOf(
    space,
    app,
    link,
    overlaid(await served(raw, app), d.rows.filter((w) => w.at != last)),
  )
  let prev = before == source ? null : await filesIn(raw, before)
  let was = prev && await recorded(raw, before)
  let start = {
    ...d.files,
    ...Object.fromEntries(
      Object.entries(prev ?? {}).filter(([path]) => path.startsWith(BUILT)),
    ),
  }
  let files = staged(raw, start, source)
  let read = (path: string) => files.files.read(`${source}/${path}`)
  let parsed = await configured(read)
  if (parsed.refused.length) {
    throw refuse('arguments', parsed.refused.join('\n'))
  }
  // Preview code never receives the live app's D1/R2/Vectorize/DO bindings.
  // App-owned resources require a release; the graph store is isolated here.
  let resources = [
    'd1_databases',
    'r2_buckets',
    'vectorize',
    'durable_objects',
    'migrations',
  ] as const
  if (resources.some((name) => parsed.config[name] != null)) {
    throw refuse(
      'arguments',
      'Draft previews support the app graph store; remove external resource bindings from the draft to preview it',
    )
  }
  let keys = Object.keys(start)
  let made = await compiled(
    ctx,
    space,
    previewing(app, link, source, mount),
    parsed.config,
    keys,
    files.files,
    files.manifest,
  )
  let main = sourceOf(parsed.config, (path) => keys.includes(path))
  let modules = made.worker?.modules ??
    (keys.includes(main) ? await carried(read, main) : null)
  let config = { ...parsed.config, main: made.worker?.main ?? main }
  let worker = modules && await digest(modules, config)
  let candidate = previewing(app, link, source, mount, !!worker)
  let store = appStore(ctx.env.STORE, space, candidate, ctx.env)
  await post(
    store,
    '/expires',
    {
      at: Date.now() + AGE,
      script: `app-${app.eid}-preview-${link}`,
      context: { app: candidate, space },
    },
    who,
  )
  if (modules && worker != was?.worker) {
    if (!ctx.env.CF_WORKERS_TOKEN) {
      throw refuse(
        'unavailable',
        'This platform has no app worker upload credential',
      )
    }
    await upload(ctx.env, candidate.script!, modules, config)
  }
  let changed = (path: string) => !prev || prev[path] != d.files[path]
  if (VOCAB.some(changed)) {
    let vocabFile = keys.includes('vocab.yml') ? 'vocab.yml' : 'vocab.json'
    let doc = stated(
      decode(await read(vocabFile)) ?? '{}',
      vocabFile,
      decode(await read('package.json')) ?? undefined,
    )
    await post(store, '/vocab', doc, who)
    await post(
      store,
      '/tools',
      appTools(doc, appVocab(doc).comps, vocabFile),
      who,
    )
  }
  let seeds = keys.filter((path) => seedy(path) && changed(path))
  if (seeds.length) {
    let seed = loaded(
      await Promise.all(seeds.map(async (path) => ({
        path,
        text: decode(await read(path)) ?? '',
      }))),
    )
    if (seed.length) await post(store, '/apply', pinned(seed, link), who)
  }
  await files.files.put(
    `${source}/${RECORD}`,
    encode(JSON.stringify({ worker } satisfies Built)),
  )
  await files.finish()
  return { worker: !!worker }
}

// The states this isolate has found or built, so a page's assets ask once.
let states = new Map<string, Promise<{ worker: boolean }>>()
let HELD = 256

/** The app as its draft stands now, or as released where it has none, built
 * for the link where no isolate has served this state before. */
let following = async (
  ctx: Ctx,
  space: Space,
  app: App,
  link: string,
  mount: string,
  who: Who,
) => {
  let d = await drafting(r2RawObjects(ctx.env.BLOBS), ctx.dir, app)
  let source = stateOf(space, app, link, d.files)
  let state = states.get(source)
  if (!state) {
    states.set(
      source,
      state = built(ctx, space, app, link, d, source, mount, who),
    )
    state.catch(() => states.delete(source))
    for (let old of states.keys()) {
      if (states.size <= HELD) break
      states.delete(old)
    }
  }
  return previewing(app, link, source, mount, (await state).worker)
}

/** Each write to an app's draft, and each release, told to the pages of the
 * app's preview link the way a release is told to the app's (graph.ts
 * `/drafted`). A link nobody opened has no pages to hear it. */
export let watching =
  (env: Env, space: Space, app: App): Tell => async (news) => {
    try {
      await appStore(
        env.STORE,
        space,
        { ...app, store: `preview/${news.link}` },
        env,
      ).consume('/drafted', async (res) => {
        if (!res.ok) throw new Error(`draft notice: ${res.status}`)
        await res.arrayBuffer()
      }, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft: news }),
      }, { 'x-yak-kernel': '1' })
    } catch (e) {
      caught(e, { request: 'draft notice', space: space.slug, app: app.slug })
    }
  }

let preview = async (ctx: Ctx, args: Args) => {
  let view = viewport(args)
  let path = page(args.path)
  if (args.screenshot != null && typeof args.screenshot != 'boolean') {
    throw refuse('arguments', 'screenshot: true or false')
  }
  let screenshot = args.screenshot !== false
  if (!ctx.env.SESSION_SECRET) {
    throw refuse('unavailable', 'Draft previews are not configured')
  }
  let { space, app, who } = await inApp(ctx, args, true)
  if (screenshot && !ctx.env.BROWSER) {
    throw refuse(
      'unavailable',
      'Cloudflare Browser Rendering is not configured',
    )
  }
  if (screenshot) {
    let why = refusedSpend(space, 'models', ctx.env, 15 * RATE)
    if (why) throw refuse('limit', why)
  }
  let open = await followed(ctx.dir, space, app, who)
  let ticket = await seal(
    'preview',
    {
      app: app.eid,
      space: space.eid,
      person: ctx.person,
      link: open.followed!,
    } satisfies Ticket,
    ctx.env.SESSION_SECRET!,
  )
  let mount = `/${app.slug}/_preview/${ticket}/`
  await following(ctx, space, open, open.followed!, mount, who)
  let url = `https://${spaceHost(ctx.env, space.slug)}${mount}${path}`
  let value: Record<string, unknown> = {
    url,
    draft: open.draft ?? null,
    ...view,
    isolated: true,
    cost: 0,
  }
  let follows =
    'It follows the app from now on, across every app_deploy: an open page takes each write to the draft as it lands, a stylesheet in place and anything else by reloading, keeping its scroll and typed fields, and after a deploy shows what was released, then the next draft.'
  if (!screenshot) {
    return {
      text:
        `Private draft preview: ${url}\n${follows} Its test data is separate from the released app; worker calls to external services still reach those services. app_preview with screenshot: true renders it on Cloudflare.`,
      space,
      value,
    }
  }
  let { render } = await import('./browser.ts')
  let rendered = await render(
    ctx.env,
    url,
    view,
    (duration) => countedSpend(ctx.env, space, duration / 1000 * RATE, 0),
  )
  let cost = rendered.duration / 1000 * RATE
  let { image, ...diagnostics } = rendered
  Object.assign(value, diagnostics, { cost })
  return {
    text:
      `Private draft preview: ${url}\n${view.width} × ${view.height}; HTTP ${rendered.status}. ${follows} Test data is isolated; worker calls to external services still reach those services.\nConsole: ${
        JSON.stringify(rendered.console)
      }\nErrors: ${JSON.stringify(rendered.errors)}\n${
        report(rendered.accessibility)
      }\nEstimated browser cost: $${cost.toFixed(6)} from the space's budget.`,
    space,
    value,
    images: [{ data: image, mime_type: 'image/png' }],
  }
}

export let tools = [worded(
  {
    name: 'app_preview',
    destructive: false,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        path: str(
          'page relative to the app root, e.g. about/; defaults to the front page',
        ),
        width: {
          type: 'integer',
          minimum: 240,
          maximum: 2560,
          description:
            'viewport CSS pixels; 390 for a phone, 1280 for a desktop (default)',
        },
        height: {
          type: 'integer',
          minimum: 240,
          maximum: 2560,
          description: 'viewport CSS pixels; default 900',
        },
        wait: {
          type: 'integer',
          minimum: 0,
          maximum: 3000,
          description:
            'milliseconds to capture logs and render after DOMContentLoaded; default 1000',
        },
        screenshot: {
          type: 'boolean',
          description:
            'default true; false returns the private preview address without running a browser',
        },
      },
      required: ['app'],
    },
    run: preview,
  } satisfies Row,
)]

let target = async (req: Request, env: Env) => {
  let url = new URL(req.url)
  let match = /^\/([^/]+)\/_preview\/([^/]+)\/(.*)$/.exec(url.pathname)
  if (!match || !env.SESSION_SECRET) return null
  let ticket = await opened<Ticket>('preview', match[2], env.SESSION_SECRET)
  let link = ticket?.link ?? ticket?.draft
  if (!ticket || typeof link != 'string') return null
  let dir = directory(bound(env.DIRECTORY, directoryPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
  let found = await dir.target(ticket.space, ticket.person, ticket.app)
  let pair = found.space && found.app
    ? { space: found.space, app: found.app }
    : null
  let role = found.role
  if (
    !pair || pair.space.eid != ticket.space ||
    url.hostname != spaceHost(env, pair.space.slug) ||
    pair.app.slug != match[1] || pair.app.followed != link ||
    pair.app.trashed || pair.space.trashed || !writes(role)
  ) return null
  let mount = url.pathname.slice(0, url.pathname.length - match[3].length)
  let app = previewing(pair.app, link, pair.app.source ?? null, mount)
  // The ticket's writer is checked above on every callback. A directory
  // edit cannot revoke its scoped worker grant; current membership does.
  let grant = await granted(
    req,
    env.SESSION_SECRET,
    storeName(pair.space, app),
  )
  if (bearing(req) && !grant) return null
  let who: Who = grant
    ? { ...grant, role: grant.person == ticket.person ? role! : grant.role }
    : { person: ticket.person, role: role!, via: ticket.app }
  return {
    dir,
    space: pair.space,
    app: pair.app,
    person: ticket.person,
    link,
    preview: app,
    who,
    path: '/' + match[3],
    mount,
  }
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let found = await target(req, env)
  if (!found) return no()
  let { dir, space, who, path, mount } = found
  // No ambient platform login follows a preview or reaches its app code.
  let headers = new Headers(req.headers)
  headers.delete('cookie')
  headers.delete('authorization')
  req = new Request(req, { headers })
  if (path.startsWith('/api/')) {
    let at = path.slice(4)
    if (
      ![
        '/client.js',
        '/storage.js',
        '/_draft.js',
        '/_outbox.js',
        '/_wire.js',
        '/me',
        '/graph',
        '/query',
        '/apply',
        '/ws',
        '/vocab',
        '/vocab.json',
      ].includes(at)
    ) return no()
    return privateResponse(
      await api(req, env, dir, space, found.preview, at, who, clock(), mount),
    )
  }
  let decoded = decodedPath(path)
  if (!decoded || inside(decoded)) return no()
  let app: App
  try {
    app = await following(
      { env, dir, person: found.person },
      space,
      found.app,
      found.link,
      mount,
      who,
    )
  } catch (e) {
    // What stops a state being built is the draft's to fix, said where the
    // person watching it will read it.
    if (!(e instanceof CallError)) throw e
    return privateResponse(
      new Response(`This draft does not build: ${e.message}`, { status: 409 }),
    )
  }
  let worker = bearing(req) ? null : await ran(env, space, app, req, who)
  let res = worker ??
    await fileBytes(
      env,
      app.eid,
      prefixOf(space, app),
      path,
      app.source!,
      null,
      req.method,
    )
  if (!worker && res.status == 404) {
    let generated = await unwritten(req, env, app, path, mount)
    if (generated) {
      await res.body?.cancel()
      res = generated
    }
  }
  if (
    res.status == 200 &&
    res.headers.get('content-type')?.startsWith('text/html')
  ) {
    let html = await woven(
      env,
      await res.text(),
      mount,
      mount,
      { ...app, source: null },
      '',
      { badge: null, draft: found.link },
      baseOf(mount, res.headers.get('x-yak-file') ?? decoded.slice(1), false),
    )
    return privateResponse(
      new Response(req.method == 'HEAD' ? null : encode(html), {
        status: res.status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
  }
  return privateResponse(new Response(res.body, res))
}
