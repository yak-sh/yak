// Connections on yaks.app (D-38019): what the dashboard's connections page
// shows and does, the door an outside service sends a person back to after
// they sign in there, and the door its webhooks arrive at. What a connection
// is, and every verb over one, is @yaks/connections'; this file is where
// those verbs meet a request.
//
// A connection lives in the directory, owned by a space or by a person, and
// its credential in the vault (vault.ts). The directory keeps the handle and
// seals the key once the write has committed (graph.ts), and the write is
// answered after that, so the page drawn after a paste already says whether
// the key was saved.
//
// A service sends a person back to one address, the one registered for
// yaks.app, so the return is a door at the apex and the attempt rides a cookie
// there from the space's page: sealed for this use alone (lib/token.ts
// `connect`), naming the person, the space and the connection it was begun
// for, and the page to bring them back to.
//
// An app may ask each person who uses it to connect their own account
// (@yaks/connections `each`). The platform draws the Connect button for it, at
// the app's own address, `/<app>/api/connections/<integration>`: the page says
// which app wants which service, and connecting there makes the person's own
// connection, owned by them and shown in their own dashboard, and brings them
// back to the app. The space holds only the ask, which its page shows and
// nobody connects.
//
// A webhook lands as a `hook` (@yaks/hook) in the store of an app that uses
// the connection, at `/_yaks/hooks/<app>/<connection>` on the space's own
// address. Where the integration names a signature scheme, the connection's
// key is the secret it is checked against, and a request that fails is
// refused rather than kept.
import {
  begin,
  BUILT,
  connect,
  CONNECTION,
  connectionsDoc,
  type Ctx,
  disconnect,
  keyed,
  known,
  list,
  need,
  type Read,
  type Status,
  USES,
  using,
} from '@yaks/connections'
import { PROVISIONAL, provisionalDoc } from '@yaks/effects'
import type { Bundle, Comp } from '@yaks/graph'
import { hooked, refusal } from '@yaks/hook'
import { mode, reads } from '@yaks/member'
import { reveal, SECRET, secretsDoc } from '@yaks/secrets'
import { toolsDoc } from '@yaks/tools'
import type { Service } from './connected.ts'
import { type App, appStore, directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { apex, url } from './host.ts'
import { cookieValue, opened, seal } from './lib/token.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import type { Answer, Door, Plugin } from './plugin.ts'
import { MANAGE, managePath, signInAt } from './route.ts'
import { caught } from './sentry.ts'
import { domainOf, vouched, type Who, whoIs } from './session.ts'
import { vaulted, vaultOf } from './vault.ts'

/** Where a service sends a person back after they sign in there. */
export let CALLBACK = '/connections/callback'
/** Where a service's webhooks for one app and connection arrive. */
export let HOOKS = `${MANAGE}/hooks/`

// The cookie an attempt rides, and how long it may: the attempt's own ten
// minutes (@yaks/oauth `attempt`).
let ATTEMPT = 'yak_connect'
let ATTEMPT_AGE = 600

// The biggest webhook body kept, as a store keeps it: one blob.
let HOOK_ROOM = 1_000_000

let EID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** One connection, as the page shows it. */
export type Shown = {
  eid: string
  integration: string
  /** the signed-in person's own, rather than the space's */
  own: boolean
  /** each person who uses its apps connects their own; the space's is only
   * the ask */
  each: boolean
  status: Status
  account: string
  /** connected by pasting a key, rather than by signing in */
  keyed: boolean
  /** the hosts its key may be sent to */
  hosts: string[]
  /** the apps that call out through it, by title */
  apps: string[]
  /** why it is not finished yet: the note on its `provisional` mark */
  saving: string
  /** why its key could not be saved: the text beside its `error` or
   * `exception` */
  failed: string
}

/** What the connections page is drawn from. */
export type Connections = {
  /** whether this deploy can keep a key at all */
  on: boolean
  list: Shown[]
  /** outside services holding a grant from the person (connected.ts) */
  services: Service[]
  /** the built integrations nothing here is connected to yet */
  built: { name: string; keyed: boolean }[]
}

// The OAuth clients yaks.app is registered as, one per integration
// (`OAUTH_CLIENTS`). A value that does not read is no clients at all.
let clients = (env: Env): Record<string, { id: string; secret?: string }> => {
  try {
    return JSON.parse(env.OAUTH_CLIENTS ?? '{}')
  } catch {
    return {}
  }
}

// A read of the directory. Every read the verbs make is a filter line.
let readOf = (env: Env): Read => (q) =>
  typeof q == 'string' ? meta(env).query(q) : []

/** The verbs' context: the directory, the vault, and the person acting. */
export let ctxOf = (env: Env, who: Who): Ctx => {
  return {
    graph: {
      read: readOf(env),
      apply: (bundles) => meta(env).apply(bundles, vouched(who)),
    },
    vault: vaultOf(env),
    client: (i) => clients(env)[i.name],
    redirect: url(env, CALLBACK),
  }
}

/** Everything the page shows a space's owner: the space's connections and
 * their own, with the apps that use each — the space's by the titles given,
 * and another space's app they connected their own account for by its own. */
export let connectionsOf = async (
  env: Env,
  space: Space,
  person: string,
  apps: { eid: string; title: string; slug: string }[],
  services: Service[] = [],
): Promise<Connections> => {
  let read = readOf(env)
  let all = [...await list(read, space.eid), ...await list(read, person)]
  let links = all.filter((b) => b[USES])
  let named = new Map(apps.map((a) => [a.eid, a.title || a.slug]))
  let elsewhere = [...new Set(links.map((l) => String(comp(l, 'edge').from)))]
    .filter((eid) => !named.has(eid))
  if (elsewhere.length) {
    for (let b of await read(`.eid=${elsewhere.join(',')}&.app&*`)) {
      named.set(
        b.entity.eid,
        String(comp(b, 'doc').title || comp(b, 'app').slug),
      )
    }
  }
  let shown = await Promise.all(
    all.filter((b) => b[CONNECTION]).map(async (b): Promise<Shown> => {
      let c = comp(b, CONNECTION)
      let i = await known(read, String(c.integration))
      let failed = !b[PROVISIONAL] && (b.error || b.exception)
      let to = links.filter((l) => comp(l, 'edge').to == b.entity.eid)
      return {
        eid: b.entity.eid,
        integration: String(c.integration),
        own: c.owner == person,
        each: to.some((l) => comp(l, USES).each),
        status: (c.status ?? 'needed') as Status,
        account: String(c.account ?? ''),
        keyed: !i || keyed(i),
        hosts: i?.hosts ?? [],
        apps: to.map((l) =>
          named.get(String(comp(l, 'edge').from)) ?? 'another app'
        ),
        saving: String(comp(b, PROVISIONAL).note ?? ''),
        failed: failed
          ? String(comp(b, 'content').body ?? 'the key could not be saved')
          : '',
      }
    }),
  )
  let taken = new Set(shown.map((s) => s.integration))
  return {
    on: vaulted(env),
    list: shown.sort((a, b) => a.integration.localeCompare(b.integration)),
    services,
    built: Object.values(BUILT)
      .filter((i) => !taken.has(i.name))
      .map((i) => ({ name: i.name, keyed: keyed(i) })),
  }
}

/** What a POST from the page answers, when it is not a redirect. */
export type Said = { say: string; no: boolean }

let no = (say: string): Said => ({ say, no: true })

// The hosts a custom key may go to, as a person typed them.
let hostsOf = (text: string): string[] =>
  text.toLowerCase().split(/[\s,]+/).filter(Boolean)
let HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

// The attempt a sign-in is begun with, as its cookie holds it, and the page to
// bring the person back to.
type Held = {
  space: string
  connection: string
  person: string
  attempt: { state: string; until: number; verifier: string }
  back: string
}

// The connections page of a space, where a sign-in begun there comes back to.
let pageOf = (env: Env, space: string) =>
  `https://${space}.${apex(env)}${managePath('connections')}`

// A page, told how a sign-in went.
let told = (page: string, how: 'connected' | 'refused') => {
  let to = new URL(page)
  to.searchParams.set(how, '1')
  return to.href
}

// Whether a connection is an app's ask that each person answers with their
// own, which is nobody's to connect.
let asking = async (read: Read, eid: string) =>
  (await read(`.edge.to=${eid}&.${USES}!&*`)).some((l) => comp(l, USES).each)

// Send the person to the service, the attempt riding a cookie to the return.
let signingIn = async (
  req: Request,
  env: Env,
  c: Ctx,
  space: Space,
  who: Who,
  eid: string,
  back = pageOf(env, space.slug),
): Promise<Response> => {
  let { url: to, attempt } = await begin(c, eid)
  let held: Held = {
    space: space.slug,
    connection: eid,
    person: who.person!,
    attempt,
    back,
  }
  let domain = domainOf(req, env)
  return new Response(null, {
    status: 303,
    headers: {
      location: to,
      'set-cookie': `${ATTEMPT}=${await seal(
        'connect',
        held,
        env.SESSION_SECRET!,
      )}; ${
        domain ? `Domain=${domain}; ` : ''
      }Path=${CALLBACK}; Max-Age=${ATTEMPT_AGE}; Secure; HttpOnly; SameSite=Lax`,
    },
  })
}

/**
 * A POST from the connections page: a key pasted into a connection, a Connect
 * button, a Disconnect button, or a new connection — a service nobody built,
 * given a name, the hosts its key may go to and the key. Answered as a
 * redirect when the person is sent to a service to sign in, else as what the
 * page should say.
 */
export let connecting = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
  form: FormData,
): Promise<Response | Said> => {
  let field = (k: string) => String(form.get(k) ?? '').trim()
  let act = field('do')
  let c = ctxOf(env, who)
  let key = field('key')
  if ((act == 'key' || act == 'add') && !vaulted(env)) {
    return no("Keys can't be saved here yet.")
  }
  try {
    let eid = field('connection')
    if (act == 'add') {
      let name = field('integration').slice(0, 60)
      let hosts = hostsOf(field('hosts'))
      if (!name) return no('Give the service a name.')
      if (hosts.some((h) => !HOST.test(h))) {
        return no('A host is an address like api.example.com.')
      }
      let made = await c.graph.apply(
        await need(c.graph.read, {
          owner: space.eid,
          integration: name,
          hosts,
        }),
      )
      eid = made[0].entity.eid
      let i = await known(c.graph.read, name)
      if (i && !keyed(i)) return signingIn(req, env, c, space, who, eid)
    }
    let [b] = EID.test(eid)
      ? await c.graph.read(`.eid=${eid}&.${CONNECTION}`)
      : []
    let owner = comp(b, CONNECTION).owner
    if (!b || (owner != space.eid && owner != who.person)) {
      return no('That connection is not here any more.')
    }
    if (act == 'disconnect') {
      await disconnect(c, eid)
      return { say: 'Disconnected.', no: false }
    }
    if (owner == space.eid && await asking(c.graph.read, eid)) {
      return no('Each person connects their own, from the app.')
    }
    if (act == 'signin') return signingIn(req, env, c, space, who, eid)
    if (!key) return no('Paste the key first.')
    await connect(c, eid, { key })
    let [now] = await c.graph.read(`.eid=${eid}&.${CONNECTION}&*`)
    return now?.error || now?.exception
      ? no(String(comp(now, 'content').body ?? 'The key could not be saved.'))
      : { say: 'Saved. The key is kept safe and never shown again.', no: false }
  } catch (e) {
    caught(e, { request: 'POST /_yaks/connections' })
    return no(e instanceof Error ? e.message : "That didn't work.")
  }
}

