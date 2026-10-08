// The `./mail` facet: what the inbox's email door makes of a letter that
// arrived. @yaks/mail records the letter and asks each configured package's
// reading (@yaks/mail `Reading`); this is the inbox's, and it answers only
// where the config opened a door (./options.ts `person`).
//
// Two things a letter can mean here. A verified letter from the person to the
// inbox address, answering nothing, is a new conversation: the received
// entity keeps its envelope and gains `conversation{}`, with their words as its
// doc. A verified reply from whom a thread letter was sent to, or from the
// person to a thread's own address, is a comment in that thread, and a number
// or words answering its open decision answer it.
//
// Provenance is checked first, independently of the person: a sender that is a
// session, role, effect, call, output or transcript entry, the inbox address
// itself, or `Auto-Submitted` other than `no` is kept as mail only. DKIM
// authenticates a sending domain, not whether a person or an automation typed
// the words.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { Book, Read, Reading } from '@yaks/mail'
import { answer, type Decision } from '@yaks/task'
import type { Options } from './options.ts'

let comp = (b: Bundle | undefined, name: string): Comp =>
  b?.[name] as Comp ?? {}
let str = (v: unknown) => String(v ?? '')

/** The new words, without the quoted conversation or a conventional signature. */
let unquoted = (body: string): string =>
  body.split(/\r?\n(?:On .+wrote:|>.*|--\s*$)/m)[0].trim()

/** The number shown in the letter, or a custom answer. Out-of-range numbers
 * remain comments rather than silently becoming custom decision answers. */
let choice = (body: string, decision: Decision): string => {
  let text = unquoted(body)
  return /^\d+$/.test(text)
    ? decision.choices[Number(text) - 1]?.label ?? ''
    : text
}

/** Keep the received envelope even when its author cannot act on the thread.
 * DKIM is the receiving edge's verdict, never an assertion in the body. */
let replied = async (
  graph: Book,
  letter: Bundle,
  parent: Bundle | undefined,
  by: string | null,
  owner?: string,
): Promise<Bundle[]> => {
  if (!parent?.mail_notice && !owner) return [letter]
  let mail = comp(letter, 'mail')
  let prior = comp(parent, 'mail')
  if (parent?.mail_notice && !prior.target) return [letter]
  let target = parent?.conversation
    ? parent.entity.eid
    : str(prior.target || mail.target)
  if (!by || mail.verified != true || !target) return [letter]
  let recipient = str(comp(parent, 'deliver').to)
  // A stored outgoing envelope proves whom we asked. Without it, only an
  // explicitly enabled inbox recipient can act via a thread's email address.
  if (parent?.deliver ? recipient != by : owner != by) return [letter]
  let addressed = (await graph.read(`.entity.eid=${JSON.stringify(target)}`))[0]
  let ancestor = str(comp(addressed, 'comment').target)
  let root = ancestor
    ? (await graph.read(`.entity.eid=${JSON.stringify(ancestor)}`))[0]
    : addressed
  if (ancestor) target = ancestor
  if (
    !root || (root.mail && !root.conversation) ||
    !(root.task || root.design || root.session ||
      root.bug || root.project || root.doc)
  ) return [letter]
  let replyTo =
    (parent?.comment
      ? parent.entity.eid
      : str(comp(parent, 'mail_notice').comment)) ||
    (ancestor ? addressed!.entity.eid : '')
  let out: Bundle = {
    ...letter,
    mail: { ...mail, target },
    comment: { target, ...(replyTo ? { reply_to: replyTo } : {}) },
  }
  let decision = root.decision as Decision | undefined
  let picked = decision ? choice(str(comp(letter, 'doc').body), decision) : ''
  let assigned = str(comp(root, 'filed').assignee)
  let canAnswer = !assigned || assigned == by
  return [
    out,
    ...(picked && canAnswer && !root.decided && !root.cancelled &&
        !root.completed
      ? answer(target, picked).map((b) => ({ ...b, $actor: { by } }))
      : []),
  ]
}

let one = async (graph: Book, eid: Eid): Promise<Bundle | undefined> =>
  (await graph.read(`.entity.eid=${JSON.stringify(eid)}`))[0]

/** Whether a letter is a person's own words from outside: not a known
 * session, role, effect, call, output or transcript entry, not the inbox
 * address writing to itself, and not a letter that says it was automatic. */
let external = async (
  { graph, message, letter, by, canonical }: Read,
  from?: string,
): Promise<boolean> => {
  let writer = by ? await one(graph, by) : undefined
  let automatic = message.headers.get('auto-submitted')?.trim().toLowerCase()
  return !(
    writer?.session || writer?.role || writer?.effect || writer?.call ||
    writer?.output || writer?.entry ||
    (automatic && automatic != 'no') ||
    (from && canonical(str(comp(letter, 'mail').from)) == canonical(from))
  )
}

/** The inbox's reading of an arrival, where the options open a door. */
export let reading = (options: Options = {}): Reading | undefined => {
  let { person, from } = options
  if (!person) return
  return async (read) => {
    let { graph, message, arrival, letter, reply, by, canonical } = read
    if (!await external(read, from)) return
    // A reply whose parent is unknown is still a reply, never a fresh request.
    // External provenance was checked first; the person filter and the
    // verification fail closed before a conversation mark is added. The
    // envelope stays on the conversation itself, so Message-ID deduplication
    // and later email replies use the same root.
    let mail = letter.mail as Record<string, unknown>
    let text = arrival.text ?? ''
    if (
      from && by == person && mail.verified == true &&
      canonical(message.to) == canonical(from) &&
      !arrival.target && !reply && !message.headers.get('in-reply-to') &&
      !message.headers.get('references') && text.trim()
    ) {
      let { target: _target, ...envelope } = mail
      return [{
        ...letter,
        mail: envelope,
        conversation: {},
        doc: { title: text.split(/\r?\n/, 1)[0], body: text },
      }]
    }
    let parent = reply ? await one(graph, reply) : undefined
    let said = await replied(graph, letter, parent, by, person)
    return said.length == 1 && said[0] == letter ? undefined : said
  }
}
