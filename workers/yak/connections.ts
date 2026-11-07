import { decodedPath } from './request-path.ts'
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
// there from the page it was begun on: sealed for this use alone (lib/token.ts
// `connect`), naming the person, the space and the connection it was begun
// for, and the page to bring them back to.
//
// An app may ask each person who uses it to connect their own account
// (@yaks/connections `each`). The platform draws the Connect button for it, at
// the app's own address, `/<app>/api/connections/<integration>`: the page says
// which app wants which service, and connecting there makes the person's own
// connection, owned by them and shown on their own space's connections page,
// and brings them back to the app. The space holds only the ask, which its page shows and
// nobody connects.
//
// A webhook lands as a `hook` (@yaks/hook) in the store of an app that uses
// the connection, at `/_yaks/hooks/<app>/<connection>` on the space's own
// address. Where the integration names a signature scheme, the connection's
// key is the secret it is checked against, and a request that fails is
// refused rather than kept.
import {
  ABOUT,
  type About,
  attach,
  begin,
  bindingOf,
  borrowed,
  carry,
  clientOf,
  connect,
  connectable,
  CONNECTION,
  type Ctx,
  disconnect,
  envOf,
  type Field,
  fieldsOf,
  type Given,
  installed,
  type Integration,
  integrationEid,
  keyed,
  known,
  knownIn,
  lend,
  list,
  LISTED,
  namesOf,
  need,
  type Owners,
  type Path,
  type Read,
  recall,
  set,
  type Status,
  USES,
  using,
} from '@yaks/connections'
import { edgeEid } from '@yaks/edge'
import { PROVISIONAL } from '@yaks/effects'
import { capOf, monthOf, spent } from '@yaks/egress'
import type { Bundle, Comp } from '@yaks/graph'
import { hooked, refusal } from '@yaks/hook'
import { mode, reads } from '@yaks/member'
import { reveal, SECRET } from '@yaks/secrets'
import type { Service } from './connected.ts'
import {
  type App,
  appStore,
  directory,
  scriptOf,
  type Space,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { apex, url } from './host.ts'
import { cookieValue, opened, seal } from './lib/token.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import type { Answer } from './apps.ts'
import type { Door } from './route.ts'
import { enabling, MANAGE, manageAt, OURS, signInAt } from './route.ts'
import { caught } from './defects.ts'
import { domainOf, vouched, type Who, whoIs } from './session.ts'
import {
  APP,
  type Ctx as Asking,
  inApp,
  inSpace,
  refuse,
  type Row,
  SPACE,
  str,
  text,
  worded,
} from './tool.ts'
import { vaulted, vaultOf } from './vault.ts'
import { drawn } from './theirs.ts'
import { INTEGRATIONS, said } from './integrations.ts'
import { EITHER } from './preauth.ts'

/** Where a service sends a person back after they sign in there. */
export let CALLBACK = '/connections/callback'
/** Where a service's webhooks for one app and connection arrive. */
export let HOOKS = `${OURS}/hooks/`

// The cookie an attempt rides, and how long it may: the attempt's own ten
// minutes (@yaks/oauth `attempt`).
let ATTEMPT = 'yak_connect'
let ATTEMPT_AGE = 600

// The biggest webhook body kept, as a store keeps it: one blob.
let HOOK_ROOM = 1_000_000

let EID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let strs = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : []

/** A service as a page draws it: what a person calls it, a line about it,
 * its site, its logo and how to get its key, each empty where its integration
 * says none. */
export type Face = {
  title: string
  tagline: string
  site: string
  /** an SVG document, drawn as an image */
  logo: string
  /** how a person gets its key, drawn from its markdown as HTML, its links
   * marked as the writer's (theirs.ts) */
  instructions: string
  /** what it says was written by the space that made it, not by yaks.app */
  theirs: boolean
  /** what a person gives to connect it with a pasted key: its one key, or
   * the fields it names */
  fields: Field[]
}

/** The face of an integration, called by its name where it has no title. */
export let faceOf = async (name: string, i?: Integration): Promise<Face> => ({
  title: i?.title || name,
  tagline: i?.tagline ?? '',
  site: i?.site ?? '',
  logo: i?.logo ?? '',
  instructions: await drawn(i?.instructions),
  theirs: !i?.built,
  fields: fieldsOf(i),
})

/** What a person typed into a key box (pages.ts `keyBox`): the one key, or
 * each field by name; or what the page says when one was left empty. */
export let givenOf = (form: FormData, fields: Field[]): Given | string => {
  let at = (k: string) => String(form.get(k) ?? '').trim()
  if (fields.length == 1) {
    return at('key') ? { key: at('key') } : 'Paste the key first.'
  }
  let said = Object.fromEntries(
    fields.map((f) => [f.name, at(`key.${f.name}`)]),
  )
  let missing = fields.find((f) => !said[f.name])
  return missing ? `Fill in ${missing.label} first.` : { fields: said }
}

/** One connection, as the page shows it. */
export type Shown = {
  eid: string
  integration: string
  face: Face
  /** the signed-in person's own, rather than the space's: shown only on
   * their own space's page */
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
  /** its integration was made by the space or person it is kept for, who may
   * change what is said about it: these, as written */
  about: About | null
  /** its integration is in the integration directory: listed by its owner,
   * or built */
  listed: boolean
  scopes: string[]
  /** the apps that call out through it */
  apps: Using[]
  /** the name an app attached to it reads it by, unless the owner names one */
  binding: string
  /** live apps in this space that the owner may attach */
  available: { app: string; title: string }[]
  /** why it is not finished yet: the note on its `provisional` mark */
  saving: string
  /** how to get its key, as its integration says */
  instructions: string
  /** why its key could not be saved: the text beside its
   * `exception` */
  failed: string
}

/** One app calling out through a connection, as the page shows it. */
export type Using = {
  /** the app's eid */
  app: string
  title: string
  /** its address, the name every tool takes, for an app of this space; empty
   * for one elsewhere */
  slug: string
  /** what its code reads it as, env.NAME */
  binding: string
  /** handed the key itself rather than a sentinel */
  direct: boolean
  /** anyone using the app may call out through it, not only its members */
  anyone: boolean
  /** the space's side of an ask each person answers with their own */
  each: boolean
  /** the calls it made through it this month (@yaks/egress `calls`) */
  calls: number
  /** the most calls a month it may make, or null for no limit */
  cap: number | null
  /** the cap each copy installed from it borrows the connection under, or
   * null where it lends it to none (@yaks/connections `lend`) */
  lends: number | null
  /** for a copy borrowing it from another space's app: the space the copy is
   * in, as its people call it; null for an app of the connection's own */
  borrower: string | null
}

/** A connection an app here borrows from the space that lends it, as the
 * page shows it: whose it is, and what the app has spent of its cap. */
export type Borrowed = {
  /** the connection lent */
  eid: string
  integration: string
  face: Face
  /** connected by pasting a key, rather than by signing in */
  keyed: boolean
  /** where its key may be sent, and so a key of the borrower's own */
  hosts: string[]
  /** the space lending it, as its people call it */
  lender: string
  /** the app borrowing it */
  app: Using
}

/** What the connections page is drawn from. */
export type Connections = {
  /** whether this deploy can keep a key at all */
  on: boolean
  list: Shown[]
  /** outside services holding a grant from the person (connected.ts), on
   * their own space's page */
  services: Service[]
  /** the built integrations nothing here is connected to yet, and this deploy
   * can connect: one reached by OAuth needs the client it names kept in the
   * vault (@yaks/connections `registration`) */
  built: { name: string; keyed: boolean; face: Face }[]
  /** the testing integrations the page was opened for (`enabled`), which its
   * forms carry */
  enable?: string[]
  /** the integration the page was opened to add (`?add=<name>`, from the
   * integration directory), while this space has none through it */
  asked?: { name: string; keyed: boolean; face: Face }
  /** what the apps of this space borrow from another space's lend */
  borrowed: Borrowed[]
}

// A read of the directory. Every read the verbs make is a filter line.
let readOf = (env: Partial<Env> & Pick<Env, 'STORE'>): Read => (q) =>
  typeof q == 'string' ? meta(env).query(q) : []

/** The verbs' context: the directory, the vault, and the person acting — or
 * the kernel, for what nobody in particular does (a token refreshed on the way
 * out, an app's bindings brought up to date). */
export let ctxOf = (env: Partial<Env> & Pick<Env, 'STORE'>, who?: Who): Ctx => {
  return {
    graph: {
      read: readOf(env),
      apply: (bundles) => meta(env).apply(bundles, who ? vouched(who) : KERNEL),
    },
    vault: vaultOf(env),
    redirect: url(env, CALLBACK),
  }
}

/** Whose space each app is in (@yaks/connections `Owners`): what its row in
 * the directory says. */
export let ownersOf =
  (env: Partial<Env> & Pick<Env, 'STORE'>): Owners => async (apps) =>
    apps.length
      ? Object.fromEntries(
        (await readOf(env)(`.entity.eid=${apps.join(',')}&.app`))
          .map((b) => [b.entity.eid, String(comp(b, 'app').space)]),
      )
      : {}

// What a space's people call it, for each of these: its title, else its
// address. The space at hand is known, and only the others are read.
let spaceNames = async (read: Read, here: Space, spaces: string[]) => {
  let away = [...new Set(spaces)].filter((eid) => eid != here.eid)
  return new Map([
    [here.eid, here.title || here.slug],
    ...away.length
      ? (await read(`.entity.eid=${away.join(',')}&.space&?doc`))
        .map((b) =>
          [
            b.entity.eid,
            String(comp(b, 'doc').title || comp(b, 'space').slug),
          ] as const
        )
      : [],
  ])
}

/** What an app's code reads as env.NAME from the connections it uses
 * (@yaks/connections `envOf`), and nothing where no vault is kept. */
export let connectedEnv = async (env: Env, app: App) =>
  vaulted(env) ? await envOf(ctxOf(env), app.eid) : {}

/**
 * An app's running worker brought up to date with the connections it uses
 * (dispatch.ts): each `uses` link's binding set to the connection's sentinel,
 * or to its key for a direct link, and a binding whose connection holds no
 * credential any more taken off. The worker is the live release's script
 * (directory.ts `scriptOf`), so a connection made or attached after a deploy
 * reaches the app at once. A name no link gives is not this function's to
 * touch, except one in `gone`: a name its link was just taken from. An app
 * whose release built no worker has nothing to bind — a release's script is
 * uploaded bound already (deploy_worker.ts) — and neither has a deploy with no
 * vault or no Cloudflare token. A worker its release built and the namespace
 * doesn't have is a failure.
 */
export let rebind = async (
  env: Env,
  space: Space,
  app: App,
  gone: string[] = [],
) => {
  if (!env.CF_WORKERS_TOKEN || !vaulted(env)) return
  let { dropSecret, secrets, setSecret } = await import('./dispatch.ts')
  let script = scriptOf(space, app)
  let had = await secrets(env, script)
  if (!had) {
    if (!app.worker) return
    throw Error(`${space.slug}/${app.slug}'s worker ${script} is not there`)
  }
  let want = await connectedEnv(env, app)
  let read = readOf(env)
  let links = await read(`.edge.from=${app.eid}&.${USES}&*`)
  let held = links.length
    ? await read(
      `.entity.eid=${
        links.map((l) => comp(l, 'edge').to).join(',')
      }&.${CONNECTION}`,
    )
    : []
  // Every name a link gives: its binding, or one for each field of several.
  let names = async (l: Bundle) => {
    let b = held.find((b) => b.entity.eid == comp(l, 'edge').to)
    let i = b && await known(read, integrationOf(b))
    let fields = i && keyed(i) ? fieldsOf(i) : fieldsOf()
    return Object.values(
      namesOf(String(comp(l, USES).binding), fields.map((f) => f.name)),
    )
  }
  let owned = [...(await Promise.all(links.map(names))).flat(), ...gone]
  for (let [name, value] of Object.entries(want)) {
    await setSecret(env, script, name, value)
  }
  for (let name of had) {
    if (owned.includes(name) && !(name in want)) {
      await dropSecret(env, script, name)
    }
  }
}

/**
 * What a copy of an app asks its space for, read off the app it was copied
 * from (@yaks/connections `carry`): the bundles that make each ask, for an
 * install to write with the copy's row and an update before its release, and
 * the line its answer says of them, naming where each is connected. Nothing
 * is written here.
 */
export let carried = async (
  env: Env,
  space: Space,
  copy: { eid: string; slug: string },
  source: string,
) => {
  let asks = await carry(readOf(env), {
    source,
    app: copy.eid,
    owner: space.eid,
  })
  let loans = asks.filter((l) => comp(l, USES).lender != null)
  let lent = loans.length
    ? await readOf(env)(
      `.entity.eid=${
        loans.map((l) => comp(l, 'edge').to).join(',')
      }&.${CONNECTION}`,
    )
    : []
  let named = (each: boolean) =>
    asks.filter((l) =>
      l[USES] && comp(l, USES).lender == null &&
      !comp(l, USES).each == !each
    ).map((l) =>
      integrationOf(asks.find((b) => b.entity.eid == comp(l, 'edge').to))
    )
  let shared = named(false), each = named(true)
  let borrowed = loans.map((l) =>
    `${integrationOf(lent.find((b) => b.entity.eid == comp(l, 'edge').to))} ` +
    `(${comp(l, USES).cap} calls a month)`
  )
  let own = `https://${space.slug}.${apex(env)}/${copy.slug}/api/connections/`
  return {
    asks,
    said:
      (borrowed.length
        ? `\nborrows ${borrowed.join(', ')} from the app's maker; no key ` +
          'or data is copied. Its owner can connect their own instead.'
        : '') +
      (shared.length
        ? `\nasks for ${shared.join(', ')}: the person pastes each key or ` +
          `signs in at ${pageOf(env, space.slug)}, never in this chat ` +
          '(store_connection_list says how to get each)'
        : '') +
      (each.length
        ? `\nasks each person who uses it to connect their own ${
          each.join(', ')
        }, at ${each.map((n) => own + encodeURIComponent(n)).join(', ')}`
        : ''),
  }
}

// The apps that use a connection, asked before it changes: a connection ended
// takes its links with it, and its apps are linked to a new one.
let usersOf = async (env: Env, connection: string): Promise<string[]> =>
  (await readOf(env)(`.edge.to=${connection}&.${USES}&*`))
    .map((l) => String(comp(l, 'edge').from))

// The same for each of those apps: after a key is kept, a sign-in finished,
// or a connection ended. The person's act is done either way, so a worker
// that could not be brought up to date is ours to hear about, not theirs.
let rebound = async (env: Env, apps: string[]) => {
  let dir = dirOf(env)
  for (let eid of apps) {
    let at = await dir.appAt(eid)
    if (!at) continue
    await rebind(env, at.space, at.app).catch((e) =>
      caught(e, { request: 'rebind', app: at.app.slug })
    )
  }
}

/** The testing integrations a page was opened for: `?enable=<name>`, several
 * by repeating it or with commas. */
export let enabled = (req: Request): string[] =>
  new URL(req.url).searchParams.getAll('enable').flatMap((n) => n.split(','))

/** What one space's connections page shows: the space's connections, with
 * the apps that use each, and what its apps borrow. On the person's own space
 * (`own`) it shows theirs too: what they connected for an app that asks each
 * person, and the outside services holding a grant from them. What nothing
 * here is connected to yet is offered to the space — a testing integration
 * only when `enable` names it.
 *
 * A space still being learned (a door admitting its caller) is asked `by` the
 * walk to it, so what the page is drawn from travels in the same trip as
 * what learns the space, and is kept to it once known: a walk that missed it
 * is asked again by its eid. */
export let connectionsOf = async (
  env: Env,
  space: Space | Promise<Space>,
  person: string,
  at: {
    /** whether it is the person's own space; still being read, what they
     * connected is asked beside the rest and kept only if it is */
    own?: boolean | Promise<boolean>
    /** asked by the caller, and awaited only once the rest is read */
    services?: Promise<Service[]>
    enable?: string[]
    add?: string
    /** the request's directory, so these reads travel with what it asks */
    dir?: ReturnType<typeof dirOf>
    /** the walk to the space, `.space.slug=ada`, while its eid is still being
     * read (@yaks/connections `Path`) */
    by?: `.${string}`
  } = {},
): Promise<Connections> => {
  let { enable = [], add, dir = dirOf(env), by } = at
  let read: Read = (q) => typeof q == 'string' ? dir.read(q) : []
  let month = monthOf(Date.now())
  // The space's apps, connections and the links out of its apps, by its eid
  // or the walk to it.
  let drawn = (owner: string | Path) =>
    Promise.all([
      dir.apps(typeof owner == 'string' ? { eid: owner } : owner),
      list(read, owner),
      dir.read(
        `.edge.from.app.space${
          typeof owner == 'string' ? `=${owner}` : owner.path
        }&.${USES}&*`,
      ),
    ])
  let eid = Promise.resolve(space).then((s) => s.eid)
  // What the page is drawn from is asked by the space and the person, all at
  // once, so it travels as one trip (directory-copy.ts `gathered`); only what
  // those answers name outside this space is asked after. A walk says which
  // spaces it reached, so one that missed this space is asked again.
  let [here, reached, ahead, listing, theirs, built, wanted, own] =
    await Promise.all(
      [
        space,
        by ? read(`${by}&.space`) : undefined,
        drawn(by ? { path: by, eid } : await eid),
        read(`.${LISTED}`),
        at.own ? list(read, person) : [],
        installed(read),
        add ? known(read, add) : undefined,
        at.own ?? false,
      ],
    )
  let mine = own ? theirs : []
  let [apps, held, out] =
    !reached || reached.some((b) => b.entity.eid == here.eid)
      ? ahead
      : await drawn(here.eid)
  let roster = apps.filter((app) => app.space == here.eid)
  let ours = new Set(roster.map((app) => app.eid))
  let loans = await borrowed(
    read,
    out.filter((l) => ours.has(String(comp(l, 'edge').from))),
  )
  // The live apps of this space, which a connection of its own may be given.
  let available = roster.filter((app) => !app.trashed)
    .map((app) => ({ app: app.eid, title: app.title || app.slug }))
  let listed = new Set(listing.map((b) => b.entity.eid))
  let all = [...held, ...mine]
  let links = all.filter((b) => b[USES])
  // Each app's space and name: this space's from its roster, and an app
  // elsewhere borrowing from it, or lending to it, from the directory.
  let named = new Map(
    roster.map((app) => [app.eid, app.title || app.slug]),
  )
  let owners: Record<string, string> = Object.fromEntries(
    roster.map((app) => [app.eid, here.eid]),
  )
  let away = [
    ...new Set(
      [...links, ...loans.filter((b) => b[USES])]
        .map((l) => String(comp(l, 'edge').from))
        .filter((app) => !named.has(app)),
    ),
  ]
  if (away.length) {
    for (let b of await read(`.entity.eid=${away.join(',')}&.app&?doc`)) {
      named.set(
        b.entity.eid,
        String(comp(b, 'doc').title || comp(b, 'app').slug),
      )
      owners[b.entity.eid] = String(comp(b, 'app').space)
    }
  }
  let names = await spaceNames(read, here, [
    ...Object.values(owners),
    ...loans.filter((b) => b[CONNECTION])
      .map((b) => String(comp(b, CONNECTION).owner)),
  ])
  let usingOf = (l: Bundle): Using => {
    let app = String(comp(l, 'edge').from)
    let u = comp(l, USES)
    return {
      app,
      title: named.get(app) ?? 'another app',
      slug: roster.find((one) => one.eid == app)?.slug ?? '',
      binding: String(u.binding ?? ''),
      direct: u.direct == true,
      anyone: u.anyone == true,
      each: u.each == true,
      calls: spent(l, month),
      cap: capOf(l),
      lends: typeof u.lends == 'number' ? u.lends : null,
      borrower: u.lender == null
        ? null
        : names.get(owners[app]) ?? 'another space',
    }
  }
  let shown = await Promise.all(
    all.filter((b) => b[CONNECTION]).map(async (b): Promise<Shown> => {
      let c = comp(b, CONNECTION)
      let i = knownIn(all, String(c.integration))
      let failed = !b[PROVISIONAL] && (b.failed || b.exception)
      let to = links.filter((l) => comp(l, 'edge').to == b.entity.eid)
      return {
        eid: b.entity.eid,
        integration: String(c.integration),
        face: await faceOf(String(c.integration), i),
        own: c.owner == person,
        each: to.some((l) => comp(l, USES).each),
        status: (c.status ?? 'needed') as Status,
        account: String(c.account ?? ''),
        keyed: !i || keyed(i),
        hosts: i?.hosts ?? [],
        about: i && !i.built && i.owner == c.owner
          ? Object.fromEntries(ABOUT.map((k) => [k, i[k] ?? '']))
          : null,
        listed: !!i?.built ||
          listed.has(integrationEid(String(c.integration))),
        scopes: strs(c.scopes).length ? strs(c.scopes) : i?.scopes ?? [],
        apps: to.map(usingOf),
        binding: bindingOf(String(c.integration)),
        available: (c.owner == here.eid ? available : [])
          .filter((app) => !to.some((l) => comp(l, 'edge').from == app.app)),
        saving: String(comp(b, PROVISIONAL).note ?? ''),
        instructions: typeof i?.instructions == 'string' ? i.instructions : '',
        failed: failed
          ? String(
            comp(b, 'failed').reason ?? comp(b, 'content').body ??
              'the key could not be saved',
          )
          : '',
      }
    }),
  )
  let taken = new Set(shown.map((s) => s.integration))
  // A client is kept in the vault, so a deploy with none has no client either.
  let offered = async (i: Integration) =>
    !taken.has(i.name) && (!i.testing || enable.includes(i.name)) &&
    connectable(i, vaulted(env) && await clientOf(vaultOf(env), read, i))
  let offers = []
  for (let i of built) {
    if (await offered(i)) {
      offers.push({
        name: i.name,
        keyed: keyed(i),
        face: await faceOf(i.name, i),
      })
    }
  }
  offers.sort((a, b) => a.name.localeCompare(b.name))
  // The one the page was opened to add, from the integration directory: a
  // built one offered here, or a custom one its owner listed.
  let asked = wanted && !taken.has(wanted.name) &&
      (wanted.built
        ? await offered(wanted)
        : listed.has(integrationEid(wanted.name)) && connectable(wanted))
    ? {
      name: wanted.name,
      keyed: keyed(wanted),
      face: await faceOf(wanted.name, wanted),
    }
    : undefined
  return {
    on: vaulted(env),
    list: shown.sort((a, b) => a.integration.localeCompare(b.integration)),
    services: own ? await at.services ?? [] : [],
    borrowed: await Promise.all(
      loans.filter((l) => l[USES]).map(async (l): Promise<Borrowed> => {
        let eid = String(comp(l, 'edge').to)
        let b = loans.find((b) => b.entity.eid == eid)
        let c = comp(b, CONNECTION)
        let integration = String(c.integration)
        let i = knownIn(loans, integration)
        return {
          eid,
          integration,
          face: await faceOf(integration, i),
          keyed: !i || keyed(i),
          hosts: i?.hosts ?? [],
          lender: names.get(String(c.owner)) ?? 'another space',
          app: usingOf(l),
        }
      }),
    ),
    built: offers.filter((b) => b.name != asked?.name),
    enable,
    ...asked ? { asked } : {},
  }
}

// A lend changes host-owned caps in other spaces. Ownership is checked by
// its caller; only the resulting bundles are applied as the host.
let lending = async (
  env: Env,
  app: string,
  integration: string,
  cap: number | null,
) => {
  let c = ctxOf(env)
  let bundles = await lend(
    c.graph.read,
    { app, integration, cap },
    ownersOf(env),
  )
  // A source may have replaced its own connection since lending to a copy.
  // Read the changed links before tombstoning them so those copies rebind too.
  let was = bundles.length
    ? await c.graph.read(
      `.entity.eid=${bundles.map((b) => b.entity.eid).join(',')}&.${USES}&*`,
    )
    : []
  let apps = [
    ...new Set(
      [...was, ...bundles].filter((b) => b.edge && b[USES])
        .map((b) => String(comp(b, 'edge').from)),
    ),
  ]
  await c.graph.apply(bundles)
  await rebound(env, apps)
}

// A connected mark is written beside the credential, before the vault has
// sealed it. Do not replace a working loan when sealing was given up on.
let ready = async (env: Env, connection: string) => {
  let [b] = await readOf(env)(`.entity.eid=${connection}&.${CONNECTION}&*`)
  if (!b || comp(b, CONNECTION).status != 'connected') {
    throw new Error('The connection was not saved.')
  }
  let why = comp(b, 'failed').reason ??
    (b.exception ? comp(b, 'content').body : undefined) ??
    comp(b, PROVISIONAL).note
  if (why) throw refuse('connection', String(why))
}

// The newly connected credential replaces the copy's borrowed link only once
// saving or signing in has succeeded. The lender's connection is untouched.
let attached = async (
  env: Env,
  who: Who,
  space: Space,
  app: string,
  connection: string,
) => {
  let at = await dirOf(env).appAt(app)
  if (
    who.role != 'owner' || !at || at.app.trashed || at.space.eid != space.eid
  ) {
    throw refuse('access', 'Only this space’s owner can connect its app.')
  }
  let c = ctxOf(env, who)
  let bundles = await attach(c.graph.read, {
    owner: space.eid,
    app,
    connection,
  })
  if (bundles.length) await c.graph.apply(bundles)
  await rebound(env, [app])
}

/** What a POST from the page answers, when it is not a redirect. */
export type Said = { say: string; no: boolean }

let no = (say: string): Said => ({ say, no: true })

/**
 * What the person acting for a space holds of a connection, and of one app's
 * link to it. A link joins two sides: the connection, kept by the space or the
 * person it belongs to, and the app, kept by its space. A loan splits them: a
 * copy's link to a connection it borrows is its own space's, but for what the
 * lender keeps of it, which is recalling it and its cap, set through the
 * lender's own app's lend.
 */
export type Hold = {
  /** whose the connection is, where it is this space's or the person's own */
  kept?: 'space' | 'person'
  /** the app is a live app of this space */
  here: boolean
  /** the app's link to the connection, where it has one */
  link?: Comp
}

/** What the person acting for `space` holds of connection `b` and of the
 * link to it from `app`, as the directory says. */
export let holdOf = async (
  env: Env,
  space: Space,
  who: Who,
  b: Bundle | undefined,
  app: string,
): Promise<Hold> => {
  let owner = comp(b, CONNECTION).owner
  let at = b && EID.test(app) ? await dirOf(env).appAt(app) : null
  let [l] = at
    ? await readOf(env)(
      `.entity.eid=${edgeEid(app, USES, b!.entity.eid)}&.${USES}`,
    )
    : []
  return {
    ...!b
      ? {}
      : owner == space.eid
      ? { kept: 'space' }
      : owner == who.person
      ? { kept: 'person' }
      : {},
    here: !!at && !at.app.trashed && at.space.eid == space.eid,
    ...l ? { link: comp(l, USES) } : {},
  }
}

let lent = (h: Hold) => h.link?.lender != null

let GONE = 'That connection is not here any more.'
let kept = (h: Hold) => h.kept ? undefined : GONE
let here = (h: Hold) => h.here ? undefined : 'Choose a live app in this space.'
let linked = (h: Hold) =>
  h.link ? undefined : 'That app does not use it any more.'

// Who may call out through a link is its app's space's to say, a copy's
// borrowed link included.
let setting = (h: Hold) =>
  !h.kept && !(h.here && lent(h)) ? GONE : linked(h) ??
    (h.here
      ? undefined
      : lent(h)
      ? 'Who may call out through a copy borrowing it is that copy’s ' +
        'space’s to say; you can change its cap or recall it.'
      : 'Who may call out through that app is its own space’s to say.')

// Each act at one app's link, and what it needs of the hold, as the sentence
// refusing it where the hold falls short. Any other act is on the connection
// alone, and needs only that it is kept here.
let ACTS: Record<string, (h: Hold) => string | undefined> = {
  own: (h) =>
    h.here && lent(h)
      ? undefined
      : 'Choose a connection this space’s app borrows.',
  lend: (h) =>
    h.kept == 'space'
      ? here(h) ?? linked(h)
      : h.here && lent(h)
      ? 'That app borrows it, and only the space lending it lends it on.'
      : h.kept
      ? 'Only a connection this space keeps can be lent.'
      : GONE,
  recall: (h) =>
    kept(h) ?? (lent(h) ? undefined : 'That app does not borrow it.'),
  attach: (h) => kept(h) ?? here(h),
  open: setting,
  close: setting,
}

/** Why the person may not do `act` (a connections page's `do`) with what they
 * hold, or nothing where they may: what the page asks of every post, and the
 * connector's tools of a connection or link they name that may be another's. */
export let barred = (act: string, h: Hold): string | undefined =>
  (ACTS[act] ?? kept)(h)

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
  /** the copy replacing a borrowed connection after a successful sign-in */
  app?: string
}

