// Connections: one link between a space or a person and an outside service,
// through an integration, and the verbs over it.
//
// A connection is one entity wearing two components. `connection` says what it
// is — which integration, whose, which account, what was granted, and whether
// it works — and `secret` (@yaks/secrets) is its credential: a pasted key, the
// fields its integration names as a JSON object by name (S3's access key ID,
// secret key and region), or an OAuth grant's tokens as a JSON record. An app
// is handed a sentinel for each field, and the egress swaps in each one alone. The graph holds the secret's handle
// and the vault holds what it stands for, so a key goes from the person
// straight to the vault, and nothing that reads the graph — an agent, a sync, a
// backup — ever holds more than the handle. Being one entity is what makes its
// end one: deleting a connection, or the space or person it belongs to, drops
// its credential from the vault once the batch commits.
//
// The secret's name is `connection:` and a random id, and the entity's id is
// derived from that name (@yaks/secrets `secretEid`), so a refreshed token
// written under the vault's lock (`records`) lands on this same entity. It is
// also why a disconnect deletes the connection rather than clearing it: the
// name is the entity's identity, and a secret component removed would take the
// name with it. Every app that used it is linked to a new, needed connection
// in the same batch, so the space still shows what those apps need.
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
// A copy of an app, made in another space from the same code, asks for what
// the app it was copied from uses (`carry`): a needed connection in its own
// space for each, by the same name, so its person connects their own and the
// copy works without anyone saying again what it needs.
//
// Or the app's space lends the copies its connection (`lend`): its link says
// `lends`, and each copy is linked to that same connection instead of asking,
// its link capped at that many calls a month and naming the `lender`. The
// copy calls out through it at once and never holds the key. A space knows
// which of its apps' links are borrowed by their `lender`, and which copies
// borrow its own connection the same way. Stopping a lend (`recall`) gives the
// copy the ask it would have had, in its own space; a key of its own replaces
// the borrowed link (`attach`); and the lender's connection stays as it was
// either way. Only a sentinel is lent: never a direct key, nor a link where
// each person connects their own. Which space a copy is in is the host's to
// say (`Owners`), since an app is the host's word.
//
// The two verbs an untrusted caller may ask, `need` and `list`, are the tools,
// and answer bundles like every tool, for the caller to write in its own name.
// Attaching an existing credential is the owner's act through a host that
// checks ownership. The rest are for trusted code (the dashboard connecting,
// the egress finding
// a sentinel among an app's connections, swapping in the credential and
// refreshing a token), and act on the graph and vault they are given.

import { type Built, line, sub } from '@yaks/query'
import { CallError } from '@yaks/tools/errors'
import type { Bundle, Comp, Eid } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { edgeEid, link } from '@yaks/edge'
import {
  type Attempt,
  claims,
  type Client,
  client,
  OAuthError,
  type Tokens,
} from '@yaks/oauth'
import {
  records,
  reveal,
  secretEid,
  sentinelOf,
  type Vault,
} from '@yaks/secrets'
import {
  type About,
  connectable,
  type Field,
  fieldsOf,
  installed,
  type Integration,
  keyed,
  known,
  type Read,
  set,
  told,
} from './integrations.ts'
import type { Place } from '@yaks/host/keepers'
import {
  ASKS,
  CONNECTION,
  INTEGRATION,
  integrationEid,
  USES,
} from './identity.ts'
import { through } from './graph.ts'
import { pasted } from './paste.ts'
import { clientOf } from './clients.ts'
import { type Broker, BrokerError, brokerOf, type Grant } from './brokers.ts'

let SECRET = 'secret'
let RECONNECTING = 'reconnecting'
let EDGE = 'edge'

/** An explicit account name did not select one connection: a refusal of the
 * caller's own input, not a fault. */
export class AccountError extends CallError {
  constructor(message: string) {
    super('arguments', message)
    this.name = 'AccountError'
  }
}

/** needed: no credential yet; connected: one is kept; broken: the service
 * refused it. */
export type Status = 'needed' | 'connected' | 'broken'

/** What an app, or a person, asks for, and for a custom integration what a
 * person reads about it: its owner's to say, when it is made or later. */
export type Need = About & {
  /** the space or person it belongs to */
  owner: Eid
  /** the integration, by name */
  integration: string
  /** the app that needs it; none when a person connects first */
  app?: Eid
  scopes?: string[]
  /** for a custom key: the hosts it may be sent to */
  hosts?: string[]
  /** for a custom key: what a person gives to connect it, when it is more
   * than one key */
  fields?: Field[]
  /** each person connects their own, and only they call out through it */
  each?: boolean
  /** the name the app's code reads it by (default: the integration's name in
   * capitals) */
  binding?: string
  /** ask for a separate shared connection under this binding */
  separate?: boolean
  /** hand the app's code the key itself rather than a sentinel */
  direct?: boolean
  /** the task that asks a person for the key, linked to it by `asks` */
  task?: Eid
  /** where else the key goes once it is given, besides the vault */
  keep?: Place[]
}

/** What the acting verbs work with. */
export type Ctx = {
  graph: {
    read: Read
    apply: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
  }
  vault: Vault
  /** where the service sends the person back after they sign in */
  redirect?: string
  /** where the host serves its OAuth client's metadata document, whose URL
   * is the client's id at a service that takes one (@yaks/mcp-client/oauth
   * `client`) */
  document?: string
  fetch?: typeof fetch
  now?: () => number
  /** where a failure is reported that the verb answering is not stopped by:
   * a broker's connection left behind by a disconnect */
  report?: (e: unknown) => void
  /** asked before `owner` comes to hold one more connection with a key or a
   * grant: before a needed one's sign-in begins, and before its key or grant
   * is kept. It throws to refuse, as a host's plan limit does; signing in
   * again, or a connection that already holds one, is not asked. */
  admit?: (owner: Eid) => Promise<void>
}

/** Whose space each app is in, by its eid: who is asked for what it needs. The
 * host says, since an app is its word; an app it does not know is missing. */
export type Owners = (apps: Eid[]) => Promise<Record<Eid, Eid>>

/** What a caller calling out through a connection is given: the connection,
 * the `uses` link to it from the app, and the sentinel for each field of its
 * credential, by the field's name: `key` for one key or a sign-in's token. */
export type Resolved = {
  connection: Bundle
  link: Bundle
  sentinels: Record<string, string>
}

/** How a connection's credential arrives: a pasted key, each field its
 * integration names, or the return from the service's sign-in page with the
 * attempt `begin` gave. */
export type Given = { key: string; expect?: Status } | {
  fields: Record<string, string>
} | {
  attempt: Attempt
  callback: string | URL
  /** A website session obtained alongside a bot OAuth sign-in, kept only in the vault. */
  session?: string
  /** the person who signed in, whose own account the sign-in also names
   * where its integration `links` one */
  person?: Eid
} | {
  /** the broker's own id for a sign-in that finished there (`settle`) */
  brokered: string
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
let ALL = line`&*`

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
  let [b] = await read(line`.entity.eid=${eid}&.${CONNECTION}${sub(ALL)}`)
  if (!b) throw new Error(`no connection ${eid}`)
  return b
}

// An exchange may outlast the connection it started on.
let stillHeld = (row: Bundle): Bundle => ({
  entity: row.entity,
  $was: {
    entity: { eid: token(row.entity.eid) },
    tombstone: { '': null },
  },
})

let keeping = (c: Ctx, b: Bundle) =>
  records<Tokens & Kept>(
    {
      apply: (rows) => c.graph.apply([stillHeld(b), ...rows]),
    },
    c.vault,
    '',
  )

// The `uses` links at one end, and the far end of one.
let links = (read: Read, at: 'from' | 'to', eid: Eid | Eid[]) =>
  read(line`.${EDGE}.${at}=${eid}&.${USES}${sub(ALL)}`)
let far = (l: Bundle, at: 'from' | 'to'): Eid =>
  String(comp(l, EDGE)[at == 'from' ? 'to' : 'from'])

type Use = {
  app: Eid
  integration: string
  owner?: Eid
  each?: boolean
  binding?: string
}

type AppUse = { connection: Bundle; link: Bundle }

