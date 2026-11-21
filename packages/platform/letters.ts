/**
 * What a space's Operator writes a person by email. Every letter yaks.app
 * sends a person that they might answer comes from the Operator of the space
 * it concerns: under the Operator's name, from the space's own address
 * (`<space>@yaks.app`, {@link mailFrom}), written in the first person, and
 * ending with what a reply can ask for. A reply to that address reaches the
 * Operator's one conversation with whoever wrote it.
 *
 * A few letters stay mechanical, because what they carry has to be read at a
 * glance and their words are fixed: a sign-in code, a contact code, the link
 * that confirms an act an assistant cannot take. They still come from the
 * Operator, so a reply to one reaches it too.
 *
 * Each function here is pure: it answers a letter's subject and body, and
 * the host decides how it is sent.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { envelope, signed } from '@yaks/platform/letters'
 * let ada = { slug: 'ada', title: 'Ada', operator: 'Nova' }
 * equal(envelope(ada), { from: 'ada@yaks.app', name: 'Nova' })
 * equal(signed(ada), 'Nova\nAda’s Operator')
 * ```
 */
import { type Host, mailFrom } from './host.ts'

/** The space a letter's Operator works for: its slug, its title and what
 * its Operator is called. */
export type Writer = { slug: string; title?: string; operator: string }

/** Who a letter is from: the space's own address, under its Operator's
 * name, which the reader's mail shows. */
export let envelope = (space: Writer, env: Host = {}) => ({
  from: mailFrom(space.slug, null, env),
  name: space.operator,
})

/** How the Operator signs a letter: its name, and whose Operator it is. */
export let signed = (space: Writer) =>
  `${space.operator}\n${space.title || space.slug}’s Operator`

/** How the Operator signs a letter it writes to someone else for a person:
 * its name, whose assistant it is, and that they are copied. */
export let signedFor = (space: Writer, name: string) =>
  `${space.operator}\n${name}’s AI assistant on yaks.app. ${name} is copied on this letter.`

/** The line that ends a letter whose reader may have a question. */
export let ASK = "Reply to this email with any question, and I'll answer."

/// bullets(['a', 'b']) -> '  - a\n  - b'
/** Lines as a letter lists them. */
export let bullets = (lines: string[]) =>
  lines.map((l) => `  - ${l}`).join('\n')

// Someone's own words, marked as theirs the way a letter quotes, so a reader
// can tell what a person wrote from what the Operator says.
let quoted = (said: string) =>
  said.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')

/** What the invitation's reader is invited to. */
export type Invited = {
  space: Writer
  /** who invited them, by name, or null when nobody is known */
  by: string | null
  /** what to call them, where the inviter said */
  name?: string
  /** the inviter's note */
  note?: string
  /** 'see' for a viewer, 'use' for anyone who may write */
  verb: 'see' | 'use'
  /** what it opens: a title and the address it opens at */
  what: string
  /** the one click that accepts */
  accept: string
  /** the address the link signs them in as */
  email: string
  /** how many days the link signs them in */
  days: number
}

/**
 * An invitation, from the Operator of the space it opens: the inviter's note
 * first and quoted, then who invited them to what, the one click that
 * accepts, and an offer to answer.
 *
 * ```ts
 * import { assertStringIncludes } from '@std/assert'
 * import { invitation } from '@yaks/platform/letters'
 * let body = invitation({
 *   space: { slug: 'ada', title: 'Ada', operator: 'Nova' },
 *   by: 'Ada', verb: 'use', what: 'Cookbook (ada.yaks.app/cookbook)',
 *   accept: 'https://yaks.app/invite?t=x', email: 'bea@example.com', days: 14,
 * })
 * assertStringIncludes(body, "I'm Nova, the AI assistant for Ada’s space")
 * assertStringIncludes(body, 'Ada invited you to use Cookbook')
 * ```
 */
