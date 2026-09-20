// Receiving, with a graph: the questions ./inbound.ts deliberately does not
// ask. That file is pure — a message in, bundles out — and stays that way,
// because a letter's other two columns are LOOKUPS: whom it is about
// (`mail.target`), and which earlier letter it answers (`mail.reply_to`).
// Both are questions for the address book and the letters already here, so
// they live on this side of the line.
//
// The address book is read in ONE direction here: which entity wears this
// address. A sender nobody here knows resolves to NOBODY — never to whatever
// the routing fallback would have picked, or a stranger's letter joins the
// journal signed by whoever runs the box.
//
// The id grammar is the address grammar: an address whose local part is an id
// this graph knows names THAT entity, through the same door that resolves an
// id a person typed (`graph.address`). Derived, never stored — an address-book
// row per short-lived entity is bookkeeping nobody would keep true, and
// writing to an agent should not require minting one.
//
// The Message-ID is what makes an arrival idempotent. A door that is posted
// the same letter twice, or a sweep that pulls a message it already pulled,
// records it once: the second call answers with no bundles at all.

import type { Bundle, Eid, Graph } from '@yaks/graph'
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

/** A graph as this file uses one: a query, and the door that resolves an id a
 * caller typed. Nothing here writes — the batch goes back to whoever asked. */
export type Book = Pick<Graph, 'read' | 'address'>

// One entity, or none. Everything this file asks is a single-row question, so
// the shape is written once.
let one = async (graph: Book, clause: Clause): Promise<Eid | null> =>
  (await graph.read(and(clause, limit(1))))[0]?.entity.eid ?? null

/**
 * Which entity wears this address, or nobody.
 *
 * Case and spelling are the address book's own: the canonicalizer on the
 * `normalize` phase (./plugin.ts) means a stored address is already in one
 * form, so a lookup canonicalizes the same way before it asks.
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
  return id ? (await graph.address([id])).get(id) ?? null : null
}

let nobody: Promise<Eid | null> = Promise.resolve(null)

/** The letter the world knows by this Message-ID, or none — what threading
 * resolves against, and what makes an arrival idempotent. */
export let known = (graph: Book, id: string): Promise<Eid | null> =>
  id ? one(graph, eq(`${MAIL}.message_id`, id)) : nobody

/** Whom a letter to this address is for: whoever wears it, else the entity its
 * id names, else nobody. */
export let routed = async (
  graph: Book,
  address: string,
  domain?: string,
): Promise<Eid | null> =>
  await wearer(graph, address, domain) ??
    (domain ? await named(graph, address, domain) : null)

/** What the receiving half needs, besides the message. */
export type Arrivals = {
  /** the graph to ask */
  graph: Book
  /** your own mail domain: the namespace whose addresses this graph can
   * resolve. Without one, every address is somebody else's and a letter is
   * recorded aimed at whatever the book knows. */
  domain?: string
  /** where a letter addressed to nobody here lands — the triage pile */
  triage?: Eid
}

/**
 * A received message → the bundles that record it, with the two lookups
 * answered: whom it is for and which letter it answers.
 *
 * ```ts
 * import { arrived } from '@yaks/mail'
 *
 * let receive = arrived({ graph, domain: 'books.example', triage: pile })
 * await graph.apply(await receive(message, { text }))
 * ```
 *
 * Empty bundles mean the letter is already here: the Message-ID is the one
 * identity a letter carries across the wire, so recording it twice is the
 * error, not the second delivery.
 *
 * The batch is signed by the AUTHOR where the address book knows them, and by
 * nobody where it does not — an unattributed write is the truth about a
 * stranger's letter, and far better than the box's owner appearing to have
 * written it.
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
  let by = await wearer(graph, author(m), domain)
  let batch = inbound(m, {
    ...arrival,
    verified: arrival.verified ?? verdict(m.headers) ?? undefined,
    ...(target ? { target } : {}),
    ...(reply ? { reply } : {}),
  })
  return by ? batch.map((b) => ({ ...b, $actor: { by } })) : batch
}
