// The other direction: a letter that arrived, as bundles to write.
//
// The shape it takes is the one Cloudflare's Email Workers hand a worker (a
// `ForwardableEmailMessage`), named structurally so nothing here imports a
// Cloudflare type — ./conform.ts is where that claim is checked against the
// runtime's own types. Any other source that can say from, to and headers
// works the same way.
//
// Two things this deliberately does NOT do:
//
//   IT DOES NOT PARSE MIME. The body arrives as a stream of RFC 5322 and
//   turning that into text is a parser's job, not a mail domain's — so hand
//   the text in (`postal-mime` is the usual answer in a Worker) and this
//   composes the entity around it.
//
//   IT DOES NOT ASK THE GRAPH ANYTHING. It is pure: a message in, bundles out.
//   Whom the letter is FOR, and which earlier letter it answers, are lookups —
//   see below — and a pure function is what makes this testable without a
//   storage adapter anywhere.
//
// An arrival carries no `deliver`, which is exactly why it can never echo back
// out: ./send.ts sends the letters that ask to be sent, and an arrival never
// asks.

import type { Bundle, Eid } from '@yaks/graph'
import { DOC } from '@yaks/doc'
import { MAIL } from './comp.ts'

/** The head of a received message — a web `Headers` satisfies this. */
export type Head = { get: (name: string) => string | null }

/** A received message: the slice of an Email Workers message this reads. */
export type Received = {
  /** the envelope sender — SMTP plumbing, often a bounce address */
  from: string
  /** the address it was delivered to */
  to: string
  /** its headers */
  headers: Head
}

/** What the caller knows and the message does not. */
export type Arrival = {
  /** the body as text, once something has parsed the MIME */
  text?: string
  /** the id to mint it under (default: a fresh uuid) */
  eid?: Eid
  /** the entity the letter is about — the recipient, a thread, a task */
  target?: Eid
  /** when it arrived (default: the Date header, else now) */
  at?: string
}

/**
 * Who WROTE the letter, from the `From:` header.
 *
 * The envelope `from` is not the author: a relay stamps its own bounce address
 * there, so a reply aimed at it reaches a bounce sink rather than a person.
 * The header is the author, in either of its two shapes — `Ana <ana@x.example>`
 * or a bare address — and the envelope is the fallback when there is no header
 * at all.
 */
export let author = (m: Received): string => {
  let head = (m.headers.get('from') ?? '').trim()
  let angled = /<([^<>\s]+@[^<>\s]+)>/.exec(head)
  return angled?.[1] ?? (/^\S+@\S+$/.test(head) ? head : m.from)
}

/** The unbracketed Message-ID of a received letter, or `''`. */
export let messageId = (m: Received): string =>
  (m.headers.get('message-id') ?? '').replace(/[<>]/g, '').trim()

/**
 * A received message → the bundles that record it: one entity wearing the
 * envelope it arrived in (`mail`) and the words it carried
 * ({@link https://jsr.io/@yaks/doc | @yaks/doc}'s `doc{title, body}`).
 *
 * ```ts
 * import { inbound } from '@yaks/mail'
 * // in a Worker's email() handler:
 * // let text = await parse(message.raw)
 * // await graph.apply(inbound(message, { text, target: club }))
 * ```
 *
 * Threading is a lookup, so it is left to you: read the `in-reply-to` header,
 * find the letter whose `message_id` matches, and patch this one's `reply_to`
 * at it. Same for `target` when the recipient address names an entity — query
 * `email.address`, and pass what you find.
 */
export let inbound = (m: Received, arrival: Arrival = {}): Bundle[] => {
  let at = arrival.at ?? m.headers.get('date') ?? new Date().toISOString()
  return [{
    entity: { eid: arrival.eid ?? crypto.randomUUID() },
    [DOC]: {
      title: m.headers.get('subject') || '(no subject)',
      body: arrival.text ?? '',
    },
    [MAIL]: {
      from: author(m),
      to: m.to,
      at,
      message_id: messageId(m),
      ...(arrival.target ? { target: arrival.target } : {}),
    },
  }]
}
