// An app's own server code (D-32318 §Code, T-32778): a `worker.js` among its
// files becomes a script in the `yak-apps` dispatch namespace at deploy, and
// the kernel forwards the app's non-`/api/` requests to it, falling back to
// the static files when it answers 404 or when the app has no worker at all.
// Everything Cloudflare-shaped about that lives here; apps.ts has one call
// site (`ran`) and tools.ts one (`upload`).
//
// The hard part is identity. The app's script is code its owner's agent
// wrote, so nothing it SAYS can be believed — and it still has to reach its
// own store and its own files as the person looking at the page. So the
// kernel seals a GRANT (src/token.ts `seal`) naming the store, the visitor
// and their role, good for a minute, and sends it in with the request; the
// script's uploaded entry module (`SHIM`) takes that header off before the
// app's own code ever sees it and holds it in a closure, handing the app
// `env.STORE` and `env.FILES` — fetchers onto the app's own doors that add
// the grant on the way out. So `env.STORE.fetch('/query?.doc!')` works, and
// an app that tries to reach another app's store through the same service
// binding has no grant that names it. Nothing durable is handed to app code:
// the grant dies in a minute and belongs to one request.
//
// The platform's session cookie never crosses into app code either — it is
// stripped on the way in (session.ts: what serves an app gets the vouched
// headers and never the cookie), because it is a credential for every space
// this person belongs to and the app is owed only this visit.
//
// Local development has no dispatch namespace: it is remote-only
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/local-development/),
// so under `wrangler dev` there is no worker to reach and every app serves its
// files the way it always did. HOW that absence arrives depends on the
// wrangler: older ones left the binding undefined, current ones bind a stub
// that throws `needs to be run remotely`, which `nowhere` reads as the same
// fact. `remote = true` in wrangler.toml would point local dev at the deployed
// namespace; we do not set it, because a test must not need the account.
import { COOKIE, opened, seal } from '../../src/token.ts'
import type { App, Role, Space } from './directory.ts'
import { storeName } from './directory.ts'
import type { Env, Fetcher } from './env.ts'
import { oops } from './pages.ts'
import type { Who } from './session.ts'
import { storeOf } from './door.ts'
import { failed, noted, refusal, serving } from './unseen.ts'
import { KERNEL, metaOf } from './meta.ts'

// The dispatch namespace binding, the slice we ask of it (env.ts): a name in,
// a fetcher out. `get` throws for a script that is not there, and the docs
// give only the message's prefix to know it by
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/).
export type Dispatch = { get(name: string): Fetcher }

// The namespace the account holds (`wrangler dispatch-namespace create
// yak-apps`), named here as well as in wrangler.toml because the upload
// addresses it by name over the API.
export let NAMESPACE = 'yak-apps'

// The grant rides its own header, in and out. A client's own is always
// stripped before an app's worker is called, so the only one an app ever
// sees is the kernel's.
export let GRANT = 'x-yak-grant'

// The app the request is for, so the shim can spell its own doors, and who
// is looking, so the app's code can greet them. A client cannot send these
// either.
let VOUCH = ['x-yak-app', 'x-yak-person', 'x-yak-role']

// Long enough for an app's worker to answer, short enough that a grant that
// leaks is worth nothing by the time anyone has it.
let LIFE = 60

type Grant = {
  store: string
  person: string | null
  role: Role | null
  exp: number
}

// The script's name in the namespace: the app's STORE name (directory.ts
// `storeName` — pinned at birth, which a rename never moves), with the slash
// made a character a script name may carry. A slug never holds an underscore
// (route.ts SLUG), so `jeff/recipes` is `jeff_recipes` and no two apps can
// spell the same script.
export let scriptName = (store: string) => store.replaceAll('/', '_')

// The app's own entry, the one file the platform looks for and the name the
// shim imports.
export let WORKER = 'worker.js'