let appUses = async (
  read: Read,
  a: Use,
): Promise<AppUse[]> => {
  let out = (await links(read, 'from', a.app))
    .filter((l) => !comp(l, USES).each == !a.each)
  if (!out.length) return []
  let found = await read(
    line`.entity.eid=${out.map((l) => far(l, 'from'))}&.${CONNECTION}`,
  )
  return found.flatMap((b) => {
    let c = comp(b, CONNECTION)
    if (c.integration != a.integration || a.each && c.owner != a.owner) {
      return []
    }
    return [{
      connection: b,
      link: out.find((l) => far(l, 'from') == b.entity.eid)!,
    }]
  })
}

let boundAs = <T extends AppUse>(uses: T[], binding: string): T | undefined =>
  uses.find((m) => comp(m.link, USES).binding == binding)
let shared = <T extends AppUse>(uses: T[]): T | undefined =>
  uses.find((m) => !comp(m.link, USES).separate)
let byIntegration = <T extends AppUse>(uses: T[]): T | undefined =>
  shared(uses) ?? (uses.length == 1 ? uses[0] : undefined)
let usingLink = async (read: Read, a: Use) => {
  let uses = await appUses(read, a)
  return a.binding == null ? byIntegration(uses) : boundAs(uses, a.binding)
}

/** The connection an app uses through an integration, optionally by binding.
 * With `each`, it is the one `owner` holds. */
export let using = async (read: Read, a: Use): Promise<Bundle | undefined> =>
  (await usingLink(read, a))?.connection

let same = (a: string[], b: string[]) =>
  [...a].sort().join('\n') == [...b].sort().join('\n')

// What a custom integration's fields say, checked: each a name an app can
// read, said once, with a label a person reads.
let FIELD = /^[a-z][a-z0-9_]{0,31}$/
let fielded = (fields: Field[]): Field[] => {
  let out = fields.map((f) => ({
    name: String(f.name ?? ''),
    label: String(f.label ?? '').trim(),
    ...f.shown ? { shown: true } : {},
  }))
  for (let f of out) {
    if (!FIELD.test(f.name)) {
      throw new CallError(
        'fields',
        `${f.name} is not a field name: lowercase letters, digits and ` +
          `underscores, starting with a letter`,
      )
    }
    if (!f.label) throw new CallError('fields', `${f.name} needs a label`)
  }
  if (new Set(out.map((f) => f.name)).size < out.length) {
    throw new CallError('fields', 'each field is named once')
  }
  return out
}

// A binding is a name in the app's own code, so it must be one.
let NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** The names an app's code reads a connection by, by field name: its
 * binding, for one key or a sign-in, or for several fields the binding and
 * each field's name in capitals, `S3_ACCESS_KEY_ID`. */
export let namesOf = (
  binding: string,
  fields: string[],
): Record<string, string> =>
  fields.length == 1 ? { [fields[0]]: binding } : Object.fromEntries(
    fields.map((f) => [f, `${binding}_${f.toUpperCase()}`]),
  )

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
  u: { binding: string; direct: boolean; each?: boolean; separate?: boolean },
): Bundle => ({
  ...link(app, USES, to),
  [USES]: {
    binding: u.binding,
    ...u.direct ? { direct: true } : {},
    ...u.each ? { each: true } : {},
    ...u.separate ? { separate: true } : {},
  },
})

// The asks `owner` has standing through an integration for these scopes:
// shared connections needing a credential, grouped by binding for separate asks.
let asksOf = async (
  read: Read,
  owner: Eid,
  integration: string,
  scopes: string[],
  binding?: string,
): Promise<Bundle[]> => {
  let needed = (await read(
    line`.${CONNECTION}.owner=${owner}&.${CONNECTION}.status=${'needed'}${
      sub(ALL)
    }`,
  )).filter((b) => {
    let c = comp(b, CONNECTION)
    return c.integration == integration && same(strs(c.scopes), scopes)
  })
  if (!needed.length) return []
  let used = await links(read, 'to', needed.map((b) => b.entity.eid))
  return needed.filter((b) => {
    let uses = used.filter((l) => far(l, 'from') == b.entity.eid)
      .map((l) => comp(l, USES))
    return binding == null
      ? uses.every((u) => !u.each && !u.separate)
      : uses.length > 0 && uses.every((u) => u.separate && u.binding == binding)
  })
}

// A separate credential only answers other asks for its binding.
let separately = async (read: Read, eid: Eid) =>
  (await links(read, 'to', eid)).map((l) => comp(l, USES))
    .find((u) => u.separate)?.binding as string | undefined

// What connecting `b` answers: every other ask its owner has standing through
// the same integration and scopes closes, and each app it served is linked to
// `to`, the connection now connected, as it was to the ask.
let answered = async (read: Read, b: Bundle, to: Eid): Promise<Bundle[]> => {
  let c = comp(b, CONNECTION)
  let asks = (await asksOf(
    read,
    String(c.owner),
    String(c.integration),
    strs(c.scopes),
    await separately(read, b.entity.eid),
  )).filter((o) => o.entity.eid != b.entity.eid && o.entity.eid != to)
  if (!asks.length) return []
  let served = await links(read, 'to', asks.map((o) => o.entity.eid))
  return [
    ...asks.map((o) => ({ entity: { eid: o.entity.eid }, tombstone: {} })),
    ...served.flatMap((
      l,
    ) => [{ entity: { eid: l.entity.eid }, tombstone: {} }, {
      ...link(far(l, 'to'), USES, to),
      [USES]: comp(l, USES),
    }]),
  ]
}

/** Make a connection needing a credential, linked from the app that needs it,
 * with the custom integration a key for an unbuilt service needs — made only
 * where no integration holds the name, so it never writes over one, and owned
 * by whoever made it. Its hosts may wait: a key kept before anyone uses it is
 * sent nowhere, and its owner names them once, asking with them, after which
 * they never change. What is said about it (`About`) is written with it, or
 * changed by its owner asking again. An ask the owner already has standing
 * through that integration for the same scopes is reused. With `separate`,
 * the binding also identifies the ask. With `each`, each owner asks for
 * their own. The connection comes first. */
export let need = async (read: Read, a: Need): Promise<Bundle[]> => {
  let keep = placesOf(a.keep)
  if (keep.length) {
    let i = await known(read, a.integration)
    if (i && !keyed(i)) {
      throw new CallError(
        'keep',
        `${a.integration} is connected by signing in, and only a pasted key ` +
          `is kept anywhere but the vault`,
      )
    }
  }
  let [made, ...rest] = await asked(read, a)
  let eid = made.entity.eid
  return [
    keep.length
      ? { ...made, [CONNECTION]: { ...comp(made, CONNECTION), keep } }
      : made,
    ...rest,
    ...a.task ? [{ ...link(a.task, ASKS, eid), [ASKS]: {} }] : [],
  ]
}

// The places a key is kept, each a keeper's name and its address there.
let placesOf = (keep: Place[] = []): Place[] =>
  keep.map(({ via, at }) => {
    if (!String(via ?? '').trim() || !String(at ?? '').trim()) {
      throw new CallError(
        'keep',
        'each place names a keeper (via) and where (at)',
      )
    }
    return { via: String(via).trim(), at: String(at).trim() }
  })

