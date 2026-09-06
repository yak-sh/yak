// Deleting, and taking it back. Two halves: an APP goes to the trash and is
// erased thirty days later (T-34430, the bottom of this file), and a SPACE
// dies at once behind a link in a letter (T-33166, everything above it). One
// file because there is one erase — `emptied` empties an app's storage, and
// whether it is called by the space's death, by the sweep, or by a person who
// said `forever`, it is the same act.
//
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
// bytes, the builder's conversation and the workbench it ran commands in
// (T-34371) — and the row that says the space exists last, because that row is
// the only record we keep that any of it was ours. A delete that dies halfway
// leaves a space still named but emptied, which asking again finishes; the
// other order would leave a billable custom hostname and a bucket full of
// bytes with nothing left pointing at them.
import { r2Blobs } from '../../src/blobs_r2.ts'
import { opened, seal } from '../../src/token.ts'
import { wiped } from './build.ts'
import { moved, reachChanged, toolsOf } from './declared.ts'
import {
  type App,
  type Directory,
  directory,
  type Host,
  META,
  type Space,
  storeName,
  type Trashed,
  url,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { drop } from './dispatch.ts'
import { reachable, release } from './domains.ts'
import { bound, type Env } from './env.ts'
import { PLATFORM } from './route.ts'
import { destroyed } from './sandbox.ts'
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
  // What the space kept outside the graph, and therefore outside the cascade
  // below: the builder's conversation, in an object of its own keyed by the
  // eid (build.ts), and the container that conversation compiled things in
  // (sandbox.ts, same key). `/privacy` says both go with the space. Before the
  // row, like everything else here — a wipe that throws leaves the space still
  // named, and asking again finishes it, where the other order would leave a
  // transcript nothing points at and nobody can ask about again.
  await wiped(env, d.space.eid)
  await destroyed(env, d.space)
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

// ---- the trash: an app deleted, and an app brought back (T-34430) ----
//
// Jeff, 2026-09-05: "can deleted apps be brought back if done by mistake?" —
// "there should be a grace period. like a 30 day trash". So `app_delete`
// keeps everything and writes ONE word on the app row (vocab.ts `trashed`),
// and every reader of an app asks it: the web serves nothing, the roster
// drops its tools and views, the front page is not it, and its mail bounces.
// Nothing is copied anywhere and nothing is moved — which is what makes
// `app_restore` exact rather than approximate.
//
// The SLUG is held with it, deliberately, and that is the one place this
// disagrees with a space's death above ("i'd release the names"): a space's
// name comes straight back because nothing survives it, where a trashed app
// is still here in every other way, and a second app born at its address
// would be the thing a restore then could not put back.

// How long the trash keeps it. Thirty days is the owner's number, and it is
// the same number `/privacy` says out loud.
export let GRACE = 30 * 24 * 60 * 60_000

// Days left before the sweep takes it, never below zero — what a person is
// told, in the unit they would ask in. An app trashed a moment ago has thirty.
export let daysLeft = (t: Trashed, now = Date.now()) =>
  Math.max(0, Math.ceil((Date.parse(t.at) + GRACE - now) / 86_400_000))

// Whether the trash has run out. A mark with no readable `at` is DUE — an app
// nothing can count the days of cannot be kept forever on a null.
export let due = (t: Trashed, now = Date.now()) =>
  !(Date.parse(t.at) + GRACE > now)

// Which of a space's apps the sweep takes: the ones in the trash whose days
// have run out, and nothing else. The whole of the selection, as one pure
// answer, because what a sweep DELETES is the part worth holding to a test.
export let overdue = (apps: App[], now = Date.now()) =>
  apps.filter((a) => a.trashed && due(a.trashed, now))

// What an app's coming or going does to everyone's tool list (T-33004). A
// trashed app leaves the roster and a restored one rejoins it, so both ask
// the same question of its store — did it declare tools, views, or neither —
// and tell the space only what actually moved.
export let rostered = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
) => {
  let had = await toolsOf(env, space, app)
  await moved({ env, dir }, space, [
    ...(Object.keys(had).length ? ['tools' as const] : []),
    ...(Object.values(had).some((t) => t.view) ? ['resources' as const] : []),
  ])
}

// Into the trash: the mark, then the roster. Nothing else — the bytes, the
// store, the deploys and the slug are all exactly where they were.
export let trash = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
  now = new Date(),
) => {
  await dir.apply({
    entities: [{
      entity: { eid: app.eid },
      trashed: { at: now.toISOString(), by: who.person },
    }],
  }, vouched(who))
  await rostered(env, dir, space, app)
}

// And out of it: `trashed: null` drops the whole component, which is the
// whole of a restore — every other word the app wears was never touched.
// Both doors call this, the tool and the space page's form. `untrash` rather
// than `restore` because versions.ts already owns that word for putting an
// app's FILES back, and these are two different acts on the same app.
export let untrash = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
) => {
  await dir.apply({
    entities: [{ entity: { eid: app.eid }, trashed: null }],
  }, vouched(who))
  await rostered(env, dir, space, app)
}

// One app gone for good: its storage (`emptied` above, the same call a
// space's death makes), then the row that says the app exists — that order,
// because the row is the app. Answers how many of the keys were files a
// person wrote rather than bytes a version pinned (versions.ts `own`), which
// is what a delete says back.
export let erased = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
) => {
  let prefix = under(space, app)
  let keys = await emptied(env, space, app, who)
  await dir.apply({
    entities: [{ entity: { eid: app.eid }, tombstone: {} }],
  }, vouched(who))
  return own(keys.map((k) => k.slice(prefix.length))).length
}

// The cron line the sweep runs on, spelled exactly as wrangler.toml
// `[triggers] crons` spells it. `scheduled` is ONE handler for both triggers
// (index.ts) and the line that fired is what tells them apart, so the two
// spellings have to agree — erase_test.ts holds them to it, because a line
// that matched nothing would run the meter twice a day and the sweep never.
export let DAILY = '20 4 * * *'

// The daily sweep (wrangler.toml `[triggers] crons`, index.ts `scheduled`):
// every app whose thirty days have run out, erased. It walks the platform
// because the promise is the platform's, not a space's — and it erases AS the
// person who threw the app away, since the delete is what it is finishing.
//
// Nothing is told about a roster here: the app left everyone's lists the day
// it went into the trash, and this is only the storage catching up.
export let collected = async (env: Env, now = new Date()) => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let gone = 0
  for (let space of await dir.all()) {
    // Never the directory itself, whatever its row says: the app that holds
    // every space on the platform is not one a sweep may erase (`refused`
    // above and tools.ts app_delete hold the same line at the doors).
    if (space.slug == META.space) continue
    for (let app of overdue(await dir.apps(space), now.getTime())) {
      await erased(env, dir, space, app, {
        person: app.trashed!.by,
        role: 'owner',
      })
      gone++
    }
  }
  if (gone) console.log(`yak-trash: ${gone} erased at ${now.toISOString()}`)
  return gone
}
