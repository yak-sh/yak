// What an agent may ASK for here: the `tools` facet a host takes
// (`@yaks/mail/tools`) — the runs behind the `tool: true` declarations in
// ./vocab.json. Five words a person types all day, and one CHECK.
//
// THE INBOX IS A QUERY, never a pile. A letter is addressed to somebody three
// ways — the entity it was routed to (`mail.target`, ./arrive.ts), the entity
// it was written to (`deliver.to`), and the address that entity wears
// (`mail.to`) — so the inbox is those three asked as one `or`, minus what has
// been archived. Nothing is moved, copied, or marked on the way in, which is
// why the same letter reads the same through every door.
//
// ARCHIVING IS THE ONE ACT THAT HIDES. Reading a letter marks it read and
// leaves it in the list; only `inbox archive` takes it out, and `--all` is the
// way back. That asymmetry is the point (M-7048): no sweep, subagent or second
// reader can drain somebody's inbox behind them, so a list that is empty is a
// list they emptied. The one thing that archives on its own is answering an
// arrival — a thread you have replied to is not waiting on you, and without
// that every fresh session re-presents the same letter and replies again.
//
// READING IS THE MARK, so `mail show` WRITES: it stamps `opened` on the letter
// it renders. That is what keeps it from being a second spelling of
// `graph_show` (@yaks/mcp's generic tier, which shows any entity at all) —
// this one marks the letter read and gathers its THREAD, both of which are
// facts about mail and about nothing else.
//
// `archived` and `opened` are a NEIGHBOUR's words — @yaks/kernel's, the marks
// that say somebody looked at a thing and somebody put it away. A tool answers
// BUNDLES, which are data, so naming one costs no import; a host that composes
// the kernel has them, and one that does not simply has those columns dropped
// at the door, its inbox then a list that never shrinks. Nothing here declares
// a second spelling of either (M-17871).
//
// The SENDER is not this facet's business. `mail send` and `mail reply` MINT a
// letter that asks to go (`deliver`), and ./effects.ts — built from the
// `sender` the config names beside this plugin — is what hands it to a
// transport and settles `delivered` or `bounced` back onto it. So a tool that
// writes mail never talks to a mail server, and a test fakes the whole of it
// with `{"via": "stash"}`.
//
// WHAT IS NOT CHECKED in `mail check`, deliberately: whether each address this
// graph can mint is deliverable at the MTA — the fleet's doctor read Cloudflare
// Email Routing's live rule set to say so. That is a question about a zone
// somebody deployed, answered by a credential the host holds, and its answer is
// the same whatever graph is running; a package's check reads the graph its own
// words describe. A deployment that wants it asks its provider, in its own
// deployment's check, and this package's `bounced{reason}` is what records the
// answer arriving the hard way.

import {
  addressed,
  type Bundle,
  type Comp,
  detached,
  type Eid,
  type ToolCtx,
} from '@yaks/graph'
import { BODY, DOC, TITLE } from '@yaks/doc'
import { human } from '@yaks/id'
import {
  absent,
  and,
  type Clause,
  eq,
  limit,
  list,
  or,
  present,
  type Query,
} from '@yaks/query'
import { checked, type Finding } from '@yaks/tools'
import type { Runs } from '@yaks/graph/tools'
import { wearer } from './arrive.ts'
import { post } from './effects.ts'
import { DELIVER, EMAIL, MAIL } from './comp.ts'
import type { Options } from './options.ts'

/** How many letters an inbox answers with, unasked. */
export let PAGE = 50

// The two words this facet WRITES that it does not own. Both are
// @yaks/kernel's, and both are said here as the strings they are, because a
// tool's answer is data (see the header).
let ARCHIVED = 'archived'
let OPENED = 'opened'

let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let col = (c: Comp | undefined, k: string): string => str(c?.[k])

// One entity whole, by eid. Everything here works from the letter as it
// STANDS rather than from a patch, the way ./send.ts does.
let one = async (ctx: ToolCtx, eid: Eid): Promise<Bundle | undefined> =>
  (await detached(ctx.graph.storage).get([eid]))[0]

// The eid an argument names, whatever a person typed.
let at = async (ctx: ToolCtx, said: unknown): Promise<Eid> =>
  (await addressed(ctx.graph, [str(said)]))[0]

// The letter an argument names, refused by the one thing that makes it one.
let letterIn = async (ctx: ToolCtx, said: unknown): Promise<Bundle> => {
  let found = await one(ctx, await at(ctx, said))
  if (!comp(found, MAIL)) throw new Error(`not a letter: ${str(said)}`)
  return found!
}

/** Whose inbox this is: the entity the line named, else whoever is asking. */
export let reader = async (ctx: ToolCtx): Promise<Eid> => {
  if (ctx.args.who != null) return await at(ctx, ctx.args.who)
  let me = ctx.actor?.by
  if (!me) throw new Error('nobody is asking — say --who')
  return me
}