// The directory the doors below ask, as apps.ts asks it.
let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

// The return from a service's sign-in page. The attempt must be this
// person's, for their own connection or one of a space they still own;
// anything else is sent back to their account to start again.
let callback: Door = async ({ env, req, path, space }) => {
  if (space != null || path != CALLBACK) return null
  let gone = `${ATTEMPT}=; Path=${CALLBACK}; Max-Age=0; Secure; HttpOnly`
  let answer = (to: string) =>
    new Response(null, {
      status: 303,
      headers: { location: to, 'set-cookie': gone },
    })
  let sealed = cookieValue(req.headers.get('cookie'), ATTEMPT)
  let held = sealed && env.SESSION_SECRET
    ? await opened<Held>('connect', sealed, env.SESSION_SECRET)
    : null
  let dir = dirOf(env)
  let at = held ? await dir.space(held.space) : null
  let who = at &&
    await whoIs(req, env.SESSION_SECRET, (p) => dir.role(at, p))
  let [b] = held && who?.person == held.person
    ? await readOf(env)(`.eid=${held.connection}&.${CONNECTION}`)
    : []
  let owner = comp(b, CONNECTION).owner
  if (
    !held || !at || !who || !b ||
    owner != who.person && !(owner == at.eid && who.role == 'owner')
  ) {
    return answer(url(env, '/manage'))
  }
  // An attempt begun before its cookie named a page came from the space's.
  let back = held.back ?? pageOf(env, at.slug)
  try {
    await connect(ctxOf(env, who), held.connection, {
      attempt: held.attempt,
      callback: req.url,
    })
    return answer(told(back, 'connected'))
  } catch (e) {
    caught(e, { request: `GET ${CALLBACK}` })
    return answer(told(back, 'refused'))
  }
}