let asked = async (read: Read, a: Need): Promise<Bundle[]> => {
  let hosts = a.hosts ?? []
  let fields = a.fields?.length ? fielded(a.fields) : []
  let name = a.integration
  let about = told(a)
  let i = await known(read, name)
  if (fields.length && i && !i.fields?.length) {
    throw new CallError(
      'fields',
      `${name} is connected with ${
        keyed(i) ? 'one key' : 'a sign-in'
      }, and its fields never change`,
    )
  }
  if (
    fields.length && i?.fields &&
    JSON.stringify(fielded(i.fields)) != JSON.stringify(fields)
  ) {
    throw new CallError(
      'fields',
      `${name} already asks for ${i.fields.map((f) => f.name).join(', ')}`,
    )
  }
  if (hosts.length && i?.built) {
    throw new CallError(
      'hosts',
      `${name} is built, and sends its credential to its own hosts`,
    )
  }
  // Hosts not yet named are its owner's to name, once.
  let naming = !!i && !i.hosts?.length && hosts.length > 0
  if (naming && i!.owner != a.owner) {
    throw new CallError(
      'hosts',
      `only the space or person that made ${name} names its hosts`,
    )
  }
  if (i && hosts.length && !naming && !same(i.hosts, hosts)) {
    throw new CallError(
      'hosts',
      `${name} already sends its key to ${i.hosts.join(', ')}`,
    )
  }
  let binding = a.binding ?? bindingOf(name)
  if (a.separate && (!a.app || a.binding == null || a.each)) {
    throw new CallError(
      'separate',
      'A separate connection needs an app and a binding shared by its callers',
    )
  }
  if (!NAME.test(binding)) {
    throw new CallError(
      'binding',
      `${binding} is not a name code can read: letters, digits and ` +
        `underscores, not starting with a digit`,
    )
  }
  if (a.direct && i && !keyed(i)) {
    throw new CallError(
      'direct',
      `${name} is connected by signing in, and only a pasted key is handed ` +
        `to an app directly`,
    )
  }
  if (a.direct && a.each) {
    throw new CallError(
      'direct',
      `a key each person connects is theirs, and is never handed to the app`,
    )
  }
  let u = { binding, direct: !!a.direct, each: a.each, separate: a.separate }
  // Said again of one that stands, it is its owner's change to make.
  let retold = [
    ...i && Object.keys(about).length ? await set(read, a) : [],
    ...naming
      ? [{
        entity: { eid: integrationEid(name) },
        [INTEGRATION]: { hosts },
        // Refused, rather than written over, where they were named meanwhile.
        $was: { [INTEGRATION]: { hosts: token(i!.hosts) } },
      }]
      : [],
  ]
  let uses = a.app ? await appUses(read, { ...a, app: a.app }) : []
  let used = (a.binding != null ? boundAs(uses, binding) : undefined) ??
    (a.separate ? undefined : shared(uses) ?? boundAs(uses, binding))
  if (used) {
    if (a.direct) {
      let loan = comp(used.link, USES)
      if (loan.lender != null || loan.lends != null) {
        throw new CallError(
          'direct',
          loan.lender != null
            ? 'A borrowed connection only supplies a sentinel; connect your own key first'
            : 'Stop lending this connection before handing its key to the app',
        )
      }
    }
    let said = a.binding != null || a.direct != null
    let patch = {
      ...a.binding != null ? { binding: a.binding } : {},
      ...a.direct != null ? { direct: a.direct || null } : {},
    }
    return [
      // Answered with the integration it goes through, as it already does.
      {
        entity: { eid: used.connection.entity.eid },
        [CONNECTION]: { integration: name },
      },
      ...said
        ? [{
          ...link(a.app!, USES, used.connection.entity.eid),
          [USES]: patch,
        }]
        : [],
      ...retold,
    ]
  }
  // Reuse an ask standing for the same scopes and group.
  let standing = a.each ? undefined : (await asksOf(
    read,
    a.owner,
    name,
    a.scopes ?? [],
    a.separate ? binding : undefined,
  ))[0]
  if (standing) {
    return [
      {
        entity: { eid: standing.entity.eid },
        [CONNECTION]: { integration: name },
      },
      ...retold,
      ...a.app ? [linked(a.app, standing.entity.eid, u)] : [],
    ]
  }
  let made = fresh(a.owner, name, a.scopes ?? [])
  let written = Object.fromEntries(
    Object.entries(about).filter(([, v]) => v != null),
  )
  return [
    made,
    ...i ? retold : [{
      entity: { eid: integrationEid(name) },
      [INTEGRATION]: {
        name,
        hosts,
        ...fields.length ? { fields } : {},
        owner: a.owner,
        ...written,
      },
      // Refused, rather than written over, where one was made meanwhile.
      $was: { [INTEGRATION]: { name: null } },
    }],
    ...a.app ? [linked(a.app, made.entity.eid, u)] : [],
  ]
}

// Whether a link may lend its connection: a sentinel every caller shares, on
// a connection the app's own space keeps rather than borrows.
let lendable = (u: Comp) => !u.each && !u.direct && u.lender == null

// The copy's link to the connection its source app lends, capped as lent.
let borrowing = (app: Eid, lent: Bundle, lender: Eid): Bundle => {
  let u = comp(lent, USES)
  return {
    ...link(app, USES, far(lent, 'from')),
    [USES]: {
      binding: u.binding,
      cap: u.lends,
      lender,
      ...u.separate ? { separate: true } : {},
    },
  }
}

/** What a copy of an app asks for, read off the app it was copied from: for
 * each connection the source uses and the copy does not yet, a connection
 * needing a credential, owned by `owner`, the copy's space, and linked from the
 * copy as `need` makes one. It goes through the same integration, is read by
 * the same binding, as directly, for each person where the source asks each,
 * and asks for the same scopes. A credential never travels, and neither does a
 * link opened to anyone, which is the person's act. Where the source lends a
 * connected connection (`lend`), the copy borrows it instead: a link to that
 * same connection, capped at what the source lends and naming it the
 * `lender`, which the host writes as itself since only it sets a cap. An
 * install and an update both ask it, so an update adds what its version gained
 * and leaves what the copy already uses as its person made it. */
export let carry = async (
  read: Read,
  a: { source: Eid; app: Eid; owner: Eid },
): Promise<Bundle[]> => {
  let out = await links(read, 'from', [a.source, a.app])
  if (!out.length) return []
  let to = await read(
    line`.entity.eid=${out.map((l) => far(l, 'from'))}&.${CONNECTION}`,
  )
  // One ask for each integration and mode, with a binding for separate asks.
  let had = new Set<string>()
  let asks = new Map<string, Need | Bundle>()
  for (let l of out) {
    let c = comp(to.find((b) => b.entity.eid == far(l, 'from')), CONNECTION)
    let u = comp(l, USES)
    // A link naming no binding is a person's grant of their own source
    // (./sources.ts), not something the app's code asks for.
    if (u.binding == null && u.lender == null) continue
    let each = u.each == true
    let key = JSON.stringify([
      each,
      c.integration,
      u.separate ? u.binding : null,
    ])
    if (comp(l, EDGE).from == a.app) {
      if (!each || c.owner == a.owner) had.add(key)
    } else if (
      lendable(u) && typeof u.lends == 'number' && c.status == 'connected'
    ) {
      asks.set(key, borrowing(a.app, l, a.source))
    } else if (typeof c.integration == 'string') {
      asks.set(key, {
        owner: a.owner,
        app: a.app,
        integration: c.integration,
        scopes: strs(c.scopes),
        each,
        binding: typeof u.binding == 'string' ? u.binding : undefined,
        direct: u.direct == true,
        separate: u.separate == true,
      })
    }
  }
  let made = await Promise.all(
    [...asks].filter(([key]) => !had.has(key)).map(([, ask]) =>
      'entity' in ask ? [ask] : need(read, ask)
    ),
  )
  return made.flat()
}

/** Lend the connection an app uses through an integration to every copy
 * installed from it, from then on: each copy borrows it at install (`carry`)
 * under a cap of `cap` calls a month, and a new cap moves every copy already
 * borrowing it. `null` stops lending it, and every copy borrowing it through
 * this app asks for its own (`recall`). The cap a copy borrows under is the
 * host's to write, so the host applies this as itself, once it has checked
 * that the actor owns the app's space and the connection. Refused for a key
 * handed to the app's code, a link where each person connects their own, and
 * a connection the app itself borrows. */
export let lend = async (
  read: Read,
  a: { app: Eid; integration: string; binding?: string; cap: number | null },
  owners: Owners,
): Promise<Bundle[]> => {
  if (a.cap != null && !(Number.isInteger(a.cap) && a.cap > 0)) {
    throw new CallError(
      'cap',
      'a cap is a whole number of calls a month, at least one',
    )
  }
  let used = await usingLink(read, a)
  if (!used) {
    throw new CallError(
      'integration',
      `Choose a shared ${a.integration} connection by binding to lend it`,
    )
  }
  let eid = used.link.entity.eid
  let u = comp(used.link, USES)
  if (u.direct) {
    throw new CallError(
      'integration',
      `the app's code is handed the ${a.integration} key itself, and only a ` +
        'sentinel is lent',
    )
  }
  if (u.lender != null) {
    throw new CallError(
      'integration',
      `the app borrows its ${a.integration} connection, which is not its to lend`,
    )
  }
  let lends = { entity: { eid }, [USES]: { lends: a.cap } }
  let loans = (await read(line`.${USES}.lender=${a.app}${sub(ALL)}`))
    .filter((l) => {
      let loan = comp(l, USES)
      return !!loan.separate == !!u.separate &&
        (!u.separate || loan.binding == u.binding)
    })
  let connections = loans.length
    ? await read(
      line`.entity.eid=${loans.map((l) => far(l, 'from'))}&.${CONNECTION}`,
    )
    : []
  let targets = new Set(
    connections.filter((b) => comp(b, CONNECTION).integration == a.integration)
      .map((b) => b.entity.eid),
  )
  let lent = loans.filter((l) => targets.has(far(l, 'from')))
  if (a.cap == null) {
    return [
      lends,
      ...(await Promise.all(
        [...targets].map((connection) =>
          recall(read, { connection, lender: a.app }, owners)
        ),
      )).flat(),
    ]
  }
  return [
    lends,
    ...lent.map((l) => ({
      entity: { eid: l.entity.eid },
      [USES]: { cap: a.cap },
    })),
  ]
}

