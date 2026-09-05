// An app's letters, as two tools at the agent door (T-34149): `mail_list` and
// `mail_send`.
//
// THEY EXIST FOR THE SCOPING SENTENCE. A letter is `doc` + `mail` + `deliver`
// and nothing else, so `graph_apply` could always send one and `.mail!` read
// one back — these add no power. What the generic tier cannot say is WHICH
// mailbox is meant: an agent holding a mail connector beside this one hears
// "check my email" as the person's own account, and a bundle wire has nowhere
// to tell it that `<space>.<app>@yaks.app` is a different thing. A tool's name
// and its description are what a model reads before it chooses, so the
// sentence lives there ({@link SCOPE}), said by both, and again in the door's
// instructions (mcp.ts).
//
// The answer is the generic tier's shape: whole bundles, under an output
// schema derived from the vocabulary the caller's apps declare (@yaks/mcp
// `bundleSchema`), so a letter reads back the way every other row does.
//
// And the write is the generic tier's write. `mail_send` composes the same
// bundles a person would type and hands them to `written()` — the door
// `graph_apply` uses — so the platform's `from` stamp, the member guard, the
// open-relay rule and the month's ceiling all hold here without this file
// knowing any of them exist (graph.ts `#posting`, meter.ts).
import { z } from 'zod'
import type { Bundle, Tool } from '@yaks/graph'
import { bundleSchema, outputSchema } from '@yaks/mcp'
import { canon, parts } from '@yaks/mail'
import type { Vocab } from '@yaks/vocab'
import { mailbox } from './directory.ts'
import { type Reach, read, written } from './reach.ts'
import { PLATFORM } from './route.ts'
import { titling } from './session.ts'
import { type Ctx, inApp } from './tools.ts'

/**
 * The one sentence both tools carry, because the tool list is where a model
 * decides which mailbox somebody meant.
 */
export let SCOPE =
  'These are the letters an app received at its yaks.app address ' +
  "(<space>.<app>@yaks.app); not a person's own mailbox — mail asked about " +
  'with no app named is their own mail account, which whatever mail tool ' +
  'they have connected answers.'

// The components a letter is made of, asked for by name: a row carries only
// what its filter NAMES (listing.ts), and what a reader wants off a letter is
// the words, the envelope, who it was for, and what became of it.
let LETTER = '.mail!&.doc?&.deliver?&.delivered?&.bounced?'

// Which side of the mailbox, given the app's own address.
//
// SENT is the ask to send, which is what makes a letter outbound (@yaks/mail
// `sending`). RECEIVED is neither that nor written here: the `from` on a
// letter of the app's own is stamped with its address whether or not it ever
// asked to go (graph.ts `#posting`), so a letter from anywhere else is one
// that arrived — and a draft, which is both kept and unsent, is honestly in
// neither side.
let side = (said: string, mine: string): string | null =>
  said == 'all'
    ? ''
    : said == 'sent'
    ? '&.deliver!'
    : said == 'received'
    ? `&.deliver.to=&.mail.from!=${mine}`
    : null

let str = (v: unknown, what: string): string => {
  if (typeof v != 'string' || !v.trim()) throw new Error(`${what} is required`)
  return v.trim()
}

let num = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined

// Newest first, by the number the store minted: an arrival is numbered when it
// arrived and a letter of the app's own when it was written, so one key orders
// both directions without either pretending to know the other's clock.
let newest = (a: Bundle, b: Bundle) =>
  (b.entity?.num ?? 0) - (a.entity?.num ?? 0)

let APP = 'the app slug — its mailbox is <space>.<app>@yaks.app'

let SPACE = "the space the app is in; leave it out and the person's own is " +
  'used, as everywhere else'

// The recipient an address already names in this app, if any. A letter is
// addressed to an ENTITY here, so writing a second row for a person the app
// already has would scatter their correspondence across two of them.
let known = async (
  ctx: Ctx,
  mine: Reach,
  address: string,
): Promise<string | null> => {
  let rows = await read(
    ctx.env,
    [mine],
    `.email.address=${address}&.limit=1`,
  )
  let [one] = Array.isArray(rows) ? rows as Bundle[] : []
  return one?.entity?.eid ?? null
}

