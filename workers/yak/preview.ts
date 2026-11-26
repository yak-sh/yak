// A draft's private preview link (D-136180, D-453): the app as one of its
// drafts stands at each request, the draft's newest `written` rows over the
// release (written.ts), on a branch of the app's own store (graph.ts
// `#onBranch`): the live rows as of the branch's fork, under the preview's own
// writes, which the live app sees only once a release of the draft asks for
// them (app_deploy rows: all, draft-merge.ts). Each draft has a link and a branch of its own,
// made when it is first previewed, so several drafts of one app preview side
// by side, each with its own writes; once a release takes the draft, its link
// serves what was released, over the live rows. Discarding the draft drops its
// branch. Nothing here selects a release in the directory.
//
// Each state of the draft is served as a release named for the files it holds,
// built by the first request that finds it missing (`following`) and found
// again by any isolate after. A state starts from the one before the newest
// write: what that one compiled carries over, so a page script is compiled
// once per sha (esbuild.ts), and the worker, the branch's vocabulary and its
// seed rows are set up again only by the write that changed them. Each write
// is told to the link's pages (`watching`); public/release.js takes it there.
//
// The rules are @yaks/platform/preview's: where a link is mounted, whom its
// ticket admits, which door a request goes to, where a state is kept and
// what building it sets up again. This file does the reading and building
// they name: the directory, the draft's rows, R2 and the dispatch namespace.
import { stated } from './vocab.ts'
import { ACCEPTED } from './door.ts'
import { declarationOf } from './declaration.ts'
import { copyFor, storeApi, storing, unwritten, woven } from './apps.ts'
import {
  type App,
  appStore,
  directory,
  type PreviewLink,
  releaseOf,
  type Space,
  url as appUrl,
} from './directory.ts'
import * as directoryPart from './directory.ts'
import { copyOf } from './directory-copy.ts'
import { caught } from './defects.ts'
import {
  bearing,
  carried,
  drop,
  granted,
  grantee,
  type Module,
  ran,
  upload,
} from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { report } from '@yaks/platform/preview-audit'
import { fitted } from '@yaks/platform/preview-fit'
import {
  firstPreview,
  toolDraft,
  WRITE_DRAFT,
} from '@yaks/platform/draft-choice'
import { writes } from '@yaks/member'
import { ours } from './asking.ts'
import { compiled, pageInputs } from './esbuild.ts'
import { configured } from './deploy_worker.ts'
import { baseOf } from '@yaks/platform/woven'
import { fileBytes, prefixOf } from './files.ts'
import { spaceHost } from '@yaks/platform/host'
import { r2Objects, r2RawObjects } from './lib/objects.ts'
import { COOKIE, opened, sign } from './lib/token.ts'
import { onHold } from './model-spend.ts'
import { ModelError } from '@yaks/model'
import { system } from '@yaks/fp'
import { mint } from '@yaks/graph/identity'
import { filesIn, staged } from './release.ts'
import { loaded, pinned } from './seed.ts'
import {
  admits,
  aimed,
  type Built,
  codeOf,
  door,
  entered,
  LASTS,
  linkFor,
  linkMount,
  outside,
  PRIVATE,
  reading,
  RECORD,
  resets,
  scriptOf,
  seeding,
  shows,
  starting,
  stateOf,
  type Ticket,
  undone,
  until,
  viewer,
  within,
} from '@yaks/platform/preview'
import { vouched, type Who } from './session.ts'
import { clock } from './timing.ts'
import { headed } from '@yaks/workerd/upgrade'
import { type Args, type Ctx, inApp, refuse, rejected } from './tool.ts'
import { CallError } from '@yaks/tools/errors'
import { misfit } from '@yaks/graph/errors'
import { addressed } from '@yaks/platform/versions'
import { digest } from '@yaks/graph/sha256'
import { unbase64 } from './bytes.ts'
import { blobPrefix } from './blob-key.ts'
import {
  type AppDraft,
  type Branches,
  type Draft,
  type Drafted,
  drafting,
  draftsOf,
  newest,
  overlaid,
  previewed,
  served,
  type Tell,
  withLegacy,
} from './written.ts'
import type { Objects } from '@yaks/blob'
import {
  type Cookie,
  previewSteps,
  previewTime,
  type Step,
  type View,
  type Visit,
} from '@yaks/platform/browser-visit'
import { sourceOf } from './wrangler_app.ts'
import { walled } from '@yaks/platform/installs'
import { screen as screenAt } from './screen.ts'
import { sharing } from './lib/shared.ts'

