// What an agent may ask for here: the `@yaks/mail/tools` entry point — the
// implementations behind the `tool: true` declarations in ./vocab.json. Three
// commands a person runs all day, and one check.
//
// Reading is the mark, so `mail show` refreshes `opened` on the letter and on
// the first letter of the thread it renders. That is what keeps it from being
// a duplicate of `graph_show` (@yaks/mcp's generic tier, which shows any entity
// at all) — this one marks the letter read and gathers its thread, both of
// which are facts about mail and about nothing else. Answering a letter that
// arrived puts its thread away the same way, with `archived`. Each mark is
// removed and written again in one batch, so a repeated one gets a fresh time.
//
// `archived` and `opened` are another package's components — @yaks/kernel's,
// the marks recording that somebody looked at a thing and that somebody put it
// away. A tool returns bundles, which are plain data, so naming a component
// costs no import; a server that composes the kernel stores them, and one that
// does not has those components dropped on write. Nothing here declares a
// second copy of either (M-17871).
//
// The sender is not this file's business. `mail send` and `mail reply` create
// a letter that asks to be sent (`deliver`), and ./effects.ts — built from the
// `sender` the config names beside this plugin — is what hands it to a
// transport and writes `delivered` or `bounced` back onto it. So a tool that
// writes mail never talks to a mail server, and a test replaces the whole of
// it with `{"via": "stash"}`.
//
// What is not checked in `mail check`, deliberately: whether each address this
// graph can create is deliverable at the MTA — the fleet's doctor read
// Cloudflare Email Routing's live rule set to determine that. That is a
// question about a zone somebody deployed, answered using a credential the
// server holds, and its answer is the same whatever graph is running; a
// package's check reads the graph its own components describe. A deployment
// that wants that check asks its provider, in its own deployment's check, and
// this package's `bounced{reason}` is what records the answer arriving the
// hard way.

import {
  addressed,
  argsOf,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  who,
} from '@yaks/graph'
import { BODY, DOC, TITLE } from '@yaks/doc'
import { human } from '@yaks/id'
import { absent, and, eq, every, list, present } from '@yaks/query'
import { checked, type Finding, said } from '@yaks/tools'
import type { Runs } from '@yaks/graph/tools'
import { wearer } from './arrive.ts'
import { post } from './effects.ts'
import { DELIVER, EMAIL, MAIL } from './comp.ts'
import type { Options } from './options.ts'

// The two components this file writes that it does not declare. Both are
// @yaks/kernel's, and both are written here as plain strings, because a tool's
// result is data (see the header).
let ARCHIVED = 'archived'
let OPENED = 'opened'

let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let prop = (c: Comp | undefined, k: string): string => str(c?.[k])

// One entity whole, by eid. Everything here works from the letter as it
// stands rather than from a patch, the way ./send.ts does.
let one = async (graph: Graph, eid: Eid): Promise<Bundle | undefined> =>
  (await graph.get([eid]))[0]

// The eid a recipient argument names, whatever form a person typed it in:
// `to` takes an address or an id, so it is not a declared reference the
// runner resolves the way it resolves `who`, `item`, `letter` and `about`
// (@yaks/tools).
let at = async (graph: Graph, said: unknown): Promise<Eid> =>
  (await addressed(graph, [str(said)]))[0]

// The letter an argument names, rejected unless it carries `mail`.
let letterIn = async (graph: Graph, said: unknown): Promise<Bundle> => {
  let found = await one(graph, str(said))
  if (!comp(found, MAIL)) throw new Error(`not a letter: ${str(said)}`)
  return found!
}

/** `Re:` derivation — shed however many `Re:`/`Fwd:` layers already piled up,
 * so a long thread does not grow a subject line. */
export let reSubject = (said: string): string =>
  `Re: ${said.replace(/^(\s*(re|fwd?):\s*)+/i, '').trim()}`

// The far side's address as an entity, since `deliver.to` names a recipient
// rather than a string: whoever already has that address, else a new `email`
// row for it. That is what makes the address book grow by use instead of by
// bookkeeping — and why writing to a stranger needs no step before it. An
// empty address resolves to nobody, never to a blank row: an `email` entity
// with no address is a recipient a letter can be aimed at and never reach.
let recipientOf = async (
  graph: Graph,
  address: string,
  domain?: string,
): Promise<{ to: Eid; made: Bundle[] }> => {
  if (!address) return { to: '', made: [] }
  let known = await wearer(graph, address, domain)
  return known
    ? { to: known, made: [] }
    : { to: '$to', made: [{ entity: { eid: '$to' }, [EMAIL]: { address } }] }
}

