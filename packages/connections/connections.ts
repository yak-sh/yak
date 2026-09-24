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
// its credential from the vault in the same transaction.
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
import { and, eq, list as among, present } from '@yaks/query'
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

let one = (eids: Eid[]) => eids.length == 1 ? eids[0] : among(...eids)

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
  let [b] = await read(`.eid=${eid}&.${CONNECTION}`)
  if (!b) throw new Error(`no connection ${eid}`)
  return b
}

// The `uses` links at one end, and the far end of one.
let links = (read: Read, at: 'from' | 'to', eid: Eid) =>
  read(and(eq(`${EDGE}.${at}`, eid), present(USES)))
let far = (l: Bundle, at: 'from' | 'to'): Eid =>
  String(comp(l, EDGE)[at == 'from' ? 'to' : 'from'])

// The far ends of the `uses` links at one end.
let ends = async (read: Read, at: 'from' | 'to', eid: Eid): Promise<Eid[]> =>
  (await links(read, at, eid)).map((l) => far(l, at))

// The connection an app uses through an integration.
let using = async (
  read: Read,
  app: Eid,
  integration: string,
): Promise<Bundle | undefined> => {
  let to = await ends(read, 'from', app)
  if (!to.length) return undefined
  let found = await read(
    and(eq('eid', one(to)), eq(`${CONNECTION}.integration`, integration)),
  )
  return found[0]
}

let same = (a: string[], b: string[]) =>
  [...a].sort().join('\n') == [...b].sort().join('\n')

/** Make a connection needing a credential, linked from the app that needs it,
 * with the custom integration a key for an unbuilt service needs. An app that
 * already uses a connection through that integration is answered with it. */
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
  let used = a.app ? await using(read, a.app, name) : undefined
  if (used) return [{ entity: { eid: used.entity.eid } }]
  let made = fresh(a.owner, name, a.scopes ?? [])
  return [
    ...i ? [] : [{
      entity: { eid: integrationEid(name) },
      [INTEGRATION]: { name, hosts },
    }],
    made,
    ...a.app ? [link(a.app, USES, made.entity.eid)] : [],
  ]
}

/** A space's or a person's connections, and the `uses` links from the apps
 * that use them. */
export let list = async (read: Read, owner: Eid): Promise<Bundle[]> => {
  let owned = await read(and(eq(`${CONNECTION}.owner`, owner)))
  if (!owned.length) return []
  let links = await read(
    and(eq(`${EDGE}.to`, one(owned.map((b) => b.entity.eid))), present(USES)),
  )
  return [...owned, ...links]
}

/** Every connected connection an app calls out through, each with its `uses`
 * link and the sentinel for its credential: what the egress finds a request's
 * sentinels among. */
export let used = async (c: Ctx, app: Eid): Promise<Resolved[]> => {
  let out = await links(c.graph.read, 'from', app)
  if (!out.length) return []
  let found = await c.graph.read(and(
    eq('eid', one(out.map((l) => far(l, 'from')))),
    eq(`${CONNECTION}.status`, 'connected' satisfies Status),
  ))
  let all = await Promise.all(found.map(async (connection) => ({
    connection,
    link: out.find((l) => far(l, 'from') == connection.entity.eid)!,
    sentinel: await sentinelOf(c.vault, nameOf(connection)),
  })))
  return all.filter((r): r is Resolved => !!r.sentinel)
}

/** The connection an app calls out through for an integration, and the
 * sentinel it is handed for its credential; nothing while none is connected.
 * Whether the caller may use it is the egress's question. */
export let resolve = async (
  c: Ctx,
  app: Eid,
  integration: string,
): Promise<Resolved | undefined> =>
  (await used(c, app)).find((r) =>
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
  if (!registered) throw new Error(`no OAuth client is registered for ${name}`)
  let scopes = strs(comp(b, CONNECTION).scopes)
  return client({
    authorize: i.authorize,
    token: i.token,
    scopes: scopes.length ? scopes : i.scopes,
    params: i.params,
    client: registered,
    auth: i.auth,
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

/** End a connection, and forget its credential. The apps that used it each
 * need a connection again, and are linked to a new one. */
export let disconnect = async (
  c: Ctx,
  connection: Eid,
): Promise<Bundle[]> => {
  let b = await held(c.graph.read, connection)
  let apps = await ends(c.graph.read, 'to', connection)
  let { integration, owner, scopes } = comp(b, CONNECTION)
  let again = apps.length
    ? fresh(String(owner), String(integration), strs(scopes))
    : undefined
  return c.graph.apply([
    { entity: { eid: connection }, tombstone: {} },
    ...again
      ? [again, ...apps.map((app) => link(app, USES, again.entity.eid))]
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
