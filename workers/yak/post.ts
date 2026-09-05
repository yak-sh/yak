// An app's post room: the address it writes from, the (space, app) an address
// names, and Cloudflare's Email Sending BINDING as an @yaks/mail `Sender`.
//
// THE ADDRESS IS A LOCAL PART AT THE APEX, and that is not a style choice.
// Cloudflare onboards mail per DOMAIN, thirty to a zone, and a wildcard MX is
// refused at RCPT — a probe to `probe@cf-bounce.yaks.app`, which HAS the
// Cloudflare MX, came back `550 5.1.1 Domain does not exist` (C-33769 on
// T-33684). So `<app>@<space>.yaks.app` is undeliverable in both directions
// for every space but the handful anyone could onboard by hand, and the one
// shape the zone carries for every space there will ever be is a local part at
// `yaks.app`. Jeff, 2026-09-05: "yeah, let's do space.app@yaks.app.
// space@yaks.app should also work (home app)".
//
// The two directions are ONE derivation read each way, in one file, because an
// app that writes from an address nobody can write back to is worse than an
// app with no address at all: this is what holds the outbound `from` (the
// sending effect, graph.ts) and the inbound route (`email()`, index.ts) to the
// same sentence. A slug carries no dot (route.ts `SLUG`), so the single dot in
// a local part is unambiguously the seam between the space and the app.
import { type Message, parts, type Receipt, type Sender } from '@yaks/mail'
import { PLATFORM, SLUG } from './route.ts'

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
export let mailFrom = (space: string, app: string | null): string =>
  `${app ? `${space}.${app}` : space}@${PLATFORM}`

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
export let mailedTo = (address: string): Mailbox | null => {
  let split = parts(address.trim().toLowerCase())
  if (!split || split[1] != PLATFORM) return null
  let [space, app, ...rest] = split[0].split('.')
  if (rest.length || !SLUG.test(space ?? '')) return null
  if (app != null && !SLUG.test(app)) return null
  return { space, app: app ?? null }
}

/**
 * The slice of the Email Sending binding one letter needs (wrangler.toml
 * `[[send_email]]`, env.ts `MAIL`). No token rides with it — the deploy is the
 * authorization — and what a binding may send FROM is the set of domains
 * onboarded to Email Sending on the zone, which is the check that matters.
 */
export type Binding = {
  send(letter: {
    from: string
    to: string
    subject: string
    text?: string
    html?: string
    headers?: Record<string, string>
  }): Promise<{ messageId?: string }>
}

/**
 * The binding as an @yaks/mail {@link Sender}: the seam the sending effect
 * hands one composed letter to.
 *
 * NO BINDING IS A SENDER THAT REFUSES — `wrangler dev` without `remote = true`,
 * the workerd stand-in, a deploy that lost the binding. A letter then comes to
 * rest as a `bounced` saying so, which someone can read off the entity, rather
 * than sitting unsent with nothing written about it.
 */
export let posting = (mail?: Binding): Sender => ({
  send: async (m: Message): Promise<Receipt> => {
    if (!mail) throw new Error('this deploy has no mail binding')
    let sent = await mail.send({
      from: m.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
      // The threading headers carry the bracketed Message-ID; the receipt
      // hands back the unbracketed one the next reply threads on.
      ...(m.replyTo
        ? {
          headers: {
            'In-Reply-To': `<${m.replyTo}>`,
            References: `<${m.replyTo}>`,
          },
        }
        : {}),
    })
    let id = String(sent?.messageId ?? '').replace(/[<>]/g, '')
    return id ? { id } : {}
  },
})
