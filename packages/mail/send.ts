// Sending: the interface a transport implements, and the effect that calls it.
//
// A letter is sent when it asks to be. The request is the `deliver` component:
// an entity carrying `mail` and `deliver` is outbound, and one carrying `mail`
// alone is a letter you are keeping — a draft, or one that arrived. That is the
// whole rule, and it is why an inbound letter (which carries the address it was
// delivered to, in `mail.to`) can never echo itself back out.
//
// The effect runs post-commit, which is the right place for it: the letter is
// durable before anyone tries to send it, a mail server that is down cannot
// fail the write, and the outcome — `delivered` or `bounced` — is written back
// through the graph's own `apply()` as a transaction of its own. So "what
// happened to that letter?" is both a query and a live update: it is journaled
// and pushed to whoever is subscribed, rather than a row found on the next read
// (T-34044).
//
// The transport itself is supplied by the caller. This package composes a
// message and hands it over; whether that is Cloudflare, an SMTP relay, or an
// array in memory is the caller's business (./cloudflare.ts and ./stash.ts are
// two implementations).
//
// A letter is two components: the envelope is `mail` and the words a person
// reads are @yaks/doc's `doc{title, body}`. So the composition works from the
// whole entity, which is what the effect reads anyway.

import type { Bundle, Comp, Entity, ReadTx } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { after } from '@yaks/fp'
import type { Handler } from '@yaks/effects'
import { BODY, DOC, TITLE } from '@yaks/doc'
import { at } from './addr.ts'
import { html, text } from './md.ts'
import { BOUNCED, DELIVER, DELIVERED, EMAIL, MAIL } from './comp.ts'
import type { Message, Sender } from '@yaks/host'
import { Unsent } from '@yaks/host/senders'
export type { Message, Receipt, Sender } from '@yaks/host'

/** How the effect is built. */
export type Post = {
  /** what to do about a letter that asks to be sent */
  sender: Sender
  /** the clock, passed in so a test can hold it still (default: now) */
  now?: () => string
  /** a domain whose addresses belong to this graph rather than to a mail
   * server. A letter to one is delivered by writing it — see below. */
  local?: string
}

let clock = () => new Date().toISOString()

/** The whole letter as it stands, post-commit. An effect works from storage
 * rather than from the patch, so it sees `mail` and `deliver` together however
 * the transaction that wrote them was shaped. */
export let letterOf = (
  tx: ReadTx,
  entity: Entity,
): Bundle | undefined | Promise<Bundle | undefined> =>
  after(tx.get([entity.eid]), (found) => found[0])

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let str = (c: Comp | undefined, k: string): string =>
  c?.[k] == null ? '' : String(c[k])

/** Whether a letter is still owed a send: it asks to go, it was never handed
 * to a sender, and it has no outcome. A letter handed over and never settled
 * may have left, so it is not owed — sending is at most once. */
export let owed = (letter: Bundle | undefined): boolean =>
  !!comp(letter, MAIL) && !!comp(letter, DELIVER) &&
  comp(letter, DELIVER)?.tried == null &&
  !comp(letter, DELIVERED) && !comp(letter, BOUNCED)

/** The address an entity is reachable at: its own `email.address`. */
export let addressOf = (
  tx: ReadTx,
  eid: string,
): string | Promise<string> =>
  after(tx.get([eid]), (found) => str(comp(found[0], EMAIL), 'address'))

// The Message-ID a reply threads on: the answered letter's own, whether it
// arrived with it or our transport gave it one when it left.
let threadOf = (tx: ReadTx, eid: string): string | Promise<string> =>
  after(tx.get([eid]), (found) => str(comp(found[0], MAIL), 'message_id'))