/** Stop lending a connection: to the one copy `app`, to every copy borrowing
 * it through the `lender` app's lend, or with neither to every copy borrowing
 * it. Each copy's link gives way to a connection needing a credential of its
 * own, in the copy's own space (`owners`), linked by the same name, as
 * `disconnect` leaves the apps that shared one. The connection lent stays as
 * it was. */
export let recall = async (
  read: Read,
  a: { connection: Eid; app?: Eid; lender?: Eid },
  owners: Owners,
): Promise<Bundle[]> => {
  let b = await held(read, a.connection)
  let loans = (await links(read, 'to', a.connection)).filter((l) => {
    let u = comp(l, USES)
    return u.lender != null && (a.app == null || far(l, 'to') == a.app) &&
      (a.lender == null || u.lender == a.lender)
  })
  return [
    ...loans.map((l) => ({ entity: { eid: l.entity.eid }, tombstone: {} })),
    ...await reasked(b, loans, owners),
  ]
}

/** The connections some apps borrow rather than hold, from the `uses` links
 * out of them, each with the link borrowing it and the integration it goes
 * through: what the apps' own space reads beside the connections it keeps.
 * The host reads the links however it names its apps, so they can be asked
 * beside everything else it shows. A borrowed connection is read without its
 * secret, which is the lender's. */
export let borrowed = async (
  read: Read,
  out: Bundle[],
): Promise<Bundle[]> => {
  let loans = out.filter((l) => l[USES] && comp(l, USES).lender != null)
  if (!loans.length) return []
  let lent = await read(
    line`.entity.eid=${loans.map((l) => far(l, 'from'))}&.${CONNECTION}`,
  )
  return [...lent, ...loans, ...await through(read, lent)]
}

/** Link an app to a connection its space already owns and has connected.
 * The host verifies that the actor owns both. A previous unmet ask is
 * replaced, with its binding kept, and an unused ask is removed. The new
 * link starts members-only and never hands the app code a key. */
export let attach = async (
  read: Read,
  a: { owner: Eid; app: Eid; connection: Eid; binding?: string },
): Promise<Bundle[]> => {
  let target = await held(read, a.connection)
  let grant = comp(target, CONNECTION)
  if (grant.owner != a.owner || grant.status != 'connected') {
    throw new Error('Choose a connected connection owned by this space')
  }
  let integration = String(grant.integration)
  let uses = await appUses(read, { app: a.app, integration })
  let current = uses.find((m) => m.connection.entity.eid == a.connection)?.link
  let selected = a.binding == null ? undefined : boundAs(uses, a.binding)
  if (current) {
    // Attached again, it is renamed when given a new name, and otherwise
    // already is what was asked.
    let had = comp(current, USES).binding
    if (a.binding == null || a.binding == had) return []
    if (!NAME.test(a.binding)) {
      throw new Error('The binding must be a name code can read')
    }
    if (selected && selected.link.entity.eid != current.entity.eid) {
      throw new Error(
        'This app already uses another connection under that binding',
      )
    }
    return [{
      entity: current.entity,
      [USES]: { binding: a.binding },
      $was: { [USES]: { binding: had == null ? null : token(had) } },
    }]
  }
  let old = selected ??
    (a.binding == null
      ? byIntegration(uses) ?? boundAs(uses, bindingOf(integration))
      : shared(uses))
  let previous = old?.connection.entity.eid
  let u = comp(old?.link, USES)
  if (u.direct) {
    throw new Error(
      'This app asks for the key itself; attach requires a sentinel',
    )
  }
  let binding = a.binding ?? u.binding ?? bindingOf(integration)
  if (typeof binding != 'string' || !NAME.test(binding)) {
    throw new Error('The binding must be a name code can read')
  }
  if (old && comp(old.connection, CONNECTION).status == 'needed') {
    let i = await known(read, integration)
    if (i?.token) {
      let wanted = strs(comp(old.connection, CONNECTION).scopes)
      let granted = strs(grant.scopes)
      wanted = wanted.length ? wanted : i.scopes ?? []
      granted = granted.length ? granted : i.scopes ?? []
      if (wanted.some((s) => !granted.includes(s))) {
        throw new Error(
          'This connection does not grant the scopes the app asked for',
        )
      }
    }
  }
  let alone = previous && (await links(read, 'to', previous)).length == 1
  return [
    {
      entity: { eid: a.connection },
      $was: {
        [CONNECTION]: {
          status: token(grant.status),
          owner: token(grant.owner),
          integration: token(grant.integration),
        },
      },
    },
    ...previous
      ? [{ entity: { eid: edgeEid(a.app, USES, previous) }, tombstone: {} }]
      : [],
    ...previous && alone && comp(old?.connection, CONNECTION).status == 'needed'
      ? [{
        entity: { eid: previous },
        tombstone: {},
        $was: { [CONNECTION]: { status: token('needed') } },
      }]
      : [],
    linked(a.app, a.connection, {
      binding,
      direct: false,
      separate: u.separate == true,
    }),
  ]
}

/** An owner named before its eid is known: the walk from a reference to it
 * to what names it, as `.space.slug=ada` names a space by its address, and
 * its eid as whatever learns it answers. The host spells the walk, and one
 * may reach more than one owner: only the eid's are kept. */
export type Path = { path: Built; eid: Promise<Eid> }

/** An owner's connected chat integrations and their connection rows. A
 * {@link Path} lets both reads start while the owner is still being read. */
export let chatConnections = async (
  read: Read,
  owner: Eid | Path,
): Promise<{ row: Bundle; integration: Integration }[]> => {
  let at = typeof owner == 'string' ? line`=${owner}` : owner.path
  let [rows, integrations, eid] = await Promise.all([
    read(
      line`.${CONNECTION}.owner${sub(at)}&.${CONNECTION}.status=connected${
        sub(ALL)
      }`,
    ),
    installed(read),
    typeof owner == 'string' ? owner : owner.eid,
  ])
  let byName = new Map(
    integrations.filter((i) => i.chat).map((i) => [i.name, i]),
  )
  return rows.flatMap((row) => {
    let connection = comp(row, CONNECTION)
    let integration = byName.get(String(connection.integration))
    return connection.owner == eid && integration ? [{ row, integration }] : []
  })
}

/** A space's or a person's connections, the `uses` links from the apps that
 * use them, and the integrations they go through. Each is asked by the owner,
 * so all three are asked at once, and a host whose reads asked together
 * travel together answers them in one trip: the integrations among the built
 * ones (the line `installed` asks) and the owner's own. Only one another owner
 * listed is asked after. An owner named by a {@link Path} is asked before its
 * eid is known, beside whatever learns it. */