let RATE = 0.09 / 3600
let encode = (value: string) => new TextEncoder().encode(value)
let decode = (value: Uint8Array | null) =>
  value && new TextDecoder().decode(value)

let privateResponse = (res: Response) => {
  let headers = new Headers(res.headers)
  for (let [name, value] of Object.entries(PRIVATE)) headers.set(name, value)
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
  let path = within(value)
  if (path == null) {
    throw refuse(
      'arguments',
      'path: a page within this app, such as about/ or details.html',
    )
  }
  return path
}

/** Why the preview's store refused what a draft's file `from` gave it: the
 * store's own message, and, where the refusal is a misfit (@yaks/graph
 * `Misfit`), that the file names a word the draft's vocabulary does not
 * declare, or a value of another type than the word's.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   storeSaid('seed.json', '{"error":"Refused","message":"unknown component: note","misfit":true}'),
 *   'seed.json does not fit the draft’s vocabulary: unknown component: note. ' +
 *     'A misfit is a component or property the vocab file does not declare, ' +
 *     'or a value of another type than it declares: declare it there, or ' +
 *     'change seed.json to the words it declares',
 * )
 * assertEquals(
 *   storeSaid('vocab.yml', '{"error":"Refused","message":"a name is held"}'),
 *   'vocab.yml was refused: a name is held',
 * )
 * assertEquals(storeSaid('vocab.yml', 'gone'), 'vocab.yml was refused: gone')
 * ```
 */
export let storeSaid = (from: string, text: string): string => {
  let said: { message?: unknown; misfit?: unknown } = {}
  try {
    said = JSON.parse(text) ?? {}
  } catch { /* a body that is not JSON is the message itself */ }
  let message = typeof said.message == 'string' ? said.message : text
  return misfit(said)
    ? `${from} does not fit the draft’s vocabulary: ${message}. A misfit is ` +
      'a component or property the vocab file does not declare, or a value ' +
      `of another type than it declares: declare it there, or change ${from} ` +
      'to the words it declares'
    : `${from} was refused: ${message}`
}

let post = (
  store: ReturnType<typeof appStore>,
  path: string,
  from: string,
  value: unknown,
  who: Who,
  headers: Record<string, string> = {},
) =>
  store.consume(
    path,
    async (res) => {
      if (!res.ok) throw rejected(res.status, storeSaid(from, await res.text()))
      await res.arrayBuffer()
    },
    { method: 'POST', body: JSON.stringify(value) },
    {
      ...vouched(who),
      'content-type': 'application/json',
      'x-yak-kernel': '1',
      ...headers,
    },
  )

// The app as its link serves one state of its draft: the app's store on the
// draft's branch, and its own dispatch script where the state has a worker.
// A link whose draft is closed has no branch, and reads the live app's rows,
// as a viewer (@yaks/platform/preview `viewer`).
// The store is told of the app as it serves (its release and access), since
// it is the live app's.
let previewing = (
  app: App,
  link: string,
  source: string | null,
  mount: string,
  branch: number | null,
  worker = false,
): App => {
  let script = worker ? scriptOf(app.eid, link) : undefined
  return {
    ...app,
    ...branch != null ? { branch } : {},
    source,
    files: `${source}/private`,
    version: null,
    declaration: releaseOf(app),
    lenses: undefined,
    scope: 'store',
    script,
    worker: script ?? '',
    mount,
  }
}

