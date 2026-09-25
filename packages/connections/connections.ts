// Connections: one link between a space or a person and an outside service,
// through an integration, and the verbs over it.
//
// A connection is one entity wearing two components. `connection` says what it
// is — which integration, whose, which account, what was granted, and whether
// it works — and `secret` (@yaks/secrets) is its credential: a pasted key, or
// an OAuth grant's tokens as a JSON record. The graph holds the secret's handle
// and the vault holds what it stands for, so a key goes from the person
// straight to the vault, and nothing that reads the graph — an agent, a sync, a
// backup — ever holds more than the handle. Being one entity is what makes its
// end one: deleting a connection, or the space or person it belongs to, drops
// its credential from the vault once the change commits.
//
// The secret's name is `connection:` and a random id, and the entity's id is
// derived from that name (@yaks/secrets `secretEid`), so a refreshed token
// written under the vault's lock (`records`) lands on this same entity. It is
// also why a disconnect deletes the connection rather than clearing it: the
// name is the entity's identity, and a secret component removed would take the
// name with it. Every app that used it is linked to a new, needed connection
// in the same change, so the space still shows what those apps need.
//
// Either order: an app says what it needs (`need`), which makes a connection
// with no credential and a `uses` link from the app; or a person connects
// first, and the app is linked to that connection afterwards. `need` never
// links an app to a connection that already holds a credential: giving an app
// a person's account is the person's act, not the app's.
//
// An app may instead ask each person who uses it to connect their own: a
// calendar app reads the calendar of whoever is looking. Its `uses` link says
// `each`, and so does the link to every person's own connection through that
// integration, made when they connect (`need` again, owned by them). A link
// marked `each` is spent only by the person who owns its connection, so one
// person's calendar is never read on another's behalf; the needed connection
// the space holds for it is only the ask, and nobody calls out through it.
//
// The two verbs an untrusted caller may ask, `need` and `list`, are the tools,
// and answer bundles like every tool, for the caller to write in its own name.
// The rest are for trusted code (the dashboard connecting, the egress finding
// a sentinel among an app's connections, swapping in the credential and
// refreshing a token), and act on the graph and vault they are given.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { link } from '@yaks/edge'
import {
  type Attempt,
  type Client,
  client,
  OAuthError,
  type Provider,
} from '@yaks/oauth'
import {
  records,
  reveal,
  secretEid,
  sentinelOf,
  type Vault,
} from '@yaks/secrets'
import {
  BUILT,
  INTEGRATION,
  type Integration,
  integrationEid,
  keyed,
  known,
  type Read,
} from './integrations.ts'

export let CONNECTION = 'connection'
export let USES = 'uses'
let SECRET = 'secret'
let EDGE = 'edge'

/** needed: no credential yet; connected: one is kept; broken: the service
 * refused it. */
export type Status = 'needed' | 'connected' | 'broken'

/** What an app, or a person, asks for. */
export type Need = {
  /** the space or person it belongs to */
  owner: Eid
  /** the integration, by name */
  integration: string
  /** the app that needs it; none when a person connects first */
  app?: Eid
  scopes?: string[]
  /** for a custom key: the hosts it may be sent to */
  hosts?: string[]
  /** each person connects their own, and only they call out through it */
  each?: boolean
  /** the name the app's code reads it by (default: the integration's name in
   * capitals) */
  binding?: string
  /** hand the app's code the key itself rather than a sentinel */
  direct?: boolean
}

/** What the acting verbs work with. */
export type Ctx = {
  graph: {
    read: Read
    apply: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
  }
  vault: Vault
  /** the built integrations (default {@link BUILT}) */
  built?: Record<string, Integration>
  /** the OAuth client registered with an integration: for a built one, the
   * host's own registration */
  client?: (
    i: Integration,
  ) =>
    | Provider['client']
    | undefined
    | Promise<Provider['client'] | undefined>
  /** where the service sends the person back after they sign in */
  redirect?: string
  fetch?: typeof fetch
  now?: () => number
}

/** What a caller calling out through a connection is given: the connection,
 * the `uses` link to it from the app, and the sentinel for its credential. */
export type Resolved = { connection: Bundle; link: Bundle; sentinel: string }

/** How a connection's credential arrives: a pasted key, or the return from
 * the service's sign-in page with the attempt `begin` gave. */
