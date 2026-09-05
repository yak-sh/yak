// The components this package ships, as one vocabulary document to load beside
// your own.
//
//   mail{from, to, subject, body, at, target, reply_to}   one letter
//   email{address}                                        an address, as an entity
//   deliver{to}                                           who it is for, as an entity
//   delivered{at, via}                                    it left
//   bounced{at, reason}                                   it did not
//   notified{at, by, via}                                 they were told
//
// A letter is a whole entity, not a row hanging off one: `mail` carries its own
// subject and body, so a graph with nothing but this document loaded can hold
// correspondence. `target` is what makes it a GRAPH's mail — the entity the
// letter is about, which is any entity at all, so a reply about the potluck
// hangs off the potluck.
//
// TWO WAYS TO SAY WHO IT IS FOR, on purpose. `mail.to` is the To: line — an
// address, written by whoever composed the letter. `deliver.to` is a
// RECIPIENT: an entity in your graph, whose address is looked up when the
// letter goes out. Addressing a person rather than a string is what lets them
// change their address without rewriting the mail that has not left yet.
//
// Three columns yield their bare spelling (`bare: false`), because another
// concept in a graph this size already owns the word: `.to` is the recipient
// (`deliver.to`), `.body` is content, and `.at` is stamped by half a dozen
// components. Say those in full — `.mail.to`, `.mail.body`, `.mail.at`.
//
// `delivered` and `bounced` are the two ends of one outcome, and exactly one of
// them lands on a letter. Both are stamped: they are the sender's account of
// what happened, written by the effect, never by a client claiming its own mail
// arrived.

import type { VocabDoc } from '@yaks/vocab'

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
 * The mail vocabulary, to load beside your own:
 * `loadVocab([mailDoc, ...mine])`. It declares nothing about what a person or
 * a club IS — those are plain entities in your own vocabulary — only what a
 * letter is, who it is for, and what became of it.
 *
 * The `prefix` keywords are {@link https://jsr.io/@yaks/id | @yaks/id}'s: load
 * that package's keywords and a letter reads back as `E-7`, an address as
 * `A-3`. A loader that never registers them simply carries neither.
 */
export let mailDoc: VocabDoc = {
  title: 'mail',
  $defs: {
    mail: {
      type: 'object',
      kind: true,
      prefix: 'E',
      description: 'one letter, sent or received',
      properties: {
        from: {
          type: 'string',
          description: 'the address it came from',
        },
        to: {
          type: 'string',
          bare: false,
          description:
            'the address it is written to — absent when `deliver.to` names the recipient as an entity instead',
        },
        subject: {
          type: 'string',
          description: 'the subject line',
        },
        body: {
          type: 'string',
          bare: false,
          description: 'the letter itself, as markdown',
        },
        at: {
          type: 'string',
          format: 'date-time',
          bare: false,
          description: 'when it was written, or when it arrived',
        },
        target: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'the entity this letter is about — any entity at all, so correspondence hangs off the thing it concerns',
        },
        reply_to: {
          type: 'string',
          ref: 'mail',
          death: 'keep',
          description: 'the letter this one answers',
        },
        message_id: {
          type: 'string',
          description:
            'the Message-ID the world knows this letter by — written from what arrived, and what a reply threads on',
        },
      },
    },
    email: {
      type: 'object',
      kind: true,
      prefix: 'A',
      description: 'an address, as an entity — what a person is reachable at',
      properties: {
        address: {
          type: 'string',
          description: 'the address itself, canonical (see canon)',
        },
      },
    },
    deliver: {
      type: 'object',
      description: 'who a letter is for, as an entity in your graph',
      properties: {
        to: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'the recipient — their address is looked up when the letter goes out',
        },
      },
    },
    delivered: {
      type: 'object',
      description: 'the letter left: half of the outcome pair',
      properties: {
        at: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when it went',
        },
        via: {
          type: 'string',
          stamped: true,
          description:
            'how it went — the id the sender gave it back, or the address it went to',
        },
      },
    },
    bounced: {
      type: 'object',
      description: 'the letter did not leave: the other half',
      properties: {
        at: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when the attempt failed',
        },
        reason: {
          type: 'string',
          stamped: true,
          description: 'what went wrong, as the sender said it',
        },
      },
    },
    notified: {
      type: 'object',
      description: 'a recipient was told about something',
      properties: {
        at: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when they were told',
        },
        by: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          stamped: true,
          description: 'who told them',
        },
        via: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          stamped: true,
          description: 'what carried it',
        },
      },
    },
  },
}