/** The branches of the app's store a draft's preview is given (written.ts
 * `previewed`). One is made on a draft's first preview (graph.ts
 * `#branching`): the store's first branch turns its versions on, and waits
 * while its live rows become their first versions; one that would wait past
 * that bound makes none yet, which is said for the caller to try again. One
 * another preview of the draft
 * stamped first is dropped, and a drop that fails is reported, since the
 * preview already has its branch. */
export let branches = (env: Env, space: Space, app: App): Branches => ({
  make: () => branching(env, space, app),
  drop: async (branch) => {
    let { dropBranch } = await import('./draft-merge.ts')
    await dropBranch(appStore(env.STORE, space, app, env), branch).catch((e) =>
      caught(e, { request: 'drop branch', space: space.slug, app: app.slug })
    )
  },
})

let branching = (env: Env, space: Space, app: App) =>
  appStore(env.STORE, space, app, env).consume(
    '/branches',
    async (res) => {
      if (res.status == 503) {
        await res.body?.cancel()
        throw refuse(
          'unavailable',
          `${space.slug}/${app.slug} is still keeping its live rows as ` +
            'versions to preview drafts on, past what one call waits for; ' +
            'try again in a minute',
        )
      }
      if (!res.ok) throw new Error(`branch: ${res.status} ${await res.text()}`)
      return (await res.json() as { branch: { id: number } }).branch.id
    },
    { method: 'POST', body: '{}' },
    { 'x-yak-kernel': '1' },
  )

/** A discarded draft's preview let go of: its branch dropped, with
 * everything its preview wrote, and its link's worker. */
export let unbranched = async (
  env: Env,
  space: Space,
  app: App,
  d: AppDraft,
) => {
  if (d.branch != null) {
    let { dropBranch } = await import('./draft-merge.ts')
    await dropBranch(appStore(env.STORE, space, app, env), d.branch)
  }
  if (env.CF_WORKERS_TOKEN) {
    await drop(env, scriptOf(app.eid, linkFor(app, d)), true)
  }
}

let recorded = async (raw: Objects, source: string) => {
  let files = await filesIn(raw, source)
  let bytes = files?.[RECORD] && await raw.read(addressed(files[RECORD]))
  return bytes ? JSON.parse(decode(bytes)!) as Built : null
}

