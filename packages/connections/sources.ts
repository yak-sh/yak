// Sources: what a person lets an app reach as them.
//
// A person's tools come from three kinds of source, each named by an address:
// an MCP server they connected (`mcp:<server>`), a connection of theirs sent
// requests through (`connection:<connection>`), and a published app service
// they connected for an app (`service:<service app>/<app>`). An agent acting
// for the person reaches them by the person's own rules; an app's code
// reaches one only where the person granted it to that app.
//
// A grant is a `uses` link from the app to the source, the same link a
// service grant and an app's per-person ask already are. It says `each`, so
// only the person who holds the source spends it (the egress reads it so),
// and names no binding, so the app's code is handed nothing for it. It says
// yes or no to the source alone: which tools the source offers stays the
// source's own (`mcp_server.allow`, a service's granted operations). It is
// read on every call, so deleting the link, or the source, stops the next.

import { line } from '@yaks/query'
import type { Bundle, Comp, Eid } from '@yaks/graph'
import { edgeEid, link } from '@yaks/edge'
import { CallError } from '@yaks/tools/errors'
import { CONNECTION, USES } from './identity.ts'
import { type Integration, known, type Read } from './integrations.ts'

/** The kinds of source a person grants an app by address. */
export type Kind = 'mcp' | 'connection' | 'service'

/** One source a person can grant, as the page asking them shows it. */
export type Grantable = { at: string; title: string; about: string }

let MCP = 'mcp_server'
let EDGE = 'edge'

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** A service's address for the app holding its connection. */
export let serviceAt = (service: string, app: string): string =>
  `service:${service}/${app}`

/** The kind an address names, and the rest of it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(addressed('mcp:abc'), { kind: 'mcp', rest: 'abc' })
 * assertEquals(addressed('connection:'), { kind: 'connection', rest: '' })
 * assertEquals(addressed('recipes'), undefined)
 * ```
 */
export let addressed = (
  at: string,
): { kind: Kind; rest: string } | undefined => {
  let m = /^(mcp|connection|service):(.*)$/s.exec(at)
  return m ? { kind: m[1] as Kind, rest: m[2] } : undefined
}

// The address a held entity is reached at, where it is a source: an MCP
// server, a connection sent requests through, or the connection behind an app
// service, whose address names the app holding it. A connection that is an
// MCP server's credential is that server's already.
let addressOf = (b: Bundle, i: Integration | undefined, app: Eid) => {
  if (b[MCP]) return `mcp:${b.entity.eid}`
  let c = comp(b, CONNECTION)
  if (typeof c.integration != 'string' || c.integration.startsWith('mcp:')) {
    return undefined
  }
  if (i?.service) return serviceAt(i.service.app, app)
  return `connection:${b.entity.eid}`
}

let holder = (b: Bundle) =>
  b[MCP] ? comp(b, MCP).owner : comp(b, CONNECTION).owner

// The integrations a set of connections go through, by name.
let integrations = async (read: Read, held: Bundle[]) => {
  let names = [
    ...new Set(
      held.map((b) => comp(b, CONNECTION).integration).filter((n) =>
        typeof n == 'string'
      ),
    ),
  ] as string[]
  let found = await Promise.all(names.map((n) => known(read, n)))
  return new Map(names.map((n, i) => [n, found[i]]))
}

let addresses = async (read: Read, held: Bundle[], app: Eid) => {
  let by = await integrations(read, held)
  return held.map((b) =>
    addressOf(b, by.get(String(comp(b, CONNECTION).integration)), app)
  )
}

/** Every source of `person`'s that `app` holds their grant to: the far end
 * of each `uses` link from the app that the person holds, whole. */
export let grantedTo = async (
  read: Read,
  a: { app: Eid; person: Eid },
): Promise<Bundle[]> => {
  let links = await read(line`.${EDGE}.from=${a.app}&.${USES}&*`)
  if (!links.length) return []
  return (await read(
    line`.entity.eid=${links.map((l) => String(comp(l, EDGE).to))}&*`,
  )).filter((b) => holder(b) == a.person)
}

/** Every source of `person`'s that `app` holds their grant to, by address. */
export let grantsOf = async (
  read: Read,
  a: { app: Eid; person: Eid },
): Promise<string[]> => {
  let held = await grantedTo(read, a)
  return (await addresses(read, held, a.app)).filter((at) => at != null)
}

