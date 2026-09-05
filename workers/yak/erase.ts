// Closing a space (T-33166): what deleting one destroys, the act itself, and
// the ticket that stands between an agent and it. `/privacy` promises a
// person their account can be closed, and until this there was no mechanism
// behind that sentence — nor any way to give a slug back, which a space made
// by mistake took out of circulation for good.
//
// WHO MAY. Two callers reach a space, and they are not the same (T-33070).
// A PERSON signed in on the web deletes directly: the door reads the platform
// session cookie only (identity.ts `/space/<slug>/delete`, the shape
// billing.ts's checkout established), so an agent holding a bearer token
// cannot reach it at all, and the person types the slug back before anything
// happens. An AGENT deletes nothing: `space_delete` (tools.ts) mails the
// owner a link to that same door and answers saying so. The letter is the
// second channel an agent has no way into, and it NAMES what is about to go —
// the apps, the domains, the people — because whoever reads it may not be
// whoever asked.
//
// The ticket the letter carries is a `seal` (src/token.ts): the space, the
// person, and the hour it dies, signed under the session secret, kept nowhere.
// Single-use is what it AUTHORIZES rather than a row somewhere: the one act
// it opens can happen once, and a second visit finds a space that is gone.
//
// THE SLUG COMES BACK. Owner, 2026-09-03: "i'd release the names." So the
// space row goes and its slug is free the moment it does — no cooling-off
// period, deliberately. A held name is a name nobody may have, including the
// person who deleted by mistake and wants it straight back; and a hold only
// DELAYS the cost it is meant to prevent, since a link someone was given
// resolves to a stranger's space after the hold exactly as it would without
// one. What makes reuse safe is that nothing survives the name: an app's
// store is named for the address it was born at (directory.ts `storeName`)
// and its files live under that address in the bucket, so both are emptied
// here — the next space at this slug wakes up in an empty graph with an empty
// prefix, never in the last one's.
//
// ORDER: everything OUTSIDE the directory first — the custom hostnames at
// Cloudflare, the app scripts in the dispatch namespace, the stores, the
// bytes — and the row that says the space exists last, because that row is
// the only record we keep that any of it was ours. A delete that dies halfway
// leaves a space still named but emptied, which asking again finishes; the
// other order would leave a billable custom hostname and a bucket full of
// bytes with nothing left pointing at them.
import { r2Blobs } from '../../src/blobs_r2.ts'
import { opened, seal } from '../../src/token.ts'
import { reachChanged } from './declared.ts'
import {
  type App,
  type Directory,
  type Host,
  META,
  type Space,
  storeName,
  url,
} from './directory.ts'
import { drop } from './dispatch.ts'
import { reachable, release } from './domains.ts'
import type { Env } from './env.ts'
import { PLATFORM } from './route.ts'
import { vouched, type Who } from './session.ts'
import { storeOf } from './door.ts'
import { own } from './versions.ts'

// An hour to walk over to the inbox and read the letter. Longer than a
// sign-in code's ten minutes, because nobody is standing at the form waiting
// for this one, and short enough that a link left in a mailbox stops being a
// live wire the same day. Unconfirmed, it simply lapses: nothing was written
// when it was minted, so nothing has to be swept when it dies.
export let LIFE = 60 * 60_000

// What the letter carries: the space, the person it was mailed to, and the
// second it dies. The kernel signs it; nobody else can mint one.
export type Ticket = { space: string; person: string; exp: number }

export let ticket = (space: Space, person: string, secret: string) =>
  seal(
    { space: space.eid, person, exp: Date.now() + LIFE } satisfies Ticket,
    secret,
  )

export let ticketed = async (
  token: string,
  secret: string,
  now = Date.now(),
): Promise<Ticket | null> => {
  let t = await opened<Ticket>(token, secret)
  return t && typeof t.space == 'string' && typeof t.person == 'string' &&
      typeof t.exp == 'number' && t.exp > now
    ? { space: t.space, person: t.person, exp: t.exp }
    : null
}

// The door itself, and the door with a ticket in hand — the address the
// letter carries and the page posts back to.
export let door = (slug: string, token?: string) =>
  `https://${PLATFORM}/space/${slug}/delete` +
  (token ? `?t=${encodeURIComponent(token)}` : '')

// Everything one space's death takes with it, read before anything moves —
// the census the letter and the page both name, and the list the act itself
// walks. Members are named, never addressed: a name is what the platform says
// out loud about a person (T-32654).
export type Doomed = {
  space: Space
  apps: App[]
  hosts: Host[]
  members: { person: string; name: string | null }[]
}

export let doomed = async (
  dir: Directory,
  space: Space,
): Promise<Doomed> => {
  let members: Doomed['members'] = []
  for (let person of await dir.members(space)) {
    members.push({ person, name: await dir.nameAt(person) })
  }
  return {
    space,
    apps: await dir.apps(space),
    hosts: await dir.hosts(space),
    members,
  }
}

// Why this space may not be deleted at all, or empty. Two of them, and both
// are refusals rather than a warning, because each is something that outlives
// the delete and costs somebody money or breaks the platform:
//
//   the meta space is the directory itself — deleting it would take every
//   space, app and membership on the platform with it, whoever owns `yak`
//   (tools.ts app_delete holds the same line for its app);
//
//   a space that is paying has a Stripe subscription this door does not
//   cancel, and a subscription with nothing left to bill for is a charge
//   every month for a space that is gone. Cancelling is the person's own, at
//   their billing page, and it is one click away.
export let refused = (space: Space) =>
  space.slug == META.space
    ? `${META.space} is the platform itself`
    : space.plan?.subscription && space.plan.status != 'canceled'
    ? `${space.slug} is paying for Plus. Cancel the subscription first — ` +
      `https://${PLATFORM}/connect, "Manage billing" — and delete it after ` +
      'that, so nothing keeps billing for a space that is gone'
    : ''