let fingerprint = async (modules: Module[], config: unknown) =>
  await digest(JSON.stringify([
    config,
    ...await Promise.all(
      modules.map(async (m) => [m.name, await digest(m.bytes)]),
    ),
  ]))

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
  branch: number | null,
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
    space.store,
    app.eid,
    link,
    overlaid(await served(raw, app), d.rows.filter((w) => w.at != last)),
  )
  let prev = before == source ? null : await filesIn(raw, before)
  let was = prev && await recorded(raw, before)
  let start = starting(d.files, prev)
  let files = staged(raw, start, source)
  let read = (path: string) => files.files.read(`${source}/${path}`)
  let parsed = await configured(read)
  if (parsed.refused.length) {
    throw refuse('arguments', parsed.refused.join('\n'))
  }
  if (outside(parsed.config).length) {
    throw refuse(
      'arguments',
      'Draft previews support the app graph store; remove external resource bindings from the draft to preview it',
    )
  }
  let keys = Object.keys(start)
  let made = await compiled(
    ctx,
    space,
    previewing(app, link, source, mount, branch),
    parsed.config,
    keys,
    files.files,
    files.manifest,
  )
  let main = sourceOf(parsed.config, (path) => keys.includes(path))
  let modules = made.worker?.modules ??
    (keys.includes(main) ? await carried(read, main) : null)
  let config = { ...parsed.config, main: made.worker?.main ?? main }
  let worker = modules && await fingerprint(modules, config)
  let candidate = previewing(app, link, source, mount, branch, !!worker)
  let store = appStore(ctx.env.STORE, space, candidate, ctx.env)
  if (modules && worker != was?.worker) {
    if (!ctx.env.CF_WORKERS_TOKEN) {
      throw refuse(
        'unavailable',
        'This platform has no app worker upload credential',
      )
    }
    let send = () => upload(ctx.env, candidate.script!, modules, config)
    await (ctx.clock ? ctx.clock.time('worker_upload', send) : send())
  }
  // Only a branch is set up: a link with none shows what was released, whose
  // words and rows are the live app's own.
  if (branch != null && resets(d.files, prev)) {
    let vocabFile = keys.includes('vocab.yml') ? 'vocab.yml' : 'vocab.json'
    let doc = stated(
      decode(await read(vocabFile)) ?? '{}',
      vocabFile,
      decode(await read('package.json')) ?? undefined,
    )
    // A word the app's release already declares stays the app's here as in
    // its deploys (vocab.ts `unsaid`), though the link's store never held it.
    let held = Object.keys(
      (await declarationOf(ctx.env, space, app)).vocab.$defs ?? {},
    )
    await post(store, '/vocab', vocabFile, doc, who, {
      [ACCEPTED]: JSON.stringify(held),
    })
  }
  // The rows a release would seed: only an app no release has seeded yet
  // takes its seed files (tools.ts `willSeed`), and its draft's branch with it.
  let seeds = seeding(d.files, prev)
  if (branch != null && !app.seeded && seeds.length) {
    let seed = loaded(
      await Promise.all(seeds.map(async (path) => ({
        path,
        text: decode(await read(path)) ?? '',
      }))),
    )
    if (seed.length) {
      await post(store, '/apply', seeds.join(', '), pinned(seed, link), who)
    }
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

/** The app as a draft stands now, built for the link where no isolate has
 * served this state before, or as released once it is closed. */
let following = async (
  ctx: Ctx,
  space: Space,
  app: App,
  of: AppDraft | null,
  link: string,
  mount: string,
  who: Who,
) => {
  // A closed draft's link shows what was released, which the app already
  // serves built: its release's files and its own worker. Building that
  // release again as a preview put a compile and a worker upload in front of
  // the first visit after every release, and one that never finished held
  // every visit for the request's whole minute (90344f8c).
  if (!of) {
    return {
      ...previewing(app, link, app.source ?? null, mount, null),
      script: app.script,
      worker: app.worker ?? '',
    }
  }
  let d = await drafting(r2RawObjects(ctx.env.BLOBS), ctx.dir, app, of)
  let branch = of.branch
  let source = stateOf(space.store, app.eid, link, d.files)
  let state = sharing(
    states,
    source,
    () => built(ctx, space, app, link, branch, d, source, mount, who),
    HELD,
  )
  return previewing(app, link, source, mount, branch, (await state).worker)
}

// The last plan a page could have loaded. Writes can arrive before a page
// asks for their state, so walk past those unbuilt states to the last built
// one. Undoing the draft's writes ends at the serving release's source files.
let reached = async (
  env: Env,
  space: Space,
  app: App,
  news: Drafted,
  before?: Draft,
): Promise<Drafted> => {
  if (!before) return news
  let raw = r2RawObjects(env.BLOBS)
  let plan = async () => {
    for (let files of undone(before.files, newest(before.rows))) {
      let index = await filesIn(
        raw,
        stateOf(space.store, app.eid, news.link, files),
      )
      if (index) {
        return pageInputs((path) =>
          index[path] ? raw.read(addressed(index[path])) : Promise.resolve(null)
        )
      }
    }
    return app.source
      ? pageInputs((path) => before.view.read(`${app.source}/${path}`))
      : null
  }
  let pages = await plan()
  return pages ? { ...news, files: entered(news.files, pages) } : news
}

/** Each write to a draft, and its release, told to the pages of the draft's
 * preview link the way a release is told to the app's (graph.ts
 * `/drafted`). A draft nobody previewed is told nothing (written.ts
 * `previewed`). */
export let watching =
  (env: Env, space: Space, app: App): Tell => async (news, before) => {
    // A link's pages are on its draft's branch; a draft with none has none.
    let { branch, ...told } = news
    if (branch == null) return
    try {
      told = await reached(env, space, app, told, before)
    } catch (e) {
      caught(e, { request: 'draft entries', space: space.slug, app: app.slug })
    }
    try {
      await appStore(env.STORE, space, { ...app, branch }, env).consume(
        '/drafted',
        async (res) => {
          if (!res.ok) throw new Error(`draft notice: ${res.status}`)
          await res.arrayBuffer()
        },
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ draft: told }),
        },
        { 'x-yak-kernel': '1' },
      )
    } catch (e) {
      caught(e, { request: 'draft notice', space: space.slug, app: app.slug })
    }
  }

