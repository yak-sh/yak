// The components this package ships, as one vocabulary document to load beside
// your own.
//
//   mail{from, to, at, target, reply_to, message_id}   one letter's envelope
//   email{address}                                     an address, as an entity
//   deliver{to}                                        who it is for, as an entity
//   delivered{at, via}                                 it left
//   bounced{at, reason}                                it did not
//   notified{at, by, via}                              they were told
//
// THE SUBJECT AND THE BODY ARE NOT HERE. They are `doc{title, body}`, from
// {@link https://jsr.io/@yaks/doc | @yaks/doc}, which this package depends on
// (Jeff, 2026-09-05: "the mail package can't require the package that installs
// doc?"). A letter is an entity like any other, and the words a person reads
// live in the one component every readable thing wears — so a letter is
// searched, rendered and edited by whatever already handles a `doc`, instead of
// by a second copy of the same two columns. What is left on `mail` is the
// ENVELOPE: who it is from, where it went, when, what it is about, what it
// answers.
//
// `mail` does not SHIP `doc` — a vocabulary refuses a component declared twice,
// so composing it is the application's call: `loadVocab([docDoc, mailDoc,
// ...mine])`, `plugins: [docs(), mailbox({...})]`. `target` is what makes this a
// GRAPH's mail — the entity the letter is about, which is any entity at all, so
// a reply about the potluck hangs off the potluck.
//
// TWO WAYS TO SAY WHO IT IS FOR, on purpose. `mail.to` is the To: line — an
// address, written by whoever composed the letter. `deliver.to` is a
// RECIPIENT: an entity in your graph, whose address is looked up when the
// letter goes out. Addressing a person rather than a string is what lets them
// change their address without rewriting the mail that has not left yet.
//
// Two columns yield their bare spelling (`bare: false`), because another concept
// in a graph this size already owns the word: `.to` is the recipient
// (`deliver.to`), and `.at` is stamped by half a dozen components. Say those in
// full — `.mail.to`, `.mail.at`.
//
// `delivered` and `bounced` are the two ends of one outcome, and exactly one of
// them lands on a letter. Both are stamped: they are the sender's account of
// what happened, written by the effect, never by a client claiming its own mail
// arrived.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// say and keeps the prose about why it is shaped the way it is.

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
 * The mail vocabulary, to load beside {@link https://jsr.io/@yaks/doc |
 * @yaks/doc}'s and your own: `loadVocab([docDoc, mailDoc, ...mine])`. It
 * declares nothing about what a person or a club IS — those are plain entities
 * in your own vocabulary — only the ENVELOPE of a letter, who it is for, and
 * what became of it. The subject and the body are `doc.title` and `doc.body`.
 *
 * The `prefix` keywords are {@link https://jsr.io/@yaks/id | @yaks/id}'s: load
 * that package's keywords and a letter reads back as `E-7`, an address as
 * `A-3`. A loader that never registers them simply carries neither.
 *
 * `mail` says `before: ['doc']` — a letter that wears both is a letter, not
 * the `doc` it also wears, so `mail` sorts first. The word it sorts against is
 * @yaks/doc's, which is why this document is never loaded without it.
 */
export let mailDoc: VocabDoc = doc