/**
 * Everything addressed to one reader: routed to them, written to them, or
 * delivered to the address they wear. Three spellings of one question, asked
 * as one — a letter that answers any of them is in their inbox.
 */
export let addressedTo = (who: Eid, address: string): Clause =>
  or(
    eq(`${MAIL}.target`, who),
    eq(`${DELIVER}.to`, who),
    ...(address ? [eq(`${MAIL}.to`, address)] : []),
  )

// Newest first, said by the WINDOW rather than by a clock column: `mail.at` is
// written when a letter ARRIVES, so ordering by it would sort a letter written
// to you here — an invitation, a reply from the desk beside you — to the
// bottom. A limited answer is newest-first by the order rows were written
// (@yaks/sql bind.ts), which is the order they reached this graph.
let inbox = (who: Eid, address: string, all: boolean, n: number): Query =>
  and(
    present(MAIL),
    addressedTo(who, address),
    ...(all ? [] : [absent(ARCHIVED)]),
    limit(n),
  )

/** `Re:` derivation — shed however many `Re:`/`Fwd:` layers already piled up,
 * so a long thread does not grow a subject line. */
export let reSubject = (said: string): string =>
  `Re: ${said.replace(/^(\s*(re|fwd?):\s*)+/i, '').trim()}`

// The far side's address as an ENTITY, since `deliver.to` names a recipient
// rather than a string: whoever already wears it, else a fresh `email` row for
// it. That is what makes the address book grow by use instead of by
// bookkeeping — and why writing to a stranger needs no step before it. NO
// address is nobody, never a blank row: an `email` entity wearing no address
// is a recipient a letter can be aimed at and never reach.
let recipientOf = async (
  ctx: ToolCtx,
  address: string,
  domain?: string,
): Promise<{ to: Eid; made: Bundle[] }> => {
  if (!address) return { to: '', made: [] }
  let known = await wearer(ctx.graph, address, domain)
  return known
    ? { to: known, made: [] }
    : { to: '$to', made: [{ entity: { eid: '$to' }, [EMAIL]: { address } }] }
}

// Whom a line means: an address is an address, anything else is an id.
let aimedAt = async (
  ctx: ToolCtx,
  said: string,
  domain?: string,
): Promise<{ to: Eid; made: Bundle[] }> =>
  said.includes('@')
    ? await recipientOf(ctx, said, domain)
    : { to: await at(ctx, said), made: [] }

/**
 * A letter's THREAD: up its one-parent `reply_to` chain, then down over
 * whatever answers anything already found. Each read is keyed by the letters
 * in hand, so a thread costs its own rows rather than every letter ever sent.
 */
export let threadOf = async (
  ctx: ToolCtx,
  letter: Bundle,
): Promise<Bundle[]> => {
  let found = [letter]
  let seen = new Set([letter.entity.eid])
  for (let up = col(comp(letter, MAIL), 'reply_to'); up && !seen.has(up);) {
    let b = await one(ctx, up)
    if (!b) break
    seen.add(up)
    found.push(b)
    up = col(comp(b, MAIL), 'reply_to')
  }
  for (let front = [...seen]; front.length;) {
    let down = (await ctx.read(and(eq(`${MAIL}.reply_to`, list(...front)))))
      .filter((b) => !seen.has(b.entity.eid))
    for (let b of down) seen.add(b.entity.eid), found.push(b)
    front = down.map((b) => b.entity.eid)
  }
  // Chronological where the letters say when, insertion order where they do
  // not — a sort that is stable either way rather than one that invents a time.
  return found.sort((a, b) =>
    col(comp(a, MAIL), 'at').localeCompare(col(comp(b, MAIL), 'at'))
  )
}

// One letter as a line: who it is from, what it is about, and whether it has
// been read — `●` unread, `·` read, `×` archived, the way a mail client does.
let line = (id: (b: Bundle) => string) => (b: Bundle): string => {
  let mail = comp(b, MAIL)
  let dot = b[ARCHIVED] ? '×' : b[OPENED] ? '·' : '●'
  let who = col(mail, 'from')
  return `${dot} ${id(b)}${who ? ` ${who}` : ''} — ${
    col(comp(b, DOC), TITLE) || '(no subject)'
  }`
}