export let list = async (read: Read, owner: Eid | Path): Promise<Bundle[]> => {
  let at = typeof owner == 'string' ? line`=${owner}` : owner.path
  let [reached, links, built, theirs, eid] = await Promise.all([
    read(line`.${CONNECTION}.owner${sub(at)}${sub(ALL)}`),
    read(line`.${EDGE}.to.${CONNECTION}.owner${sub(at)}&.${USES}${sub(ALL)}`),
    read(line`.${INTEGRATION}.built`),
    read(line`.${INTEGRATION}.owner${sub(at)}`),
    typeof owner == 'string' ? owner : owner.eid,
  ])
  let owned = reached.filter((b) => comp(b, CONNECTION).owner == eid)
  if (!owned.length) return []
  let ids = new Set(owned.map((b) => b.entity.eid))
  let names = new Set(
    owned.map((b) => integrationEid(String(comp(b, CONNECTION).integration))),
  )
  let kept = [
    ...new Map([...built, ...theirs].map((b) => [b.entity.eid, b])).values(),
  ].filter((b) => names.has(b.entity.eid))
  return [
    ...owned,
    ...links.filter((l) => ids.has(String(comp(l, EDGE).to))),
    ...kept,
    ...await through(read, [...owned, ...kept]),
  ]
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
    line`.entity.eid=${
      out.map((l) => far(l, 'from'))
    }&.${CONNECTION}.status=${'connected' satisfies Status}${sub(ALL)}`,
  )
  let all = await Promise.all(found.map(async (connection) => ({
    connection,
    link: out.find((l) => far(l, 'from') == connection.entity.eid)!,
    sentinels: await sentinelsOf(c, connection),
  })))
  return all.filter((r) =>
    Object.keys(r.sentinels).length &&
    (!comp(r.link, USES).each ||
      comp(r.connection, CONNECTION).owner == person)
  )
}

// The fields a connection's credential is kept as: its integration's, or one
// key, which a sign-in's token is too.
let fieldsFor = async (read: Read, b: Bundle): Promise<Field[]> => {
  let i = await known(read, String(comp(b, CONNECTION).integration))
  return i && keyed(i) ? fieldsOf(i) : fieldsOf()
}

// The sentinel for each field of a connection's credential: the secret's own
// for one, and one for each field of several; none while nothing is kept.
let sentinelsOf = async (
  c: Ctx,
  b: Bundle,
): Promise<Record<string, string>> => {
  let fields = await fieldsFor(c.graph.read, b)
  let out: Record<string, string> = {}
  for (let f of fields) {
    let s = await sentinelOf(
      c.vault,
      nameOf(b),
      fields.length == 1 ? undefined : f.name,
    )
    if (s) out[f.name] = s
  }
  return out
}

/** What an app's code is handed for each connected connection it uses, for a
 * person or for nobody in particular, by the name it reads it by: the sentinel
 * for its credential, or the credential itself where the link is direct. */
export let envOf = (
  c: Ctx,
  app: Eid,
  person: Eid | null = null,
): Promise<Record<string, string>> =>
  bound(c, app, person, (u) => !!u.direct && u.lender == null)

/** What the host's own code reads for each connected connection an app of the
 * host's uses, by the name it reads it by: the credential itself, whatever the
 * link says, since that code is the host's and the key goes nowhere else.
 * yaks.app's own provider keys are its `platform` app's. */
export let keysOf = (c: Ctx, app: Eid): Promise<Record<string, string>> =>
  bound(c, app, null, () => true)

// Each connected connection `app` uses, by the name it reads it by: the
// credential where `direct` says so, else its sentinel.
let bound = async (
  c: Ctx,
  app: Eid,
  person: Eid | null,
  direct: (u: Comp) => boolean,
): Promise<Record<string, string>> => {
  let out: Record<string, string> = {}
  for (let r of await used(c, app, person)) {
    let u = comp(r.link, USES)
    if (typeof u.binding != 'string') continue
    let names = namesOf(u.binding, Object.keys(r.sentinels))
    for (let [f, name] of Object.entries(names)) {
      let value = direct(u)
        ? await credential(c, r.connection.entity.eid, f)
        : r.sentinels[f]
      if (value) out[name] = value
    }
  }
  return out
}

/** The connection an app calls out through for an integration, for a person
 * or for nobody in particular, optionally by binding. It includes the
 * credential's sentinel. Whether the caller may use it is the egress's
 * question. */
export let resolve = async (
  c: Ctx,
  app: Eid,
  integration: string,
  person: Eid | null = null,
  binding?: string,
): Promise<Resolved | undefined> => {
  let uses = (await used(c, app, person)).filter((r) =>
    comp(r.connection, CONNECTION).integration == integration
  )
  return binding == null ? byIntegration(uses) : boundAs(uses, binding)
}

/** Choose an owner's account. Without a name, the person's own address wins,
 * otherwise the oldest connection. No remembered selection can let a newer
 * throwaway change what unattended commands use. */
export let pick = async (
  read: Read,
  owner: Eid,
  integration: string,
  as?: string,
): Promise<Bundle | undefined> => {
  let found = (await read(
    line`.${CONNECTION}.owner=${owner}${sub(ALL)}&.order=created.at`,
  ))
    .filter((b) => comp(b, CONNECTION).integration == integration)
  let address = (b: Bundle) =>
    String(comp(b, CONNECTION).account ?? '').toLowerCase()
  if (as) {
    let name = as.toLowerCase()
    let exact = found.filter((b) => address(b) == name)
    let matches = exact.length
      ? exact
      : name.includes('@')
      ? []
      : found.filter((b) => address(b).split('@')[0] == name)
    let accounts = [...new Set(found.map((b) => comp(b, CONNECTION).account))]
      .filter((a): a is string => typeof a == 'string' && a != '')
      .sort()
    let available = `; available accounts: ${accounts.join(', ') || '(none)'}`
    if (matches.length > 1) {
      throw new AccountError(
        `${as} names several ${integration} accounts; use the whole address${available}`,
      )
    }
    if (!matches.length) {
      throw new AccountError(
        `no ${integration} account is named ${as}${available}`,
      )
    }
    return matches[0]
  }
  let [person] = await read(line`.entity.eid=${owner}&*`)
  let own = String(comp(person, 'email').address ?? '').toLowerCase()
  return found.find((b) => own && address(b) == own) ?? found[0]
}

/** Every connection to one account of an integration, by its whole address,
 * whoever owns it: what goes when the account does. */
export let toAccount = async (
  read: Read,
  integration: string,
  address: string,
): Promise<Bundle[]> =>
  (await read(line`.${CONNECTION}.integration=${integration}`)).filter((b) =>
    String(comp(b, CONNECTION).account ?? '').toLowerCase() ==
      address.toLowerCase()
  )

/** The address the provider returned. An id_token is used only to name an
 * account after the authenticated code exchange, never as authorization. */