// What the platform runs, with the app's own module inside it. Uploaded as
// the script's `main_module` beside `worker.js`, which it imports — a
// multipart upload may carry several ES modules, and the entry is whichever
// one `main_module` names
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/platform-examples/).
//
// It is deliberately tiny and deliberately first: it is the only thing
// between the app's code and the grant.
export let SHIM = `import app from './${WORKER}'

let GRANT = '${GRANT}'

export default {
  fetch(req, env, ctx) {
    let grant = req.headers.get(GRANT) || ''
    let headers = new Headers(req.headers)
    headers.delete(GRANT)
    let origin = new URL(req.url).origin
    let slug = req.headers.get('x-yak-app') || ''
    // A path onto the app's own doors, never a URL: a leading slash is the
    // app's root and not the hostname's, so the two are joined by hand.
    let door = (under) => ({
      fetch: (path, init) => {
        let to = origin + under + String(path).replace(/^\\/+/, '')
        let out = new Request(to, init)
        out.headers.set(GRANT, grant)
        return env.KERNEL.fetch(out)
      },
    })
    return app.fetch(new Request(req, { headers }), {
      ...env,
      STORE: door('/' + slug + '/api/'),
      FILES: door('/' + slug + '/'),
    }, ctx)
  },
}
`

// The visitor an app's worker acts as, for one minute, on one store.
export let granting = (secret: string, store: string, who: Who) =>
  seal(
    {
      store,
      person: who.person,
      role: who.role,
      exp: Math.floor(Date.now() / 1000) + LIFE,
    } satisfies Grant,
    secret,
  )

// Whether this request is an app's worker coming back through the service
// binding at all — ANY app's, whoever the grant names and whether or not it
// still opens. It is the loop guard on the home app's router (apps.ts
// `served`, D-34197): the router's own onward request carries the grant it was
// handed, so this is what keeps a path it just intercepted from arriving back
// at it. `granted` below is the other question — who this grant says the
// caller is — and only its own app can ask that one.
export let bearing = (req: Request) => req.headers.has(GRANT)

// Who this request is, when it is an app's own worker coming back through
// its service binding — and null for anything else: no header, a forged or
// expired one, or one minted for a store that is not this app's. Null means
// "an ordinary visitor", so a failed grant never grants anything.
export let granted = async (
  req: Request,
  secret: string | undefined,
  store: string,
): Promise<Who | null> => {
  let sealed = req.headers.get(GRANT)
  if (!sealed || !secret) return null
  let g = await opened<Grant>(sealed, secret)
  if (!g || g.store != store || !(g.exp * 1000 > Date.now())) return null
  return { person: g.person ?? null, role: g.role ?? null }
}

// The session cookie taken out and every other cookie left alone: the app is
// owed this visit, not the person's platform-wide credential.
let uncookied = (headers: Headers) => {
  let sent = headers.get('cookie')
  if (!sent) return
  let kept = sent.split(';').map((c) => c.trim())
    .filter((c) => c.split('=')[0] != COOKIE)
  if (kept.length) headers.set('cookie', kept.join('; '))
  else headers.delete('cookie')
}

// The request an app's worker is handed: the visitor's own, minus what only
// the kernel may say and minus the platform's cookie, plus who is looking
// (session.ts `vouched`, said the same way everything else the kernel serves
// says it) and the grant that lets the worker act as them.
let handed = async (
  req: Request,
  app: App,
  store: string,
  who: Who,
  secret: string,
) => {
  let headers = new Headers(req.headers)
  for (let h of [...VOUCH, GRANT]) headers.delete(h)
  uncookied(headers)
  headers.set('x-yak-app', app.slug)
  if (who.person) headers.set('x-yak-person', who.person)
  if (who.role) headers.set('x-yak-role', who.role)
  headers.set(GRANT, await granting(secret, store, who))
  return new Request(req, { headers })
}

// A script that is not there, which is every app that has never deployed a
// worker. The runtime says so in the message's first words and gives nothing
// else to know it by
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/).
let missing = (e: unknown) =>
  e instanceof Error && e.message.startsWith('Worker not found')

// A namespace bound where it cannot be reached. Dispatch namespaces are
// remote-only, so `wrangler dev` and the workerd probes bind a STUB that
// throws `Binding DISPATCH needs to be run remotely` rather than leaving the
// binding off — which is the same fact as no binding at all, this runtime has
// no app workers, and never the app's break (T-34179).
let unreachable = (e: unknown) =>
  e instanceof Error && e.message.includes('needs to be run remotely')

// Neither of those is a worker to serve from: the app's files answer instead.
let nowhere = (e: unknown) => missing(e) || unreachable(e)