/** A draft's preview link for the caller (`ctx.person`), with the draft
 * marked as previewed, so its writes are told to the link's pages from now
 * on: where it is mounted, and its address. Nothing is built until a page
 * asks for it. A link for a paired TV names its `screen`. */
export let linkOf = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  of: AppDraft,
  screen?: string,
) => {
  let draft = await previewed(
    ctx.dir,
    space,
    app,
    of,
    who,
    branches(ctx.env, space, app),
  )
  return {
    draft,
    link: linkFor(app, draft),
    ...await issued(ctx, space, app, draft.eid, screen),
  }
}

/** The link to a draft by its id alone, marking nothing: a draft no longer
 * open shows what was released (`target`). It is a stored `preview_link`
 * whose random code its address carries, for the caller (`ctx.person`) and
 * the screen it is for, until the end of the window after this one
 * (`until`): one already standing for them in that window is the same link,
 * which a TV following it does not reload for, and a new one is written. */
export let issued = async (
  ctx: Pick<Ctx, 'env' | 'dir' | 'person'>,
  space: Space,
  app: App,
  of: string,
  screen?: string,
) => {
  let exp = until((ctx.env.CLOCK ?? system).now())
  let at = new Date(exp * 1000).toISOString()
  let held = (await ctx.dir.previewLinks(of)).find((l) =>
    l.app == app.eid && l.person == ctx.person &&
    l.screen == (screen ?? null) && Date.parse(l.until) == exp * 1000
  )
  let code = held?.code
  if (!code) {
    code = codeOf(crypto.getRandomValues(new Uint8Array(12)))
    await ctx.dir.stamp({
      entities: [{
        entity: { eid: mint() },
        preview_link: {
          code,
          app: app.eid,
          space: space.eid,
          person: ctx.person,
          draft: of,
          until: at,
          ...screen ? { screen } : {},
        },
      }],
    }, vouched({ person: ctx.person, role: null }))
  }
  let mount = linkMount(app.slug, code)
  return {
    mount,
    at: `https://${spaceHost(ctx.env, space.slug)}${mount}`,
  }
}

let shownDraft = async (
  ctx: Ctx,
  space: Space,
  app: App,
  asked?: string | null,
) => {
  let d = await toolDraft(asked, ctx.env.CLOCK)(
    ctx.dir,
    app,
    await draftsOf(ctx.dir, app),
  )
  if (!d) {
    let name = `${space.slug}/${app.slug}`
    throw refuse(
      'missing',
      app.version
        ? `${name} has no open draft. ${WRITE_DRAFT} ` +
          'Call app_preview with released: true to see the live app.'
        : firstPreview(name, []),
    )
  }
  return d
}

