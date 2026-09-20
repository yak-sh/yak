// What an agent may ASK for here: the `tools` facet a host takes
// (`@yaks/mail/tools`) — the run behind the `mail_check` declaration in
// ./vocab.json. One tool, and it is a CHECK: a tool whose verb is `check`,
// which is the whole of what a "doctor" is now (@yaks/tools ./check.ts). A
// host that composes this plugin gets this invariant watched; one that does
// not, does not.
//
// The invariant: a letter that ARRIVED carries a sender. Outbound mail needs
// no watching — ./send.ts refuses a letter with no `from` at the moment it
// would leave, and the bounce says so on the letter itself. An arrival is the
// other direction, where nothing refuses anything: the letter is already here,
// and a missing `from` means a reply has nowhere to go and a thread that can
// never be answered. That is exactly the silent kind of break a check exists
// for, so it is a `fail`.
//
// WHAT IS NOT CHECKED HERE, deliberately: whether each address this graph can
// mint is deliverable at the MTA — the fleet's doctor read Cloudflare Email
// Routing's live rule set to say so. That is a question about a zone somebody
// deployed, answered by a credential the host holds, and its answer is the
// same whatever graph is running; a package's check reads the graph its own
// words describe. A deployment that wants it asks its provider, in its own
// deployment's check, and this package's `bounced{reason}` is what records the
// answer arriving the hard way.

import { absent, and, present } from '@yaks/query'
import { human } from '@yaks/id'
import { checked, type Finding } from '@yaks/tools'
import type { Runs } from '@yaks/graph/tools'
import { MAIL } from './comp.ts'

/** The runs behind the tools ./vocab.json declares. A factory, as every facet
 * is, though this one needs nothing from the host: what it reads arrives on
 * the call's own context. */
export let runs = (): Runs => ({
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
    return checked(
      ctx.call,
      'every letter that arrived carries a sender',
      found,
    )
  },
})