// The connections page of a space, where a sign-in begun there comes back to.
export let pageOf = (env: Env, space: string) =>
  manageAt(space, 'connections', env)

/** The connections page opened to add one integration, still naming it while
 * it is in its service's testing mode (`enabled`). */
export let addingAt = (env: Env, space: string, i: Integration) =>
  enabling(
    `${pageOf(env, space)}?add=${encodeURIComponent(i.name)}`,
    i.testing ? [i.name] : [],
  )

/** A person's own connected connection through `integration`, held for them by
 * an agent working in `space` (the Operator): theirs, or else that space's when
 * they own it. */
export let ownConnection = async (
  env: Env,
  ctx: Pick<Asking, 'person' | 'dir'>,
  space: Space,
  integration: string,
): Promise<Bundle | undefined> => {
  // Both owners' and the person's role are asked at once; the space's is
  // theirs only when they own it.
  let [role, held] = await Promise.all([
    ctx.dir.role(space, ctx.person),
    meta(env).query(
      `.${CONNECTION}.owner=${
        [ctx.person, space.eid].filter(Boolean).join(',')
      }&.${CONNECTION}.integration=${integration}&.${CONNECTION}.status=connected&*`,
    ),
  ])
  let owners = role == 'owner' ? [ctx.person, space.eid] : [ctx.person]
  for (let owner of owners) {
    let b = held.find((b) => comp(b, CONNECTION).owner == owner)
    if (b) return b
  }
  return undefined
}