export type Given = { key: string } | {
  attempt: Attempt
  callback: string | URL
}

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let strs = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : []

// Reads are filter lines, the form every door to a graph takes, so these verbs
// run over a graph in this process or one behind HTTP alike (yaks.app's
// directory). What a line here spells is an eid or a word of this package's,
// never a name somebody chose, which a line would have to quote: a connection's
// integration is compared here, after the read. A line answers the components
// it names, so one that needs the rest of an entity asks for them (`*`).
let any = (eids: Eid[]) => eids.join(',')
let ALL = '&*'

let nameOf = (b: Bundle): string => String(comp(b, SECRET).name)

// A new connection, needing a credential, under a name of its own.
let fresh = (owner: Eid, integration: string, scopes: string[]): Bundle => {
  let name = `${CONNECTION}:${crypto.randomUUID()}`
  return {
    entity: { eid: secretEid(name) },
    [CONNECTION]: {
      integration,
      owner,
      ...scopes.length ? { scopes } : {},
      status: 'needed',
    },
    [SECRET]: { name },
  }
}

// The connection as the graph holds it, or a refusal naming it.
let held = async (read: Read, eid: Eid): Promise<Bundle> => {
  let [b] = await read(`.eid=${eid}&.${CONNECTION}${ALL}`)
  if (!b) throw new Error(`no connection ${eid}`)
  return b
}

// The `uses` links at one end, and the far end of one.
let links = (read: Read, at: 'from' | 'to', eid: Eid) =>
  read(`.${EDGE}.${at}=${eid}&.${USES}!${ALL}`)
let far = (l: Bundle, at: 'from' | 'to'): Eid =>
  String(comp(l, EDGE)[at == 'from' ? 'to' : 'from'])

/** The connection an app uses through an integration: the one it shares with
 * every caller, or, where `each` person connects their own, the one `owner`
 * holds. */
export let using = async (
  read: Read,
  a: { app: Eid; integration: string; owner?: Eid; each?: boolean },
): Promise<Bundle | undefined> => {
  let out = (await links(read, 'from', a.app))
    .filter((l) => !comp(l, USES).each == !a.each)
  if (!out.length) return undefined
  let found = await read(
    `.eid=${any(out.map((l) => far(l, 'from')))}&.${CONNECTION}`,
  )
  return found.find((b) => {
    let c = comp(b, CONNECTION)
    return c.integration == a.integration && (!a.each || c.owner == a.owner)
  })
}

let same = (a: string[], b: string[]) =>
  [...a].sort().join('\n') == [...b].sort().join('\n')

// A binding is a name in the app's own code, so it must be one.
let NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** The name an app reads an integration's connection by when it names none:
 * `google-calendar` is `GOOGLE_CALENDAR`. */
export let bindingOf = (integration: string): string =>
  integration.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^(?=\d)/, '_')
    .slice(0, 64)

// The link from an app, saying what its code reads the connection by, and
// whether each person connects their own.
let linked = (
  app: Eid,
  to: Eid,
  u: { binding: string; direct: boolean; each?: boolean },
): Bundle => ({
  ...link(app, USES, to),
  [USES]: {
    binding: u.binding,
    ...u.direct ? { direct: true } : {},
    ...u.each ? { each: true } : {},
  },
})

/** Make a connection needing a credential, linked from the app that needs it,
 * with the custom integration a key for an unbuilt service needs. An app that
 * already uses a connection through that integration is answered with it:
 * with `each`, the one the owner holds. The connection comes first. */