/**
 * The letter as a message: the subject and both body renderings, with the
 * addresses already resolved. Pure — a test asserts on it without a transport
 * anywhere.
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
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { docDoc, docs } from '@yaks/doc'
 * import { mailDoc, sending, stash } from '@yaks/mail'
 *
 * let vocab = loadVocab([docDoc, mailDoc])
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * let g = graph({ storage: ram(vocab), vocab, plugins: [fx, docs()] })
 * fx.handle({ mail_post: sending({ sender: stash() }) })
 * ```
 *
 * It reads the whole entity, so it does not care which component triggered
 * it, and it is idempotent: only a
 * letter still {@link owed} a send is touched, and `deliver.tried` is written
 * before the letter reaches the transport, so a crash between the send and its
 * outcome leaves a letter that is never handed over twice. The one exception
 * is a sender's `Unsent` rejection, which knows the letter never left: the
 * claim is given back and the run fails to be tried again, so a dropped
 * connection is a wait, not a bounce.
 *
 * The outcome is written back through @yaks/effects' write function — a new
 * transaction through the graph's own `apply()` — so "this letter left" is
 * journaled and pushed to whoever is subscribed to the letter, rather than a
 * row they find next time they read. The registry needs that function:
 * `effects(vocab, { write })`, applied trusted, since `delivered` and
 * `bounced` are the sender's report and therefore server-owned.
 *
 * `local` names a domain whose addresses belong to this graph — an agent, a
 * project, anything reachable here and nowhere else. A letter to one is
 * already where it is going, so it is stamped `delivered` and never handed to
 * the transport; sending it out would bring it back as a
 * second letter about the same words. Leave it out where somebody reads that
 * domain's mail in a mail client: then the mailbox is the destination, and the
 * graph is only the record.
 */
export let sending =
  ({ sender, now = clock, local }: Post): Handler => (event, tx, write) =>
    after(letterOf(tx, event.entity), (letter) => {
      // Not a letter, not a request to send one, or one already handed over.
      if (!owed(letter)) return
      let mail = comp(letter, MAIL)!
      let deliver = comp(letter, DELIVER)!
      let settle = (out: Comp, name: string) =>
        write([{ entity: event.entity, [name]: { at: now(), ...out } }])
      let fail = async (reason: string, error: unknown = new Error(reason)) => {
        await settle({ reason }, BOUNCED)
        // The outcome answers the owner; throwing also reaches the host's
        // reporter. A later attempt sees the bounce and cannot resend.
        throw error
      }
      let recipient = deliver.to == null ? '' : String(deliver.to)
      if (!recipient) return fail('deliver.to names nobody')
      return after(addressOf(tx, recipient), (to) => {
        if (!to) return fail(`no address on file for ${recipient}`)
        if (!str(mail, 'from')) return fail('the letter has no from address')
        // Local delivery: the address is at a domain this graph owns, so the
        // letter has arrived by being written. The envelope is stamped the same
        // way a sent one is — a later address-book edit must never rewrite
        // where this letter went.
        if (local && at(local)(to)) {
          return write([{
            entity: event.entity,
            [MAIL]: { to },
            [DELIVER]: { waiting: null },
            [DELIVERED]: { at: now() },
          }])
        }
        let answered = mail.reply_to == null ? '' : String(mail.reply_to)
        // A refused guard on `deliver.tried` means another writer moved it.
        let raced = (error: unknown) =>
          error instanceof Stale && error.eid == event.entity.eid &&
          error.comp == DELIVER && error.prop == 'tried'
        // Two committed triggers can read the same untried letter. Claim the
        // hand-over atomically before either reaches the sender.
        let stamp = now()
        let tried = async () => {
          try {
            await write([{
              entity: event.entity,
              [DELIVER]: { tried: stamp, waiting: null },
              $was: { [DELIVER]: { tried: token(deliver.tried) } },
            }])
            return true
          } catch (error) {
            if (raced(error)) return false
            throw error
          }
        }
        // The sender knows the letter never left: give the claim back, say
        // why it waits, and throw, so the pool hands it over again after the
        // wait the sender asked for. The sweep finds it if every try fails.
        let unsent = async (error: Unsent) => {
          try {
            await write([{
              entity: event.entity,
              [DELIVER]: { tried: null, waiting: error.message.slice(0, 240) },
              $was: { [DELIVER]: { tried: token(stamp) } },
            }])
          } catch (raceError) {
            if (!raced(raceError)) throw raceError
          }
          throw error
        }
        return after(
          answered ? threadOf(tx, answered) : '',
          (replyTo) =>
            tried().then(
              (claimed) =>
                claimed
                  ? sender.send(message(letter!, to, replyTo || undefined))
                  : undefined,
            ).then(
              (receipt) =>
                receipt &&
                write([{
                  entity: event.entity,
                  // The envelope, denormalized onto the letter as data: an
                  // address book edited later never rewrites where this one
                  // went. The Message-ID the transport gave it goes where an
                  // arrival's does, so a reply to it threads the same way.
                  [MAIL]: {
                    to,
                    ...(receipt.id ? { message_id: receipt.id } : {}),
                  },
                  [DELIVERED]: { at: now() },
                }]),
              (err) =>
                err instanceof Unsent ? unsent(err) : fail(
                  String((err as Error)?.message ?? err).slice(0, 240),
                  err,
                ),
            ),
        )
      })
    })