// A page, told how a sign-in went.
let told = (page: string, how: 'connected' | 'refused') => {
  let to = new URL(page)
  to.searchParams.set(how, '1')
  return to.href
}

// Whether a connection is an app's ask that each person answers with their
// own, which is nobody's to connect.
let asking = async (read: Read, eid: string) =>
  (await read(`.edge.to=${eid}&.${USES}&*`)).some((l) => comp(l, USES).each)

// Send the person to the service, the attempt riding a cookie to the return.
let signingIn = async (
  req: Request,
  env: Env,
  c: Ctx,
  space: Space,
  who: Who,
  eid: string,
  back = enabling(pageOf(env, space.slug), enabled(req)),
  app?: string,
): Promise<Response> => {
  let { url: to, attempt } = await begin(c, eid)
  let held: Held = {
    space: space.slug,
    connection: eid,
    person: who.person!,
    attempt,
    back,
    ...app ? { app } : {},
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
  // What was typed into the key box, for a connection through `integration`.
  let pasted = async (integration: string) =>
    givenOf(form, fieldsOf(await known(c.graph.read, integration)))
  // The page is its space owner's alone (apps.ts `manage`).
  if (who.role != 'owner') {
    return no('Only this space’s owner can change its connections.')
  }
  if (['key', 'add', 'own'].includes(act) && !vaulted(env)) {
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
          // Said only by whoever makes it; adding a key says nothing of it.
          ...field('instructions')
            ? { instructions: field('instructions') }
            : {},
        }),
      )
      eid = made[0].entity.eid
      let i = await known(c.graph.read, name)
      if (i && !keyed(i)) return signingIn(req, env, c, space, who, eid)
    }
    let [b] = EID.test(eid)
      ? await c.graph.read(`.entity.eid=${eid}&.${CONNECTION}`)
      : []
    let owner = comp(b, CONNECTION).owner
    let app = field('app')
    let refused = barred(act, await holdOf(env, space, who, b, app))
    if (refused) return no(refused)
    if (act == 'own') {
      let integration = integrationOf(b)
      let i = await known(c.graph.read, integration)
      let given = await pasted(integration)
      if ((!i || keyed(i)) && typeof given == 'string') return no(given)
      let made = await c.graph.apply(
        await need(c.graph.read, {
          owner: space.eid,
          integration,
          scopes: strs(comp(b, CONNECTION).scopes),
        }),
      )
      let own = made[0].entity.eid
      if (i && !keyed(i)) {
        return signingIn(req, env, c, space, who, own, undefined, app)
      }
      await connect(c, own, given as Given)
      await ready(env, own)
      await attached(env, who, space, app, own)
      return { say: 'The app uses your own connection now.', no: false }
    }
    let apps = await usersOf(env, eid)
    // What is said about a custom integration is its owner's to change: for
    // a space's, the space's owner (@yaks/connections `set`). Where its key
    // goes never changes.
    if (act == 'about' || act == 'list' || act == 'unlist') {
      let bundles = await set(c.graph.read, {
        ...act == 'about'
          ? Object.fromEntries(ABOUT.map((k) => [k, field(k)]))
          : { listed: act == 'list' },
        owner: String(owner),
        integration: integrationOf(b),
      })
      if (bundles.length) await c.graph.apply(bundles)
      return {
        say: act == 'about'
          ? `Saved what ${integrationOf(b)} says.`
          : act == 'list'
          ? `${integrationOf(b)} is listed in the integration directory, ` +
            'for anyone to add to a space of theirs with their own key. The ' +
            'page shows it within half a minute.'
          : `${integrationOf(b)} is out of the integration directory.`,
        no: false,
      }
    }
    if (act == 'lend') {
      let cap = field('cap') == '' ? null : Number(field('cap'))
      await lending(env, app, integrationOf(b), cap)
      return {
        say: cap == null
          ? 'Stopped lending to installed copies.'
          : `Installed copies may each make ${cap} calls a month.`,
        no: false,
      }
    }
    if (act == 'recall') {
      let host = ctxOf(env)
      await host.graph.apply(
        await recall(host.graph.read, { connection: eid, app }, ownersOf(env)),
      )
      await rebound(env, [app])
      return {
        say: 'Stopped lending to that copy; it needs its own connection now.',
        no: false,
      }
    }
    if (act == 'attach') {
      let bundles = await attach(c.graph.read, {
        owner: space.eid,
        app,
        connection: eid,
        binding: field('binding') || undefined,
      })
      if (bundles.length) await c.graph.apply(bundles)
      await rebound(env, [app])
      let [l] = await c.graph.read(
        `.entity.eid=${edgeEid(app, USES, eid)}&.${USES}`,
      )
      let at = (await dirOf(env).appAt(app))!.app
      return {
        say: `${at.title || at.slug} can now use ${integrationOf(b)}, as env.${
          comp(l, USES).binding
        }. Only its members can call out through it.`,
        no: false,
      }
    }
    // Opening a connection to anyone using an app, or closing it to its
    // members again, is the person's act on one link (@yaks/member
    // `callsOut`); what the app's code reads does not move.
    if (act == 'open' || act == 'close') {
      await c.graph.apply([{
        entity: { eid: edgeEid(app, USES, eid) },
        [USES]: { anyone: act == 'open' },
      }])
      return {
        say: act == 'open'
          ? 'Anyone using the app may call out through it now.'
          : 'Only its members may call out through it now.',
        no: false,
      }
    }
    if (act == 'disconnect') {
      await disconnect(ctxOf(env), eid, ownersOf(env))
      await rebound(env, apps)
      return { say: 'Disconnected.', no: false }
    }
    if (owner == space.eid && await asking(c.graph.read, eid)) {
      return no('Each person connects their own, from the app.')
    }
    if (act == 'signin') return signingIn(req, env, c, space, who, eid)
    let given = await pasted(integrationOf(b))
    if (typeof given == 'string') return no(given)
    await connect(c, eid, given)
    await rebound(env, apps)
    let [now] = await c.graph.read(`.entity.eid=${eid}&.${CONNECTION}&*`)
    if (now?.exception) {
      return no(
        String(comp(now, 'content').body ?? 'The key could not be saved.'),
      )
    }
    // A person's own number is set up once its key is kept, where a phone
    // connects one through this integration (operator-line.ts).
    let { lined } = await import('./operator-line.ts')
    let line = await lined(env, integrationOf(now), eid)
    if (line) return line
    return {
      say: 'Saved. The key is kept safe and never shown again.',
      no: false,
    }
  } catch (e) {
    caught(e, { request: 'POST /manage/connections' })
    return no(e instanceof Error ? e.message : "That didn't work.")
  }
}