export let need = async (
  read: Read,
  a: Need,
  built: Record<string, Integration> = BUILT,
): Promise<Bundle[]> => {
  let hosts = a.hosts ?? []
  let name = a.integration
  let i = await known(read, name, built)
  if (hosts.length && Object.hasOwn(built, name)) {
    throw new Error(
      `${name} is built, and sends its credential to its own hosts`,
    )
  }
  if (!i && !hosts.length) {
    throw new Error(
      `no integration is named ${name}; for a custom key, name the hosts it ` +
        `may be sent to`,
    )
  }
  if (i && hosts.length && !same(i.hosts, hosts)) {
    throw new Error(`${name} already sends its key to ${i.hosts.join(', ')}`)
  }
  let binding = a.binding ?? bindingOf(name)
  if (!NAME.test(binding)) {
    throw new Error(
      `${binding} is not a name code can read: letters, digits and ` +
        `underscores, not starting with a digit`,
    )
  }
  if (a.direct && i && !keyed(i)) {
    throw new Error(
      `${name} is connected by signing in, and only a pasted key is handed ` +
        `to an app directly`,
    )
  }
  if (a.direct && a.each) {
    throw new Error(
      `a key each person connects is theirs, and is never handed to the app`,
    )
  }
  let u = { binding, direct: !!a.direct, each: a.each }
  let used = a.app ? await using(read, { ...a, app: a.app }) : undefined
  if (used) {
    let said = a.binding != null || a.direct != null
    return [
      { entity: { eid: used.entity.eid } },
      ...said ? [linked(a.app!, used.entity.eid, u)] : [],
    ]
  }
  let made = fresh(a.owner, name, a.scopes ?? [])
  return [
    made,
    ...i ? [] : [{
      entity: { eid: integrationEid(name) },
      [INTEGRATION]: { name, hosts },
    }],
    ...a.app ? [linked(a.app, made.entity.eid, u)] : [],
  ]
}

/** A space's or a person's connections, and the `uses` links from the apps
 * that use them. */
export let list = async (read: Read, owner: Eid): Promise<Bundle[]> => {
  let owned = await read(`.${CONNECTION}.owner=${owner}${ALL}`)
  if (!owned.length) return []
  let links = await read(
    `.${EDGE}.to=${any(owned.map((b) => b.entity.eid))}&.${USES}!${ALL}`,
  )
  return [...owned, ...links]
}

/** Every connected connection an app calls out through for a person, or for
 * nobody in particular: those it shares with every caller, and that person's
 * own where each person connects their own. Each comes with its `uses` link
 * and the sentinel for its credential: what the egress finds a request's
 * sentinels among. */
export let used = async (
  c: Ctx,
  app: Eid,
  person: Eid | null = null,
): Promise<Resolved[]> => {
  let out = await links(c.graph.read, 'from', app)
  if (!out.length) return []
  let found = await c.graph.read(
    `.eid=${
      any(out.map((l) => far(l, 'from')))
    }&.${CONNECTION}.status=${'connected' satisfies Status}${ALL}`,
  )
  let all = await Promise.all(found.map(async (connection) => ({
    connection,
    link: out.find((l) => far(l, 'from') == connection.entity.eid)!,
    sentinel: await sentinelOf(c.vault, nameOf(connection)),
  })))
  return all.filter((r): r is Resolved =>
    !!r.sentinel &&
    (!comp(r.link, USES).each ||
      comp(r.connection, CONNECTION).owner == person)
  )
}

/** What an app's code is handed for each connected connection it uses, for a
 * person or for nobody in particular, by the name it reads it by: the sentinel
 * for its credential, or the credential itself where the link is direct. */
export let envOf = async (
  c: Ctx,
  app: Eid,
  person: Eid | null = null,
): Promise<Record<string, string>> => {
  let out: Record<string, string> = {}
  for (let r of await used(c, app, person)) {
    let u = comp(r.link, USES)
    if (typeof u.binding != 'string') continue
    let value = u.direct
      ? await credential(c, r.connection.entity.eid)
      : r.sentinel
    if (value) out[u.binding] = value
  }
  return out
}

/** The connection an app calls out through for an integration, for a person
 * or for nobody in particular, and the sentinel it is handed for its
 * credential; nothing while none is connected. Whether the caller may use it
 * is the egress's question. */
export let resolve = async (
  c: Ctx,
  app: Eid,
  integration: string,
  person: Eid | null = null,
): Promise<Resolved | undefined> =>
  (await used(c, app, person)).find((r) =>
    comp(r.connection, CONNECTION).integration == integration
  )

// The OAuth client for a connection: its integration's endpoints, the scopes
// it was asked for, and its tokens kept as its own secret.
let signIn = async (c: Ctx, b: Bundle): Promise<Client> => {
  let name = String(comp(b, CONNECTION).integration)
  let i = await known(c.graph.read, name, c.built)
  if (!i?.authorize || !i.token) {
    throw new Error(`${name} is connected with a pasted key, not by signing in`)
  }
  let registered = await c.client?.(i)
  if (!registered && i.answers != 'key') {
    throw new Error(`no OAuth client is registered for ${name}`)
  }
  let scopes = strs(comp(b, CONNECTION).scopes)
  return client({
    authorize: i.authorize,
    token: i.token,
    scopes: scopes.length ? scopes : i.scopes,
    params: i.params,
    client: registered,
    auth: i.auth,
    answers: i.answers,
    resource: i.resource,
    issuer: i.issuer,
  }, {
    store: records(c.graph, c.vault, ''),
    key: nameOf(b),
    redirect: c.redirect ?? '',
    fetch: c.fetch,
    now: c.now,
  })
}