export let accountOf = async (
  integration: Integration,
  tokens: Tokens,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> =>
  (await signedIn(integration, tokens, fetcher)).account

// The account the provider returned, and what people call it where the
// account is an id (`account_title`).
let signedIn = async (
  integration: Integration,
  tokens: Tokens,
  fetcher: typeof fetch,
): Promise<{ account?: string; title?: string }> => {
  if (integration.account && tokens.account) {
    return { account: tokens.account, title: tokens.account_title }
  }
  let body: Record<string, unknown> = {}
  if (tokens.id_token) {
    body = claims(tokens.id_token)
    if (!Object.keys(body).length) {
      throw new Error('the provider returned an invalid id_token')
    }
  } else if (integration.userinfo && tokens.access_token) {
    let res = await fetcher(integration.userinfo, {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      throw new Error(`the userinfo endpoint refused: ${res.status}`)
    }
    body = await res.json()
  }
  let at = (path?: string) => {
    let v = path?.split('.').reduce<unknown>(
      (at, k) => at && typeof at == 'object' ? (at as Comp)[k] : undefined,
      body,
    )
    return typeof v == 'string' || typeof v == 'number' ? String(v) : undefined
  }
  if (integration.account) {
    return {
      account: at(integration.account),
      title: at(integration.account_title),
    }
  }
  return {
    account: typeof body.email == 'string' && body.email.includes('@')
      ? body.email.toLowerCase()
      : undefined,
  }
}

// The OAuth client for a connection: its integration's endpoints, the scopes
// it was asked for, and its tokens kept as its own secret.
let signIn = async (
  c: Ctx,
  b: Bundle,
  staged?: Tokens,
  again = false,
): Promise<Client> => {
  let name = String(comp(b, CONNECTION).integration)
  let i = await known(c.graph.read, name)
  return oauth(c, name, i, b, staged, again)
}

let oauth = async (
  c: Ctx,
  name: string,
  i: Integration | undefined,
  b?: Bundle,
  staged?: Tokens,
  again = false,
): Promise<Client> => {
  if (!i?.authorize || !i.token) {
    throw new Error(
      `${name} is connected with a pasted key, not by signing in`,
    )
  }
  let registered = await clientOf(c.vault, c.graph.read, i)
  if (!connectable(i, registered)) {
    throw new Error(`no OAuth client is registered for ${name}`)
  }
  let scopes = strs(comp(b, CONNECTION).scopes)
  return client({
    authorize: i.authorize,
    token: i.token,
    scopes: scopes.length
      ? [
        ...new Set([
          ...scopes,
          ...(i.scopes ?? []).filter((s) => again || IDENTITY.has(s)),
        ]),
      ]
      : i.scopes,
    params: i.params,
    client: registered ?? (i.client_id ? { id: i.client_id } : undefined),
    auth: i.auth,
    scopeSeparator: i.scope_separator,
    pkce: i.pkce,
    refreshEncoding: i.refresh_encoding,
    answers: i.answers,
    resource: i.resource,
    issuer: i.issuer,
    account: i.account,
    account_title: i.account_title,
  }, {
    store: staged || !b
      ? {
        read: () => Promise.resolve(staged ?? {}),
        update: (_, fn) => fn(staged ?? {}),
      }
      : keeping(c, b),
    key: b ? nameOf(b) : '',
    redirect: c.redirect ?? '',
    fetch: c.fetch,
    now: c.now,
  })
}

// The scopes that only say who signed in, which a provider may name its own
// way in what it grants.
let IDENTITY = new Set(['openid', 'email', 'profile'])

/** The scopes `i` now asks for that a connection holding `scopes` lacks, so
 * signing in again would give it more; none when what it holds is unknown. */
export let lacking = (i: Integration, scopes: string[]): string[] => {
  let held = new Set(scopes)
  return scopes.length
    ? (i.scopes ?? []).filter((s) => !IDENTITY.has(s) && !held.has(s))
    : []
}

/** The link to send a person to, to connect by signing in, and the attempt to
 * hold until they return. `again` signs a connection in again in place,
 * asking for every scope its integration now asks for: the same row, the
 * apps using it and its account, with a new grant. A brokered one is marked
 * `reconnecting` until `settle` finds the new grant at the broker. */
export let begin = async (
  c: Ctx,
  connection: Eid,
  again = false,
): Promise<{ url: string; attempt?: Attempt & { verifier: string } }> => {
  let b = await held(c.graph.read, connection)
  if (!again) await admitting(c, b)
  let i = await known(c.graph.read, String(comp(b, CONNECTION).integration))
  if (i?.broker) {
    // A broker's sign-in returns to the broker, not to us: `settle` finds
    // it there afterwards by the connection's eid.
    let broker = await brokering(c, i.broker.name)
    if (!i.built && !i.owner && Array.isArray(i.categories)) {
      await broker.enable(i.broker.integration, i.connects ?? 'signin')
    }
    let url = await broker.begin(i.broker.integration, connection)
    if (again) {
      await c.graph.apply([{ entity: { eid: connection }, [RECONNECTING]: {} }])
    }
    return { url }
  }
  if (!c.redirect) throw new Error('signing in needs a redirect')
  return (await signIn(c, b, undefined, again)).begin()
}

// The last two labels of a host: canva.com for mcp.canva.com.
let domainOf = (url?: string) => {
  try {
    return new URL(url ?? '').host.split('.').slice(-2).join('.')
  } catch {
    return ''
  }
}

/** An MCP server's sign-in page `url`, which `begin` gave for `connection`,
 * opened once before a person's browser is sent there. A server that takes
 * only the OAuth clients it lists can fail its page for any other:
 * mcp.canva.com answers 500 to a client from Canva's Developer Portal. That
 * refuses here in words, naming a built integration for the same service that
 * signs in another way, instead of sending them to the server's error page. A
 * page that can't be reached from here is left for the browser to try. */
export let opens = async (c: Ctx, connection: Eid, url: string) => {
  let b = await held(c.graph.read, connection)
  let i = await known(c.graph.read, String(comp(b, CONNECTION).integration))
  if (!i?.resource) return
  let res = await (c.fetch ?? fetch)(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  await res?.body?.cancel()
  if (!res || res.status < 500) return
  let at = domainOf(i.resource)
  let other = (await installed(c.graph.read)).find((o) =>
    o.name != i.name && !o.resource && domainOf(o.site) == at
  )
  throw new CallError(
    'rejected',
    `${i.title ?? i.name}'s sign-in page fails for this OAuth client: ` +
      `${new URL(url).host} answers ${res.status} before anyone signs in. ` +
      'This server takes only the clients it lists, so it refuses this one.' +
      (other
        ? ` ${
          other.title ?? other.name
        } in the list of services signs in another way: connect it there.`
        : ''),
  )
}

/** What an integration signs in with, where it is kept: its broker, when it
 * names one, else the OAuth client it names. `connectable` says whether
 * either is enough. */
export let signsInWith = (
  vault: Vault,
  read: Read,
  i: Integration,
): Promise<unknown> =>
  i.broker ? brokerOf(vault, i.broker.name) : clientOf(vault, read, i)

// The broker named `name`, or a failure saying its key is not kept.
let brokering = async (c: Ctx, name: string): Promise<Broker> => {
  let broker = await brokerOf(c.vault, name, c.fetch)
  if (!broker) throw new Error(`no key is kept for the ${name} broker`)
  return broker
}

/** Connect a connection whose sign-in finished at its integration's broker,
 * once it has; nothing while it has not, or for one that is not needed or
 * not brokered. A broker's sign-in never returns to us, so whoever reads a
 * needed connection settles it: nothing waits on the broker telling us. */
export let settle = async (
  c: Ctx,
  connection: Eid,
): Promise<Bundle[]> => {
  let b = await held(c.graph.read, connection)
  let again = b[RECONNECTING] as Comp | undefined
  if (comp(b, CONNECTION).status == 'connected' && !again) return []
  let i = await known(c.graph.read, String(comp(b, CONNECTION).integration))
  if (!i?.broker) return []
  let broker = await brokerOf(c.vault, i.broker.name, c.fetch)
  let id = await broker?.found(i.broker.integration, connection)
  if (!again) return id ? connect(c, connection, { brokered: id }) : []
  // Signing in again leaves a new grant at the broker beside the one kept,
  // which goes once the connection holds the new one.
  let keeps = records<Kept>(c.graph, c.vault, '')
  let kept = await keeps.read(nameOf(b))
  if (!id || id == kept?.id) {
    let stale = (c.now ?? Date.now)() - Date.parse(String(again.at)) > HOUR
    return stale
      ? c.graph.apply([{ entity: { eid: connection }, [RECONNECTING]: null }])
      : []
  }
  let out = await connect(c, connection, { brokered: id })
  let now = await keeps.read(nameOf(b))
  if (now?.id == id && kept?.id && kept.broker && kept.integration) {
    await (await brokering(c, kept.broker)).forget(kept.integration, kept.id)
      .catch(c.report ?? (() => {}))
  }
  return out
}

let HOUR = 3_600_000

// A needed connection given its key or grant is one more its owner holds,
// which the host may refuse (`admit`).
let admitting = async (c: Ctx, b: Bundle) => {
  let { owner, status } = comp(b, CONNECTION)
  if (status == 'needed') await c.admit?.(String(owner))
}

/** Exchange an installation begun at a provider. The grant is still unowned. */
export let redeemInstallation = async (
  c: Ctx,
  i: Integration,
  code: string,
): Promise<Tokens> => {
  let grant = await (await oauth(c, i.name, i)).redeem(code)
  if (!grant.account) {
    throw new CallError('connection', 'Install the app in a workspace.')
  }
  return grant
}

/** Bind a redeemed installation to the workspace's chosen space. */
export let attachInstallation = async (
  c: Ctx,
  owner: Eid,
  integration: string,
  grant: Tokens,
): Promise<Bundle[]> => {
  let [b] = await c.graph.apply(
    await need(c.graph.read, { owner, integration }),
  )
  return keepGrant(
    c,
    b,
    grant,
    grant.account,
    grantWords(grant, grant.account_title),
  )
}

let grantWords = (tokens: Tokens, title?: string): Comp => ({
  ...tokens.scope ? { scopes: tokens.scope.split(/\s+/) } : {},
  ...title ? { title } : {},
})

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
  if ('key' in given || 'fields' in given) {
    let name = String(comp(b, CONNECTION).integration)
    let i = await known(c.graph.read, name)
    if (!i || (!keyed(i) && name != 'yaks.app')) {
      throw new Error(`${name} is connected by signing in, not with a key`)
    }
    await admitting(c, b)
    let held = stillHeld(b)
    let expect = 'key' in given ? given.expect : undefined
    if (expect) held.$was![CONNECTION] = { status: token(expect) }
    return c.graph.apply([{
      ...pasted(b, name, fieldsOf(i), given),
      ...held,
      [CONNECTION]: now,
    }, ...await answered(c.graph.read, b, connection)])
  }
  let i = await known(c.graph.read, String(comp(b, CONNECTION).integration))
  let tokens: Tokens & Kept = {}
  let made: Comp = {}
  let linked: Bundle[] = []
  if ('brokered' in given) {
    if (!i?.broker) throw new Error(`${i?.name} is not brokered`)
    let { name, integration } = i.broker
    let g = await (await brokering(c, name)).grant(integration, given.brokered)
    Object.assign(tokens, keptGrant(name, integration, given.brokered, g))
    account = g.account ??
      await accountOf(i, g, c.fetch ?? fetch).catch(() => undefined) ??
      account
    made = { broker: name, ...g.scopes ? { scopes: g.scopes } : {} }
  } else {
    await (await signIn(c, b, tokens)).complete(given.attempt, given.callback)
    if (given.session) {
      Object.assign(tokens, { website_session: given.session })
    }
    let who = i ? await signedIn(i, tokens, c.fetch ?? fetch) : {}
    if (i?.chat_grant && !who.account) {
      throw new CallError('connection', 'Install the app in a workspace.')
    }
    account = who.account ?? account
    made = grantWords(tokens, who.title)
    if (i?.links && given.person) {
      linked = await linking(c, i.links, given.person, tokens)
        .catch((e) => (c.report?.(e), []))
    }
  }
  return keepGrant(c, b, tokens, account, made, linked)
}

let keepGrant = async (
  c: Ctx,
  b: Bundle,
  tokens: Tokens,
  account: string | undefined,
  made: Comp,
  linked: Bundle[] = [],
): Promise<Bundle[]> => {
  let connection = b.entity.eid
  let grant = comp(b, CONNECTION)
  let binding = await separately(c.graph.read, connection)
  let existing = account && binding == null
    ? (await c.graph.read(
      line`.${CONNECTION}.owner=${String(grant.owner)}${sub(ALL)}`,
    ))
      .filter((other) =>
        other.entity.eid != connection &&
        comp(other, CONNECTION).integration == grant.integration &&
        String(comp(other, CONNECTION).account ?? '').toLowerCase() ==
          account!.toLowerCase()
      )
    : undefined
  let reserved = existing?.length
    ? new Set(
      (await links(c.graph.read, 'to', existing.map((o) => o.entity.eid)))
        .filter((l) => comp(l, USES).separate).map((l) => far(l, 'from')),
    )
    : new Set<Eid>()
  let kept = existing?.find((o) => !reserved.has(o.entity.eid))
  // A different account never overwrites what the person already holds.
  let different = grant.status == 'connected' && grant.account && account &&
    String(grant.account).toLowerCase() != account.toLowerCase()
  let target = kept ??
    (different
      ? fresh(
        String(grant.owner),
        String(grant.integration),
        strs(grant.scopes),
      )
      : b)
  if (!kept) await admitting(c, different ? target : b)
  let transient = kept && grant.status != 'connected'
  let out = transient ? await links(c.graph.read, 'to', connection) : []
  return c.graph.apply([
    stillHeld(b),
    ...kept ? [stillHeld(kept)] : [],
    {
      entity: { eid: target.entity.eid },
      ...target.$was ? { $was: target.$was } : {},
      [SECRET]: { name: nameOf(target), value: JSON.stringify(tokens) },
      [CONNECTION]: {
        ...comp(target, CONNECTION),
        ...made,
        status: 'connected',
        ...account ? { account } : {},
      },
      ...target[RECONNECTING] ? { [RECONNECTING]: null } : {},
    },
    ...out.flatMap((
      l,
    ) => [{ entity: { eid: l.entity.eid }, tombstone: {} }, {
      ...link(far(l, 'to'), USES, target.entity.eid),
      [USES]: comp(l, USES),
    }]),
    ...transient
      ? [{ entity: { eid: connection }, tombstone: {} }]
      : b[RECONNECTING] && target.entity.eid != connection
      ? [{ entity: { eid: connection }, [RECONNECTING]: null }]
      : [],
    ...await answered(c.graph.read, b, target.entity.eid),
    ...linked,
  ])
}

// The person's own connection through `name` that a sign-in through another
// integration also names (`links`): Discord's bot added with `identify`
// granted reads who added it at `/users/@me`, with the same token. It keeps
// that token without its refresh token, so the two never race to rotate one
// grant. One they already hold to that account is marked connected again; a
// failure to read who they are leaves the sign-in it rode on standing.
let linking = async (
  c: Ctx,
  name: string,
  person: Eid,
  tokens: Tokens,
): Promise<Bundle[]> => {
  let i = await known(c.graph.read, name)
  if (!i) throw new Error(`no integration ${name} to link`)
  let { refresh_token: _, account: _a, account_title: _t, ...own } = tokens
  let who = await signedIn(i, own, c.fetch ?? fetch)
  if (!who.account) throw new Error(`${name} named no account`)
  let held = (await c.graph.read(
    line`.${CONNECTION}.owner=${person}${sub(ALL)}`,
  )).filter((b) => comp(b, CONNECTION).integration == name)
  let target =
    held.find((b) =>
      String(comp(b, CONNECTION).account ?? '') == who.account
    ) ?? held.find((b) => comp(b, CONNECTION).status != 'connected') ??
      fresh(person, name, i.scopes ?? [])
  return [{
    entity: { eid: target.entity.eid },
    [SECRET]: { name: nameOf(target), value: JSON.stringify(own) },
    [CONNECTION]: {
      ...comp(target, CONNECTION),
      status: 'connected',
      account: who.account,
      ...who.title ? { title: who.title } : {},
    },
  }]
}

// What takes the place of `was`, links to a connection going away or no
// longer lent: a connection needing a credential for each owner, and for
// each separate binding. The app keeps its binding and access settings.
// Borrowers keep their binding and ask in their own space.
let reasked = async (b: Bundle, was: Bundle[], owners?: Owners) => {
  let { integration, owner, scopes } = comp(b, CONNECTION)
  let loans = was.filter((l) => comp(l, USES).lender != null)
  let whose = loans.length && owners
    ? await owners(loans.map((l) => far(l, 'to')))
    : {}
  let asks = new Map<string, Bundle>()
  let out: Bundle[] = []
  for (let l of was) {
    let app = far(l, 'to')
    let u = comp(l, USES)
    let at = u.lender == null ? String(owner) : whose[app]
    if (!at) {
      throw new Error(
        `no space is known for ${app}, which borrows ${b.entity.eid}`,
      )
    }
    let key = JSON.stringify([at, u.separate ? u.binding : null])
    let again = asks.get(key)
    if (!again) {
      asks.set(key, again = fresh(at, String(integration), strs(scopes)))
      out.push(again)
    }
    out.push({
      ...link(app, USES, again.entity.eid),
      [USES]: u.lender == null ? u : {
        binding: u.binding,
        ...u.separate ? { separate: true } : {},
      },
    })
  }
  return out
}

/** Trash a connection, retaining its credential and broker grant for restoration. The apps that shared it each
 * need a connection again, and are linked to a new one; a copy that borrowed
 * it is linked to one in its own space, which `owners` says. A person's own,
 * for an app that asks each person, is not replaced: the app still asks
 * them. */
export let disconnect = async (
  c: Ctx,
  connection: Eid,
  owners?: Owners,
): Promise<Bundle[]> => {
  let b = await held(c.graph.read, connection)
  let was = (await links(c.graph.read, 'to', connection))
    .filter((l) => !comp(l, USES).each)
  let out = await c.graph.apply([
    { entity: { eid: connection }, tombstone: {} },
    ...await reasked(b, was, owners),
  ])
  return out
}

// A step against the service's token endpoint. A grant the service refuses
// marks the connection broken; a failure on the wire leaves it be.
let marking = async (
  c: Ctx,
  connection: Bundle,
  step: () => Promise<string | undefined>,
): Promise<string | undefined> => {
  try {
    return await step()
  } catch (e) {
    if (
      e instanceof OAuthError && !e.code.startsWith('http_') ||
      e instanceof BrokerError && e.refused
    ) {
      await c.graph.apply([{
        ...stillHeld(connection),
        [CONNECTION]: { status: 'broken' satisfies Status },
      }])
    }
    throw e
  }
}

// A connection's fields, as the vault keeps them. A voip.ms key pasted before
// its integration named fields was its fields joined by colons; it is read so
// and kept as the object it is now, behind the same handle, so its sentinels
// hold. TODO: delete the colon reading once no such record is left.
let fieldsKept = async (
  c: Ctx,
  b: Bundle,
  fields: Field[],
  raw: string,
): Promise<Record<string, string>> => {
  if (raw.trimStart().startsWith('{')) return JSON.parse(raw)
  let parts = raw.split(':')
  let said = Object.fromEntries(fields.map((f, n) => [
    f.name,
    (n < fields.length - 1 ? parts[n] : parts.slice(n).join(':'))?.trim() ??
      '',
  ]))
  await c.graph.apply([{
    entity: { eid: b.entity.eid },
    [SECRET]: { name: nameOf(b), value: JSON.stringify(said) },
  }])
  return said
}

/** What a call out sends in a sentinel's place: the pasted key, one `field` of
 * several by name, or an access token, refreshed first when it is about to
 * expire. A credential kept as several fields is only ever read one at a
 * time. */
/**
 * The bot token that speaks for a chat connection (`integration.chat`): the
 * pasted key of a bot the space brought, or, for one that added the
 * platform's own bot to a server, the bot of the OAuth client its
 * integration signs in as. None for a connection that does not chat, is not
 * connected (or not there at all), or whose bot is not kept yet.
 */
export let botOf = async (
  c: Ctx,
  connection: Eid,
): Promise<string | undefined> => {
  let [b] = await c.graph.read(
    line`.entity.eid=${connection}&.${CONNECTION}${sub(ALL)}`,
  )
  if (comp(b, CONNECTION).status != 'connected') return undefined
  let i = await known(c.graph.read, String(comp(b, CONNECTION).integration))
  return botFrom(c, b, i)
}

/** The bot token for a connection and integration already read together. */
export let botFrom = async (
  c: Ctx,
  b: Bundle,
  i: Integration | undefined,
): Promise<string | undefined> => {
  if (comp(b, CONNECTION).status != 'connected' || !i?.chat) return undefined
  if (keyed(i)) return keyOf(c, b, i)
  if (i.chat_grant) {
    return marking(c, b, (await signIn(c, b)).token)
  }
  return (await clientOf(c.vault, c.graph.read, i))?.bot
}

let keyOf = async (c: Ctx, b: Bundle, i: Integration, field?: string) => {
  let fields = fieldsOf(i)
  let raw = await reveal(c.vault, nameOf(b), { env: () => undefined })
  if (fields.length == 1) {
    return field == null || field == fields[0].name ? raw : undefined
  }
  if (field == null) {
    throw new Error(`${i.name} is kept as several fields; read one by name`)
  }
  return raw ? (await fieldsKept(c, b, fields, raw))[field] : undefined
}

export let credential = async (
  c: Ctx,
  connection: Eid,
  field?: string,
): Promise<string | undefined> => {
  let b = await held(c.graph.read, connection)
  let i = await known(c.graph.read, String(comp(b, CONNECTION).integration))
  if (i && keyed(i)) return keyOf(c, b, i, field)
  let raw = await reveal(c.vault, nameOf(b), { env: () => undefined })
  if (field != null && field != fieldsOf()[0].name) return undefined
  if (comp(b, CONNECTION).broker) {
    return marking(c, b, () => brokered(c, b))
  }
  if (raw && !raw.trimStart().startsWith('{')) return raw
  let oauth = await signIn(c, b)
  return marking(c, b, oauth.token)
}

/** What the vault keeps for a brokered connection, beside its access token:
 * the broker it was made through, the broker's id for it, and what the broker
 * calls its integration. */
type Kept = { broker?: string; id?: string; integration?: string }

let keptGrant = (
  broker: string,
  integration: string,
  id: string,
  g: Grant,
): Tokens & Kept => ({
  broker,
  integration,
  id,
  access_token: g.access_token,
  ...g.expires_at ? { expires_at: g.expires_at } : {},
})

// A brokered connection's access token: the one kept while it is good for a
// minute more, else the broker's, which the broker refreshes when it is due;
// with `stale`, a new one unless another caller already replaced it. The
// connection is asked of the broker it was made through, by what that broker
// called its integration then, whatever its integration names now.
let brokered = (c: Ctx, b: Bundle, stale?: string) => {
  let now = (c.now ?? Date.now)()
  return keeping(c, b).update(
    nameOf(b),
    async (r) => {
      let good = r.access_token &&
        (stale
          ? r.access_token != stale
          : r.expires_at && r.expires_at - now > 60_000)
      if (good) return r.access_token
      let { broker, integration, id } = r
      if (!broker || !integration || !id) {
        throw new Error(`${nameOf(b)} names no connection at its broker`)
      }
      let g = await (await brokering(c, broker)).grant(
        integration,
        id,
        !!stale,
      )
      if (!g.expires_at) delete r.expires_at
      Object.assign(r, keptGrant(broker, integration, id, g))
      return g.access_token
    },
  )
}

/** A new access token behind the same handle, after the service refused
 * `stale`, unless another caller already replaced it. A grant the service
 * refuses marks the connection broken; a failure on the wire leaves it be. */
export let refresh = async (
  c: Ctx,
  connection: Eid,
  stale: string,
): Promise<string | undefined> => {
  let b = await held(c.graph.read, connection)
  if (comp(b, CONNECTION).broker) {
    return marking(c, b, () => brokered(c, b, stale))
  }
  let oauth = await signIn(c, b)
  return marking(c, b, () => oauth.refresh(stale))
}

/** Send a request through a connection for the one who holds it, its
 * credential as the bearer: over https to a host its integration names, and
 * to no other, following no redirect. A service that refuses the access token
 * (401) is asked once more with a refreshed one. */
export let call = async (
  c: Ctx,
  connection: Eid,
  req: Request,
): Promise<Response> => {
  let b = await held(c.graph.read, connection)
  let name = String(comp(b, CONNECTION).integration)
  let i = await known(c.graph.read, name)
  let url = new URL(req.url)
  if (url.protocol != 'https:' || !i?.hosts.includes(url.host)) {
    throw new CallError(
      'access',
      `${name} sends its credential to no ${url.host}`,
    )
  }
  let bearer = await credential(c, connection)
  if (!bearer) throw new CallError('missing', `${name} holds no credential yet`)
  let body = req.body ? await req.arrayBuffer() : undefined
  let send = (token: string) => {
    let headers = new Headers(req.headers)
    headers.set('authorization', `Bearer ${token}`)
    return (c.fetch ?? fetch)(url, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    })
  }
  let res = await send(bearer)
  if (res.status != 401 || keyed(i)) return res
  let fresh = await refresh(c, connection, bearer)
  if (!fresh || fresh == bearer) return res
  await res.body?.cancel()
  return send(fresh)
}

/** A selected account's bearer and optional website session, read privately
 * from its vault. The session is not handed to browser-only API doors. */
export let accountCredential = async (
  ctx: Ctx,
  owner: Eid,
  integration: string,
  as?: string,
): Promise<
  { connection: Bundle; bearer: string; session?: string } | undefined
> => {
  let connection = await pick(ctx.graph.read, owner, integration, as)
  if (!connection) return undefined
  let bearer = await credential(ctx, connection.entity.eid)
  if (!bearer) return undefined
  let raw = await reveal(ctx.vault, nameOf(connection), {
    env: () => undefined,
  })
  let session: string | undefined
  try {
    let record = JSON.parse(raw ?? '{}')
    session = typeof record.website_session == 'string'
      ? record.website_session
      : undefined
  } catch { /* A pasted key is not an OAuth record. */ }
  return { connection, bearer, ...session ? { session } : {} }
}