// One break of the app's own making, where its agent reads it — the app's
// store, its serving version, and the members told. Both ways the app's code
// can fall over come through here, because they are one event: a worker that
// answers 500 and a worker that throws are the same app not working.
let broke = (
  env: Env,
  space: Space,
  app: App,
  req: Request,
  said: { message: string; stack?: string },
) =>
  serving(env, space, app).then((version) =>
    noted((bundles) =>
      metaOf(storeOf(env.STORE, storeName(space, app)))
        .apply(bundles, KERNEL), {
      request: `worker ${req.method} ${new URL(req.url).pathname}`,
      version,
      ...said,
    }, { env, space, app })
  )

// THE SEAM (T-33234). `worker.fetch` below is the one line in the whole
// kernel where the code running is the app's and not ours, so it is the one
// place a throw may be filed as the APP's break. Everything on either side of
// it — routing, the directory, a store object, the bucket, the dispatch
// binding itself — is the platform's own code, and what falls over there is
// the platform's however loudly the URL names an app.
//
// It used to be left to throw, and index.ts's catch-all filed it by ROUTE:
// whatever app the URL named wore every failure that escaped, so evicting a
// Store object on a platform deploy wrote "your app broke" into a customer's
// store, on their version, against their metered writes, to every member of
// their space. The catch-all cannot tell whose code it was; here we know.
//
// Null is "there is no script": no dispatch namespace (local dev), or an app
// that never deployed a worker. A throw is the app's code falling over, and
// what that MEANS is the callers' — it ends the request for the app that owns
// the path (`ran`) and is skipped for the home app's router (`ahead`).
let called = async (
  env: Env,
  space: Space,
  app: App,
  req: Request,
  who: Who,
): Promise<Response | null> => {
  if (!env.DISPATCH || !env.SESSION_SECRET) return null
  let store = storeName(space, app)
  let worker
  try {
    worker = env.DISPATCH.get(scriptName(store))
  } catch (e) {
    // Not the app's code — the namespace refusing to hand it over is ours.
    if (nowhere(e)) return null
    throw e
  }
  try {
    return await worker.fetch(
      await handed(req, app, store, who, env.SESSION_SECRET),
    )
  } catch (e) {
    if (nowhere(e)) return null
    throw e
  }
}

// The app's code fell over, written where its agent reads it. A no it relayed
// by THROWING what a door answered it is not a break, the same rule the
// answered status reads (unseen.ts `refusal`).
let threw = async (
  env: Env,
  space: Space,
  app: App,
  req: Request,
  e: unknown,
) => {
  let said = e instanceof Error ? e.message : String(e)
  if (refusal(said)) return
  await broke(env, space, app, req, {
    message: said,
    stack: e instanceof Error ? e.stack ?? '' : '',
  })
}

// What the worker's answer MEANS, whichever caller asked for it: a 404 is the
// PASS verdict — null, so the files answer behind it — a 4xx is the app's own
// deliberate no and files nothing (unseen.ts `refusal`), and a 5xx is not a
// throw and would otherwise go unseen, so it is written here.
let verdict = async (
  env: Env,
  space: Space,
  app: App,
  req: Request,
  res: Response | null,
) => {
  if (!res) return null
  if (res.status == 404) {
    await res.body?.cancel()
    return null
  }
  if (failed(res.status)) {
    await broke(env, space, app, req, {
      message: `the app's worker answered ${res.status}`,
      stack: '',
    })
  }
  return res
}

// The app's own worker, or null to serve the files instead — which is what
// no worker means, and what a worker's own 404 means, so an app can answer
// its routes and leave its pages to the platform. A throw ends the request:
// this app is the one that owes an answer, so the visitor gets the soft page,
// which is what the catch-all gave them before and all it ever gave them.
export let ran = async (
  env: Env,
  space: Space,
  app: App,
  req: Request,
  who: Who,
): Promise<Response | null> => {
  let res
  try {
    res = await called(env, space, app, req, who)
  } catch (e) {
    await threw(env, space, app, req, e)
    return oops()
  }
  return verdict(env, space, app, req, res)
}