// The directory the doors below ask, as apps.ts asks it.
let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

// The return from a service's sign-in page. The attempt must be this
// person's, for their own connection or one of a space they still own;
// anything else is sent back to their account to start again.
export let callback: Door = async ({ env, req, path, space }) => {
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
    await whoIs(req, env.SESSION_SECRET, (p) => dir.role(at, p), at.eid)
  let [b] = held && who?.person == held.person
    ? await readOf(env)(`.entity.eid=${held.connection}&.${CONNECTION}`)
    : []
  let owner = comp(b, CONNECTION).owner
  if (
    !held || !at || !who || !b ||
    owner != who.person && !(owner == at.eid && who.role == 'owner')
  ) {
    return answer(url(env, MANAGE))
  }
  // An attempt begun before its cookie named a page came from the space's.
  let back = held.back ?? pageOf(env, at.slug)
  try {
    let saved = await connect(ctxOf(env, who), held.connection, {
      attempt: held.attempt,
      callback: req.url,
    })
    let connection = saved.find((b) =>
      comp(b, CONNECTION).status == 'connected'
    )?.entity.eid
    if (!connection) {
      throw new Error('The service did not return a connected account.')
    }
    await ready(env, connection)
    if (held.app) await attached(env, who, at, held.app, connection)
    await rebound(env, await usersOf(env, connection))
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
export let own: Answer = async (
  { env, req, path, space, app, who, refuse },
) => {
  if (!path.startsWith(OWN)) return null
  let integration = decodedPath(path.slice(OWN.length))
  if (integration == null) return (await import('./pages.ts')).lost(env)
  let here = `https://${space.slug}.${apex(env)}/${app.slug}/api${path}${
    new URL(req.url).search
  }`
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
  // Load the page renderer when the Connect door answers.
  let { askConnect, lost } = await import('./pages.ts')
  if (!asked || !i || (i.testing && !enabled(req).includes(integration))) {
    return lost(env)
  }
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
      face: await faceOf(integration, i),
      keyed: keyed(i),
      on: !keyed(i) || vaulted(env),
      status: (comp(mine, CONNECTION).status ?? 'needed') as Status,
      back,
      ...said,
    }, env)
  }
  if (req.method != 'POST') return page()
  let form = await req.formData().catch(() => new FormData())
  let given = givenOf(form, fieldsOf(i))
  if (keyed(i) && !vaulted(env)) {
    return page(no("Keys can't be saved here yet."))
  }
  if (keyed(i) && typeof given == 'string') return page(no(given))
  try {
    // Their own is read by the name the app's ask gives it.
    let [ask] = await c.graph.read(
      `.entity.eid=${edgeEid(app.eid, USES, asked.entity.eid)}&.${USES}`,
    )
    let binding = comp(ask, USES).binding
    let [made] = await c.graph.apply(
      await need(c.graph.read, {
        owner: who.person,
        app: app.eid,
        integration,
        scopes: (comp(asked, CONNECTION).scopes ?? []) as string[],
        each: true,
        binding: typeof binding == 'string' ? binding : undefined,
      }),
    )
    let eid = made.entity.eid
    if (!keyed(i)) return signingIn(req, env, c, space, who, eid, back)
    await connect(c, eid, given as Given)
    let [now] = await c.graph.read(`.entity.eid=${eid}&.${CONNECTION}&*`)
    return now?.exception
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
  let [b] = await read(`.entity.eid=${eid}&.${CONNECTION}&*`)
  if (!b || comp(b, CONNECTION).owner != space.eid) return null
  let used = await read(`.edge.from=${app.eid}&.edge.to=${eid}&.${USES}`)
  return used.length ? b : null
}

