// A private draft has its own files, store and worker. Nothing here selects
// a release in the directory or opens the serving app's store for writing.
import { writes } from '@yaks/member'
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
import { copyOf, signedDirectory } from './directory-copy.ts'
import { bearing, carried, granted, ran, upload } from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { report } from './accessibility.ts'
import { compiled } from './esbuild.ts'
import { configured } from './deploy_worker.ts'
import { baseOf, fileBytes, inside, prefixOf } from './files.ts'
import { spaceHost } from './host.ts'
import { r2RawObjects } from './lib/objects.ts'
import { opened, seal } from './lib/token.ts'
import { countedSpend, refusedSpend } from './meter.ts'
import { staged } from './release.ts'
import { loaded, seedy } from './seed.ts'
import { vouched, type Who } from './session.ts'
import { clock } from './timing.ts'
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
import { releaseOf } from './versions.ts'
import { drafting } from './written.ts'
import { sourceOf } from './wrangler_app.ts'
import { decodedPath } from './request-path.ts'
import { walled } from './installed.ts'

export let LIFE = 60 * 60_000
let RATE = 0.09 / 3600
let encode = (value: string) => new TextEncoder().encode(value)
let decode = (value: Uint8Array | null) =>
  value && new TextDecoder().decode(value)

type Ticket = {
  app: string
  space: string
  person: string
  source: string
  store: string
  worker: string
  exp: number
}

let privateHeaders = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
}

