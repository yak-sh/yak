// Receiving, with a graph: the questions ./inbound.ts deliberately does not
// ask. That file is pure — a message in, bundles out — and stays that way,
// because a letter's other two properties are lookups: whom it is about
// (`mail.target`), and which earlier letter it answers (`mail.reply_to`).
// Both are questions for the address book and the letters already stored, so
// they live in this file instead.
//
// The address book is read in one direction here: which entity has this
// address. Both ends of a letter are found the same way (`routed`), and the
// one it came from is who wrote it. A sender nobody here knows resolves to
// nobody — never to whatever a routing fallback would have picked — and the
// letter says so with an empty `$actor`. Saying nothing is not the same: a
// change that names no writer is signed by the graph's owner (@yaks/graph
// `Options.actor`), and a stranger's letter would join the journal as the
// words of whoever runs the mailbox.
//
// The id grammar is the address grammar: an address whose local part is an id
// this graph knows names that entity, resolved by the same call that resolves
// an id a person typed (`graph.address`). Derived, never stored — an
// address-book row per short-lived entity is bookkeeping nobody would keep
// accurate, and writing to an agent should not require creating one.
//
// The Message-ID is what makes an arrival idempotent. An endpoint posted the
// same letter twice, or a sweep that pulls a message it already pulled,
// records it once: the second call returns no bundles at all.

import { type Bundle, type Eid, type Graph, Refused } from '@yaks/graph'
import { and, type Clause, eq, limit } from '@yaks/query'
import { canon, local as localOf } from './addr.ts'
import { EMAIL, MAIL } from './comp.ts'
import {
  type Arrival,
  author,
  inbound,
  messageId,
  type Received,
  verdict,
} from './inbound.ts'

/** A graph as this file uses one: a read, and the call that resolves an id a
 * caller typed. Nothing here writes — the bundles are returned to the
 * caller. */
export type Book = Pick<Graph, 'read' | 'address'>

// One entity, or none. Everything this file asks is a single-row question, so
// the shape is written once.
let one = async (graph: Book, clause: Clause): Promise<Eid | null> =>
  (await graph.read(and(clause, limit(1))))[0]?.entity.eid ?? null

/**
 * Which entity has this address, or nobody.
 *
 * Case and punctuation are the address book's own: the canonicalizer in the
 * `normalize` phase (./plugin.ts) means a stored address is already in one
 * form, so a lookup canonicalizes the same way before it queries.
 */
export let wearer = (
  graph: Book,
  address: string,
  domain?: string,
): Promise<Eid | null> =>
  one(graph, eq(`${EMAIL}.address`, domain ? canon(domain)(address) : address))

/** The entity an id-shaped address at `domain` names, or none: `S-31@yours`
 * is S-31. Only your own domain — everywhere else, a local part is a mailbox
 * name and reading it as an id would misdeliver. */
export let named = async (
  graph: Book,
  address: string,
  domain: string,
): Promise<Eid | null> => {
  let id = localOf(domain)(address)
  if (!id) return null
  try {
    return (await graph.address([id])).get(id) ?? null
  } catch (e) {
    // `S-99@yours` when there is no S-99 is a letter for nobody here, which
    // triage takes — the address door refusing the id is that answer, not a
    // reason to refuse the letter.
    if (e instanceof Refused) return null
    throw e
  }
}

let nobody: Promise<Eid | null> = Promise.resolve(null)

/** The letter other mail systems know by this Message-ID, or none — what
 * threading resolves against, and what makes an arrival idempotent. */
export let known = (graph: Book, id: string): Promise<Eid | null> =>
  id ? one(graph, eq(`${MAIL}.message_id`, id)) : nobody

/** Whom a letter to this address is for: whoever has that address, else the
 * entity its id names, else nobody. */
export let routed = async (
  graph: Book,
  address: string,
  domain?: string,
): Promise<Eid | null> =>
  await wearer(graph, address, domain) ??
    (domain ? await named(graph, address, domain) : null)

/** What the receiving half needs, besides the message. */
export type Arrivals = {
  /** the graph to query */
  graph: Book
  /** your own mail domain: the one whose addresses this graph can resolve.
   * Without it, every address belongs to somebody else and a letter is
   * recorded against whatever the address book already knows. */
  domain?: string
  /** where a letter addressed to nobody here lands — the triage entity */
  triage?: Eid
}

/**
 * A received message → the bundles that record it, with the two lookups
 * answered: whom it is for and which letter it answers. `receive` is
 * `arrived({ graph, domain, triage })`, and `graph.apply(await receive(message,
 * { text }))` records the letter; the README shows it whole.
 *
 * An empty array of bundles means the letter is already here: the Message-ID
 * is the one identity a letter carries between mail systems, so recording it
 * twice would be the error, not the second delivery.
 *
 * The letter is written by its author, found as a recipient is (`routed`),
 * and by nobody where nobody here has that address: its `$actor` is then
 * empty, so the graph does not sign it as its owner's. An unattributed write
 * is the truth about a stranger's letter, and far better than the mailbox's
 * owner appearing to have written it.
 */
export let arrived = (
  { graph, domain, triage }: Arrivals,
): (m: Received, arrival?: Arrival) => Promise<Bundle[]> =>
async (m, arrival = {}) => {
  let id = messageId(m)
  if (id && await known(graph, id)) return []
  let target = arrival.target ?? await routed(graph, m.to, domain) ?? triage
  let answers = m.headers.get('in-reply-to')
  let reply = arrival.reply ??
    (answers ? await known(graph, answers.replace(/[<>]/g, '').trim()) : null)
  let by = await routed(graph, author(m), domain)
  let batch = inbound(m, {
    ...arrival,
    verified: arrival.verified ?? verdict(m.headers) ?? undefined,
    ...(target ? { target } : {}),
    ...(reply ? { reply } : {}),
  })
  return batch.map((b) => ({ ...b, $actor: by ? { by } : {} }))
}