// A page as yak-browser rendered it, held on the space's budget for the most
// browser time a load and its check can take (@yaks/platform/browser-visit),
// refused there in the directory's own transaction, and charged
// the time it took, failing or not (model-spend.ts `onHold`).
let rendering = async (ctx: Ctx, space: Space, app: App, visit: Visit) => {
  ctx.doing?.('the browser is opening and checking the page')
  let { render } = await import('./browser.ts')
  let rendered = await onHold(
    ctx.env,
    space,
    previewTime(visit) / 1000 * RATE,
    'models',
    (spent) =>
      render(ctx.env, visit, (duration) => {
        spent(duration / 1000 * RATE)
        return Promise.resolve()
      }, { space: space.slug, app: app.slug }),
    'browser',
  ).catch((e) => {
    throw e instanceof ModelError && e.code == 'limit'
      ? refuse('limit', e.message)
      : e
  })
  let { image, text, shots: _, ...diagnostics } = rendered
  return {
    png: image,
    cost: rendered.duration / 1000 * RATE,
    diagnostics,
    images: [{ data: image, mime_type: 'image/png' }],
    said: (where: string) =>
      `${where}\n${visit.view.width} × ${visit.view.height}; HTTP ${rendered.status}.\nText: ${
        JSON.stringify(text)
      }\nConsole: ${JSON.stringify(rendered.console)}\nErrors: ${
        JSON.stringify(rendered.errors)
      }\n${rendered.fit ? fitted(rendered.fit) + '\n' : ''}${
        report(rendered.accessibility)
      }`,
  }
}

// How long the sign-in a private app is opened with lasts, in seconds: past
// the longest render, and no longer.
let SIGNED = 120

// The sign-in a render of a private app carries: the caller's own, narrowed
// to the app's space, on the app's host alone and gone after the render.
let signedIn = async (
  env: Env,
  person: string,
  space: Space,
  host: string,
): Promise<Cookie> => ({
  name: COOKIE,
  value: await sign({
    person,
    space: space.eid,
    exp: Math.floor(Date.now() / 1000) + SIGNED,
    render: true,
  }, env.SESSION_SECRET!),
  domain: host,
  path: '/',
  secure: true,
  httpOnly: true,
})

// A render of the live release kept as its picture (deploy{screenshot}):
// the bytes among the app's uploads, as a chosen screenshot is (tools.ts
// `app_set`), and their sha on the release's row, so a picture of each
// version stays when the app moves on (gallery.ts `shotAt`). Choosing what
// stands for the app is its space owner's, as its screenshot is.
let kept = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  png: string,
) => {
  if (who.role != 'owner') {
    throw refuse('access', `not the owner of ${space.slug}`)
  }
  let release = await ctx.dir.deployAt(app, app.version!)
  if (!release) {
    throw refuse(
      'missing',
      `${space.slug}/${app.slug} v${app.version} has no release row`,
    )
  }
  let bytes = unbase64(png)
  let sha = await digest(bytes)
  await r2Objects(ctx.env.BLOBS).put(blobPrefix(space, app) + sha, bytes)
  await ctx.dir.stamp({
    entities: [{ entity: { eid: release.eid }, deploy: { screenshot: sha } }],
  }, vouched(who))
  return sha
}

// The released app at the address everyone is handed (directory.ts `url`),
// over its live store: a public app as a visitor sees it, a private one as
// the caller does.
let released = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  path: string,
  view: View,
  steps: Step[],
  screenshot: boolean,
  keep: boolean,
) => {
  let at = appUrl(space, app, ctx.env) + path
  let value: Record<string, unknown> = {
    url: at,
    version: app.version,
    ...view,
    cost: 0,
  }
  let where = `Released ${space.slug}/${app.slug} v${app.version}: ${at}`
  if (!screenshot) {
    return {
      text:
        `${where}\napp_preview with released: true and screenshot: true opens it in a browser.`,
      space,
      value,
    }
  }
  let signed = app.access == 'private' && who.person
  let cookies = signed
    ? [await signedIn(ctx.env, who.person!, space, new URL(at).host)]
    : []
  let shot = await rendering(ctx, space, app, { url: at, view, cookies, steps })
  Object.assign(value, shot.diagnostics, { cost: shot.cost })
  if (keep) value.screenshot = await kept(ctx, space, app, who, shot.png)
  return {
    text: shot.said(
      `${where}, with its live data, as ${
        signed ? 'you see it signed in' : 'a visitor sees it'
      }.${keep ? ' Kept as the picture of this release.' : ''}`,
    ),
    space,
    value,
    images: shot.images,
  }
}