let listing = (ctx: Ctx, vocab: Vocab): Tool => ({
  name: 'mail_list',
  readOnly: true,
  title: "An app's letters",
  description:
    `Every letter an app received at its own address, and every one it sent ` +
    `from it, newest first, as whole bundles carrying what became of each — ` +
    `delivered{at, via} or bounced{at, reason}. ${SCOPE} direction takes one ` +
    `side: received, sent, or all (the default).`,
  input: {
    app: z.string().describe(APP),
    space: z.string().optional().describe(SPACE),
    direction: z.enum(['received', 'sent', 'all']).optional().describe(
      'which side of the mailbox (default: all)',
    ),
    limit: z.number().optional().describe('at most this many (default: 20)'),
  },
  output: outputSchema(z.array(bundleSchema(vocab))),
  run: async (args) => {
    let { space, app, who } = await inApp(ctx, args)
    let said = args.direction == null ? 'all' : String(args.direction)
    let which = side(said, mailbox(space, app))
    if (which == null) throw new Error('direction: received, sent or all')
    let rows = await read(
      ctx.env,
      [{ space, app, who }],
      `${LETTER}${which}&.limit=${num(args.limit) ?? 20}`,
    )
    return (Array.isArray(rows) ? rows as Bundle[] : []).sort(newest)
  },
})

let sending = (ctx: Ctx, vocab: Vocab): Tool => ({
  name: 'mail_send',
  title: "Send from an app's address",
  // A letter to a stranger's inbox: it leaves the platform, and no second
  // call takes it back.
  destructive: true,
  openWorld: true,
  description:
    `Send one letter from an app's own address to one recipient — an email ` +
    `address, or the eid of an entity in the app already wearing ` +
    `email{address}, which is what later letters to the same person hang ` +
    `off. It writes the recipient where the app has not got them yet, then ` +
    `the letter beside them, and answers the letter as applied; whether it ` +
    `left lands on that same entity a moment later as delivered or bounced, ` +
    `so read it back with mail_list. The body is markdown. ${SCOPE} Asking ` +
    `to send takes a member who may write, even in an app anyone can write ` +
    `to.`,
  input: {
    app: z.string().describe(APP),
    space: z.string().optional().describe(SPACE),
    to: z.string().describe(
      'the recipient: an email address, or the eid of an entity in the app ' +
        'that wears email{address}',
    ),
    title: z.string().describe('the subject line'),
    body: z.string().describe('the words, as markdown'),
  },
  output: outputSchema(bundleSchema(vocab, { nulls: true })),
  run: async (args) => {
    let { space, app, who } = await inApp(ctx, args, true)
    let mine: Reach = { space, app, who }
    let to = str(args.to, 'to')
    let title = str(args.title, 'title')
    let body = str(args.body, 'body')
    // An address or an eid, told apart by the one `@` an address has. An
    // address is canonicalized the way the store's own normalize hook would
    // (@yaks/mail `mailbox`), so the lookup asks in the spelling the row was
    // written in.
    let address = parts(to) ? canon(PLATFORM)(to) : null
    let held = address ? await known(ctx, mine, address) : to
    let batch: Bundle[] = [
      ...(held ? [] : [{
        entity: { eid: '$to' },
        email: { address },
      } as Bundle]),
      {
        entity: { eid: '$letter' },
        doc: { title, body },
        // Empty on purpose: the `from` is the platform's word, stamped over
        // whatever a batch says (graph.ts `#posting`).
        mail: {},
        deliver: { to: held ?? '$to' },
      } as Bundle,
    ]
    let out = await written(
      ctx.env,
      [mine],
      mine,
      batch,
      await titling(ctx.dir, ctx.person),
    )
    let eid = out.aliases['$letter']
    let letter = out.bundles.find((b) => b.entity?.eid == eid)
    if (!letter) throw new Error('the letter was not written')
    return letter
  },
})

/**
 * The two mail tools, bound to this caller and described in the vocabulary
 * their apps declare. They ride the platform plugin (agent.ts) beside the
 * app_* family, since a mailbox is a fact about an app.
 */
export let letters = (ctx: Ctx, vocab: Vocab): Tool[] => [
  listing(ctx, vocab),
  sending(ctx, vocab),
]