let privateResponse = (res: Response) => {
  // WebSocket upgrade responses must keep their socket and status intact.
  if (res.status != 101) res = new Response(res.body, res)
  for (let [name, value] of Object.entries(privateHeaders)) {
    res.headers.set(name, value)
  }
  return walled(res)
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

let prepared = async (
  ctx: Ctx,
  space: Space,
  original: App,
  who: Who,
  exp: number,
) => {
  let raw = r2RawObjects(ctx.env.BLOBS)
  let draft = await drafting(raw, ctx.dir, original)
  let source = releaseOf(space, original)
  let candidate: App = {
    ...original,
    store: `preview/${crypto.randomUUID()}`,
    source,
    files: `${source}/private`,
    version: null,
    declaration: '0',
    lenses: undefined,
    scope: 'store',
    worker: '',
    script: undefined,
    access: 'private',
  }
  let files = staged(raw, draft.files, source)
  let prefix = `${source}/`
  let read = (path: string) => files.files.read(prefix + path)
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
  let keys = Object.keys(draft.files)
  let main = sourceOf(parsed.config, (path) => keys.includes(path))
  if (keys.includes(main)) {
    candidate.script = `app-${original.eid}-preview-${crypto.randomUUID()}`
    candidate.worker = candidate.script
  }
  let ticket = await seal(
    'preview',
    {
      app: original.eid,
      space: space.eid,
      person: ctx.person,
      source,
      store: candidate.store!,
      worker: candidate.script ?? '',
      exp,
    } satisfies Ticket,
    ctx.env.SESSION_SECRET!,
  )
  candidate.mount = `/${original.slug}/_preview/${ticket}/`
  let store = appStore(ctx.env.STORE, space, candidate, ctx.env)
  await post(
    store,
    '/expires',
    {
      at: exp,
      source,
      script: candidate.script,
      context: { app: candidate, space },
    },
    who,
  )
  let made = await compiled(
    ctx,
    space,
    candidate,
    parsed.config,
    keys,
    files.files,
    files.manifest,
  )
  await files.finish()
  if (made.worker || keys.includes(main)) {
    if (!ctx.env.CF_WORKERS_TOKEN) {
      throw refuse(
        'unavailable',
        'This platform has no app worker upload credential',
      )
    }
    candidate.worker = await upload(
      ctx.env,
      candidate.script!,
      made.worker?.modules ?? await carried(read, main),
      { ...parsed.config, main: made.worker?.main ?? main },
    ) || candidate.script
  }
  let vocabFile = keys.includes('vocab.yml') ? 'vocab.yml' : 'vocab.json'
  let sourceDoc = decode(await read(vocabFile))
  let doc = stated(
    sourceDoc ?? '{}',
    vocabFile,
    decode(await read('package.json')) ?? undefined,
  )
  await post(store, '/vocab', doc, who)
  let commands = appTools(doc, appVocab(doc).comps, vocabFile)
  await post(store, '/tools', commands, who)
  let seed = loaded(
    await Promise.all(
      keys.filter(seedy).map(async (path) => ({
        path,
        text: decode(await read(path)) ?? '',
      })),
    ),
  )
  if (seed.length) await post(store, '/apply', seed.map((s) => s.bundle), who)
  return candidate
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
    let why = await refusedSpend(ctx.dir, space, 'models', ctx.env, 15 * RATE)
    if (why) throw refuse('limit', why)
  }
  let exp = Date.now() + LIFE
  let candidate = await prepared(ctx, space, app, who, exp)
  let mount = candidate.mount!
  let url = `https://${spaceHost(ctx.env, space.slug)}${mount}${path}`
  let value: Record<string, unknown> = {
    url,
    expires: new Date(exp).toISOString(),
    ...view,
    isolated: true,
    cost: 0,
  }
  if (!screenshot) {
    return {
      text:
        `Private draft preview: ${url}\nExpires ${value.expires}. Its test data is separate from the released app; worker calls to external services still reach those services. app_preview with screenshot: true renders it on Cloudflare.`,
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
      `Private draft preview: ${url}\n${view.width} × ${view.height}; HTTP ${rendered.status}. Expires ${value.expires}. Test data is isolated; worker calls to external services still reach those services.\nConsole: ${
        JSON.stringify(rendered.console)
      }\nErrors: ${JSON.stringify(rendered.errors)}\n${
        report(rendered.accessibility)
      }\nEstimated browser cost: $${cost.toFixed(6)} from the account budget.`,
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
  if (!ticket || ticket.exp <= Date.now()) return null
  let dir = directory(
    signedDirectory(
      bound(env.DIRECTORY, directoryPart.fetch, env),
      copyOf(env),
      env.CLOCK,
    ),
    true,
  )
  let found = await dir.target(ticket.space, ticket.person, ticket.app)
  let pair = found.space && found.app
    ? { space: found.space, app: found.app }
    : null
  let role = found.role
  if (
    !pair || pair.space.eid != ticket.space ||
    url.hostname != spaceHost(env, pair.space.slug) ||
    pair.app.slug != match[1] ||
    pair.app.trashed || pair.space.trashed || !writes(role)
  ) return null
  let mount = url.pathname.slice(0, url.pathname.length - match[3].length)
  let app: App = {
    ...pair.app,
    source: ticket.source,
    files: `${ticket.source}/private`,
    store: ticket.store,
    declaration: '0',
    version: null,
    lenses: undefined,
    scope: 'store',
    script: ticket.worker || undefined,
    worker: ticket.worker,
    access: 'private',
    mount,
  }
  let grant = await granted(
    req,
    env.SESSION_SECRET,
    storeName(pair.space, app),
    app.policy,
  )
  if (bearing(req) && !grant) {
    let claims = await opened<Record<string, unknown>>(
      'visit',
      req.headers.get('x-yak-grant')!,
      env.SESSION_SECRET,
    )
    let reason = !claims
      ? 'grant signature'
      : claims.store != storeName(pair.space, app)
      ? 'grant store'
      : claims.policy !== app.policy
      ? `grant policy ${claims.policy} != ${app.policy}`
      : 'grant expiry'
    return privateResponse(
      new Response(`Preview unavailable: ${reason}`, { status: 404 }),
    )
  }
  let who: Who = grant ??
    { person: ticket.person, role: role!, via: ticket.app }
  return { dir, ...pair, app, who, path: '/' + match[3], mount }
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let found = await target(req, env)
  if (!found) return no()
  if (found instanceof Response) return found
  let { dir, space, app, who, path, mount } = found
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
      await api(req, env, dir, space, app, at, who, clock(), mount),
    )
  }
  let decoded = decodedPath(path)
  if (!decoded || inside(decoded)) return no()
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
      null,
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
