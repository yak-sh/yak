// An app's post room: the address it writes from, the (space, app) an address
// names, and the sender a letter leaves through, which a provider config.ts
// names lends (lent.ts).
//
// The address is A local part at the apex, and that is not a style choice.
// Cloudflare onboards mail per domain, thirty to a zone, and a wildcard MX is
// refused at RCPT — a probe to `probe@cf-bounce.yaks.app`, which has the
// Cloudflare MX, came back `550 5.1.1 Domain does not exist` (C-33769 on
// T-33684). So `<app>@<space>.yaks.app` is undeliverable in both directions
// for every space but the handful anyone could onboard by hand, and the one
// shape the zone carries for every space there will ever be is a local part at
// `yaks.app`. Jeff, 2026-09-05: "yeah, let's do space.app@yaks.app.
// space@yaks.app should also work (home app)".
//
// The two directions are one derivation read each way, in one file, because an
// app that writes from an address nobody can write back to is worse than an
// app with no address at all: this is what holds the outbound `from` (the
// sending effect, graph.ts) and the inbound route (`email()`, index.ts) to the
// same sentence. A slug carries no dot (route.ts `SLUG`), so the single dot in
// a local part is unambiguously the seam between the space and the app.
import { toBase64url } from '@yaks/fp'
import { parts, post, type Sender, Unsent } from '@yaks/mail'
import type { Built } from '@yaks/host/senders'
import { SLUG } from './route.ts'
import { apex, type Host } from './host.ts'
import type { Env } from './env.ts'
import { type Post, posts } from './config.ts'
import { lent } from './lent.ts'

// Apply at the transport so app effects and platform letters obey one rule.
export let sink = <T extends string | string[]>(
  env: Pick<Env, 'MAIL_SINK'>,
  to: T,
  subject: string,
): { to: string | T; subject: string } => ({
  to: env.MAIL_SINK || to,
  subject: env.MAIL_SINK
    ? `[to: ${[to].flat().join(', ')}] ${subject}`
    : subject,
})

/**
 * The address an app writes from: `<space>.<app>@yaks.app`, and
 * `<space>@yaks.app` for the space's HOME app — the one whose address is the
 * bare hostname (directory.ts `url`), so its mailbox is the bare name too.
 *
 * ```ts
 * mailFrom('ada', 'cookbook') // 'ada.cookbook@yaks.app'
 * mailFrom('ada', null)       // 'ada@yaks.app'
 * ```
 */
export let mailFrom = (
  space: string,
  app: string | null,
  env: Host = {},
): string => `${app ? `${space}.${app}` : space}@${apex(env)}`

/** An app's mailbox, as {@link mailedTo} reads one back. */
export type Mailbox = { space: string; app: string | null }

/**
 * The same derivation the other way: which app a letter arrived for, or `null`
 * for an address this platform does not carry — another domain, a local part
 * with a second dot in it, a label that is not a slug.
 *
 * ```ts
 * mailedTo('ada.cookbook@yaks.app') // { space: 'ada', app: 'cookbook' }
 * mailedTo('Ada@Yaks.App')          // { space: 'ada', app: null }
 * mailedTo('ana@example.com')       // null
 * mailedTo('a.b.c@yaks.app')        // null
 * ```
 */
export let mailedTo = (address: string, env: Host = {}): Mailbox | null => {
  let split = parts(address.trim().toLowerCase())
  if (!split || split[1] != apex(env)) return null
  let [space, app, ...rest] = split[0].split('.')
  if (rest.length || !SLUG.test(space ?? '')) return null
  if (app != null && !SLUG.test(app)) return null
  return { space, app: app ?? null }
}

let diverted = (sender: Sender, env: Pick<Env, 'MAIL_SINK'>): Sender => ({
  send: (m) =>
    sender.send({
      ...m,
      ...sink(env, m.to, m.subject),
      ...(env.MAIL_SINK ? { cc: undefined } : {}),
    }),
})

/** The sender the deploy's MAIL_VIA selects for a kind of letter (config.ts
 * `posts`), else the one that kind defaults to, or why it cannot send yet.
 * The providers config.ts names lend the senders, read from the env, and
 * `tags` beside: what a provider's notice about the letter carries back
 * (mail-receipts.ts). */
export let transport = async (
  env: Delivery,
  kind: Post = posts.apps,
  tags: Record<string, string> = {},
): Promise<Built> =>
  post({ via: env.MAIL_VIA ?? kind.via }, {
    senders: await lent(env, 'senders', kind, { tags }),
  })

/** What a transport reads: the env the providers' options name, the deploy's
 * selection and the staging sink. */
export type Delivery = Partial<Env>

/** The capability lent to apps and Operators, with one selected transport,
 * the staging sink kept at its boundary. */
export let outgoing = (
  env: Delivery,
  tags: Record<string, string> = {},
): Sender => ({
  send: async (m) => {
    let { sender, waiting } = await transport(env, posts.apps, tags)
    if (!sender) throw new Unsent(waiting!, 60_000)
    return diverted(sender, env).send(m)
  },
})

/** A store locator as provider correlation metadata, never stored on mail. */
export let mailTags = (store: string): Record<string, string> => ({
  yak_store: toBase64url(new TextEncoder().encode(store)),
})