// Whom an argument means: a string with an `@` is an address, anything else is
// an id.
let aimedAt = async (
  graph: Graph,
  said: string,
  domain?: string,
): Promise<{ to: Eid; made: Bundle[] }> =>
  said.includes('@')
    ? await recipientOf(graph, said, domain)
    : { to: await at(graph, said), made: [] }

/**
 * A letter's thread: up its one-parent `reply_to` chain, then down over
 * whatever answers anything already found. Each read is keyed by the letters
 * in hand, so a thread costs its own rows rather than every letter ever sent.
 */
export let threadOf = async (
  graph: Graph,
  letter: Bundle,
): Promise<Bundle[]> => {
  let found = [letter]
  let seen = new Set([letter.entity.eid])
  for (let up = prop(comp(letter, MAIL), 'reply_to'); up && !seen.has(up);) {
    let b = await one(graph, up)
    if (!b) break
    seen.add(up)
    found.push(b)
    up = prop(comp(b, MAIL), 'reply_to')
  }
  for (let front = [...seen]; front.length;) {
    let down = (await graph.read(
      and(eq(`${MAIL}.reply_to`, list(...front)), every()),
    ))
      .filter((b) => !seen.has(b.entity.eid))
    for (let b of down) seen.add(b.entity.eid), found.push(b)
    front = down.map((b) => b.entity.eid)
  }
  // Chronological where the letters record a time, insertion order where they
  // do not — a sort that is stable either way rather than one that invents a
  // time.
  return found.sort((a, b) =>
    prop(comp(a, MAIL), 'at').localeCompare(prop(comp(b, MAIL), 'at'))
  )
}

// The first letter of a thread: up the `reply_to` chain from this one, as far
// as the thread in hand goes.
let rootOf = (thread: Bundle[], letter: Bundle): Eid => {
  let byId = new Map(thread.map((b) => [b.entity.eid, b]))
  let seen = new Set<Eid>()
  let at = letter
  for (
    let up = prop(comp(at, MAIL), 'reply_to');
    up && byId.has(up) && !seen.has(up);
    up = prop(comp(at, MAIL), 'reply_to')
  ) {
    seen.add(up)
    at = byId.get(up)!
  }
  return at.entity.eid
}

// A mark made again: removed and added in one batch, so the server stamps a
// fresh time even where the mark was already there.
let mark = (eid: Eid, name: string): Bundle[] => [
  { entity: { eid }, [name]: null },
  { entity: { eid }, [name]: {} },
]

// One letter as a line: who it is from, what it is about, and whether it has
// been read — `●` unread, `·` read, `×` archived, the way a mail client does.
let line = (id: (b: Bundle) => string) => (b: Bundle): string => {
  let mail = comp(b, MAIL)
  let dot = b[ARCHIVED] ? '×' : b[OPENED] ? '·' : '●'
  let who = prop(mail, 'from')
  return `${dot} ${id(b)}${who ? ` ${who}` : ''} — ${
    prop(comp(b, DOC), TITLE) || '(no subject)'
  }`
}

// One letter whole: the envelope a person reads, then the words, then the rest
// of the thread with this one marked.
let page = (id: (b: Bundle) => string, letter: Bundle, thread: Bundle[]) => {
  let mail = comp(letter, MAIL)
  let doc = comp(letter, DOC)
  let said = [
    `# ${prop(doc, TITLE) || '(no subject)'}`,
    [
      prop(mail, 'from') && `from ${prop(mail, 'from')}`,
      prop(mail, 'to') && `to ${prop(mail, 'to')}`,
      prop(mail, 'at'),
      mail?.verified === false && 'UNSIGNED',
    ].filter(Boolean).join(' · '),
    '',
    prop(doc, BODY),
  ]
  if (thread.length > 1) {
    said.push(
      '',
      '## Thread',
      ...thread.map((t) =>
        `${t.entity.eid == letter.entity.eid ? '▶' : ' '} ${line(id)(t)}`
      ),
    )
  }
  return said.join('\n')
}

/** The implementations of the tools ./vocab.json declares. A factory, like
 * every other entry point in these packages: the domain is what an address a
 * person typed is canonicalized against before the address book is queried,
 * into the same form the canonicalizer stored it in (./plugin.ts). Everything
 * else a handler needs arrives on the call it is handed. */
