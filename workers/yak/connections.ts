import {
  credentialAt,
  restoreCredential,
  retainedCredentials,
} from './credential-trash.ts'
import { type Built, line, sub } from '@yaks/query'
import { decodedPath } from './request-path.ts'
import { CallError } from '@yaks/tools/errors'
import {
  type Borrowed,
  type Catalog,
  type Connections,
  type Face,
  type McpPage,
  type Offered,
  pageRow,
  type Service,
  SHOWN,
  type Shown,
  type Using,
} from '@yaks/platform/connections-page'
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
// yaks.app, so the return is a door at the apex. The attempt waits for it in
// the vault, under the `state` the service carries back, naming the person and
// the sign-in it was begun from, the space, the connection, and the page to
// bring them back to. Nothing rides the browser: on a phone the service's page
// may open in its own app and come back in another browser, and the return
// still finds its attempt. It is spent on the way in, so it finishes once.
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
  attach,
  begin,
  bindingOf,
  borrowed,
  brokerOf,
  carry,
  catalogHeld,
  catalogued,
  chatConnections,
  connect,
  connectable,
  CONNECTION,
  type Ctx,
  disconnect,
  envOf,
  type Field,
  fieldsOf,
  find,
  type Given,
  INTEGRATION,
  type Integration,
  integrationEid,
  keyed,
  kind,
  kinds,
  known,
  knownIn,
  lacking,
  lend,
  list,
  namesOf,
  need,
  type Offer,
  opens,
  type Owners,
  type Path,
  PUBLISHED,
  type Read,
  recall,
  set,
  settle,
  signsInWith,
  standIn,
  type Status,
  USES,
  using,
} from '@yaks/connections'
import { edgeEid } from '@yaks/edge'
import { sandboxed } from '@yaks/platform/installs'
import { integrationLogo } from '@yaks/platform/routes'
import { sampling } from '@yaks/platform/visits'
import { PROVISIONAL } from '@yaks/effects'
import { capOf, monthOf, spent } from '@yaks/egress'
import type { Bundle, Comp, Taken } from '@yaks/graph'
import { hooked, refusal } from '@yaks/hook'
import { mode, reads } from '@yaks/member'
import { reveal, SECRET } from '@yaks/secrets'
import {
  type App,
  appStore,
  directory,
  scriptOf,
  type Space,
  walkTo,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { apex, url } from '@yaks/platform/host'
import { KERNEL, meta, metaOf } from './meta.ts'
import type { Answer } from './apps.ts'
import type { Door } from '@yaks/platform/routes'
import {
  enabling,
  MANAGE,
  manageAt,
  OURS,
  signInAt,
} from '@yaks/platform/routes'
import { telling } from '@yaks/platform/cookie'
import { background, caught } from './defects.ts'
import { domainOf, vouched, type Who, whoIs } from './session.ts'
import { held as live } from './browser-sessions.ts'
import { type Ctx as Asking, EID, refuse } from './tool.ts'
export { EID }
import { vaulted, vaultOf } from './vault.ts'
import { hold, take } from './attempts.ts'
import { drawn } from './theirs.ts'
import { adopting, BROKER, instructionsOf, offersOf } from './catalog.ts'

/** Where a service sends a person back after they sign in there. */
export let CALLBACK = '/connections/callback'
/** Where a service's webhooks for one app and connection arrive. */
export let HOOKS = `${OURS}/hooks/`

// The biggest webhook body kept, as a store keeps it: one blob.
let HOOK_ROOM = 1_000_000

export let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let strs = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : []

// One app's use of a connection.
let integrationOf = (b: Bundle | undefined) =>
  String(comp(b, CONNECTION).integration)

/** Where the logo of each integration `named` is drawn from
 * (@yaks/platform/routes `integrationLogo`), by what a call names it by: its
 * name, or a connection's eid (@yaks/session `integrationNamed`). `null` for
 * one with no logo or none known, which wears the plug. */
export let logosOf = async (
  read: Read,
  env: Env,
  named: string[],
): Promise<Record<string, string | null>> => {
  let eids = named.filter((n) => EID.test(n))
  let held = eids.length
    ? await read(line`.entity.eid=${eids}&.${CONNECTION}`)
    : []
  let nameOf = (n: string) =>
    EID.test(n) ? integrationOf(held.find((b) => b.entity.eid == n)) : n
  return Object.fromEntries(
    await Promise.all(named.map(async (n) => {
      let i = await known(read, nameOf(n))
      return [n, (i && integrationLogo(i, env)) ?? null] as const
    })),
  )
}

// The face of an integration, called by its name where it has no title. A
// card in a grid has no instructions.
let faceOf = async (
  name: string,
  i: Integration | undefined,
  instructions: string,
): Promise<Face> => ({
  title: i?.title || name,
  tagline: i?.tagline ?? '',
  description: i?.description ?? '',
  details: i?.details ?? '',
  docs: i?.docs ?? '',
  connects: i?.connects ?? (i?.token || i?.broker ? 'signin' : 'key'),
  broker: i?.broker?.name ?? '',
  site: i?.site ?? '',
  name,
  logo: i?.logo ?? '',
  image: i?.image ?? '',
  instructions: await drawn(instructions),
  theirs: !!i?.owner,
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

// A read of the directory. Every read the verbs make is a filter line.
let readOf = (env: Partial<Env> & Pick<Env, 'STORE'>): Read => (said) => {
  let q = said as Taken
  return typeof q == 'string' ? meta(env).query(q) : []
}

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
    report: (e) => caught(e, { request: 'connections' }),
  }
}

/** Settle each needed connection `owners` hold through a brokered
 * integration (@yaks/connections `settle`), or through `integration` alone,
 * and each one they began signing in to again there (`reconnecting`): a
 * sign-in that finished at its broker, which never sends the person back to
 * us. Whoever reads a person's connections settles theirs first, so nothing
 * waits on the broker telling us. */
export let settling = async (
  env: Env,
  owners: string[],
  integration?: string,
) => {
  let { read } = ctxOf(env).graph
  let held = owners.filter(Boolean)
  let named = integration
    ? line`&.${CONNECTION}.integration=${integration}`
    : line``
  let due = (only: Built) =>
    read(line`.${CONNECTION}.owner=${held}${sub(only)}${sub(named)}&*`)
  let needed = held.length
    ? (await Promise.all([
      due(line`&.${CONNECTION}.status=needed`),
      due(line`&.reconnecting`),
    ])).flat()
    : []
  return await settled(env, needed, (name) => known(read, name))
}

/** Settle each of `rows` that is a needed connection through a brokered
 * integration, as `named` reads it → how many it connected. A
 * broker that fails is ours to hear about, and the connection stays needed
 * for the next read. */
let settled = async (
  env: Env,
  rows: Bundle[],
  named: (
    name: string,
  ) => Integration | undefined | Promise<Integration | undefined>,
): Promise<number> => {
  let c = ctxOf(env)
  let needed = rows.filter((b) =>
    b[CONNECTION] &&
    (comp(b, CONNECTION).status == 'needed' || b.reconnecting)
  )
  let made = await Promise.all(needed.map(async (b) => {
    let i = await named(integrationOf(b))
    if (!i?.broker) return 0
    try {
      if (!(await settle(c, b.entity.eid)).length) return 0
      await ready(env, b.entity.eid)
      await rebound(env, await usersOf(env, b.entity.eid))
      return 1
    } catch (e) {
      caught(e, { request: 'settle', integration: i.name })
      return 0
    }
  }))
  return made.reduce((n: number, m) => n + m, 0)
}

/** Whose space each app is in (@yaks/connections `Owners`): what its row in
 * the directory says. */
export let ownersOf =
  (env: Partial<Env> & Pick<Env, 'STORE'>): Owners => async (apps) =>
    apps.length
      ? Object.fromEntries(
        (await readOf(env)(line`.entity.eid=${apps}&.app`))
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
      ? (await read(line`.entity.eid=${away}&.space&?doc`))
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
  let links = await read(line`.edge.from=${app.eid}&.${USES}&*`)
  let held = links.length
    ? await read(
      line`.entity.eid=${
        links.map((l) => String(comp(l, 'edge').to))
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
      line`.entity.eid=${
        loans.map((l) => String(comp(l, 'edge').to))
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
  (await readOf(env)(line`.edge.to=${connection}&.${USES}&*`))
    .map((l) => String(comp(l, 'edge').from))

/** End connection `eid` and rebind its apps. Carrier callback cleanup is
 * best-effort after revoking access. A bot stops when its token goes. */
export let ended = async (
  env: Env,
  eid: string,
  apps?: string[],
) => {
  apps ??= await usersOf(env, eid)
  let { unlining } = await import('./operator-line.ts')
  let callbacks = await unlining(env, eid)
  let chat = await import('./chat.ts')
  let bot = await chat.botFor(env, eid)
  if (callbacks) await vaultOf(env).erase([eid])
  await disconnect(ctxOf(env), eid, ownersOf(env))
  if (bot) {
    await chat.quiet(env, bot)
      .catch((e) => caught(e, { request: 'chat quiet', connection: eid }))
  }
  await rebound(env, apps)
  return callbacks ? await callbacks() : 'Disconnected.'
}

// The same for each of those apps: after a key is kept, a sign-in finished,
// or a connection ended. The person's act is done either way, so a worker
// that could not be brought up to date is ours to hear about, not theirs.
export let rebound = async (env: Env, apps: string[]) => {
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

/** Who is asking for a space's connections, and about what. */
type Asked = {
  trash?: boolean
  /** A general page can draw while the broker checks pending sign-ins. */
  deferSettlement?: boolean
  /** whether it is the person's own space; still being read, what they
   * connected is asked beside the rest and kept only if it is */
  own?: boolean | Promise<boolean>
  add?: string
  /** what the page's search asks the catalog for (`?q=`) */
  find?: string
  /** the connection the page was opened on, to connect or manage
   * (`?detail=<eid>`) */
  open?: string
  /** the request's directory, so these reads travel with what it asks */
  dir?: ReturnType<typeof dirOf>
  /** the walk to the space, `.space.slug=ada`, while its eid is still being
   * read (@yaks/connections `Path`) */
  by?: Built
}

let readOn = (dir: ReturnType<typeof dirOf>): Read => (said) => {
  let q = said as Taken
  return typeof q == 'string' ? dir.read(q) : []
}

/** The settings page's connected bots on its request's directory. */
export let chatRows = (
  dir: ReturnType<typeof dirOf>,
  owner: string | Path,
) => chatConnections(readOn(dir), owner)

// The space's apps, connections and the links out of its apps, by its eid
// or the walk to it.
let ownedBy = (dir: ReturnType<typeof dirOf>, owner: string | Path) =>
  Promise.all([
    dir.apps(typeof owner == 'string' ? { eid: owner } : owner),
    list(readOn(dir), owner),
    dir.read(
      typeof owner == 'string'
        ? line`.edge.from.app.space=${owner}&.${USES}&*`
        : line`.edge.from.app.space${sub(owner.path)}&.${USES}&*`,
    ),
  ])

// The host catalog this isolate holds, by the directory it was read from,
// read again only once it changed (@yaks/connections `catalogHeld`).
let catalogs = new WeakMap<object, ReturnType<typeof catalogHeld>>()
let catalogOf = (env: Env) => {
  let key = env.DIRECTORY ?? env
  let held = catalogs.get(key)
  if (!held) catalogs.set(key, held = catalogHeld())
  return held
}

/** What a connections page is drawn from (`connectionsOf`), asked by the
 * space and the person all at once, so it travels as one trip
 * (directory-copy.ts `gathered`). A page asks it ahead of learning its space
 * (apps.ts `foresee`), and each line is answered again when the page draws
 * (hops.ts `recall`). */
export let connectionsAsked = async (
  env: Env,
  space: Space | Promise<Space>,
  person: string,
  { own, add, dir = dirOf(env), by }: Asked = {},
) => {
  let read = readOn(dir)
  let eid = Promise.resolve(space).then((s) => s.eid)
  return await Promise.all(
    [
      space,
      by ? read(line`${sub(by)}&.space`) : undefined,
      ownedBy(dir, by ? { path: by, eid } : await eid),
      read(line`.${PUBLISHED}&.${INTEGRATION}`),
      own ? list(read, person) : [],
      catalogOf(env)(read),
      add ? known(read, add) : undefined,
      own ?? false,
      // The MCP servers the person keeps, of which the page shows those in
      // this space (@yaks/connections/mcp `reachedIn`).
      read(line`.mcp_server.owner=${person}&*`),
    ],
  )
}

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
  at: Asked & {
    /** asked by the caller, and awaited only once the rest is read */
    services?: Promise<Service[]>
    /** the page of the person's MCP servers, drawn from their rows read
     * with the rest */
    mcp?: (kept: Bundle[]) => Promise<McpPage>
    enable?: string[]
  } = {},
): Promise<Connections> => {
  let { enable = [], dir = dirOf(env) } = at
  // Awaited only on the person's own space.
  at.services?.catch(() => {})
  let read = readOn(dir)
  let month = monthOf(Date.now())
  // Only what those answers name outside this space is asked after.
  let [here, reached, ahead, listing, theirs, built, byName, own, servers] =
    await connectionsAsked(env, space, person, { ...at, dir })
  // A service a built integration stands in for is added as that one.
  let wanted = at.add && standIn(built, at.add, BROKER) || byName
  let mcp = at.mcp?.(servers)
  mcp?.catch(() => {})
  let mine = own ? theirs : []
  let [apps, held, out] =
    !reached || reached.some((b) => b.entity.eid == here.eid)
      ? ahead
      : await ownedBy(dir, here.eid)
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
  // A sign-in finished at a broker shows as connected on this very read:
  // settled from the rows just read, and read again only once one connected.
  let settlement = settled(
    env,
    all,
    (name) => knownIn(all, name) ?? built.find((i) => i.name == name),
  )
  if (at.deferSettlement) {
    background(
      settlement.then(
        () => {},
        (error) =>
          caught(error, { request: 'settle connections', space: here.slug }),
      ),
    )
  } else if (await settlement) {
    return await connectionsOf(env, here, person, { ...at, by: undefined })
  }
  let taken = new Set(
    all.filter((b) => b[CONNECTION])
      .map((b) => String(comp(b, CONNECTION).integration)),
  )
  let vault = vaulted(env) ? vaultOf(env) : null
  // Built integrations can use the same broker. Its credential is read once
  // for this view, including for the catalogue below.
  let brokers = new Map<string, Promise<boolean>>()
  let hasBroker = (name: string) => {
    let found = brokers.get(name)
    if (found) return found
    let ready = vault
      ? brokerOf(vault, name).then(Boolean)
      : Promise.resolve(false)
    brokers.set(name, ready)
    return ready
  }
  let offered = async (i: Integration) => {
    if (taken.has(i.name) || i.testing && !enable.includes(i.name)) return false
    if (connectable(i) || !vault) return connectable(i)
    return connectable(
      i,
      i.broker
        ? await hasBroker(i.broker.name)
        : await signsInWith(vault, read, i),
    )
  }
  let card = async (i: Integration, brief = true): Promise<Offered> => ({
    name: i.name,
    keyed: keyed(i),
    face: await faceOf(i.name, i, brief ? '' : await instructionsOf(env, i)),
  })
  // What is offered, each client read from the vault at once and beside the
  // reads below.
  let offers = Promise.all(
    built.filter((i) => i.built).map(async (i) =>
      await offered(i) ? [await card(i, false)] : []
    ),
  ).then((each) => each.flat().sort((a, b) => a.name.localeCompare(b.name)))
  offers.catch(() => {})
  // The catalog, beside them: a built one is offered as above, and one only
  // the catalog lists where its broker or the vault can take it.
  let catalog = (async (): Promise<[Catalog, Offer[]]> => {
    let [all, offered, brokered] = await Promise.all([
      offersOf(env, built),
      offers,
      hasBroker(BROKER),
    ])
    let ready = new Set(offered.map((b) => b.name))
    let can = all.filter((o) =>
      o.built ? ready.has(o.name) : !taken.has(o.name) &&
        (o.broker ? brokered : vaulted(env))
    )
    let found = at.find?.trim() ? find(can, at.find) : []
    return [{
      q: at.find?.trim() ?? '',
      featured: await Promise.all(
        can.filter((o) => o.featured).map((o) => card(o)),
      ),
      found: await Promise.all(found.slice(0, SHOWN).map((o) => card(o))),
      matched: found.length,
      total: can.length,
      kinds: kinds(can).map((name) => ({ name, label: kind(name) })),
    }, can]
  })()
  catalog.catch(() => {})
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
    for (let b of await read(line`.entity.eid=${away}&.app&?doc`)) {
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
      let instructions = await instructionsOf(env, i)
      let failed = !b[PROVISIONAL] && (b.failed || b.exception)
      let to = links.filter((l) => comp(l, 'edge').to == b.entity.eid)
      return {
        eid: b.entity.eid,
        integration: String(c.integration),
        face: await faceOf(String(c.integration), i, instructions),
        own: c.owner == person,
        each: to.some((l) => comp(l, USES).each),
        status: (c.status ?? 'needed') as Status,
        account: String(c.account ?? ''),
        title: String(c.title ?? ''),
        keyed: !i || keyed(i),
        hosts: i?.hosts ?? [],
        about: i && !i.built && i.owner == c.owner
          ? Object.fromEntries(ABOUT.map((k) => [k, i[k] ?? '']))
          : null,
        listed: !!i?.built ||
          listed.has(integrationEid(String(c.integration))),
        scopes: strs(c.scopes).length ? strs(c.scopes) : i?.scopes ?? [],
        lacking: i && c.status == 'connected' ? lacking(i, strs(c.scopes)) : [],
        apps: to.map(usingOf),
        binding: bindingOf(String(c.integration)),
        available: (c.owner == here.eid ? available : [])
          .filter((app) => !to.some((l) => comp(l, 'edge').from == app.app)),
        saving: String(comp(b, PROVISIONAL).note ?? ''),
        instructions,
        failed: failed
          ? String(
            comp(b, 'failed').reason ?? comp(b, 'content').body ??
              'the key could not be saved',
          )
          : '',
      }
    }),
  )
  // The one the page was opened to add, from a card's Connect or the
  // integration directory: a built one offered here, a custom one its owner
  // listed, or one the catalog offers here.
  let [shelf, can] = await catalog
  let listedHere = wanted && !taken.has(wanted.name) &&
    (wanted.built
      ? await offered(wanted)
      : listed.has(integrationEid(wanted.name)) && connectable(wanted))
  // The catalog reads no prose (@yaks/connections `catalogued`): the one
  // opened has its own, read by name.
  let found = at.add ? can.find((o) => o.name == at.add) : undefined
  let fromCatalog = found && wanted?.name == found.name
    ? { ...found, ...prose(wanted) }
    : found
  let described = wanted && !wanted.owner && Array.isArray(wanted.categories)
    ? wanted
    : undefined
  let asked = listedHere
    ? await card(wanted!, false)
    : fromCatalog
    ? await card(fromCatalog, false)
    : described
    ? { ...await card(described, false), available: false }
    : undefined
  return {
    on: vaulted(env),
    ...at.trash
      ? {
        trash: (await retainedCredentials(env, dir, here, person)).map((
          { id, integration, at },
        ) => ({ id, integration, at })),
      }
      : {},
    list: shown.sort((a, b) => a.integration.localeCompare(b.integration)),
    services: own ? await at.services ?? [] : [],
    ...mcp ? { mcp: await mcp } : {},
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
          face: await faceOf(integration, i, await instructionsOf(env, i)),
          keyed: !i || keyed(i),
          hosts: i?.hosts ?? [],
          lender: names.get(String(c.owner)) ?? 'another space',
          app: usingOf(l),
        }
      }),
    ),
    built: (await offers).filter((b) => b.name != asked?.name),
    catalog: {
      ...shelf,
      featured: shelf.featured.filter((b) => b.name != asked?.name),
    },
    ...at.open ? { open: at.open } : {},
    enable,
    ...asked ? { asked } : {},
  }
}

