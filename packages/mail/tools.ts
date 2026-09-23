// What an agent may ask for here: the `@yaks/mail/tools` entry point — the
// implementations behind the `tool: true` declarations in ./vocab.json. Five
// commands a person runs all day, and one check.
//
// The inbox is A query, never a folder. A letter is addressed to somebody
// three ways — the entity it was routed to (`mail.target`, ./arrive.ts), the
// entity it was written to (`deliver.to`), and the address that entity has
// (`mail.to`) — so the inbox is those three asked as one `or`, minus what has
// been archived. Nothing is moved, copied, or marked on the way in, which is
// why the same letter reads the same through every interface.
//
// Archiving is the one act that hides. Reading a letter marks it read and
// leaves it in the list; only `inbox archive` takes it out, and `--all` shows
// the hidden ones again. That asymmetry is the point (M-7048): no sweep,
// subagent or second reader can drain somebody's inbox behind them, so a list
// that is empty is a list they emptied. The one thing that archives on its own
// is answering an arrival — a thread you have replied to is not waiting on
// you, and without that every fresh session shows the same letter again and
// replies again.
//
// Reading is the mark, so `mail show` writes: it stamps `opened` on the letter
// it renders. That is what keeps it from being a duplicate of `graph_show`
// (@yaks/mcp's generic tier, which shows any entity at all) — this one marks
// the letter read and gathers its thread, both of which are facts about mail
// and about nothing else.
//
// `archived` and `opened` are another package's components — @yaks/kernel's,
// the marks recording that somebody looked at a thing and that somebody put it
// away. A tool returns bundles, which are plain data, so naming a component
// costs no import; a server that composes the kernel stores them, and one that
// does not has those components dropped on write, leaving an inbox that never
// shrinks. Nothing here declares a second copy of either (M-17871).
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

/** How many letters an inbox returns when the caller gave no limit. */
export let PAGE = 50

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
let one = async (ctx: ToolCtx, eid: Eid): Promise<Bundle | undefined> =>
  (await detached(ctx.graph.storage).get([eid]))[0]

// The eid an argument names, whatever form a person typed it in.
let at = async (ctx: ToolCtx, said: unknown): Promise<Eid> =>
  (await addressed(ctx.graph, [str(said)]))[0]

// The letter an argument names, rejected unless it carries `mail`.
let letterIn = async (ctx: ToolCtx, said: unknown): Promise<Bundle> => {
  let found = await one(ctx, await at(ctx, said))
  if (!comp(found, MAIL)) throw new Error(`not a letter: ${str(said)}`)
  return found!
}

/** Whose inbox this is: the entity the arguments named, else whoever is
 * asking. */
export let reader = async (ctx: ToolCtx): Promise<Eid> => {
  if (ctx.args.who != null) return await at(ctx, ctx.args.who)
  let me = ctx.actor?.by
  if (!me) throw new Error('nobody is asking — say --who')
  return me
}

/**
 * Everything addressed to one reader: routed to them, written to them, or
 * delivered to the address they have. Three forms of one question, asked as
 * one — a letter matching any of them is in their inbox.
 */
export let addressedTo = (who: Eid, address: string): Clause =>
  or(
    eq(`${MAIL}.target`, who),
    eq(`${DELIVER}.to`, who),
    ...(address ? [eq(`${MAIL}.to`, address)] : []),
  )

// Newest first, from the limit rather than from a clock property: `mail.at` is
// written when a letter arrives, so ordering by it would sort a letter written
// to you here — an invitation, a reply from the address beside you — to the
// bottom. A limited result is newest-first by the order rows were written
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

// The far side's address as an entity, since `deliver.to` names a recipient
// rather than a string: whoever already has that address, else a new `email`
// row for it. That is what makes the address book grow by use instead of by
// bookkeeping — and why writing to a stranger needs no step before it. An
// empty address resolves to nobody, never to a blank row: an `email` entity
// with no address is a recipient a letter can be aimed at and never reach.
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

// Whom an argument means: a string with an `@` is an address, anything else is
// an id.
let aimedAt = async (
  ctx: ToolCtx,
  said: string,
  domain?: string,
): Promise<{ to: Eid; made: Bundle[] }> =>
  said.includes('@')
    ? await recipientOf(ctx, said, domain)
    : { to: await at(ctx, said), made: [] }

/**
 * A letter's thread: up its one-parent `reply_to` chain, then down over
 * whatever answers anything already found. Each read is keyed by the letters
 * in hand, so a thread costs its own rows rather than every letter ever sent.
 */
export let threadOf = async (
  ctx: ToolCtx,
  letter: Bundle,
): Promise<Bundle[]> => {
  let found = [letter]
  let seen = new Set([letter.entity.eid])
  for (let up = prop(comp(letter, MAIL), 'reply_to'); up && !seen.has(up);) {
    let b = await one(ctx, up)
    if (!b) break
    seen.add(up)
    found.push(b)
    up = prop(comp(b, MAIL), 'reply_to')
  }
  for (let front = [...seen]; front.length;) {
    let down = (await ctx.read(and(eq(`${MAIL}.reply_to`, list(...front)))))
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
 * else a handler needs arrives on the call's own context. */
export let runs = (_host?: unknown, options: Options = {}): Runs => ({
  inbox_list: async (_bundles, ctx): Promise<Bundle[]> => {
    let who = await reader(ctx)
    let address = prop(comp(await one(ctx, who), EMAIL), 'address')
    let n = ctx.args.limit == null ? PAGE : Number(ctx.args.limit)
    return await ctx.read(inbox(who, address, !!ctx.args.all, n))
  },

  inbox_archive: async (_bundles, ctx): Promise<Bundle[]> => [{
    entity: { eid: await at(ctx, ctx.args.item) },
    [ARCHIVED]: {},
  }],

  // Reading is the mark, so this writes. The prose is the result; the `opened`
  // patch is what keeps a second call from reporting it as unread.
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

  // The reply goes to the far side — an arrival's author, or our own sent
  // letter's recipient — and never to a fallback between the two: the wrong
  // choice here is this graph's own address, so a reply that quietly went
  // there would look sent without being sent.
  mail_reply: async (_bundles, ctx): Promise<Bundle[]> => {
    let letter = await letterIn(ctx, ctx.args.letter)
    let mail = comp(letter, MAIL)!
    let arrived = !!prop(mail, 'message_id')
    let far = arrived
      ? await recipientOf(ctx, prop(mail, 'from'), options.domain)
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
          [BODY]: str(ctx.args.body),
        },
        // No `target`: on an arrival that property holds whom the letter was
        // routed to (./arrive.ts), which is this side of the thread — carrying
        // it forward would file our own answer in our own inbox. `reply_to` is
        // what threads a reply, and it is enough.
        [MAIL]: { ...(from ? { from } : {}), reply_to: letter.entity.eid },
        [DELIVER]: { to: far.to },
      },
      // Answering an arrival archives it: a thread you have replied to is not
      // one waiting on you. Only an arrival — following up on your own letter
      // never put anything in the inbox, so there is nothing to hide.
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
      : prop(comp(await one(ctx, str(ctx.actor?.by)), EMAIL), 'address')
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
    // The Message-ID is what other mail systems know a letter by, written from
    // what arrived — so it marks a letter this graph received, and this pair
    // of predicates is the whole question.
    let orphans = await ctx.read(
      and(present(`${MAIL}.message_id`), absent(`${MAIL}.from`)),
    )
    let id = human(ctx.graph.vocab)
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
      ctx.call,
      'every letter that arrived carries a sender, and this server can send',
      found,
    )
  },
})