export let preview = async (ctx: Ctx, args: Args) => {
  let view = viewport(args)
  let path = page(args.path)
  for (let flag of ['screenshot', 'released', 'keep']) {
    if (args[flag] != null && typeof args[flag] != 'boolean') {
      throw refuse('arguments', `${flag}: true or false`)
    }
  }
  let screenshot = args.screenshot !== false
  let steps = previewSteps(args.steps)
  if (!screenshot && steps.length) {
    throw refuse('arguments', 'Browser steps require a screenshot.')
  }
  if (!ctx.env.SESSION_SECRET) {
    throw refuse('unavailable', 'Draft previews are not configured')
  }
  let live = args.released === true
  let { space, app, who } = await inApp(ctx, args, !live || steps.length > 0)
  let keep = args.keep === true
  if (keep && (!live || !screenshot)) {
    throw refuse(
      'arguments',
      'keep: true keeps a picture of the release, so it needs released: true and a screenshot',
    )
  }
  if (live && !app.version) {
    throw refuse(
      'missing',
      firstPreview(
        `${space.slug}/${app.slug}`,
        writes(who.role) ? await draftsOf(ctx.dir, app) : null,
      ),
    )
  }
  if (screenshot && !ctx.env.BROWSER) {
    throw refuse(
      'unavailable',
      'Cloudflare Browser Rendering is not configured',
    )
  }
  if (live) {
    return released(ctx, space, app, who, path, view, steps, screenshot, keep)
  }
  if (args.draft != null && typeof args.draft != 'string') {
    throw refuse('arguments', "draft: the id of one of the app's drafts")
  }
  let of = await shownDraft(ctx, space, app, args.draft as string | undefined)
  let { draft, link, mount, at } = await linkOf(ctx, space, app, who, of)
  ctx.doing?.('the draft is building for its private link')
  await following(ctx, space, app, draft, link, mount, who)
  let url = at + path
  let value: Record<string, unknown> = {
    url,
    draft: draft.eid,
    ...view,
    isolated: true,
    cost: 0,
  }
  // A new app is made, not drafted: its first version goes live at its own
  // address (T-1641).
  let first = app.version
    ? ''
    : ` ${space.slug}/${app.slug} has no release yet: once this draft works, app_deploy releases it as the first version at ${
      appUrl(space, app, ctx.env)
    }, the address to hand the person, not this draft's link.`
  let follows =
    `It shows draft ${draft.eid} over the app's live rows as they stood when it was first previewed, on a branch of its own: what its pages write stays there, out of the live app, until app_deploy merges it with rows: all; a release without it takes only the draft's files and keeps those rows on the branch until merged or discarded. An open page takes each write to that draft as it lands, a stylesheet in place and anything else by reloading, keeping its scroll and typed fields, and once app_deploy releases the draft shows what was released, read-only. The link opens for at least ${
      LASTS / 3600
    } hours; app_preview again gives a new one once it has expired, and anyone holding it can open it, so hand it only to whom it is for. Each draft of the app has its own link and branch; discarding the draft drops its branch.${first}`
  if (!screenshot) {
    return {
      text:
        `Private draft preview: ${url}\n${follows} Worker calls to external services still reach those services. app_preview with screenshot: true renders it on Cloudflare.`,
      space,
      value,
    }
  }
  let shot = await rendering(ctx, space, app, { url, view, steps })
  Object.assign(value, shot.diagnostics, { cost: shot.cost })
  return {
    text: shot.said(
      `Private draft preview: ${url}\n${follows} Worker calls to external services still reach those services. app_preview with released: true opens the released app.`,
    ),
    space,
    value,
    images: shot.images,
  }
}

let directoryAt = (env: Env) =>
  directory(bound(env.DIRECTORY, directoryPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })

// What a stored link opens, read as a ticket would be (`admits`): none for
// one revoked.
let ticketOf = (l: PreviewLink | null): Ticket | null =>
  l && {
    app: l.app,
    space: l.space,
    person: l.person,
    of: l.draft,
    exp: Date.parse(l.until) / 1000,
    ...l.screen ? { screen: l.screen } : {},
  }

