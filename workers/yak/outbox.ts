// A letter leaving an app's store, as what it CONTRIBUTES (plugin.ts
// `effects`): the transport that store sends by, and the two registrations
// that carry a letter out when it asks to go — whichever of its components
// arrives last.
//
// It is a file of its own because it is where three things meet and none of
// them is above the others: the post room's address and binding (post.ts), the
// space's letter allowance (meter.ts), and @yaks/mail's own sending effect.
// graph.ts held the composition until T-34951, which meant the Store object
// knew how a letter travels; it now hands the slot what only it knows — its
// bindings, the app it holds, the address it writes from — and knows nothing
// about mail beyond the words its vocabulary already speaks.
import { DELIVER, MAIL, sending } from '@yaks/mail'
import { metering } from './meter.ts'
import type { Plugin } from './plugin.ts'
import { posting } from './post.ts'

export let outboxPlugin: Plugin = {
  name: 'outbox',
  effects: [(on, at) => {
    // Only an app's store carries a letter under its own name: the platform's
    // own store writes its sign-in codes through mail.ts from the fleet's
    // address, and has no app whose name a letter could leave under.
    if (at.meta || !at.app) return
    // No binding is a sender that REFUSES (post.ts), so a deploy without one
    // bounces a letter rather than swallowing it — and the send is metered
    // against the space's month on the way through (meter.ts), which is why
    // the address is read at send time and not here.
    let post = metering(at.env, at.mail, posting(at.env.MAIL, at.env))
    // `sending` reads the whole entity rather than the patch that woke it, so
    // a letter written whole and one that gains its recipient later go the
    // same way. It is idempotent — a letter already carrying `delivered` or
    // `bounced` is left alone — so two slots are still one send.
    on.created(MAIL, sending({ sender: post }))
    on.created(DELIVER, sending({ sender: post }))
  }],
}