export let runs = (_host?: unknown, options: Options = {}): Runs => ({
  // Reading is the mark, so this writes. The prose is the result; the `opened`
  // patch is what keeps a second call from reporting it as unread.
  mail_show: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let letter = await letterIn(graph, args.letter)
    let thread = await threadOf(graph, letter)
    let root = rootOf(thread, letter)
    return [
      ...[...new Set([root, letter.entity.eid])].flatMap((eid) =>
        mark(eid, OPENED)
      ),
      said(call, page(human(graph.vocab), letter, thread)),
    ]
  },

  // The reply goes to the far side — an arrival's author, or our own sent
  // letter's recipient — and never to a fallback between the two: the wrong
  // choice here is this graph's own address, so a reply that quietly went
  // there would look sent without being sent. An arrival is a letter with a
  // Message-ID that never asked to be sent: one of ours carries `deliver`, and
  // has a Message-ID too once the transport gave it one.
  mail_reply: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let letter = await letterIn(graph, args.letter)
    let mail = comp(letter, MAIL)!
    let arrived = !!prop(mail, 'message_id') && !comp(letter, DELIVER)
    let far = arrived
      ? await recipientOf(graph, prop(mail, 'from'), options.domain)
      : { to: prop(comp(letter, DELIVER), 'to'), made: [] as Bundle[] }
    if (!far.to) {
      throw new Error(
        'cannot reply: that letter names nobody to answer — send a fresh mail',
      )
    }
    // The address it goes from: the one an arrival was delivered to, or the
    // one our own letter went out from. Either way, this side of the thread.
    let from = arrived ? prop(mail, 'to') : prop(mail, 'from')
    return [
      ...far.made,
      {
        entity: { eid: '$reply' },
        [DOC]: {
          [TITLE]: reSubject(prop(comp(letter, DOC), TITLE)),
          [BODY]: str(args.body),
        },
        // No `target`: on an arrival that property holds whom the letter was
        // routed to (./arrive.ts), which is this side of the thread — carrying
        // it forward would file our own answer as one more letter to us.
        // `reply_to` is what threads a reply, and it is enough.
        [MAIL]: { ...(from ? { from } : {}), reply_to: letter.entity.eid },
        [DELIVER]: { to: far.to },
      },
      // Answering an arrival puts its thread away: a thread you have replied
      // to is not one waiting on you. Only an arrival — following up on your
      // own letter left nothing waiting, so there is nothing to put away.
      ...(arrived
        ? [
          ...new Set([
            rootOf(await threadOf(graph, letter), letter),
            letter.entity.eid,
          ]),
        ].flatMap((eid) => mark(eid, ARCHIVED))
        : []),
    ]
  },

  // A letter goes out from the address of what it is about, so the answer
  // comes back to that: a project's letter from the project's address. Where
  // that has none, from whoever is asking.
  mail_send: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let far = await aimedAt(graph, str(args.to), options.domain)
    if (!far.to) throw new Error('a letter needs somebody to go to — say --to')
    let target = str(args.about)
    let address = async (eid: string) =>
      eid ? prop(comp(await one(graph, eid), EMAIL), 'address') : ''
    let from = args.from != null
      ? str(args.from)
      : await address(target) || await address(str(who(call)?.by))
    if (!from) {
      throw new Error(
        'a letter needs a from address — say --from, or send it about ' +
          'something with an `email.address`, or give whoever is asking one',
      )
    }
    return [
      ...far.made,
      {
        entity: { eid: '$letter' },
        [DOC]: {
          [TITLE]: str(args.subject),
          [BODY]: str(args.body),
        },
        [MAIL]: { from, ...(target ? { target } : {}) },
        [DELIVER]: { to: far.to },
      },
    ]
  },

  mail_check: async (call, graph) => {
    // An arrival is a letter with a Message-ID that never asked to be sent
    // (see mail_reply), and one with no sender has nobody to answer.
    let orphans = await graph.read(
      and(
        present(`${MAIL}.message_id`),
        absent(DELIVER),
        absent(`${MAIL}.from`),
        every(),
      ),
    )
    let id = human(graph.vocab)
    let found = orphans.map((b): Finding => ({
      level: 'fail',
      text: `${id(b)} arrived with no sender — a reply has nowhere to go`,
    }))
    // And the other direction: a transport this server could not build leaves
    // outbound letters sitting in the graph. Missing config never stops the
    // server from starting (./effects.ts), so this is where it is reported.
    let { waiting } = options.sender
      ? post(options.sender)
      : { waiting: undefined }
    if (waiting) {
      found.push({
        level: 'warn',
        text: `nothing is being sent — ${waiting}. What is written meanwhile ` +
          `waits in the graph`,
      })
    }
    return checked(
      call.entity.eid,
      'every letter that arrived carries a sender, and this server can send',
      found,
    )
  },
})
