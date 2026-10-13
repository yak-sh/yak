// An app's letters, read at the agent door (T-34149): `mail_list`. Sending
// is @yaks/mail's own `mail_send`, which the connector lists beside its other
// store tools (package-tools.ts).
//
// It exists for the scoping sentence. A letter is `doc` + `mail` + `deliver`
// and nothing else, so `.mail` through `graph_query` could always read one
// back — this adds no power. What the generic tier cannot say is which
// mailbox is meant: an agent holding a mail connector beside this one hears
// "check my email" as the person's own account, and a bundle wire has nowhere
// to tell it that `<space>.<app>@yaks.app` is a different thing. A tool's name
// and its description are what a model reads before it chooses, so the
// sentence lives there ({@link SCOPE}), and again in the door's instructions
// (mcp.ts).
//
// The answer is the generic tier's shape: whole bundles, under an output
// schema derived from the vocabulary the caller's apps declare (@yaks/mcp
// `bundleSchema`), so a letter reads back the way every other row does.
import { z } from 'zod'
import type { Bundle, Tool } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { mailbox } from './directory.ts'
import { read } from './reach.ts'
import { apex, type Host } from './host.ts'
import { type Ctx, inApp } from './tools.ts'
import { refuse } from './tool.ts'

/**
 * The sentence mail_list carries, because the tool list is where a model
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

/**
 * The mail tool, bound to this caller. It rides beside the platform plugin
 * (agent.ts) and the app_* family, since a mailbox is a fact about an app,
 * and it answers bundles where the rest of that family answers words.
 */
export let letters = (ctx: Ctx): Tool[] => [listing(ctx)]