// A link that is a person's grant of their own source: spent by them alone
// and naming no binding, since the app's code is handed nothing for it.
let granting = (l: Bundle) => {
  let u = comp(l, USES)
  return u.each == true && u.binding == null && u.lender == null
}

/** The apps each of `eids` (sources a person holds) is granted to, by the
 * source's eid. */
export let grantees = async (
  read: Read,
  eids: Eid[],
): Promise<Map<Eid, Eid[]>> => {
  let out = new Map(eids.map((e) => [e, [] as Eid[]]))
  if (!eids.length) return out
  for (let l of await read(line`.${EDGE}.to=${eids}&.${USES}&*`)) {
    let e = comp(l, EDGE)
    if (granting(l)) out.get(String(e.to))?.push(String(e.from))
  }
  return out
}

/** Whether `person` granted `app` the source at `at`, read now. */
export let granted = async (
  read: Read,
  a: { app: Eid; person: Eid; at: string },
): Promise<boolean> => (await grantsOf(read, a)).includes(a.at)

// The entity behind an MCP server's or a connection's address.
let eidOf = (at: string): Eid => {
  let said = addressed(at)
  if (!said || said.kind == 'service' || !said.rest) {
    throw new CallError(
      'arguments',
      `${at} is not one source: mcp:<server> or connection:<connection>`,
    )
  }
  return said.rest
}

/** The source the link from an app to `eid` reaches, and the link, where the
 * person holds it and the link stands. */
export let grantOf = async (
  read: Read,
  a: { app: Eid; person: Eid; eid: Eid },
): Promise<{ source: Bundle; link: Bundle } | undefined> => {
  let rows = await read(
    line`(.entity.eid=${a.eid}&*)|(.entity.eid=${
      edgeEid(a.app, USES, a.eid)
    }&.${USES}&?${EDGE})`,
  )
  let source = rows.find((b) => b.entity.eid == a.eid)
  let held = rows.find((b) =>
    b[USES] && comp(b, EDGE).from == a.app && comp(b, EDGE).to == a.eid
  )
  return source && held && holder(source) == a.person
    ? { source, link: held }
    : undefined
}

/** The person's grant of one of their sources to an app: the link, spent by
 * them alone and naming no binding. Only the person who holds the source
 * grants it. */
export let grant = async (
  read: Read,
  a: { app: Eid; person: Eid; at: string },
): Promise<Bundle[]> => {
  let eid = eidOf(a.at)
  let [b] = await read(line`.entity.eid=${eid}&*`)
  let [at] = b ? await addresses(read, [b], a.app) : []
  if (!b || holder(b) != a.person || at != a.at) {
    throw new CallError(
      'access',
      'Only the person who holds this source grants it to an app',
    )
  }
  return [{ ...link(a.app, USES, eid), [USES]: { each: true } }]
}

/** Take back a grant: the link goes, and the next call through it is refused. */
export let revoke = (a: { app: Eid; at: string }): Bundle[] => [{
  entity: { eid: edgeEid(a.app, USES, eidOf(a.at)) },
  tombstone: {},
}]

/** What `person` may grant at `at`: the one source it names, or each of its
 * kind they hold (`mcp:`, `connection:`), with what it is and where it
 * reaches. A connection is offered once connected with hosts to send to. */
export let grantable = async (
  read: Read,
  person: Eid,
  at: string,
): Promise<Grantable[]> => {
  let said = addressed(at)
  if (!said || said.kind == 'service') return []
  let held = said.kind == 'mcp'
    ? await read(line`.${MCP}.owner=${person}&*`)
    : await read(
      line`.${CONNECTION}.owner=${person}&.${CONNECTION}.status=${'connected'}&*`,
    )
  let by = await integrations(read, held)
  let out: Grantable[] = []
  for (let b of held) {
    let one = `${said.kind}:${b.entity.eid}`
    if (said.rest && one != at) continue
    if (said.kind == 'mcp') {
      let s = comp(b, MCP)
      if (s.enabled === false) continue
      out.push({ at: one, title: String(s.name), about: String(s.url) })
      continue
    }
    let c = comp(b, CONNECTION)
    let i = by.get(String(c.integration))
    if (addressOf(b, i, '') != one || !i?.hosts.length) continue
    out.push({
      at: one,
      title: `${i.title || i.name}${c.account ? ` (${c.account})` : ''}`,
      about: `requests to ${i.hosts.join(', ')}`,
    })
  }
  return out
}