let target = async (req: Request, env: Env) => {
  let url = new URL(req.url)
  let aim = aimed(url.pathname)
  if (!aim || !env.SESSION_SECRET) return null
  let dir = directoryAt(env)
  let ticket = aim.code
    ? ticketOf(await dir.previewLink(aim.code))
    : await opened<Ticket>('preview', aim.ticket!, env.SESSION_SECRET)
  if (!ticket) return null
  let [found, paired, rows] = await Promise.all([
    dir.target(ticket.space, ticket.person, ticket.app),
    ticket.screen ? screenAt(dir, ticket.screen) : null,
    dir.drafts({ eid: ticket.app } as App),
  ])
  let { space, app: held, role } = found
  if (
    !space || !held ||
    !admits(ticket, { space, app: held, role }, {
      host: url.hostname,
      app: aim.app,
      now: (env.CLOCK ?? system).now(),
      paired: paired?.person,
    }, env)
  ) return null
  // The draft it shows while that draft is open, and the release once it is
  // closed, read-only.
  let of = shows(ticket, withLegacy(held, rows))
  let link = of ? linkFor(held, of) : ticket.of
  let { mount } = aim
  // An open draft previewed before drafts had branches takes one now, as the
  // person whose link it is. One its store cannot make yet is made later, and
  // its pages' doors wait for it (`fetch`).
  if (of && of.branch == null) {
    of = await previewed(
      dir,
      space,
      held,
      of,
      { person: ticket.person, role: role!, via: ticket.app },
      branches(env, space, held),
    ).catch((e) => {
      if (e instanceof CallError) return of
      throw e
    })
  }
  let app = previewing(
    held,
    link,
    held.source ?? null,
    mount,
    of?.branch ?? null,
  )
  // The ticket's writer is checked above on every callback. A directory
  // edit cannot revoke its scoped worker grant; current membership does.
  let grant = await granted(req, env.SESSION_SECRET, grantee(space, app))
  if (bearing(req) && !grant) return null
  return {
    dir,
    space,
    app: held,
    person: ticket.person,
    of,
    link,
    preview: app,
    who: viewer(ticket, role!, grant, !!of),
    reads: reading(ticket, !!of),
    path: aim.path,
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
  if (ours(headers.get('authorization'))) headers.delete('authorization')
  req = new Request(req, { headers })
  let to = door({
    path,
    method: req.method,
    reads: found.reads,
    waiting: !!found.of && found.of.branch == null,
  })
  if (to.to == 'nothing') return no(to.status)
  if (to.to == 'api') {
    return privateResponse(
      await storeApi(
        req,
        env,
        dir,
        space,
        found.preview,
        to.door,
        who,
        clock(),
        mount,
      ),
    )
  }
  let app: App
  try {
    app = await following(
      { env, dir, person: found.person },
      space,
      found.app,
      found.of,
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
  // The worker's 404 is its pass, as on the released app (apps.ts): the
  // draft's files answer behind it, and where they hold nothing either, that
  // 404 is the app's answer.
  let pass = worker?.status == 404 ? worker : null
  if (pass) worker = null
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
    let generated = await unwritten(req, env, space, app, path, mount)
    if (generated) {
      await res.body?.cancel()
      res = generated
    }
  }
  if (pass && res.status == 404) {
    await res.body?.cancel()
    res = pass
  } else await pass?.body?.cancel()
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
      // The preview is walled (`privateResponse`), so the browser's own
      // storage throws in it; the page gets the platform's, as a sandboxed
      // app's does, kept in the preview's own store.
      await storing(env, space, found.preview, who, mount),
      { badge: null, draft: found.link },
      baseOf(mount, res.headers.get('x-yak-file') ?? to.file.slice(1), false),
      undefined,
      // The draft's own copy, so a preview shows the copy as drafted.
      await copyFor(env, space, app),
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