/** The Connections page of `space` as `ask` asks it (@yaks/platform/
 * connections-page `askOf`), as its row: what the page draws for its first
 * paint, and what the page graph's door answers and reads again as it moves.
 * On the person's own space it holds what they connected for themselves and
 * the services holding a grant from them; always, the MCP servers they keep
 * there, and the tools of the one the page opened. */
export let connectionsRow = async (
  env: Env,
  dir: ReturnType<typeof dirOf>,
  who: Who & { person: string },
  space: Space,
  ask: string,
): Promise<Bundle> => {
  let q = new URLSearchParams(ask)
  let { person } = who
  let asked = (k: string) => q.get(k) ?? undefined
  let c = await connectionsOf(env, space, person, {
    dir,
    by: walkTo(space.slug, space.eid).path,
    own: dir.seats(person, 'owner').then((seats) =>
      seats.some((s) => s.own && s.space.eid == space.eid)
    ),
    // Asked beside the directory's reads, and kept only on their own.
    services: import('./identity.ts').then((part) =>
      part.services(env, person, dir)
    ),
    mcp: async (kept) =>
      (await import('./connected-mcp.ts')).mcpPage(
        env,
        dir,
        { person, role: who.role },
        space.eid,
        { kept, open: asked('mcp'), grant: asked('grant'), at: asked('at') },
      ),
    enable: q.getAll('enable').flatMap((n) => n.split(',')),
    add: asked('detail'),
    find: asked('q'),
    open: asked('detail'),
    trash: q.has('trash'),
    deferSettlement: !q.has('detail'),
  })
  return pageRow(space.eid, ask, c)
}

