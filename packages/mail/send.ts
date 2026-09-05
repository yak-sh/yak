// Sending: the seam a transport plugs into, and the effect that uses it.
//
// A letter GOES when it asks to. The ask is the `deliver` component: an entity
// wearing `mail` and `deliver` is outbound, and one wearing `mail` alone is a
// letter you are keeping — a draft, or one that arrived. That is the whole
// rule, and it is why an inbound letter (which carries the address it came to,
// in `mail.to`) can never echo itself back out.
//
// The effect runs POST-COMMIT, which is the right place for it: the letter is
// durable before anyone tries to send it, a mail server that is down cannot
// refuse the write, and the outcome — `delivered` or `bounced` — goes back
// through the graph's own `apply()` as a batch of its own. So "what happened to
// that letter?" is a query AND a frame: it is journaled and pushed to whoever
// is watching, rather than a row found on the next look (T-34044).
//
// The transport itself is INJECTED. This package composes a message and hands
// it over; whether that is Cloudflare, an SMTP relay, or a list in memory is
// the host's business (./cloudflare.ts and ./stash.ts are two answers).
//
// A letter is TWO components: the envelope is `mail` and the words a person
// reads are @yaks/doc's `doc{title, body}`. So the composition works from the
// whole entity, which is what the effect reads anyway.

import type { Bundle, Comp, Entity, Tx } from '@yaks/graph'
import { then } from '@yaks/graph'
import type { Handler } from '@yaks/effects'
import { BODY, DOC, TITLE } from '@yaks/doc'
import { html, text } from './md.ts'
import { BOUNCED, DELIVER, DELIVERED, EMAIL, MAIL } from './comp.ts'

/** One message, composed and ready to leave. */
export type Message = {
  /** the address it is from */
  from: string
  /** the address it is going to */
  to: string
  /** the subject line */
  subject: string
  /** the body as plain text */
  text: string
  /** the same body as HTML */
  html: string
  /** the Message-ID it answers, unbracketed, when it answers one */
  replyTo?: string
}

/** What a transport says about a message it took. */
export type Receipt = {
  /** the id the transport gave it, if it gave one — kept as `delivered.via` */
  id?: string
}

/**
 * A transport: the one thing this package does not implement. `send` resolves
 * when the message is away and REJECTS when it is not — the rejection's message
 * is what lands in `bounced.reason`, so make it worth reading.
 */
export type Sender = {
  /** hand one message over */
  send: (message: Message) => Promise<Receipt>
}

/** How the effect is built. */
export type Post = {
  /** what to do about a letter that asks to go */
  sender: Sender
  /** the clock, injected so a test can hold it still (default: now) */
  now?: () => string
}

let clock = () => new Date().toISOString()

// The whole letter as it stands, post-commit: the effect works from storage
// rather than from the patch, so it sees `mail` and `deliver` together however
// the batch that wrote them was shaped.
let whole = (tx: Tx, entity: Entity) =>
  then(tx.get([entity.eid]), (found) => found[0])

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let str = (c: Comp | undefined, k: string): string =>
  c?.[k] == null ? '' : String(c[k])

/** The address an entity is reachable at: its own `email.address`. */
export let addressOf = (
  tx: Tx,
  eid: string,
): string | Promise<string> =>
  then(tx.get([eid]), (found) => str(comp(found[0], EMAIL), 'address'))

// The Message-ID a reply threads on: what the answered letter arrived as, else
// the id our own transport gave it when it went.
let threadOf = (tx: Tx, eid: string): string | Promise<string> =>
  then(tx.get([eid]), (found) =>
    str(comp(found[0], MAIL), 'message_id') ||
    str(comp(found[0], DELIVERED), 'via'))

/**
 * The letter as a message: the subject and both body renderings, with the
 * addresses already resolved. Pure — the seam a test asserts on without a
 * transport anywhere.
 *
 * It takes the whole letter rather than one component, because a letter is two
 * of them: the envelope is `mail` and the words are
 * {@link https://jsr.io/@yaks/doc | @yaks/doc}'s `doc{title, body}`.
 */
export let message = (
  letter: Bundle,
  to: string,
  replyTo?: string,
): Message => {
  let mail = comp(letter, MAIL)
  let doc = comp(letter, DOC)
  let body = str(doc, BODY)
  return {
    from: str(mail, 'from'),
    to,
    subject: str(doc, TITLE),
    text: text(body),
    html: html(body),
    ...(replyTo ? { replyTo } : {}),
  }
}

/**
 * The `created(mail)` handler: hand an outbound letter to the sender, and
 * write back what became of it.
 *
 * ```ts
 * import { effects } from '@yaks/effects'
 * import { sending, stash } from '@yaks/mail'
 *
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * fx.created('mail', sending({ sender: stash() }))
 * ```
 *
 * Register it on `created('deliver')` too and a letter that gains its
 * recipient later goes then — the handler reads the whole entity, so it does
 * not care which component woke it. It is idempotent either way: a letter that
 * already carries `delivered` or `bounced` is left alone.
 *
 * The outcome goes back through @yaks/effects' WRITE door — a new batch through
 * the graph's own `apply()` — so "this letter left" is journaled and pushed to
 * whoever is watching the letter, rather than a row they find next time they
 * ask. The registry needs that door: `effects(vocab, { write })`, applied
 * trusted, since `delivered` and `bounced` are the sender's word and therefore
 * server-owned.
 */
export let sending =
  ({ sender, now = clock }: Post): Handler => (event, tx, write) =>
    then(whole(tx, event.entity), (letter) => {
      let mail = comp(letter, MAIL)
      let deliver = comp(letter, DELIVER)
      // Not a letter, not an ask to send one, or one already settled.
      if (!mail || !deliver) return
      if (comp(letter, DELIVERED) || comp(letter, BOUNCED)) return
      let settle = (out: Comp, name: string) =>
        write([{ entity: event.entity, [name]: { at: now(), ...out } }])
      let fail = (reason: string) => settle({ reason }, BOUNCED)
      let recipient = deliver.to == null ? '' : String(deliver.to)
      if (!recipient) return fail('deliver.to names nobody')
      return then(addressOf(tx, recipient), (to) => {
        if (!to) return fail(`no address on file for ${recipient}`)
        if (!str(mail, 'from')) return fail('the letter has no from address')
        let answered = mail.reply_to == null ? '' : String(mail.reply_to)
        return then(
          answered ? threadOf(tx, answered) : '',
          (replyTo) =>
            sender.send(message(letter!, to, replyTo || undefined)).then(
              (receipt) =>
                write([{
                  entity: event.entity,
                  // The envelope, denormalized onto the letter as data: an
                  // address book edited later never rewrites where this one
                  // went.
                  [MAIL]: { to },
                  [DELIVERED]: { at: now(), via: receipt.id ?? to },
                }]),
              (err) =>
                fail(String((err as Error)?.message ?? err).slice(0, 240)),
            ),
        )
      })
    })