// Where an app sends a person to connect their own account, within its
// `/api/`.
let OWN = '/connections/'

// The Connect button an app asks for, drawn by the platform at the app's own
// address. Whoever may read the app may connect their own account for it, once
// the app asks each person for that integration; what they connect is theirs,
// and only they call out through it. A sign-in's cookie must reach the
// platform's callback, so a request at a space's own domain is sent to the
// same page at the platform's address first.
let own: Answer = async ({ env, req, path, space, app, who, refuse }) => {
  if (!path.startsWith(OWN)) return null
  let integration = decodeURIComponent(path.slice(OWN.length))
  let here = `https://${space.slug}.${apex(env)}/${app.slug}/api${path}`
  if (!domainOf(req, env)) return Response.redirect(here, 303)
  if (!who.person) return Response.redirect(signInAt(here, env), 303)
  if (!reads(mode(app.access), who.role)) return refuse('not_a_reader')
  let c = ctxOf(env, who)
  let asked = await using(c.graph.read, {
    app: app.eid,
    integration,
    owner: space.eid,
    each: true,
  })
  let i = asked && await known(c.graph.read, integration)
  // Loaded here, as the doors are (T-37977): pages.ts reaches the plugin list,
  // which names this file.
  let { askConnect, lost } = await import('./pages.ts')
  if (!asked || !i) return lost(env)
  let back = `https://${space.slug}.${apex(env)}/${app.slug}/`
  let page = async (said?: Said) => {
    let mine = await using(c.graph.read, {
      app: app.eid,
      integration,
      owner: who.person!,
      each: true,
    })
    return askConnect({
      app: app.title,
      integration,
      keyed: keyed(i),
      on: !keyed(i) || vaulted(env),
      status: (comp(mine, CONNECTION).status ?? 'needed') as Status,
      back,
      ...said,
    }, env)
  }
  if (req.method != 'POST') return page()
  let form = await req.formData().catch(() => new FormData())
  let key = String(form.get('key') ?? '').trim()
  if (keyed(i) && !vaulted(env)) {
    return page(no("Keys can't be saved here yet."))
  }
  if (keyed(i) && !key) return page(no('Paste the key first.'))
  try {
    let [made] = await c.graph.apply(
      await need(c.graph.read, {
        owner: who.person,
        app: app.eid,
        integration,
        scopes: (comp(asked, CONNECTION).scopes ?? []) as string[],
        each: true,
      }),
    )
    let eid = made.entity.eid
    if (!keyed(i)) return signingIn(req, env, c, space, who, eid, back)
    await connect(c, eid, { key })
    let [now] = await c.graph.read(`.eid=${eid}&.${CONNECTION}&*`)
    return now?.error || now?.exception
      ? page(
        no(String(comp(now, 'content').body ?? 'The key could not be saved.')),
      )
      : Response.redirect(told(back, 'connected'), 303)
  } catch (e) {
    caught(e, { request: `POST /api${path}` })
    return page(no(e instanceof Error ? e.message : "That didn't work."))
  }
}