export let invitation = (o: Invited): string =>
  (o.name ? `Hi ${o.name},\n\n` : '') +
  // Their words first, and marked as theirs, so a reader never takes the
  // Operator to be saying them.
  (o.note ? `${o.by ?? 'They'} wrote:\n\n${quoted(o.note)}\n\n` : '') +
  `I'm ${o.space.operator}, the AI assistant for ${
    o.space.title || o.space.slug
  }’s space on yaks.app. ${o.by ?? 'Someone there'} invited you to ${o.verb} ` +
  `${o.what}. Accept with one click:\n\n${o.accept}\n\n` +
  `The link signs you in as ${o.email} for the next ${o.days} days. There ` +
  'is nothing to install and no account to make first. Until you accept, ' +
  'nothing of theirs is shared with you, and if you did not expect this you ' +
  'can ignore it.\n\n' +
  "Reply to this email with any question about it, and I'll answer.\n\n" +
  signed(o.space)

/** An act an assistant asked for that only the person can confirm. */
export type Confirming = {
  space: Writer
  /** the letter's subject: the act, as a question */
  subject: string
  /** what the assistant asked, as a sentence */
  asked: string
  /** where things stand until they press, if anything is worth saying */
  until?: string
  /** the link that does it */
  link: string
  /** the sentence before the list */
  what: string
  /** what it stops or destroys */
  lines: string[]
}

/**
 * The letter that confirms an act an assistant may only ask for: what was
 * asked, that nothing has happened, the hour's link, what it stops or
 * destroys, and that only the link does it. Mechanical where it must be:
 * the link and the list are exact.
 *
 * ```ts
 * import { assertStringIncludes } from '@std/assert'
 * import { confirmation } from '@yaks/platform/letters'
 * let l = confirmation({
 *   space: { slug: 'ada', operator: 'Nova' }, subject: 'Delete ada.yaks.app?',
 *   asked: 'Your assistant asked to delete ada.yaks.app.',
 *   link: 'https://yaks.app/x', what: 'It destroys:', lines: ['Cookbook'],
 * })
 * assertStringIncludes(l.body, "I haven't done anything yet.")
 * assertStringIncludes(l.body, '  - Cookbook')
 * ```
 */
export let confirmation = (o: Confirming) => ({
  subject: o.subject,
  body: `${o.asked}\n\n` +
    `I haven't done anything yet.${o.until ? ` ${o.until}` : ''} Nothing ` +
    'changes unless you open this link, and it only works for the next ' +
    `hour:\n\n${o.link}\n\n${o.what}\n\n${bullets(o.lines)}\n\n` +
    'Only the link does this, never a reply. If you did not ask for it, ' +
    'ignore this letter and nothing happens at all, or reply and tell me ' +
    'what you would like instead.\n\n' +
    signed(o.space),
})

/**
 * The code that proves a person holds an address they asked their Operator
 * to reach them at, typed back in their conversation with it. Mechanical:
 * the code is the subject and the first line.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { contactCode } from '@yaks/platform/letters'
 * let l = contactCode({ slug: 'ada', operator: 'Nova' }, '123456')
 * equal(l.subject, '123456 is your yaks.app contact code')
 * ```
 */
export let contactCode = (space: Writer, code: string) => ({
  subject: `${code} is your yaks.app contact code`,
  body: `Your contact code is ${code}.\n\n` +
    'Type it in our conversation to confirm this email address. It expires ' +
    'in ten minutes. If you did not ask for this, ignore it; no contact has ' +
    `changed.\n\n${signed(space)}`,
})

/**
 * An alert by email: what the Operator tells the person, an invitation to
 * answer by replying, and where their Updates are; or what it `asks` them,
 * and where in their Updates its choices answer it in one press.
 *
 * ```ts
 * import { assertStringIncludes } from '@std/assert'
 * import { alerted } from '@yaks/platform/letters'
 * let ada = { slug: 'ada', operator: 'Nova' }
 * let body = alerted(ada, 'Your report is ready.', 'https://yaks.app/manage/ada/updates')
 * assertStringIncludes(body, 'Reply to this email to answer me')
 * assertStringIncludes(
 *   alerted(ada, 'Email bo@x.com?', 'https://yaks.app/manage/ada/updates#u-1', true),
 *   'Answer it in your Updates: https://yaks.app/manage/ada/updates#u-1',
 * )
 * ```
 */
export let alerted = (
  space: Writer,
  words: string,
  updates: string,
  asks = false,
) =>
  `${words}\n\n` +
  (asks
    ? `Answer it in your Updates: ${updates}\n\n`
    : `Reply to this email to answer me, or open your Updates: ${updates}\n\n`) +
  signed(space)