// A webhook, kept in the app's store as the request it was.
export let hook: Door = async ({ env, req, path, space: slug }) => {
  if (slug == null || !path.startsWith(HOOKS)) return null
  let lost = () => new Response('not found', { status: 404 })
  if (req.method != 'POST') {
    return new Response('webhooks are POSTed', { status: 405 })
  }
  let [name, eid, ...rest] = path.slice(HOOKS.length).split('/')
  let dir = dirOf(env)
  // A hook keeps arriving at the address it was registered with after the
  // space or the app moves, and its sender follows no redirect, so it is
  // served where it lands (directory.ts `answering`, D-131924).
  let space = rest.length ? null : await dir.answering(slug)
  let app = space && name ? await dir.answeringApp(space, name) : null
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

// ---- the tools (T-38030) ---------------------------------------------------

// One app's use of a connection.
let integrationOf = (b: Bundle | undefined) =>
  String(comp(b, CONNECTION).integration)

// Attaching a connected credential remains a platform verb. The package owns
// need and list; published.ts translates their former connector arguments.
let CONNECTIONS: Row[] = [
  {
    name: 'connection_attach',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        connection: str(
          'the id of a connected connection owned by this space, from ' +
            'store_connection_list',
        ),
        binding: str(
          'the name the app reads it as, env.NAME in worker.js and from ' +
            "./api/env in a page; omit for the service's name in capitals",
        ),
      },
      required: ['app', 'connection'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args)
      if (who.role != 'owner') {
        throw refuse(
          'access',
          `only the owner of ${space.slug} may attach its connection`,
        )
      }
      let connection = text(args.connection, 'connection')
      let c = ctxOf(ctx.env, who)
      let [b] = EID.test(connection)
        ? await c.graph.read(`.entity.eid=${connection}&.${CONNECTION}`)
        : []
      let refused = barred(
        'attach',
        await holdOf(ctx.env, space, who, b, app.eid),
      )
      if (refused) throw refuse('access', refused)
      let bundles = await attach(c.graph.read, {
        owner: space.eid,
        app: app.eid,
        connection,
        ...args.binding == null
          ? {}
          : { binding: text(args.binding, 'binding') },
      }).catch((e) => {
        throw refuse('conflict', e instanceof Error ? e.message : String(e))
      })
      if (bundles.length) await c.graph.apply(bundles)
      await rebound(ctx.env, [app.eid])
      let [l] = await c.graph.read(
        `.entity.eid=${edgeEid(app.eid, USES, connection)}&.${USES}`,
      )
      return {
        space,
        text: `${space.slug}/${app.slug} can use connection ${connection}, ` +
          `as env.${comp(l, USES).binding}. ` +
          'Only app members can call out through it. The credential stays in the vault.',
      }
    },
  },
  {
    name: 'connection_lend',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        integration: str(
          'the integration of a shared connection this app uses',
        ),
        cap: {
          type: ['integer', 'null'],
          minimum: 1,
          description:
            'the calls a month each installed copy may make; null stops lending and recalls outstanding loans from this app',
        },
      },
      required: ['app', 'integration', 'cap'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args)
      if (who.role != 'owner') {
        throw refuse(
          'access',
          `only the owner of ${space.slug} may lend its connection`,
        )
      }
      let integration = text(args.integration, 'integration')
      let c = ctxOf(ctx.env)
      // An app with none to lend is told so by `lend`.
      let connection = await using(c.graph.read, { app: app.eid, integration })
      let refused = connection &&
        barred('lend', await holdOf(ctx.env, space, who, connection, app.eid))
      if (refused) throw refuse('access', refused)
      if (args.cap !== null && typeof args.cap != 'number') {
        throw refuse(
          'cap',
          'Give a whole number of calls a month, or null to stop lending.',
        )
      }
      let cap = args.cap as number | null
      await lending(ctx.env, app.eid, integration, cap)
      return {
        space,
        text: cap == null
          ? `${space.slug}/${app.slug} stopped lending ${integration}; every copy borrowing through it needs its own connection now.`
          : `${space.slug}/${app.slug} lends ${integration} to copies installed from it, capped at ${cap} calls a month each. A changed cap reaches copies already borrowing it. The key stays in the vault; each copy keeps its own data and may connect its own key instead.`,
      }
    },
  },
  {
    name: 'integration_set',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        integration: str(
          'a custom integration this space made, by name, as ' +
            'store_connection_list names it',
        ),
        title: str('what a person calls the service, as its maker writes it'),
        tagline: str('one line saying what the service is'),
        site: str("the service's https address on the web"),
        instructions: str(
          'how a person gets its key, in markdown, written for them and the ' +
            'agent helping them: where to sign up, which page issues the ' +
            'key, what to paste',
        ),
        listed: {
          type: 'boolean',
          description: 'true lists it in the integration directory at ' +
            'yaks.app/integrations, where anyone may find it and add it to ' +
            'a space of theirs with their own key; false takes it out',
        },
      },
      required: ['integration'],
    },
    run: async (ctx, args) => {
      let { space, who } = await inSpace(ctx, args, true)
      if (who.role != 'owner') {
        throw refuse(
          'access',
          `only the owner of ${space.slug} changes what its integrations say`,
        )
      }
      let name = text(args.integration, 'integration')
      let c = ctxOf(ctx.env, who)
      let about = Object.fromEntries(
        ABOUT.filter((k) => args[k] != null).map((k) => [k, String(args[k])]),
      )
      let bundles = await set(c.graph.read, {
        ...about,
        owner: space.eid,
        integration: name,
        ...args.listed == null ? {} : { listed: args.listed == true },
      })
      if (bundles.length) await c.graph.apply(bundles)
      let i = await known(c.graph.read, name)
      let shown = (await c.graph.read(
        `.entity.eid=${integrationEid(name)}&.${LISTED}`,
      )).length > 0
      let said = (['title', 'tagline', 'site'] as const)
        .filter((k) => i?.[k]).map((k) => `${k} ${i![k]}`).join('; ')
      return {
        space,
        text:
          `${name} says: ${said || 'no title, tagline or site'}.${
            i?.instructions
              ? `\n\nHow to get its key:\n\n${i.instructions}`
              : '\n\nIt says nothing yet of how to get its key.'
          }\n\nIts key is only ever sent to ${
            i?.hosts.join(', ') || 'no host'
          }, which no change here moves. Each space's connections page shows ` +
          'the instructions beside a connection needing its key. ' +
          (shown
            ? `It is listed in the integration directory, whose page shows ` +
              `it within half a minute: ${url(ctx.env, INTEGRATIONS.path)}#${
                encodeURIComponent(name)
              }`
            : 'It is not listed in the integration directory; listed: true ' +
              'lists it.'),
      }
    },
  },
  {
    name: 'integration_list',
    readOnly: true,
    // A token is welcome and none is needed: the directory is public, and
    // this is how the anonymous door knows it may call this (anon.ts
    // `openly`).
    security: EITHER,
    input: {
      type: 'object',
      properties: {
        words: str(
          'what to look for, in the words the person used: matched against ' +
            "each service's name, title, line, site, hosts and instructions",
        ),
      },
    },
    run: async (ctx, args) => {
      let words = args.words == null ? '' : String(args.words)
      return {
        text: said(await ctx.dir.integrations(words), words, ctx.env),
      }
    },
  },
]

/** The connector row for attaching a space's connected credential. */
export let connectionTools = CONNECTIONS.map(worded)