// What an integration says at length (@yaks/connections `Prose`).
let prose = (i: Integration) =>
  Object.fromEntries(
    (['description', 'details', 'docs', 'instructions'] as const)
      .flatMap((k) => i[k] == null ? [] : [[k, i[k]]]),
  )

// A lend changes host-owned caps in other spaces. Ownership is checked by
// its caller; only the resulting bundles are applied as the host.
export let lending = async (
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
      line`.entity.eid=${bundles.map((b) => b.entity.eid)}&.${USES}&*`,
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
  let [b] = await readOf(env)(line`.entity.eid=${connection}&.${CONNECTION}&*`)
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
      line`.entity.eid=${edgeEid(app, USES, b!.entity.eid)}&.${USES}`,
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

let keptConnections = (env: Env, space: string, ids: string[]) =>
  ids.length
    ? readOf(env)(line`.entity.eid=${ids}&.${CONNECTION}.owner=${space}`)
    : []

/** Whether connection `connection` is space `space`'s own. */
export let spaceKeeps = async (env: Env, space: string, connection: string) =>
  EID.test(connection) &&
  (await keptConnections(env, space, [connection])).length > 0

/** The names of the space's own connections this app is linked to. */
export let spaceConnections = async (env: Env, space: Space, app: App) => {
  let links = await readOf(env)(line`.edge.from=${app.eid}&.${USES}`)
  let ids = links.map((l) => String(comp(l, 'edge').to))
  return (await keptConnections(env, space.eid, ids))
    .map((row) => String(comp(row, CONNECTION).title || integrationOf(row)))
    .sort()
}

/** Who outside space `space` would call out through connection `connection`
 * once app `app` (its slug or eid) is given it, in the person's words: nobody
 * where everyone holding a level on the app, and all the code running with
 * it, is the space's own, and then any of its apps may be given it without
 * asking (operator-approvals.ts). Null where the connection is not the
 * space's own or the app not a live app of it. */
export let outsiders = async (
  env: Env,
  space: Space,
  connection: string,
  app: string,
): Promise<string[] | null> => {
  let dir = dirOf(env)
  let at = await spaceKeeps(env, space.eid, connection) &&
    await dir.findApp(space, app)
  if (!at || at.trashed) return null
  let { held } = await dir.people([space.eid])
  let seated = new Set(
    held.flatMap((h) => h.held == 'seat' ? [h.person] : []),
  )
  return [
    held.some((h) => h.on == at.eid && !seated.has(h.person)) &&
    'people invited to this app alone',
    !!at.join && Object.keys(at.join).length > 0 &&
    'anyone its join policy lets in',
    sampling(at) && !!at.demo && 'strangers trying its sample',
    sandboxed(at) && 'code another space published',
  ].filter((who): who is string => typeof who == 'string')
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

// The attempt a sign-in is begun with, as the vault holds it until it returns:
// who began it and from which sign-in, and the page to bring them back to.
type Held = {
  space: string
  connection: string
  person: string
  /** the browser session it was begun from, which must still be signed in */
  session?: string
  /** the instrument it was begun from, credited with the connection */
  via?: string
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
    `${pageOf(env, space)}#${encodeURIComponent(i.name)}`,
    i.testing ? [i.name] : [],
  )

/** A person's own connected connection through `integration`, held for them by
 * an agent working in `space` (the Operator): theirs, or else that space's when
 * they own it. */
export let ownConnection = async (
  env: Env,
  ctx: Pick<Asking, 'person' | 'dir'>,
  space: Pick<Space, 'eid'>,
  integration: string,
): Promise<Bundle | undefined> => {
  // Both owners' and the person's role are asked at once; the space's is
  // theirs only when they own it.
  let [role, held] = await Promise.all([
    ctx.dir.role(space, ctx.person),
    meta(env).query(
      line`.${CONNECTION}.owner=${
        [ctx.person, space.eid].filter(Boolean)
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

// A chat integration is heard on as soon as it is connected (chat.ts): by
// yaks.app's own bot, or by the one the space brought. The connection stands
// whether or not its bot could start listening.
let heard = async (env: Env, connection: string) =>
  await (await import('./chat.ts')).connected(env, connection)
    .catch((e) => caught(e, { request: 'chat listen', connection }))

// Where a sign-in begun from one of the space's own pages (the Operator's
// Add to Discord) comes back to: that page, still naming the testing
// integrations, else the space's connections page. Any other address is not
// the space's, and is ignored.
let backTo = (env: Env, space: Space, req: Request, path: string) => {
  let page = pageOf(env, space.slug)
  let to = path.startsWith('/') && !path.startsWith('//')
    ? new URL(path, page)
    : null
  let own = to && to.origin == new URL(page).origin &&
    to.pathname.startsWith(`${MANAGE}/${encodeURIComponent(space.slug)}/`)
  return enabling(own ? to!.href : page, enabled(req))
}

// A page, told how a sign-in went (@yaks/platform/cookie `telling`).
let told = (page: string, how: 'connected' | 'refused') =>
  telling(
    new Response(null, { status: 303, headers: { location: page } }),
    how == 'connected'
      ? { say: 'Connected.' }
      : { say: "The sign-in didn't finish. Try connecting again.", no: true },
    MANAGE,
  )

// Whether a connection is an app's ask that each person answers with their
// own, which is nobody's to connect.
let asking = async (read: Read, eid: string) =>
  (await read(line`.edge.to=${eid}&.${USES}&*`)).some((l) => comp(l, USES).each)

// Send the person to the service, the attempt kept for its return.
let signingIn = async (
  req: Request,
  env: Env,
  c: Ctx,
  space: Space,
  who: Who,
  eid: string,
  back = enabling(pageOf(env, space.slug), enabled(req)),
  app?: string,
  again = false,
): Promise<Response> => {
  let { url: to, attempt } = await begin(c, eid, again)
  // A brokered sign-in returns to its broker, and is settled from there.
  if (!attempt) {
    return new Response(null, { status: 303, headers: { location: to } })
  }
  await opens(c, eid, to)
  let held: Held = {
    space: space.slug,
    connection: eid,
    person: who.person!,
    ...who.session ? { session: who.session } : {},
    ...who.via ? { via: who.via } : {},
    attempt,
    back,
    ...app ? { app } : {},
  }
  await hold(env, ATTEMPT, attempt.state, held)
  return new Response(null, { status: 303, headers: { location: to } })
}

// The kind of attempt a connection's sign-in is held as (attempts.ts).
let ATTEMPT = 'connect'

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
  if (act.startsWith('mcp-') || act.startsWith('source-')) {
    if (['mcp-add', 'mcp-key', 'mcp-client'].includes(act) && !vaulted(env)) {
      return no("Keys can't be saved here yet.")
    }
    let { pageServers, sourceActed } = await import('./connected-mcp.ts')
    let { acted } = await import('@yaks/connections/mcp')
    try {
      let dir = dirOf(env)
      // The machine a server is added on is this space's, the one whose
      // tunnel the page's owner holds.
      let asked = (k: string) =>
        k == 'machine' && field(k) ? space.eid : field(k)
      let said = await sourceActed(env, dir, who, act, field) ??
        await acted(
          pageServers(env, dir, who, space.eid),
          act,
          asked,
          (k) => form.getAll(k).map(String),
        )
      // A server found to take a sign-in goes straight to it.
      if (typeof said == 'object' && said) {
        return await signingIn(req, env, c, space, who, said.signIn)
      }
      if (said != null) return { say: said, no: false }
    } catch (e) {
      if (e instanceof CallError) return no(e.message)
      caught(e, { request: 'POST /manage/connections' })
      return no(e instanceof Error ? e.message : "That didn't work.")
    }
  }
  try {
    if (act == 'restore-credential') {
      let dir = dirOf(env)
      let one = await credentialAt(
        env,
        dir,
        space,
        who.person ?? '',
        field('retained'),
      )
      if (!one) return no('That saved credential is no longer available here.')
      return { say: await restoreCredential(env, dir, one, who), no: false }
    }
    let eid = field('connection')
    if (act == 'add') {
      let name = field('integration').slice(0, 60)
      let hosts = hostsOf(field('hosts'))
      if (!name) return no('Give the service a name.')
      if (hosts.some((h) => !HOST.test(h))) {
        return no('A host is an address like api.example.com.')
      }
      // A card's Connect names a service the catalog may only offer yet,
      // which is written as an integration first; a key for a service of
      // the space's own names its hosts.
      let existing = await known(c.graph.read, name)
      let pending = existing && !existing.built && !existing.owner &&
        Array.isArray(existing.categories)
      if (!hosts.length && (!existing || pending)) {
        await adopting(
          env,
          await offersOf(env, await catalogued(c.graph.read)),
          name,
        )
      }
      // A person's own account says who they are, so it is theirs wherever
      // they connect it: a space's would stand for whichever of its owners
      // there is, and for nobody once it has two.
      let made = await c.graph.apply(
        await need(c.graph.read, {
          owner: existing?.personal ? who.person! : space.eid,
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
      if (i && !keyed(i)) {
        let back = backTo(env, space, req, field('back'))
        return await signingIn(req, env, c, space, who, eid, back)
      }
    }
    let [b] = EID.test(eid)
      ? await c.graph.read(line`.entity.eid=${eid}&.${CONNECTION}`)
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
        return await signingIn(req, env, c, space, who, own, undefined, app)
      }
      await connect(c, own, given as Given)
      await ready(env, own)
      await heard(env, own)
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
        line`.entity.eid=${edgeEid(app, USES, eid)}&.${USES}`,
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
      return { say: await ended(env, eid, apps), no: false }
    }
    if (owner == space.eid && await asking(c.graph.read, eid)) {
      return no('Each person connects their own, from the app.')
    }
    if (act == 'signin' || act == 'reconnect') {
      let back = enabling(pageOf(env, space.slug), enabled(req))
      let again = act == 'reconnect'
      return await signingIn(
        req,
        env,
        c,
        space,
        who,
        eid,
        back,
        undefined,
        again,
      )
    }
    let given = await pasted(integrationOf(b))
    if (typeof given == 'string') return no(given)
    await connect(c, eid, given)
    await rebound(env, apps)
    let [now] = await c.graph.read(line`.entity.eid=${eid}&.${CONNECTION}&*`)
    if (now?.exception) {
      return no(
        String(comp(now, 'content').body ?? 'The key could not be saved.'),
      )
    }
    await heard(env, eid)
    // A person's own number is set up once its key is kept, where a phone
    // connects one through this integration (operator-line.ts).
    let { lined } = await import('./operator-line.ts')
    let number = await lined(env, integrationOf(now), eid)
    if (number) return number
    return {
      say: 'Saved. The key is kept safe and never shown again.',
      no: false,
    }
  } catch (e) {
    if (e instanceof CallError) return no(e.message)
    caught(e, { request: 'POST /manage/connections' })
    return no(e instanceof Error ? e.message : "That didn't work.")
  }
}

// The directory the doors below ask, as apps.ts asks it.
let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

// The return from a service's sign-in page, in whichever browser or app it
// lands. The attempt its `state` names must have been begun by a person still
// signed in where they began it, for their own connection or one of a space
// they still own; a browser signed in as anyone else may not finish it.
// Anything else is sent back to the page it was begun on to start again.
export let callback: Door<Env> = async ({ env, req, path, space }) => {
  if (space != null || path != CALLBACK) return null
  let answer = (to: string) =>
    new Response(null, { status: 303, headers: { location: to } })
  let state = new URL(req.url).searchParams.get('state')
  let held = await take<Held>(env, ATTEMPT, state)
  let dir = dirOf(env)
  let at = held ? await dir.space(held.space) : null
  let here = at && await whoIs(req, env, (p) => dir.role(at, p), at.eid)
  let began = held && at && (!held.session ||
    await live(env, held.person, held.via ?? '', held.session))
  let who: Who | null = held && at && began &&
      (!here?.person || here.person == held.person)
    ? {
      person: held.person,
      role: await dir.role(at, held.person),
      ...held.via ? { via: held.via } : {},
      ...held.session ? { session: held.session } : {},
    }
    : null
  let [b] = held && who
    ? await readOf(env)(line`.entity.eid=${held.connection}&.${CONNECTION}`)
    : []
  let owner = comp(b, CONNECTION).owner
  // A return that cannot be finished is a failure to hear about, and the
  // person goes back to the page they began on, told so; never to another
  // space's.
  let why = !state
    ? 'it named no attempt'
    : !held
    ? 'its attempt was never begun, or was already finished'
    : !at
    ? 'its space is gone'
    : !began
    ? 'the person who began it has since signed out'
    : !who
    ? 'someone else is signed in where it came back'
    : !b
    ? 'its connection is gone'
    : owner != who.person && !(owner == at.eid && who.role == 'owner')
    ? 'the person who began it does not own its space'
    : null
  if (why || !held || !at || !who) {
    caught(new Error(`A sign-in came back unfinished: ${why}.`), {
      request: `GET ${CALLBACK}`,
      ...held ? { space: held.space, connection: held.connection } : {},
    })
    return held ? told(held.back, 'refused') : answer(url(env, MANAGE))
  }
  let { back } = held
  try {
    let saved = await connect(ctxOf(env, who), held.connection, {
      attempt: held.attempt,
      callback: req.url,
      person: held.person,
    })
    let connection = saved.find((b) =>
      comp(b, CONNECTION).status == 'connected'
    )?.entity.eid
    if (!connection) {
      throw new Error('The service did not return a connected account.')
    }
    await ready(env, connection)
    await heard(env, connection)
    if (held.app) await attached(env, who, at, held.app, connection)
    await rebound(env, await usersOf(env, connection))
    return told(back, 'connected')
  } catch (e) {
    caught(e, { request: `GET ${CALLBACK}` })
    return told(back, 'refused')
  }
}

/** Begin linking the person's own account through `integration` (a chat
 * platform's user, `discord-account`) from Profile: a connection of theirs,
 * not a space's, so any member links themselves, and every space's Operator
 * knows them there (chat.ts `linked`). The sign-in is held under `space`,
 * their own, and returns to `back`. One they began and never finished is
 * begun again rather than another made. */
export let linkOwn = async (
  req: Request,
  env: Env,
  who: Who & { person: string },
  space: Space,
  integration: string,
  back: string,
): Promise<Response> => {
  let c = ctxOf(env, who)
  let [begun] = (await c.graph.read(
    line`.${CONNECTION}.owner=${who.person}&*`,
  )).filter((b) =>
    comp(b, CONNECTION).integration == integration &&
    comp(b, CONNECTION).status == 'needed'
  )
  let eid = begun?.entity.eid ??
    (await c.graph.apply(
      await need(c.graph.read, { owner: who.person, integration }),
    ))[0].entity.eid
  return await signingIn(req, env, c, space, who, eid, back)
}

// Where an app sends a person to connect their own account, within its
// `/api/`.
let OWN = '/connections/'

// The Connect button an app asks for, drawn by the platform at the app's own
// address. Whoever may read the app may connect their own account for it, once
// the app asks each person for that integration; what they connect is theirs,
// and only they call out through it. A sign-in is begun at the platform's
// address, so a request at a space's own domain is sent to the same page there
// first.
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
  let { lost } = await import('./pages.ts')
  let { askConnect } = await import('./signin-pages.ts')
  if (!asked || !i || (i.testing && !enabled(req).includes(integration))) {
    return lost(env)
  }
  let back = `https://${space.slug}.${apex(env)}/${app.slug}/`
  let page = async (said?: Said) => {
    // A sign-in finished at a broker shows as connected here too.
    await settling(env, [who.person!], integration)
    let mine = await using(c.graph.read, {
      app: app.eid,
      integration,
      owner: who.person!,
      each: true,
    })
    return askConnect({
      app: app.title,
      face: await faceOf(integration, i, await instructionsOf(env, i)),
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
      line`.entity.eid=${edgeEid(app.eid, USES, asked.entity.eid)}&.${USES}`,
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
    if (!keyed(i)) return await signingIn(req, env, c, space, who, eid, back)
    await connect(c, eid, given as Given)
    let [now] = await c.graph.read(line`.entity.eid=${eid}&.${CONNECTION}&*`)
    return now?.exception
      ? page(
        no(String(comp(now, 'content').body ?? 'The key could not be saved.')),
      )
      : Response.redirect(back, 303)
  } catch (e) {
    if (e instanceof CallError) return page(no(e.message))
    caught(e, { request: `POST /api${path}` })
    return page(no(e instanceof Error ? e.message : "That didn't work."))
  }
}

/** The connection `eid` as the app `app` of the space `space` may hear and
 * speak through: the space's own, and one the app `uses`; else null. What a
 * webhook arrives through, and what an app's chat message is posted by
 * (chat.ts `appChatters`). */
export let usedBy = async (
  env: Partial<Env> & Pick<Env, 'STORE'>,
  space: string,
  app: string,
  eid: string,
): Promise<Bundle | null> => {
  if (!EID.test(eid)) return null
  let read = readOf(env)
  let [b] = await read(line`.entity.eid=${eid}&.${CONNECTION}&*`)
  if (!b || comp(b, CONNECTION).owner != space) return null
  let used = await read(line`.edge.from=${app}&.edge.to=${eid}&.${USES}`)
  return used.length ? b : null
}

// A webhook, kept in the app's store as the request it was.
export let hook: Door<Env> = async ({ env, req, path, space: slug }) => {
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
    ? await usedBy(env, space.eid, app.eid, eid)
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
