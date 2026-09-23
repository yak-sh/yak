// The components this package declares, as one vocabulary document to load
// beside your own.
//
//   mail{from, to, at, target, reply_to, message_id, verified}
//                                                      one letter's envelope
//   email{address}                                     an address, as an entity
//   deliver{to}                                        who it is for, as an entity
//   delivered{at}                                      it left
//   bounced{at, reason}                                it did not
//   notified{at, by, via}                              they were told
//
// The subject and the body are not here. They are `doc{title, body}`, from
// {@link https://jsr.io/@yaks/doc | @yaks/doc}, which this package depends on
// (Jeff, 2026-09-05: "the mail package can't require the package that installs
// doc?"). A letter is an entity like any other, and the words a person reads
// belong in the one component every readable thing has — so a letter is
// searched, rendered and edited by whatever already handles a `doc`, instead of
// by a second copy of the same two properties. What is left on `mail` is the
// envelope: who it is from, where it went, when, what it is about, what it
// answers.
//
// `mail` does not declare `doc` — a vocabulary rejects a component declared
// twice, so composing it is the application's choice: `loadVocab([docDoc,
// mailDoc, ...mine])`, `plugins: [docs(), mailbox({...})]`. `target` is what
// makes this a graph's mail — the entity the letter is about, which may be any
// entity at all, so a reply about the potluck hangs off the potluck.
//
// Two ways to record who it is for, on purpose. `mail.to` is the To: line — an
// address, written by whoever composed the letter. `deliver.to` is a
// recipient: an entity in your graph, whose address is looked up when the
// letter goes out. Addressing a person rather than a string is what lets them
// change their address without rewriting the mail that has not left yet.
//
// Two properties give up their bare filter name (`bare: false`), because in a
// graph this size another component already claims it: `.to` is the recipient
// (`deliver.to`), and `.at` is stamped by half a dozen components. Write those
// two in full — `.mail.to`, `.mail.at`.
//
// `verified` is the receiving side's verdict on an arrival: whether the sending
// domain signed for the letter (DKIM). It is a property and not a gate — a
// letter nobody signed for is recorded with `verified: false` rather than
// dropped, because dropping it is silence and the reader is the one who decides
// what an unsigned letter is worth.
//
// `delivered` and `bounced` are the two ends of one outcome, and exactly one of
// them lands on a letter. Both are stamped: they are the sender's report of
// what happened, written by the effect, never by a client claiming its own mail
// arrived.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// import and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming one letter. */
export let MAIL = 'mail'

/** The component naming an address as an entity of its own. */
export let EMAIL = 'email'

/** The component naming who a letter is for, as an entity. */
export let DELIVER = 'deliver'

/** The component stamped on a letter that left. */
export let DELIVERED = 'delivered'

/** The component stamped on a letter that did not. */
export let BOUNCED = 'bounced'

/** The component stamped when a recipient was told. */
export let NOTIFIED = 'notified'

/**
 * The mail vocabulary document, to load beside
 * {@link https://jsr.io/@yaks/doc | @yaks/doc}'s and your own:
 * `loadVocab([docDoc, mailDoc, ...mine])`. It declares nothing about what a
 * person or a club is — those are plain entities in your own vocabulary — only
 * the envelope of a letter, who it is for, and what became of it. The subject
 * and the body are `doc.title` and `doc.body`.
 *
 * The `prefix` keywords are {@link https://jsr.io/@yaks/id | @yaks/id}'s: load
 * that package's keywords and a letter reads back as `E-7`, an address as
 * `A-3`. A loader that never registers them simply drops both.
 *
 * `mail` declares `before: ['doc']` — an entity carrying both is a letter,
 * not the `doc` it also carries, so `mail` sorts first. The component it sorts
 * against is @yaks/doc's, which is why this document is never loaded without
 * it.
 */
export let mailDoc: VocabDoc = doc