// How long the home app's router has to answer before the kernel routes
// without it. It sits in FRONT of another app's page, so this is time the
// visitor waits before the page they asked for even begins: long enough for a
// store read and an outside call, short enough that a stuck router costs the
// page a beat rather than the request. The grant it is handed outlives it by
// far (LIFE above), so nothing here is bounded by that.
let PATIENCE = 1_000

let LATE = `the router did not answer in ${PATIENCE}ms`

// The work, or that sentence, whichever comes first. Both halves of the race
// are handled, so a worker that answers after we stopped waiting is not an
// unhandled rejection.
let patient = <T>(work: Promise<T>) => {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<never>((_, no) => {
      timer = setTimeout(() => no(new Error(LATE)), PATIENCE)
    }),
  ])
}

/**
 * The HOME app's worker, run AHEAD of the app whose slug owns the path
 * (`router.first`, router.ts, D-34197). The same call `ran` makes, so the
 * router acts as the CALLER — `handed` seals the visitor's own grant on the
 * home app's store, and there is no other store it may name — and its 404 is
 * the same pass verdict every app worker already speaks.
 *
 * What differs is the other rule: FAIL OPEN. A throw or a hang is written on
 * the home app and answered null, so the owning app answers as if the router
 * were not there. A broken router costs a space its customizations, never its
 * pages.
 */
export let ahead = async (
  env: Env,
  space: Space,
  home: App,
  req: Request,
  who: Who,
): Promise<Response | null> => {
  let res
  try {
    res = await patient(called(env, space, home, req, who))
  } catch (e) {
    await threw(env, space, home, req, e)
    return null
  }
  return verdict(env, space, home, req, res)
}

// ── The upload side: what app_deploy does with a worker.js ─────────────────

// The account's Workers API, and what the platform is allowed to say to it.
// The token is the owner's (T-32781): Workers Scripts Edit for this account,
// set with `wrangler secret put CF_WORKERS_TOKEN`. Until it is set, an app
// with a worker deploys its files and is told what is missing — never a 400
// and never a half-deploy.
export let NEEDS_TOKEN =
  'this app has a worker.js, and the platform has no Cloudflare token to ' +
  'upload it with (CF_WORKERS_TOKEN) — the files are deployed and serving; ' +
  'the worker is not'