// What is about to be destroyed, as lines a person reads: the apps by name
// with the address each answers at, every domain, everyone who loses their
// way in, and the address itself going back into circulation. The same lines
// go in the letter, on the confirmation page, and in the answer the agent
// reads out, so nobody is told three different stories.
export let naming = (d: Doomed): string[] => [
  ...d.apps.map((app) =>
    `${app.title} (${url(d.space, app)}) — its pages, its files and ` +
    'everything it has saved'
  ),
  ...d.hosts.map((h) => `${h.name} stops serving and is given back`),
  ...(d.members.length > 1
    ? [
      `${d.members.length} people lose their way in: ` +
      d.members.map((m) => m.name ?? 'someone').join(', '),
    ]
    : []),
  `the address ${d.space.slug}.${PLATFORM} goes back into circulation, so ` +
  'somebody else may take it later — any link to it stops being yours',
]

// The letter an agent's ask sends, and the ONE letter the platform never
// counts against a space's month (usage.ts `sending`): refusing to send it
// would lock a person inside a space they are trying to close, and a person
// deleting a space is a person we are about to stop billing anyway.
export let letter = (d: Doomed, link: string) => ({
  subject: `Delete ${d.space.slug}.${PLATFORM}?`,
  body: `Your assistant asked to delete ${d.space.slug}.${PLATFORM}.

Nothing has happened yet. Nothing will unless you open this link, and it only
works for the next hour:

${link}

It cannot be undone. It destroys:

${naming(d).map((l) => `  - ${l}`).join('\n')}

If you did not ask for this, ignore this letter and nothing happens at all.`,
})

// The bytes under a prefix, gone. Answers the keys it removed.
let swept = async (env: Env, prefix: string) => {
  let blobs = r2Blobs(env.BLOBS)
  let keys = await blobs.list(prefix)
  for (let key of keys) await blobs.delete(key)
  return keys
}

// The prefix an app's files live under (files.ts prefixOf), which is its
// address, and therefore what a space's whole footprint in the bucket is
// prefixed by.
let under = (space: Space, app?: App) =>
  `${space.slug}/${app ? `${app.slug}/` : ''}`

// One app's STORAGE emptied — its bytes, the worker script that answers for
// it, and the store that holds what it saved. Everything but the row, which
// is the caller's to bury: app_delete tombstones the app, and a space's death
// cascades to it. Answers the keys that went, so the caller can say how many
// of them were files a person wrote.
export let emptied = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
) => {
  let keys = await swept(env, under(space, app))
  // The app's own code, which is not in the bucket: a script left in the
  // dispatch namespace would still answer at an address nothing stands at.
  if (env.CF_WORKERS_TOKEN) await drop(env, storeName(space, app))
  // The store is named for where the app was born (directory.ts storeName),
  // so emptying it is what keeps a later app at the same address from waking
  // up in this one's graph.
  let r = await storeOf(env.STORE, storeName(space, app))('/', {
    method: 'DELETE',
  }, { ...vouched(who), 'x-yak-kernel': '1' })
  if (!r.ok) throw new Error(await r.text())
  await r.body?.cancel()
  return keys
}

// The act. Everything outside the directory first, the space row last; what
// it answers is what the person is told went.
export let erase = async (
  env: Env,
  dir: Directory,
  d: Doomed,
  who: Who,
) => {
  let no = refused(d.space)
  if (no) throw new Error(no)
  // Cloudflare before anything else, and only if it can be reached: a domain
  // whose row we buried and whose custom hostname we did not is a billable
  // hostname nothing here remembers (T-33038 domain_detach holds the same
  // order for one domain).
  if (d.hosts.length) reachable(env)
  for (let host of d.hosts) await release(env, host.name)
  let files = 0
  for (let app of d.apps) {
    let keys = await emptied(env, d.space, app, who)
    files += own(keys.map((k) => k.slice(under(d.space, app).length))).length
  }
  // And whatever else stands under the space's own name — bytes an app that
  // was deleted before this tool existed left behind, or a delete that died
  // halfway and is being finished now. The slug is about to be somebody
  // else's; nothing under it may outlive this.
  await swept(env, under(d.space))
  // The row that says the space exists. Its death cascades in the store to
  // every app, deploy, hostname and membership that named it (the platform
  // contract's `death = "cascade"`), so this one tombstone buries the
  // directory's whole record of the space — and frees the slug, which is
  // unique across the platform and now belongs to nobody.
  await dir.apply({
    entities: [{ entity: { eid: d.space.eid }, tombstone: {} }],
  }, vouched(who))
  // Everyone who was in it just lost every tool and view its apps declared
  // (declared.ts, T-33004) — the same move being removed from a space makes.
  for (let m of d.members) await reachChanged(env, m.person)
  return { files, apps: d.apps.length, hosts: d.hosts.length }
}

// What went, as a sentence: the same summary the page and the tool answer
// both say back.
export let went = (
  d: Doomed,
  out: { files: number; apps: number; hosts: number },
) =>
  `${d.space.slug}.${PLATFORM} is gone: ${out.apps} ${
    out.apps == 1 ? 'app' : 'apps'
  }, ${out.files} ${out.files == 1 ? 'file' : 'files'}, everything they ` +
  `saved${
    out.hosts
      ? `, ${out.hosts} ${out.hosts == 1 ? 'domain' : 'domains'} given back`
      : ''
  }. The address is free for somebody else to take.`