// One letter whole: the envelope a person reads, then the words, then the rest
// of the thread with this one marked.
let page = (id: (b: Bundle) => string, letter: Bundle, thread: Bundle[]) => {
  let mail = comp(letter, MAIL)
  let doc = comp(letter, DOC)
  let said = [
    `# ${col(doc, TITLE) || '(no subject)'}`,
    [
      col(mail, 'from') && `from ${col(mail, 'from')}`,
      col(mail, 'to') && `to ${col(mail, 'to')}`,
      col(mail, 'at'),
      mail?.verified === false && 'UNSIGNED',
    ].filter(Boolean).join(' · '),
    '',
    col(doc, BODY),
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

/** The runs behind the tools ./vocab.json declares. A factory, as every facet
 * is: the domain is what an address a person typed is canonicalized against
 * before the address book is asked, the same spelling the canonicalizer wrote
 * it in (./plugin.ts). Everything else a run needs arrives on the call's own
 * context. */
export let runs = (_host?: unknown, options: Options = {}): Runs => ({
  inbox_list: async (_bundles, ctx): Promise<Bundle[]> => {
    let who = await reader(ctx)
    let address = col(comp(await one(ctx, who), EMAIL), 'address')
    let n = ctx.args.limit == null ? PAGE : Number(ctx.args.limit)
    return await ctx.read(inbox(who, address, !!ctx.args.all, n))
  },

  inbox_archive: async (_bundles, ctx): Promise<Bundle[]> => [{
    entity: { eid: await at(ctx, ctx.args.item) },
    [ARCHIVED]: {},
  }],

  // Reading IS the mark, so this writes. The prose is the answer; the `opened`
  // patch is what makes asking twice honest.
  mail_show: async (_bundles, ctx): Promise<Bundle[]> => {
    let letter = await letterIn(ctx, ctx.args.letter)
    let thread = await threadOf(ctx, letter)
    return [
      { entity: { eid: letter.entity.eid }, [OPENED]: {} },
      {
        entity: { eid: '$said' },
        content: { body: page(human(ctx.graph.vocab), letter, thread) },
        output: { source: ctx.call },
      },
    ]
  },

  // The reply goes to the FAR side — an arrival's author, our own sent
  // letter's recipient — and never to a fallback between the two: the near
  // miss is this graph's own desk, so a reply that quietly went there would
  // look sent and not be.
  mail_reply: async (_bundles, ctx): Promise<Bundle[]> => {
    let letter = await letterIn(ctx, ctx.args.letter)
    let mail = comp(letter, MAIL)!
    let arrived = !!col(mail, 'message_id')
    let far = arrived
      ? await recipientOf(ctx, col(mail, 'from'), options.domain)
      : { to: col(comp(letter, DELIVER), 'to'), made: [] as Bundle[] }
    if (!far.to) {
      throw new Error(
        'cannot reply: that letter names nobody to answer — send a fresh mail',
      )
    }
    // The desk it goes from: the address an arrival was delivered to, or the
    // one our own letter went out from. Either way, this side of the thread.
    let from = arrived ? col(mail, 'to') : col(mail, 'from')
    return [
      ...far.made,
      {
        entity: { eid: '$reply' },
        [DOC]: {
          [TITLE]: reSubject(col(comp(letter, DOC), TITLE)),
          [BODY]: str(ctx.args.body),
        },
        // No `target`: on an arrival that column holds whom the letter was
        // ROUTED to (./arrive.ts), which is this side of the thread — carrying
        // it forward would file our own answer in our own inbox. `reply_to` is
        // what threads a reply, and it is enough.
        [MAIL]: { ...(from ? { from } : {}), reply_to: letter.entity.eid },
        [DELIVER]: { to: far.to },
      },
      // Answering an arrival retires it: a thread you have replied to is not
      // one waiting on you. Only an arrival — following up on your own letter
      // never rang the inbox to begin with, so there is nothing to hide.
      ...(arrived && !letter[ARCHIVED]
        ? [{ entity: { eid: letter.entity.eid }, [ARCHIVED]: {} }]
        : []),
    ]
  },

  mail_send: async (_bundles, ctx): Promise<Bundle[]> => {
    let far = await aimedAt(ctx, str(ctx.args.to), options.domain)
    if (!far.to) throw new Error('a letter needs somebody to go to — say --to')
    let from = ctx.args.from != null
      ? str(ctx.args.from)
      : col(comp(await one(ctx, str(ctx.actor?.by)), EMAIL), 'address')
    if (!from) {
      throw new Error(
        'a letter needs a from address — say --from, or give whoever is ' +
          'asking an `email.address`',
      )
    }
    let target = ctx.args.about == null ? '' : await at(ctx, ctx.args.about)
    return [
      ...far.made,
      {
        entity: { eid: '$letter' },
        [DOC]: {
          [TITLE]: str(ctx.args.subject),
          [BODY]: str(ctx.args.body),
        },
        [MAIL]: { from, ...(target ? { target } : {}) },
        [DELIVER]: { to: far.to },
      },
    ]
  },

  mail_check: async (_bundles, ctx) => {
    // The Message-ID is what the world knows a letter by, written from what
    // arrived — so it is the mark of a letter this graph RECEIVED, and the
    // pair of predicates is the whole question.
    let orphans = await ctx.read(
      and(present(`${MAIL}.message_id`), absent(`${MAIL}.from`)),
    )
    let id = human(ctx.graph.vocab)
    let found = orphans.map((b): Finding => ({
      level: 'fail',
      text: `${id(b)} arrived with no sender — a reply has nowhere to go`,
    }))
    // And the other direction: a transport this host could not build is a
    // graph whose outbound letters sit there. Missing config never stops the
    // boot (./effects.ts), so this is where it is said.
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
      ctx.call,
      'every letter that arrived carries a sender, and this host can send',
      found,
    )
  },
})