let api = (env: Env, path: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT}` +
  `/workers/dispatch/namespaces/${NAMESPACE}/scripts${path}`

// What the API answered, or the sentence it refused with. Cloudflare wraps
// every reply in `{success, errors, result}`, so a failure is read out of
// the body and not only off the status. Exported because that envelope is
// the whole account API's, not this door's: domains.ts speaks the same one.
export let answered = async (r: Response) => {
  let body = await r.text()
  let said = (() => {
    try {
      return JSON.parse(body) as {
        success?: boolean
        errors?: { message?: string }[]
        result?: unknown
      }
    } catch {
      return null
    }
  })()
  if (r.ok && said?.success) return said.result
  let why = said?.errors?.map((e) => e.message).filter(Boolean).join('; ')
  throw new Error(`cloudflare: ${why || body.slice(0, 400) || r.status}`)
}

let sent = (env: Env, path: string, init: RequestInit) =>
  fetch(api(env, path), {
    ...init,
    headers: {
      authorization: `Bearer ${env.CF_WORKERS_TOKEN}`,
      ...(init.headers as Record<string, string> ?? {}),
    },
  })

// ── The modules a script is made of (T-34263) ──────────────────────────────
//
// An app's worker is not always one file: a worker compiled from another
// language is a `.wasm` beside the `.js` that imports it, and an app may
// simply split its server code in two. The upload carries every one of them.

// One module of the app's script: the name it is imported by — which is the
// app's own path for the file — and its bytes.
export type Module = { name: string; bytes: Uint8Array<ArrayBuffer> }

// What Cloudflare calls each kind of module, by the extension the app spelled
// it with (wrangler's own `moduleTypeMimeType`). The type is what decides how
// the runtime treats the part: an ES module is linked, a `.wasm` arrives as a
// `WebAssembly.Module` the worker instantiates
// (https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/),
// a `.txt` as a string, and anything else as an ArrayBuffer. A wasm part sent
// as JavaScript is a syntax error at upload, which is what a mislabelled
// module looks like from the agent's side.
let TYPES: Record<string, string> = {
  js: 'application/javascript+module',
  mjs: 'application/javascript+module',
  wasm: 'application/wasm',
  txt: 'text/plain',
}

let ESM = TYPES.js

export let moduleType = (name: string) =>
  TYPES[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream'

// The two shapes a static specifier sits in: after `from` (`import x from
// './y'`, `export * from './y'`) and after `import` itself (a bare
// `import './y'`, and `import('./y')` with a literal). Over-matching costs
// nothing — a word in a string that reads like an import names a file the app
// does not have, and a file that is not there is skipped — while missing one
// would leave a module out of the upload, which is the bug this ends.
let FROM = /\bfrom\s*(['"])([^'"\n]+)\1/g
let IMPORT = /\bimport\s*\(?\s*(['"])([^'"\n]+)\1/g

// In the order the file names them, so the module list is the app's own
// reading order and not an artefact of which pattern matched first. Only the
// app's OWN files: a bare specifier is the runtime's (`cloudflare:`, `node:`),
// and it resolves without us.
let specifiers = (source: string) =>
  [...source.matchAll(FROM), ...source.matchAll(IMPORT)]
    .sort((a, b) => a.index - b.index)
    .map((m) => m[2])
    .filter((s) => s.startsWith('./') || s.startsWith('../'))

// A specifier against the module that named it, the way the runtime resolves
// one: module names are the app's own paths, so `./lib.wasm` from `worker.js`
// is `lib.wasm` and `../lib.wasm` from `a/b.js` is `lib.wasm`. Walking it by
// hand rather than through URL keeps the name spelled exactly as the file
// store holds it, and `..` past the top pops nothing, so no specifier can
// name a file outside the app.
let resolved = (from: string, spec: string) => {
  let at = from.split('/').slice(0, -1)
  for (let seg of spec.split('/')) {
    if (seg == '.' || seg == '') continue
    if (seg == '..') at.pop()
    else at.push(seg)
  }
  return at.join('/')
}

/**
 * The modules the script carries: `worker.js`, everything it imports, and
 * everything those import, read out of the app's own files by `read`.
 *
 * A specifier naming a file the app never wrote is left out, and Cloudflare
 * refuses the upload naming the module it cannot find — a better sentence
 * than any this could invent, and the deploy is refused either way.
 */
export let carried = async (
  read: (path: string) => Promise<Uint8Array<ArrayBuffer> | null>,
): Promise<Module[]> => {
  let out: Module[] = []
  // `entry.js` is OURS: an app file by that name is never walked to and never
  // replaces the shim.
  let seen = new Set(['entry.js'])
  let walk = async (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    let bytes = await read(name)
    if (!bytes) return
    out.push({ name, bytes })
    // Only a JavaScript module has imports to follow; a wasm module's own
    // imports are satisfied by the JavaScript that instantiates it.
    if (moduleType(name) != ESM) return
    for (let spec of specifiers(new TextDecoder().decode(bytes))) {
      await walk(resolved(name, spec))
    }
  }
  await walk(WORKER)
  return out
}

// The app's worker into the namespace, wearing the shim. Multipart: one
// `metadata` part naming the entry module and the bindings, and one part per
// module named by its own filename
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/platform-examples/,
// https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/).
//
// The one binding is the service binding home: every door the app's code
// reaches — its store, its files — goes back through the kernel, so there is
// nothing else to grant and nothing to revoke. `keep_bindings: ['secret_text']`
// is what keeps the app's secrets across a deploy, since a re-upload
// otherwise replaces the binding list whole
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/).
//
// The limits are the platform's, per script and not per plan: an app's worker
// answers a page, so 50ms of CPU and 50 subrequests is roomy for a store read
// and an outside call and small enough that a loop is stopped rather than
// billed
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/custom-limits/).
//
// What it ANSWERS is Cloudflare's own name for this release of the script,
// which a deploy keeps beside its file manifest (versions.ts). The account
// API has spelled that several ways — a version id on the versioned upload
// door, a deployment id and an etag on this one — so whichever it hands back
// is read, and none of them is what a rollback restores FROM: putting an app
// back re-uploads the worker.js its version pinned, so it never depends on
// Cloudflare having kept anything.
export let upload = async (env: Env, store: string, modules: Module[]) => {
  let body = new FormData()
  body.append(
    'metadata',
    new Blob([
      JSON.stringify({
        main_module: 'entry.js',
        compatibility_date: '2025-05-08',
        bindings: [{ type: 'service', name: 'KERNEL', service: 'yak' }],
        keep_bindings: ['secret_text'],
        limits: { cpu_ms: 50, subrequests: 50 },
      }),
    ], { type: 'application/json' }),
  )
  // Each part is named by the module name that imports it, and typed by what
  // it IS — a `.wasm` as `application/wasm`, so the runtime compiles it
  // instead of trying to parse it as JavaScript.
  let part = (
    name: string,
    bytes: string | Uint8Array<ArrayBuffer>,
    type: string,
  ) => body.append(name, new Blob([bytes], { type }), name)
  part('entry.js', SHIM, ESM)
  for (let m of modules) part(m.name, m.bytes, moduleType(m.name))
  return named(
    await answered(
      await sent(env, `/${scriptName(store)}`, {
        method: 'PUT',
        body,
      }),
    ),
  )
}

// The release id out of whatever the API answered, and '' when it named none.
let named = (result: unknown) => {
  let r = (result ?? {}) as Record<string, unknown>
  for (let k of ['version_id', 'deployment_id', 'etag']) {
    if (typeof r[k] == 'string' && r[k]) return r[k]
  }
  return ''
}

// The app's worker gone, when its worker.js is (or when the app is). A
// script that was never there is not a failure to delete.
export let drop = async (env: Env, store: string) => {
  let r = await sent(env, `/${scriptName(store)}`, { method: 'DELETE' })
  if (r.status == 404) {
    await r.body?.cancel()
    return
  }
  await answered(r)
}

// ── Secrets (T-32779) ──────────────────────────────────────────────────────
//
// The first thing an app's own code is for: calling an outside service
// without the page holding the key. A secret lives on the SCRIPT and nowhere
// else — never in the app's store, never in the journal, never in a tool's
// answer — and the app's worker reads it as `env.NAME`, since the shim hands
// its own env through. Cloudflare's own list answers names and types without
// values, and the get door says the value is omitted
// (https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/subresources/secrets/methods/list/).
//
// A later deploy re-uploads the script with its binding list, which would
// otherwise replace the secrets whole; `keep_bindings: ['secret_text']` in
// `upload` above is what carries them across
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/).

// A binding is a JavaScript name in the app's own code, so it must be one.
export let SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

// A secret before any code, which is the natural order — a person hands over
// their key and then asks for the thing that uses it. There is no script to
// hold it yet, and the account API says so in its own words, `This Worker
// does not exist on your account.`, which names nothing anyone can do about
// it (C-32869 item 1). So the platform says what is missing and what fixes
// it, and the raw sentence stays for every other Cloudflare refusal.
export let NO_WORKER =
  'this app has no worker yet, and a secret lives on the worker: write a ' +
  'worker.js beside index.html (app_files) and app_deploy it, then set the ' +
  'secret'

let noScript = (e: unknown) =>
  e instanceof Error && /does not exist on your account/i.test(e.message)

let onScript = <T>(work: Promise<T>) =>
  work.catch((e) => {
    throw noScript(e) ? new Error(NO_WORKER) : e
  })

export let setSecret = (
  env: Env,
  store: string,
  name: string,
  value: string,
) =>
  onScript(
    sent(env, `/${scriptName(store)}/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, text: value, type: 'secret_text' }),
    }).then(answered),
  )

// The names, and only the names: whatever the API hands back, this reads the
// name off each row and drops the rest, so no value can leave here even if a
// later API decides to echo one.
export let secrets = async (env: Env, store: string): Promise<string[]> => {
  let r = await sent(env, `/${scriptName(store)}/secrets`, {})
  // No script yet is no secrets, not a failure: an app may be given its key
  // before it is given its code.
  if (r.status == 404) {
    await r.body?.cancel()
    return []
  }
  let got = await answered(r) as { name?: unknown }[] | null
  return (got ?? []).map((s) => String(s.name ?? '')).filter(Boolean)
}

export let dropSecret = (env: Env, store: string, name: string) =>
  onScript(
    sent(env, `/${scriptName(store)}/secrets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }).then(answered),
  )
