// An app's post room: the address it writes from, the (space, app) an address
// names, and Cloudflare's Email Sending binding as an @yaks/mail `Sender`.
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
import { type Binding, bound } from '@yaks/cloudflare-mail/binding'
import { configured as cloudflare } from '@yaks/cloudflare-mail/sender'
import { configured as resend } from '@yaks/resend/sender'
import { SLUG } from './route.ts'
import { apex, type Host } from './host.ts'
import type { Env } from './env.ts'
import { resent } from './workers_api.ts'

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

export type { Address, Binding } from '@yaks/cloudflare-mail/binding'

/** Keep the staging sink at the sender boundary, for every provider. */
export let posting = (
  mail?: Binding,
  env: Pick<Env, 'MAIL_SINK'> = {},
): Sender => diverted(bound(mail), env)

let diverted = (sender: Sender, env: Pick<Env, 'MAIL_SINK'>): Sender => ({
  send: (m) =>
    sender.send({
      ...m,
      ...sink(env, m.to, m.subject),
      ...(env.MAIL_SINK ? { cc: undefined } : {}),
    }),
})

/** The sender this deploy's configuration selects, built from its env, or
 * why it cannot send yet. Native platform letters default to the REST sender;
 * apps default to the binding. A migration explicitly selects Resend only
 * after its address passed a pilot. */
export let transport = (
  env: Delivery,
  fallback = 'binding',
  tags: Record<string, string> = {},
) => {
  let via = env.MAIL_VIA ?? fallback
  return via == 'cloudflare'
    ? cloudflare({
      account: env.MAIL_ACCOUNT || env.CF_ACCOUNT,
      token: env.MAIL_TOKEN,
      base: env.MAIL_API,
      fetch: env.MAIL_FETCH ?? resent,
    })
    : via == 'resend'
    ? resend({
      token: fallback == 'cloudflare'
        ? env.RESEND_PLATFORM_TOKEN
        : env.RESEND_TOKEN,
      base: env.RESEND_API,
      fetch: env.MAIL_FETCH,
      tags,
    })
    : post({ via }, { senders: { binding: bound(env.MAIL) } })
}

export type Delivery = Pick<
  Env,
  | 'MAIL'
  | 'MAIL_SINK'
  | 'MAIL_VIA'
  | 'RESEND_TOKEN'
  | 'RESEND_PLATFORM_TOKEN'
  | 'RESEND_API'
  | 'MAIL_TOKEN'
  | 'MAIL_ACCOUNT'
  | 'MAIL_API'
  | 'MAIL_FETCH'
  | 'CF_ACCOUNT'
>

/** The capability lent to apps and Operators, with one selected transport. */
export let outgoing = (
  env: Delivery,
  tags: Record<string, string> = {},
): Sender => ({
  send: (m) => {
    let { sender, waiting } = transport(env, 'binding', tags)
    if (!sender) throw new Unsent(waiting!, 60_000)
    return diverted(sender, env).send(m)
  },
})

/** A store locator as provider correlation metadata, never stored on mail. */
export let mailTags = (store: string): Record<string, string> => ({
  yak_store: toBase64url(new TextEncoder().encode(store)),
})