/** The link to send a person to, to connect by signing in, and the attempt to
 * hold until they return. */
export let begin = async (
  c: Ctx,
  connection: Eid,
): Promise<{ url: string; attempt: Attempt & { verifier: string } }> => {
  if (!c.redirect) throw new Error('signing in needs a redirect')
  return (await signIn(c, await held(c.graph.read, connection))).begin()
}

/** Keep a connection's credential — a pasted key, or the grant a finished
 * sign-in returns — and mark it connected. */
export let connect = async (
  c: Ctx,
  connection: Eid,
  given: Given,
  account?: string,
): Promise<Bundle[]> => {
  let b = await held(c.graph.read, connection)
  let now = {
    status: 'connected' satisfies Status,
    ...account ? { account } : {},
  }
  if ('key' in given) {
    let name = String(comp(b, CONNECTION).integration)
    let i = await known(c.graph.read, name, c.built)
    if (!i || !keyed(i)) {
      throw new Error(`${name} is connected by signing in, not with a key`)
    }
    return c.graph.apply([{
      entity: { eid: connection },
      [SECRET]: { name: nameOf(b), value: given.key },
      [CONNECTION]: now,
    }])
  }
  await (await signIn(c, b)).complete(given.attempt, given.callback)
  return c.graph.apply([{ entity: { eid: connection }, [CONNECTION]: now }])
}

/** End a connection, and forget its credential. The apps that shared it each
 * need a connection again, and are linked to a new one. A person's own, for
 * an app that asks each person, is not replaced: the app still asks them. */
export let disconnect = async (
  c: Ctx,
  connection: Eid,
): Promise<Bundle[]> => {
  let b = await held(c.graph.read, connection)
  let was = (await links(c.graph.read, 'to', connection))
    .filter((l) => !comp(l, USES).each)
  let { integration, owner, scopes } = comp(b, CONNECTION)
  let again = was.length
    ? fresh(String(owner), String(integration), strs(scopes))
    : undefined
  // Each app is linked to the new one as it was to the old: by the same name,
  // as directly, and as open.
  return c.graph.apply([
    { entity: { eid: connection }, tombstone: {} },
    ...again
      ? [
        again,
        ...was.map((l) => ({
          ...link(far(l, 'to'), USES, again.entity.eid),
          [USES]: comp(l, USES),
        })),
      ]
      : [],
  ])
}

// A step against the service's token endpoint. A grant the service refuses
// marks the connection broken; a failure on the wire leaves it be.
let marking = async (
  c: Ctx,
  connection: Eid,
  step: () => Promise<string | undefined>,
): Promise<string | undefined> => {
  try {
    return await step()
  } catch (e) {
    if (e instanceof OAuthError && !e.code.startsWith('http_')) {
      await c.graph.apply([{
        entity: { eid: connection },
        [CONNECTION]: { status: 'broken' satisfies Status },
      }])
    }
    throw e
  }
}

/** What a call out sends in its sentinel's place: the pasted key, or an access
 * token, refreshed first when it is about to expire. */
export let credential = async (
  c: Ctx,
  connection: Eid,
): Promise<string | undefined> => {
  let b = await held(c.graph.read, connection)
  let i = await known(
    c.graph.read,
    String(comp(b, CONNECTION).integration),
    c.built,
  )
  if (i && keyed(i)) {
    return await reveal(c.vault, nameOf(b), { env: () => undefined })
  }
  let oauth = await signIn(c, b)
  return marking(c, connection, oauth.token)
}

/** A new access token behind the same handle, after the service refused
 * `stale`, unless another caller already replaced it. A grant the service
 * refuses marks the connection broken; a failure on the wire leaves it be. */
export let refresh = async (
  c: Ctx,
  connection: Eid,
  stale: string,
): Promise<string | undefined> => {
  let oauth = await signIn(c, await held(c.graph.read, connection))
  return marking(c, connection, () => oauth.refresh(stale))
}
