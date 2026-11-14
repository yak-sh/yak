// An app's post room: the address it writes from, the (space, app) an address
// names, and the sender a letter leaves through, which a provider config.ts
// names lends (lent.ts).
//
// The yaks.app address is a local part at the apex, and that is not a style
// choice. Cloudflare onboards mail per domain, thirty to a zone, and a
// wildcard MX is refused at RCPT — a probe to `probe@cf-bounce.yaks.app`,
// which has the Cloudflare MX, came back `550 5.1.1 Domain does not exist`
// (C-33769 on T-33684). So the one shape the zone carries for every space
// there will ever be is a local part at `yaks.app`. Jeff, 2026-09-05: "yeah,
// let's do space.app@yaks.app. space@yaks.app should also work (home app)".
// A place's other hostnames (its subdomain, a domain aimed at it, and that
// domain's `mail.` domain) take mail where a mail provider carries them
// (D-415), and a letter to one lands where its pages do.
//
// The two directions are one derivation read each way, in one file, because an
// app that writes from an address nobody can write back to is worse than an
// app with no address at all: this is what holds the outbound `from` (the
// sending effect, graph.ts) and the inbound route (`email()`, index.ts) to the
// same sentence. A slug carries no dot (@yaks/platform/routes `SLUG`), so the single dot in
// a local part is unambiguously the seam between the space and the app.
import { toBase64url } from '@yaks/fp'
import { parts, post, type Sender, Unsent } from '@yaks/mail'
import type { Built } from '@yaks/host/senders'
import { SLUG } from '@yaks/platform/names'
import { BOT } from '@yaks/platform/bots'
import { apex, type Host } from '@yaks/platform/host'
import type { Env } from './env.ts'
import type { App, Directory, Space } from './directory.ts'
import { type Post, posts } from './config.ts'

// Apply at the transport so app effects and platform letters obey one rule.
// A letter every recipient of which is the fleet's own (@yaks/platform/bots
// `BOT`) goes where it is addressed: those mailboxes land in the tasks graph,
// never a person's inbox, and a bot signs in on staging by reading its code
// there.
export let sink = <T extends string | string[]>(
  env: Pick<Env, 'MAIL_SINK'>,
  to: T,
  subject: string,
  cc?: string | string[],
): { to: string | T; subject: string } =>
  sunk(env, [to, cc ?? []].flat())
    ? {
      to: env.MAIL_SINK!,
      subject: `[to: ${[to].flat().join(', ')}] ${subject}`,
    }
    : { to, subject }

let sunk = (env: Pick<Env, 'MAIL_SINK'>, to: string[]) =>
  !!env.MAIL_SINK && !to.every((one) => one.toLowerCase().endsWith(BOT))

/**
 * The address an app writes from: `<space>.<app>@yaks.app`, and
 * `<space>@yaks.app` for the space's HOME app — the one whose address is the
 * bare hostname (directory.ts `url`), so its mailbox is the bare name too.
 * Given the mail domain its place sends from (D-415), the app's name at that
 * domain, and the space's name there for the home app: the space's own
 * mailbox at a space's domain, as `<space>@yaks.app` is at the apex.
 *
 * ```ts
 * mailFrom('ada', 'cookbook')                     // 'ada.cookbook@yaks.app'
 * mailFrom('ada', null)                           // 'ada@yaks.app'
 * mailFrom('ada', 'cookbook', {}, 'ada.example')  // 'cookbook@ada.example'
 * ```
 */
export let mailFrom = (
  space: string,
  app: string | null,
  env: Host = {},
  domain?: string | null,
): string =>
  domain
    ? `${app ?? space}@${domain}`
    : `${app ? `${space}.${app}` : space}@${apex(env)}`

/** What an address spells, as {@link addressed} reads it. */
export type Addressed =
  | { space: string; app: string | null }
  | { space: string; local: string }
  | { host: string; local: string }

/**
 * What an address spells, before the directory is asked who holds it: at the
 * apex, a space and an app (`app` null for the space's own mailbox); at a
 * space's subdomain, the space and the local part; at any other hostname, the
 * hostname and the local part. `null` for one this platform could never carry:
 * a second dot in an apex local part, a label that is not a slug.
 *
 * ```ts
 * addressed('ada.cookbook@yaks.app') // { space: 'ada', app: 'cookbook' }
 * addressed('Clerk@Ada.Yaks.App')    // { space: 'ada', local: 'clerk' }
 * addressed('clerk@ada.example')     // { host: 'ada.example', local: 'clerk' }
 * addressed('a.b.c@yaks.app')        // null
 * ```
 */