// The connection an app may receive webhooks through: the space's, and used
// by that app.
let hookable = async (env: Env, space: Space, app: App, eid: string) => {
  if (!EID.test(eid)) return null
  let read = readOf(env)
  let [b] = await read(`.eid=${eid}&.${CONNECTION}&*`)
  if (!b || comp(b, CONNECTION).owner != space.eid) return null
  let used = await read(`.edge.from=${app.eid}&.edge.to=${eid}&.${USES}!`)
  return used.length ? b : null
}

// A webhook, kept in the app's store as the request it was.
let hook: Door = async ({ env, req, path, space: slug }) => {
  if (slug == null || !path.startsWith(HOOKS)) return null
  let lost = () => new Response('not found', { status: 404 })
  if (req.method != 'POST') {
    return new Response('webhooks are POSTed', { status: 405 })
  }
  let [name, eid, ...rest] = path.slice(HOOKS.length).split('/')
  let dir = dirOf(env)
  let space = rest.length ? null : await dir.space(slug)
  let app = space && name ? await dir.app(space, name) : null
  let b = space && app && !app.trashed
    ? await hookable(env, space, app, eid)
    : null
  if (!space || !app || !b) return lost()
  let body = await req.text()
  if (body.length > HOOK_ROOM) {
    return new Response('too large', { status: 413 })
  }
  let i = await known(readOf(env), String(comp(b, CONNECTION).integration))
  let verified: boolean | undefined
  if (i?.signature) {
    let key = keyed(i)
      ? await reveal(vaultOf(env), String(comp(b, SECRET).name), {
        env: () => undefined,
      })
      : undefined
    let why = key
      ? await refusal(i.signature, key, body, req.headers)
      : 'no key is kept to check it with'
    if (why) return new Response(why, { status: 401 })
    verified = true
  }
  let headers = Object.fromEntries(
    [...req.headers].filter(([k]) => k != 'cookie'),
  )
  let id = req.headers.get('webhook-id') ??
    req.headers.get('x-github-delivery') ?? crypto.randomUUID()
  await metaOf(appStore(env.STORE, space, app, env)).apply(
    hooked({
      id,
      source: String(comp(b, CONNECTION).integration),
      method: req.method,
      path,
      headers: JSON.stringify(headers),
      body,
      ...(verified == null ? {} : { verified }),
    }),
    KERNEL,
  )
  return new Response(null, { status: 204 })
}

/**
 * Connections, as what they contribute (plugin.ts): the words the directory
 * keeps them in — the connection and its integration, the secret its
 * credential is, the mark it wears while that is saved, and the text a
 * failure is said in beside `error` — the two doors, and the Connect button
 * at an app's address.
 */
export let connectionsPlugin: Plugin = {
  name: 'connections',
  vocab: [
    secretsDoc,
    connectionsDoc,
    provisionalDoc,
    { title: 'content', $defs: { content: toolsDoc.$defs!.content } },
  ],
  routes: [callback, hook],
  answers: [own],
}
