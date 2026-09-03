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
// so under `wrangler dev` the binding is simply undefined and every app
// serves its files the way it always did. `remote = true` in wrangler.toml
// would point local dev at the deployed namespace; we do not set it, because
// a test must not need the account.
import { COOKIE, opened, seal } from '../../src/token.ts'
import type { App, Role, Space } from './directory.ts'
import { storeName } from './directory.ts'
import type { Env, Fetcher } from './env.ts'
import type { Who } from './session.ts'
import { storeOf } from './store.ts'
import { noted } from './unseen.ts'

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

// What the platform runs, with the app's own module inside it. Uploaded as
// the script's `main_module` beside `worker.js`, which it imports — a
// multipart upload may carry several ES modules, and the entry is whichever
// one `main_module` names
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/platform-examples/).
//
// It is deliberately tiny and deliberately first: it is the only thing
// between the app's code and the grant.
export let SHIM = `import app from './worker.js'

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

// The app's own worker, or null to serve the files instead — which is what
// no worker means, and what a worker's own 404 means, so an app can answer
// its routes and leave its pages to the platform.
//
// A worker that throws is left to throw: index.ts's catch-all writes the
// exception with this app's version, which is the same entity a page's break
// becomes. A 5xx is not a throw and would go unseen, so it is written here.
export let ran = async (
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
    if (missing(e)) return null
    throw e
  }
  let res
  try {
    res = await worker.fetch(
      await handed(req, app, store, who, env.SESSION_SECRET),
    )
  } catch (e) {
    if (missing(e)) return null
    throw e
  }
  if (res.status == 404) {
    await res.body?.cancel()
    return null
  }
  if (res.status >= 500) {
    await noted(storeOf(env.STORE, store), {
      request: `worker ${req.method} ${new URL(req.url).pathname}`,
      version: app.version,
      message: `the app's worker answered ${res.status}`,
      stack: '',
    })
  }
  return res
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
// the body and not only off the status.
let answered = async (r: Response) => {
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

// The app's worker.js into the namespace, wearing the shim. Multipart: one
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
export let upload = async (env: Env, store: string, source: string) => {
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
  let module_ = (name: string, text: string) =>
    body.append(
      name,
      new Blob([text], { type: 'application/javascript+module' }),
      name,
    )
  module_('entry.js', SHIM)
  module_('worker.js', source)
  return answered(
    await sent(env, `/${scriptName(store)}`, { method: 'PUT', body }),
  )
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