export let addressed = (address: string, env: Host = {}): Addressed | null => {
  let split = parts(address.trim().toLowerCase())
  if (!split) return null
  let [local, host] = split
  let zone = apex(env)
  if (host == zone) {
    let [space, app, ...rest] = local.split('.')
    if (rest.length || !SLUG.test(space ?? '')) return null
    if (app != null && !SLUG.test(app)) return null
    return { space, app: app ?? null }
  }
  if (!host.endsWith(`.${zone}`)) return { host, local }
  let space = host.slice(0, -zone.length - 1)
  return SLUG.test(space) ? { space, local } : null
}

/** A mailbox: the space, and its app, or `null` for the space's own. */
export type Mailbox = { space: Space; app: App | null }

/** The directory's reads a mailbox is found by. */
export type Reads = Pick<
  Directory,
  'answering' | 'answeringApp' | 'serves' | 'home'
>

/**
 * The same derivation the other way: whose mailbox an address is, read where
 * the web reads its hostname (D-415, "Where a letter lands follows the web").
 *
 * - `<space>.<app>@yaks.app` is that app and `<space>@yaks.app` the space's
 *   own mailbox.
 * - At a space's hostname (its subdomain, or a domain aimed at the space, or
 *   that domain's `mail.` domain) a local part that names one of its apps is
 *   that app, and any other is the space's own mailbox.
 * - At a hostname aimed at one app, every local part is that app.
 *
 * A slug or hostname a place has left still answers, as its pages do
 * (directory.ts `answering`, `former`). `null` is nobody's: an address this
 * platform does not carry, a place that is not there or is in the trash, or
 * an apex address naming an app the space has not got.
 */
export let mailedTo = async (
  address: string,
  dir: Reads,
  env: Host = {},
): Promise<Mailbox | null> => {
  let at = addressed(address, env)
  if (!at) return null
  if ('host' in at) {
    let aimed = await dir.serves(at.host) ??
      (at.host.startsWith('mail.') ? await dir.serves(at.host.slice(5)) : null)
    if (!aimed || aimed.space.trashed) return null
    return aimed.app
      ? opened(aimed.space, aimed.app)
      : await within(dir, aimed.space, at.local)
  }
  let space = await dir.answering(at.space)
  if (!space || space.trashed) return null
  if ('local' in at) return await within(dir, space, at.local)
  if (!at.app) return { space, app: null }
  return opened(space, await dir.answeringApp(space, at.app))
}

// An app in the trash has no mailbox (erase.ts, T-34430), whichever address
// names it.
let opened = (space: Space, app: App | null): Mailbox | null =>
  app && !app.trashed ? { space, app } : null

// A local part at a space's hostname: one of its apps, else the space's own.
let within = async (dir: Reads, space: Space, local: string) => {
  let app = SLUG.test(local) ? await dir.answeringApp(space, local) : null
  return app ? opened(space, app) : { space, app: null }
}

/**
 * Whether a letter to `address` lands in app `app`'s store: its own mailbox,
 * or the space's own when `app` is the front page that one reaches for anyone
 * who is not asking the space's Operator (inbox.ts `opened`). What lets a
 * reply leave from the address the letter it answers was written to (graph.ts
 * `#posting`) and no address that is not the app's.
 */
export let heldBy = async (
  address: string,
  app: string,
  dir: Reads,
  env: Host = {},
): Promise<boolean> => {
  let box = await mailedTo(address, dir, env)
  let held = box && (box.app ?? await dir.home(box.space))
  return held?.eid == app
}

let diverted = (sender: Sender, env: Pick<Env, 'MAIL_SINK'>): Sender => ({
  send: (m) =>
    sender.send({
      ...m,
      ...sink(env, m.to, m.subject, m.cc),
      ...(sunk(env, [m.to, m.cc ?? []].flat()) ? { cc: undefined } : {}),
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
    senders: await (await import('./lent.ts')).lent(env, 'senders', kind, {
      tags,
    }),
  })

/** What a transport reads: the env the providers' options name, the deploy's
 * selection and the staging sink. */
export type Delivery = Partial<Env>

/** The capability lent to apps and Operators, with one selected transport,
 * the staging sink kept at its boundary. `kind` is whose letters these are:
 * the platform's own (support.ts) leave as platform letters do. */
export let outgoing = (
  env: Delivery,
  tags: Record<string, string> = {},
  kind: Post = posts.apps,
): Sender => ({
  send: async (m) => {
    let { sender, waiting } = await transport(env, kind, tags)
    if (!sender) throw new Unsent(waiting!, 60_000)
    return diverted(sender, env).send(m)
  },
})

/** A store locator as provider correlation metadata, never stored on mail. */
export let mailTags = (store: string): Record<string, string> => ({
  yak_store: toBase64url(new TextEncoder().encode(store)),
})
