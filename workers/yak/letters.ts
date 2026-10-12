// An app's letters, as two tools at the agent door (T-34149): `mail_list` and
// `mail_send`.
//
// They exist for the scoping sentence. A letter is `doc` + `mail` + `deliver`
// and nothing else, so `graph_apply` could always send one and `.mail` read
// one back — these add no power. What the generic tier cannot say is which
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
// The published `mail_send` translates its title argument to the package's
// subject and calls the app store's declared tool. The store owns the write,
// including the sender stamp, member guard, relay rule and month's ceiling.
import { z } from 'zod'
import type { Bundle, Tool } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { mailbox } from './directory.ts'
import { read } from './reach.ts'
import { apex, type Host } from './host.ts'
import { invokePackage } from './package-tools.ts'
import { type Ctx, inApp } from './tools.ts'
import { refuse } from './tool.ts'

/**
 * The one sentence both tools carry, because the tool list is where a model
 * decides which mailbox somebody meant.
 */
export let scope = (env: Host = {}) =>
  'These are the emails an app received at its yaks.app address ' +
  `(<space>.<app>@${
    apex(env)
  }), not a person's own mailbox: a question about mail ` +
  'with no app named is about their own mail account, which whatever mail ' +
  'tool they have connected answers.'

export let SCOPE = scope()

// The components a letter is made of, asked for by name: a row carries only
// what its filter names (listing.ts), and what a reader wants off a letter is
// the words, the envelope, who it was for, and what became of it.
let LETTER = '.mail&?doc&?deliver&?delivered&?bounced'

// Which side of the mailbox, given the app's own address.
//
// Sent is the ask to send, which is what makes a letter outbound (@yaks/mail
// `sending`). Received is neither that nor written here: the `from` on a
// letter of the app's own is stamped with its address whether or not it ever
// asked to go (graph.ts `#posting`), so a letter from anywhere else is one
// that arrived — and a draft, which is both kept and unsent, is in
// neither side.
let side = (said: string, mine: string): string | null =>
  said == 'all'
    ? ''
    : said == 'sent'
    ? '&.deliver'
    : said == 'received'
    ? `&!deliver.to&.mail.from!=${mine}`
    : null

let str = (v: unknown, what: string): string => {
  if (typeof v != 'string' || !v.trim()) {
    throw refuse('arguments', `${what} is required`)
  }
  return v.trim()
}

let num = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined

// Newest first, by the moment the row was written: an arrival is stamped when
// it arrived and a letter of the app's own when it was written, so one key
// orders both directions without either pretending to know the other's clock.
// The store sorts it, because the store is where the window is cut — sorting
// the page after it came back would only order whichever letters the limit
// happened to leave.
let NEWEST = '&.order=-created.at'

let address = (env: Host) =>
  `the app slug; its email address is <space>.<app>@${apex(env)}`

let SPACE = 'the space slug in <space>.yaks.app; omit to infer it from the ' +
  'app slug, or fall back to the only space the person owns. If more than ' +
  'one matches, the error asks you to choose'

let listing = (ctx: Ctx): Tool => ({
  name: 'mail_list',
  readOnly: true,
  title: "List an app's email",
  description:
    `List an app's email records as bundles: JSON objects with entity ids, ` +
    `message text, mail headers and delivery fields when present. Sent mail ` +
    `may later carry delivered{at} or bounced{at, reason}; an absent ` +
    `outcome is not confirmation of delivery. ${scope(ctx.env)} ` +
    `direction selects received, sent, or all (the default, including ` +
    `drafts). Returns up to limit records (20 by default), with the returned ` +
    `records sorted newest first. Documentation: https://yaks.app/docs/mail.`,
  input: {
    app: z.string().describe(address(ctx.env)),
    space: z.string().optional().describe(SPACE),
    direction: z.enum(['received', 'sent', 'all']).optional().describe(
      'which side of the mailbox (default: all)',
    ),
    limit: z.number().optional().describe('at most this many (default: 20)'),
  },
  run: async (call) => {
    let args = argsOf(call)
    let { space, app, who } = await inApp(ctx, args)
    let said = args.direction == null ? 'all' : String(args.direction)
    let which = side(said, mailbox(space, app, ctx.env))
    if (which == null) {
      throw refuse('arguments', 'direction: received, sent or all')
    }
    let rows = await read(
      ctx.env,
      [{ space, app, who }],
      `${LETTER}${which}${NEWEST}&.limit=${num(args.limit) ?? 20}`,
    )
    return Array.isArray(rows) ? rows as Bundle[] : []
  },
})

let sending = (ctx: Ctx): Tool => ({
  name: 'mail_send',
  applied: true,
  title: "Send email from an app's address",
  // An email to a stranger's inbox: it leaves the platform, and no second
  // call takes it back.
  destructive: true,
  openWorld: true,
  description:
    `Send one email from an app's own address to one recipient: an email ` +
    `address, or the unique id (eid) of a record in the app that has an ` +
    `email{address} field. Later emails to that person link to the same ` +
    `record. Creates the recipient record if needed, then the email record, ` +
    `and returns the email as written: a JSON object with its id and named ` +
    `groups of fields (components). Delivery is recorded on that email a ` +
    `moment later as delivered or bounced, so read it back with mail_list. ` +
    `The body is markdown. ${scope(ctx.env)} Sending ` +
    `requires a member who may write, even in an app anyone can write to. ` +
    `Cannot be undone: an email that has been sent cannot be recalled, ` +
    `which makes this one of the very few things here where a mistake is ` +
    `final. Documentation: https://yaks.app/docs/mail.`,
  input: {
    app: z.string().describe(address(ctx.env)),
    space: z.string().optional().describe(SPACE),
    to: z.string().describe(
      'the recipient: an email address, or the unique id (eid) of a record ' +
        'in the app with an email{address} field',
    ),
    title: z.string().describe('the subject line'),
    body: z.string().describe('the body, as markdown'),
  },
  run: async (call) => {
    let args = argsOf(call)
    // TODO: delete this title-to-subject translation in the listing release
    // that drops the former mail_send contract.
    let { title, ...input } = args
    let answer = await invokePackage(ctx, 'mail_send', {
      ...input,
      to: str(args.to, 'to'),
      subject: str(title, 'title'),
      body: str(args.body, 'body'),
    })
    let letter = answer.find((b) => b.mail)
    if (!letter) throw new Error('the letter was not written')
    return [letter]
  },
})

/**
 * The two mail tools, bound to this caller. They ride the platform plugin
 * (agent.ts) beside the app_* family, since a mailbox is a fact about an app,
 * and they answer bundles where the rest of that family answers words.
 */
export let letters = (ctx: Ctx): Tool[] => [listing(ctx), sending(ctx)]
