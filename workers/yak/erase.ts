import { planSettings } from '@yaks/platform/routes'
import { ownedPrefix } from './file-root.ts'
// Deletion first keeps a recoverable trash mark. Only an owner's confirmed
// purge removes app stores, files or shared names; the daily sweep never does.
import { r2RawObjects } from './lib/objects.ts'
import { purgeParts } from '@yaks/blob'
import { blobPrefix, receiptPrefix, uploadPrefix } from './blob-key.ts'
import { type Bundle, dead, minted } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { declarationOf, keepDeclaration } from './declaration.ts'
import { sandboxed } from '@yaks/platform/installs'
import { componentsOf } from './vocab.ts'
import { isTestAddress } from '@yaks/platform/bots'
import {
  CENSUS,
  censusOf,
  expendable,
  idleSpaces,
  inactive,
  PROTECTED,
  type Row,
} from './idle-spaces.ts'
import { KERNEL, meta } from './meta.ts'
import { MORE } from './wake.ts'
import { type Given, VISITS, visits } from '@yaks/platform/visits'
import { ledgerOf } from './visit.ts'
import { opened, seal } from './lib/token.ts'
import { type Kind, LIFE } from './confirm.ts'
import { purgeTunnel } from './tunnel-trash.ts'
import { wiped } from './build-door.ts'
import { reachChanged, toolsOf, viewsMoved } from './declared.ts'
import {
  addresses,
  type App,
  appStore,
  clamped,
  type Directory,
  directory,
  draftStore,
  type Host,
  idOf,
  META,
  type PhoneLine,
  ranked,
  type Row as DirRow,
  type Space,
  storeName,
  url,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { drop } from './dispatch.ts'
import { deleteBindings } from './bindings.ts'
import { reachable, release } from './domains.ts'
import { unmail } from './domain-mail.ts'
import { unmailSpace } from './space-mail.ts'
import { bound, type Env } from './env.ts'
import { apex, type Host as HostEnv } from '@yaks/platform/host'
import { purgedAll } from './sandbox.ts'
import { vouched, type Who } from './session.ts'
import { storeOf } from './door.ts'
import { cleared } from './sample.ts'
import { answered } from './meta.ts'
import { plans } from './payments.ts'
import { type Pinner, versions } from './versions.ts'
import { own } from '@yaks/platform/versions'
import { holding, pruned } from './written.ts'
import { purgedPrefix, retiring, retiringPrefix } from './file-retirement.ts'
import { refuse } from './tool.ts'
import { dollars, released } from './numbers.ts'
import { shown } from '@yaks/phone'
import { caught } from './defects.ts'
import { unkept } from './newcomer.ts'
import { delivered, type Rows } from './trash.ts'
import {
  and,
  eq,
  every,
  joined,
  type Line,
  line,
  list,
  stringify,
  sub,
  whole,
} from '@yaks/query'

// A space's ticket lives as long as every confirmation's (confirm.ts).
export { LIFE }

// What the letter carries: the space, the person it was mailed to, the unix
// second it dies, and whether the button under it trashes or erases. The kernel signs
// it; nobody else can mint one — so `forever` cannot be talked onto a link,
// which is the whole reason it rides in here rather than in the query string.
export type Ticket = {
  space: string
  person: string
  exp: number
  forever?: boolean
}

export let ticket = (
  space: Space,
  person: string,
  secret: string,
  forever = false,
) =>
  seal(
    'erase',
    {
      space: space.eid,
      person,
      exp: Math.floor((Date.now() + LIFE) / 1000),
      ...(forever ? { forever: true } : {}),
    } satisfies Ticket,
    secret,
  )

export let ticketed = async (
  token: string,
  secret: string,
  now = Date.now(),
): Promise<Ticket | null> => {
  let t = await opened<Ticket>('erase', token, secret)
  return t && typeof t.space == 'string' && typeof t.person == 'string' &&
      typeof t.exp == 'number' && t.exp * 1000 > now
    ? { space: t.space, person: t.person, exp: t.exp, forever: !!t.forever }
    : null
}

// The door itself, and the door with a ticket in hand — the address the
// letter carries and the page posts back to.
export let door = (slug: string, token?: string, env: HostEnv = {}) =>
  `https://${apex(env)}/space/${slug}/delete` +
  (token ? `?t=${encodeURIComponent(token)}` : '')

// Erasing one app from retained trash, as a person
// confirms it (confirm.ts). Two steps, and an agent takes at most the first:
// app_delete puts it in the trash, and app_erase asks. The door names the app
// by eid, because a trashed app's slug may already be another app's.
export let trashedApp: Kind<App> = {
  kind: 'app',
  find: async (dir, space, eid) => {
    let found = await dir.binned(space, eid)
    return found?.space == space.eid ? found : null
  },
  typed: (a) => a.slug,
  title: (a) => `Erase ${a.title || a.slug} for good?`,
  until: () =>
    'It stays in the trash until restored or its owner confirms erasure.',
  stop: (a) =>
    a.trashed ? '' : `${a.slug} is not in the trash. An app is erased only ` +
      'from the trash: delete it first, then choose permanent erasure separately.',
  lines: (space, a, env) => [
    `${a.title || a.slug} (${a.slug}), from ${space.slug}.${apex(env)}'s trash`,
    'its files, its versions and everything it saved',
  ],
  press: (a) => `Erase ${a.slug} forever`,
  act: async (env, dir, space, a, who) => {
    let files = await erased(env, dir, space, a, who)
    return `${a.slug} is erased from ${space.slug}'s trash: ${files} ${
      files == 1 ? 'file' : 'files'
    } and everything it saved.`
  },
}

// Everything one space's death takes with it, read before anything moves —
// the census the letter and the page both name, and the list the act itself
// walks. Members are named, never addressed: a name is what the platform says
// out loud about a person (T-32654).
export type Doomed = {
  space: Space
  apps: App[]
  hosts: Host[]
  lines: PhoneLine[]
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
    lines: await dir.lines(space),
    members,
  }
}

// A space that is nobody's work: everyone with a way in is a test account
// (@yaks/platform/bots), or nobody has one at all. The letter exists so an
// assistant cannot delete a person's work on its own; with no person in the
// space there is nobody to ask, so the act asked for happens at once (tools.ts
// `space_delete`). A protected space has somebody waiting on it even with only
// test accounts in it, a directory's next reviewer, so it takes the letter,
// which only the fleet can read.
export let nobodys = async (dir: Directory, d: Doomed) => {
  if (PROTECTED.has(d.space.slug)) return false
  for (let m of d.members) {
    if (!isTestAddress(await dir.emailAt(m.person) ?? '')) return false
  }
  return true
}

// Why this space may not be deleted at all, or empty. Two of them, and both
// are refusals rather than a warning, because each is something that outlives
// the delete and costs somebody money or breaks the platform:
//
//   the meta space is the directory itself — deleting it would take every
//   space, app and membership on the platform with it, whoever owns `yak`
//   (tools.ts app_delete holds the same line for its app);
//
//   a space whose subscription has not ended holds one this door does not
//   cancel, and a subscription with nothing left to bill for is a charge
//   every month for a space that is gone. Over is where the payment provider
//   says its status stands (payments.ts, `ended`), which it never moves a
//   subscription out of. Cancelling is the person's own, at their billing
//   page, and it is one click away.
export let refused = async (space: Space, env: HostEnv) =>
  space.slug == META.space
    ? `${META.space} is the platform itself`
    : space.plan?.subscription &&
        (await plans(env)).standing(space.plan.status) != 'ended'
    ? `${space.slug} is subscribed to the Plus plan. ` +
      'Cancel the subscription first with "Manage billing" at ' +
      `${planSettings(space.slug, env)}, and delete it after that, so ` +
      'nothing keeps billing for a space that is gone'
    : ''

// What is about to be destroyed, as lines a person reads: the apps by name
// with the address each answers at, every domain, everyone who loses their
// way in, and the address itself going back into circulation. The same lines
// go in the letter, on the confirmation page, and in the answer the agent
// reads out, so nobody is told three different stories.
export let naming = (d: Doomed, env: HostEnv = {}): string[] => [
  ...d.apps.map((app) =>
    `${app.title} (${url(d.space, app, env)}) — its pages, its files and ` +
    'everything it has saved'
  ),
  ...d.hosts.map((h) => `${h.name} stops serving and is given back`),
  ...d.lines.map((l) =>
    `${shown(l.number)} stops taking calls and texts; it costs ${
      dollars(l.monthly)
    } a month until this confirmed purge returns it to the phone company`
  ),
  ...(d.members.length > 1
    ? [
      `${d.members.length} people lose their way in: ` +
      d.members.map((m) => m.name ?? 'someone').join(', '),
    ]
    : []),
  `the address ${d.space.slug}.${apex(env)} goes back into circulation, so ` +
  'somebody else may take it later — any link to it stops being yours',
]

// The same census said as what a trash does, which is a different list and
// not a softer wording of that one: nothing here is destroyed, so every line
// says what stops rather than what goes, and the last line is the opposite of
// the last line above — the address is held, not released.
export let keeping = (d: Doomed, env: HostEnv = {}): string[] => [
  ...d.apps.map((app) =>
    `${app.title} (${
      url(d.space, app, env)
    }) stops answering — its pages, its ` +
    'files and everything it has saved are kept'
  ),
  ...d.hosts.map((h) => `${h.name} stops serving until the space is back`),
  ...d.lines.map((l) =>
    `${shown(l.number)} stays the space's, and costs ${
      dollars(l.monthly)
    } a month until it is erased`
  ),
  ...(d.members.length > 1
    ? [
      `${d.members.length} people lose their way in until then: ` +
      d.members.map((m) => m.name ?? 'someone').join(', '),
    ]
    : []),
  `the address ${d.space.slug}.${
    apex(env)
  } is held for you while in the trash — ` +
  'nobody else can take it, and every link to it works again the moment you ' +
  'restore the space',
]

// The letter an agent's ask sends, and the one letter the platform never
// counts against a space's month (usage.ts `sending`): refusing to send it
// would lock a person inside a space they are trying to close, and a person
// deleting a space is a person we are about to stop billing anyway.
export let letter = (
  d: Doomed,
  link: string,
  forever = false,
  env: HostEnv = {},
) => ({
  subject: `Delete ${d.space.slug}.${apex(env)}?`,
  body: `Your assistant asked to delete ${d.space.slug}.${apex(env)}.

Nothing has happened yet. Nothing will unless you open this link, and it only
works for the next hour:

${link}

${
    forever && !!d.space.trashed
      ? `It cannot be undone. It destroys:

${naming(d, env).map((l) => `  - ${l}`).join('\n')}`
      : `It puts the space in the trash. Nothing is erased, and you
can bring it back until you separately choose permanent erasure. What stops until you do:

${keeping(d, env).map((l) => `  - ${l}`).join('\n')}

It stays recoverable until you choose to erase it from the trash.`
  }

If you did not ask for this, ignore this letter and nothing happens at all.`,
})

// Ordinary cleanup retains bytes. Only a person's confirmed purge removes them.
let swept = (env: Env, prefix: string, owner: string, purge = false) => {
  let ledger = {
    read: (query: Parameters<ReturnType<typeof meta>['query']>[0]) =>
      meta(env).query(query),
    apply: (entities: Bundle[]) => meta(env).apply(entities, KERNEL),
  }
  let blobs = r2RawObjects(env.BLOBS)
  return purge
    ? purgedPrefix(ledger, blobs, prefix)
    : retiringPrefix(ledger, blobs, prefix, owner)
}

// App-owned bytes stay beneath the space's handle across address changes.
let under = (space: Space, app?: App) =>
  app ? `${ownedPrefix(space, app)}/` : `${space.store}/`

// A visitor's store gone (@yaks/platform/visits): what it saved, its uploads,
// and the record on its browser's edge that sent them there, last, so a purge
// that dies halfway remains available for an explicit retry. Their next write
// at the app starts a store afresh from its sample.
export let unvisited = async (
  env: Env,
  { eid, visit }: Given,
  purge = false,
) => {
  if (purge) {
    await purgeParts(r2RawObjects(env.BLOBS), env.BLOBS, {
      prefix: visit.blobs,
      ledger: uploadPrefix(visit.blobs),
    })
  }
  await cleared(env, visit.store)
  // Only ever a visitor's own prefix: an empty one would be the whole bucket.
  if (visit.blobs.startsWith(VISITS) && visit.blobs != VISITS) {
    await swept(env, visit.blobs, eid, purge)
    await swept(env, uploadPrefix(visit.blobs), eid, purge)
  }
  await meta(env).apply([{ entity: { eid }, visit: null }], KERNEL)
}

// One app's storage emptied — its bytes, the worker script that answers for
// it, and the store that holds what it saved. Everything but the row, which
// is the caller's to bury after confirmed purge; a space's death cascades to
// it. Answers the file paths the editor saw before erasure, so
// the caller can say how many files a person wrote.
export let emptied = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  purge = false,
) => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let files = own(await holding(r2RawObjects(env.BLOBS), dir, app))
  if (purge) {
    await purgeParts(r2RawObjects(env.BLOBS), env.BLOBS, {
      prefix: blobPrefix(space, app),
      ledger: uploadPrefix(blobPrefix(space, app)),
    })
  }
  // The app's own code, which is not in the bucket: a script left in the
  // dispatch namespace would still answer at an address nothing stands at.
  if (env.CF_WORKERS_TOKEN) {
    if (app.script) await drop(env, app.script, true)
    await drop(env, storeName(space, app), true)
    for (let v of await versions(dir, app)) {
      if (v.script && v.script != app.script) await drop(env, v.script, true)
    }
    await drop(env, `app-${app.eid}-r-${(app.version ?? 0) + 1}`, true)
  }
  await deleteBindings(env, app)
  await swept(env, under(space, app), app.eid, purge)
  // Uploads beside its files went with them; a store it was given at
  // adoption keeps its uploads where the store was born.
  if (!blobPrefix(space, app).startsWith(under(space, app))) {
    await swept(env, blobPrefix(space, app), app.eid, purge)
  }
  await swept(env, `${space.store}/.releases/${app.eid}/`, app.eid, purge)
  await swept(env, `${space.store}/.declarations/${app.eid}/`, app.eid, purge)
  await swept(env, receiptPrefix(app), app.eid, purge)
  await swept(env, uploadPrefix(blobPrefix(space, app)), app.eid, purge)
  // The store is named for where the app was born (directory.ts storeName),
  // so emptying it is what keeps a later app at the same address from waking
  // up in this one's graph.
  let r = await storeOf(env.STORE, storeName(space, app))('/', {
    method: 'DELETE',
  }, { ...vouched(who), 'x-yak-kernel': '1' })
  if (!r.ok) throw new Error(await r.text())
  await r.body?.cancel()
  if (app.demo) await cleared(env, app.demo.store)
  for (let given of await visits(ledgerOf(env), { app: app.eid })) {
    await unvisited(env, given, purge)
  }
  return files
}

// A confirmed purge also removes recoverable copies of the rows it buried.
let purgedRows = (dir: Directory, rows: Bundle[], eids: string[] = []) =>
  dir.purgeTrashEntities([
    ...new Set([
      ...eids,
      ...rows.filter(dead).map((b) => b.entity.eid),
    ]),
  ])

// The act. Everything outside the directory first, the space row last; what
// it answers is what the person is told went.
export let erase = async (
  env: Env,
  dir: Directory,
  d: Doomed,
  who: Who,
  _now = Date.now(),
) => {
  let no = await refused(d.space, env)
  if (no) throw refuse('access', no)
  if (!d.space.trashed) {
    await trashSpace(env, dir, d.space, who)
    return { files: 0, apps: 0, hosts: 0, trashed: true }
  }
  // Cloudflare before anything else, and only if it can be reached: a domain
  // whose row we buried and whose custom hostname we did not is a billable
  // hostname nothing here remembers (T-33038 domain_detach holds the same
  // order for one domain).
  if (d.hosts.length) reachable(env)
  // Its numbers, each given back at the provider and then its row buried,
  // which its death would not take (directory-vocab.ts `phone_line`): a
  // number held past its space is billed every month with nobody to bill.
  for (let line of d.lines) await released(env, line)
  for (let host of d.hosts) {
    await release(env, host.name)
    await unmail(env, host.mail)
  }
  await purgeTunnel(env, dir, d.space, who)
  // And the mail domains at its subdomains, each one of the plan's.
  await unmailSpace(env, dir, d.space)
  let files = 0
  for (let app of d.apps) {
    files += (await emptied(env, d.space, app, who, true)).length
  }
  // And whatever else stands under the space's own name — bytes an app that
  // was deleted before this tool existed left behind, or a delete that died
  // halfway and is being finished now. The slug is about to be somebody
  // else's; this is the owner's confirmed permanent purge.
  await swept(env, under(d.space), d.space.eid, true)
  // What the space kept outside the graph, and therefore outside the cascade
  // below: the builder's conversation, in an object of its own keyed by the
  // eid (build.ts), and the container that conversation compiled things in
  // (sandbox.ts, same key). `/privacy` says both go with the space. Before the
  // row, like everything else here — a wipe that throws leaves the space still
  // named, and asking again finishes it, where the other order would leave a
  // transcript nothing points at and nobody can ask about again.
  await wiped(env, d.space.eid)
  await purgedAll(env, d.space)
  // The row that says the space exists. Its death cascades in the store to
  // every app, deploy, hostname and membership that named it (the platform
  // contract's `death = "cascade"`), so this one tombstone buries the
  // directory's whole record of the space — and frees the slug, which is
  // unique across the platform and now belongs to nobody.
  let gone = await dir.apply({
    entities: [{ entity: { eid: d.space.eid }, tombstone: {} }],
  }, vouched(who))
  await purgedRows(dir, gone, [
    d.space.eid,
    ...d.apps.map((a) => a.eid),
    ...d.hosts.map((h) => h.eid),
    ...d.lines.map((l) => l.eid),
  ])
  // Everyone who was in it just lost every view its apps declared
  // (declared.ts, T-33004) — the same move being removed from a space makes.
  // A newcomer who was in it now holds nothing, and goes with it.
  for (let m of d.members) {
    await reachChanged(env, m.person)
    await vacated(env, dir, m.person, who)
  }
  return { files, apps: d.apps.length, hosts: d.hosts.length }
}

// What went, as a sentence: the same summary the page and the tool answer
// both say back.
export let went = (
  d: Doomed,
  out: { files: number; apps: number; hosts: number; trashed?: boolean },
  env: HostEnv = {},
) =>
  out.trashed
    ? kept(d, env)
    : `${d.space.slug}.${apex(env)} is gone: ${out.apps} ${
      out.apps == 1 ? 'app' : 'apps'
    }, ${out.files} ${out.files == 1 ? 'file' : 'files'}, everything they ` +
      `saved${
        out.hosts
          ? `, ${out.hosts} ${out.hosts == 1 ? 'domain' : 'domains'} given back`
          : ''
      }. The address is free for somebody else to take.`

// ---- the trash: deleted, and brought back (T-34430, T-34431) ----
//
// Jeff, 2026-09-05: "can deleted apps be brought back if done by mistake?" —
// "there should be a grace period. like a 30 day trash". His 2026-11-18
// direction keeps trash until the owner chooses to purge it. `app_delete`
// keeps everything and writes one word on the app row (vocab.ts `trashed`),
// and every reader of an app asks it: the web serves nothing, the roster
// drops its tools and views, the front page is not it, its mail bounces, and
// its store fires none of its wakes (graph.ts `tick`).
// Nothing is copied anywhere and nothing is moved — which is what makes
// `app_restore` exact rather than approximate.
//
// A space wears the same word one row up (T-34431), and the readers that ask
// an app ask its space first: every hostname of a trashed space answers the
// platform's 404, every app in it leaves every roster at once, its mail
// bounces and its slug is held. One mark rather than a mark per app, because
// a restore has to put the space back exactly as it was — including which of
// its apps were already in the trash of their own.
//
// A trashed app frees its owner-scoped slug. Space addresses and shared
// names remain held so restoration cannot give a person's address away.

// What an app's coming or going does to everyone's resource list (T-33004): a
// trashed app's views leave it and a restored one's rejoin it, so both ask the
// same question of its store — did any command of its own draw in a page — and
// the space is told only when one did.
//
// The tool list is not asked about any more (T-34541): an app's commands live
// inside `command`, which is there whether or not the app is, so nothing an
// app does moves a tool name.
export let rostered = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
) => {
  let had = await toolsOf(env, space, app)
  if (Object.values(had).some((t) => t.view)) {
    await viewsMoved({ env, dir }, space)
  }
}

// The word on, or off. `trashed: {}` is the ask, and the store dates it and
// signs it (trash.ts, the `trashed` rule) the way it dates a birth — so a
// caller never carries a clock. `trashed: null` drops the whole component,
// which is the whole of a restore — every other word the row wears was never
// touched, and that is what makes a restore exact rather than a rebuild.
let mark = (
  dir: Directory,
  eid: string,
  who: Who,
  trashed: Record<string, never> | null,
  declarations: Bundle[] = [],
) =>
  dir.stamp({
    entities: [{ entity: { eid }, trashed }, ...declarations],
  }, vouched(who))

/** A released number uses the same trash mark and sweep as apps. */
export let trashNumber = (
  dir: Directory,
  line: PhoneLine,
  who: Who,
) => line.trashed ? Promise.resolve() : mark(dir, line.eid, who, {})

/** Restore the held number at its retained assignment. */
export let untrashNumber = (dir: Directory, line: PhoneLine, who: Who) =>
  mark(dir, line.eid, who, null)

// A use must outlive its home. Prepare replacement declarations before the
// home leaves reach, then select them beside the delete in one directory
// write. Only declarations move: the deleted app's rows stay in its store for
// restoration, and its kept files and published versions stay untouched.
let rehomed = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
): Promise<Bundle[]> => {
  if (sandboxed(app)) return []
  let home = await declarationOf(env, space, app)
  // An app with no component declarations cannot be anyone's vocabulary
  // home. Check its release metadata before waking stores to find borrowers.
  if (!componentsOf([home.vocab]).length) return []
  let peers = ranked(await dir.apps(space)).filter((one) =>
    one.eid != app.eid && !one.trashed && !sandboxed(one) && one.version
  )
  let users = await Promise.all(peers.map(async (one) => {
    let uses = await appStore(env.STORE, space, one).consume(
      '/uses',
      async (r) => {
        if (!r.ok) throw await answered(r)
        return await r.json() as Record<string, string>
      },
    )
    return { app: one, uses }
  }))
  users = users.filter(({ uses }) => Object.values(uses).includes(app.slug))
  if (!users.length) return []
  let homes: Record<string, string> = {}
  let patches: Bundle[] = [{
    entity: { eid: app.eid },
    $was: {
      app: {
        declaration: token(app.declaration),
        source: token(app.source),
      },
    },
  }]
  for (let { app: one, uses } of users) {
    let declaration = await declarationOf(env, space, one)
    let defs = { ...declaration.vocab.$defs }
    for (let [name, slug] of Object.entries(uses)) {
      if (slug != app.slug) continue
      let at = homes[name] ??= one.slug
      if (at == one.slug) {
        let schema = home.vocab.$defs?.[name]
        if (!schema) {
          throw new Error(`${app.slug} has no declaration for ${name}`)
        }
        defs[name] = schema
        delete uses[name]
      } else uses[name] = at
    }
    let release = crypto.randomUUID()
    let draft = draftStore(env.STORE, space, one, release)
    let slot = (path: string, value: unknown) =>
      draft.consume(
        path,
        async (r) => {
          if (!r.ok) throw await answered(r)
          return await r.json()
        },
        { method: 'POST', body: JSON.stringify(value) },
        vouched(who),
      )
    await slot('/vocab', { ...declaration.vocab, $defs: defs })
    await slot('/uses', uses)
    await keepDeclaration(env, space, one, release, {
      ...declaration,
      vocab: await draft.consume('/vocab', async (r) => {
        if (!r.ok) throw await answered(r)
        return await r.json()
      }),
    })
    patches.push({
      entity: { eid: one.eid },
      app: { declaration: release },
      $was: {
        app: {
          declaration: token(one.declaration),
          source: token(one.source),
        },
        trashed: { at: null },
      },
    })
  }
  return patches
}

// The bytes keep their identity; the address returns to the space immediately.
export let trash = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
) => {
  let declarations = await rehomed(env, dir, space, app, who)
  await mark(dir, app.eid, who, {}, [{
    entity: { eid: app.eid },
    app: { slug: null, files: ownedPrefix(space, app) },
    untrashed: null,
    former: addresses([
      app.slug,
      ...app.slugs.filter((slug) => slug != app.slug),
    ]),
  }, ...declarations])
  await viewsMoved({ env, dir }, space)
}

// And out of it. Both doors call this, the tool and the space page's form.
// `untrash` rather than `restore` because app_files already owns that word
// for putting an app's files back, and these are two different acts on the
// same app.
export let untrash = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
  slug?: string,
) => {
  let to = slug ?? app.slug
  if (!slug) {
    for (let n = 2;; n++) {
      let taken = await dir.app(space, to)
      if (!taken || taken.trashed || taken.eid == app.eid) break
      let suffix = `-${n}`
      to = app.slug.slice(0, 63 - suffix.length) + suffix
    }
  }
  let taken = await dir.app(space, to)
  if (taken && taken.eid != app.eid && !taken.trashed) {
    throw refuse(
      'conflict',
      `app ${to} exists in ${space.slug} — choose another slug`,
    )
  }
  if (taken?.trashed && taken.eid != app.eid) {
    await trash(env, dir, space, taken, who)
  }
  await mark(dir, app.eid, who, null, [{
    entity: { eid: app.eid },
    app: { slug: to, files: ownedPrefix(space, app) },
    untrashed: {},
    ...(app.home && await dir.home(space) ? { home: null } : {}),
    former: addresses(
      (await dir.apps(space))
        .filter((one) => !one.trashed && one.eid != app.eid)
        .reduce(
          (slugs, one) =>
            slugs.filter((s) => s != one.slug && !one.slugs.includes(s)),
          app.slugs.filter((s) => s != to),
        ),
    ),
  }, ...await dir.claimApp(space, to, app.eid)])
  await woken(env, [app])
  let restored = { ...app, slug: to, trashed: null }
  await rostered(env, dir, space, restored)
  return restored
}

/** The words a restored app declares that another app serving in its space
 * homes too, by that app's slug: taken while this one was in the trash, they
 * stay that app's for the space (directory.ts `ranked`), and the restored app
 * keeps its own for its own pages and rows. */
export let sharedWords = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
): Promise<Record<string, string[]>> => {
  if (sandboxed(app)) return {}
  let mine = Object.keys(
    (await declarationOf(env, space, app)).vocab.$defs ?? {},
  )
  if (!mine.length) return {}
  let peers = ranked(await dir.apps(space)).filter((one) =>
    one.eid != app.eid && !one.trashed && !sandboxed(one) && one.version
  )
  let by: Record<string, string[]> = {}
  let left = new Set(mine)
  for (let one of peers) {
    let defs = (await declarationOf(env, space, one)).vocab.$defs ?? {}
    let theirs = [...left].filter((name) => name in defs)
    for (let name of theirs) left.delete(name)
    if (theirs.length) by[one.slug] = theirs
  }
  return by
}

/** A restore tells its caller which of its words another app homes now. */
export let restoredWords = (app: string, by: Record<string, string[]>) =>
  Object.entries(by).map(([at, names]) => {
    let words = names.join(', ')
    return ` ${words} ${names.length == 1 ? 'is' : 'are'} also ${at}'s, ` +
      `declared there while ${app} was in the trash: ${app}'s pages keep ` +
      `their own ${words}, and the rest of the space uses ${at}'s.`
  }).join('')

/** A restore tells the person when its address changed. */
export let restoredAddress = (previous: string, slug: string) =>
  previous == slug
    ? ''
    : ` Its previous address was /${previous}/; it is now /${slug}/.`

// A restore answers once its stores are awake. The mark alone leaves each one
// asleep until the directory's effect delivers it (trash.ts `delivered`), and
// meanwhile the directory names the app while its store answers a page or a
// letter that it is in the trash. The effect still runs, and stays the
// delivery that cannot be lost: one that fails here is reported and left to
// it.
let woken = async (env: Env, apps: App[]) => {
  let rows: Rows = {
    get: (eids) =>
      meta(env).query(
        // A tree printed, every eid written as `parse` reads it back.
        whole(stringify(and(eq('entity.eid', list(...eids)), every()))),
        {
          trusted: true,
        },
      ),
  }
  for (let app of apps) {
    await delivered(env.STORE, rows, app.eid)
      .catch((why) => caught(why, { request: 'wake a restored store' }))
  }
}

// Everyone in the space, told their reach moved (declared.ts, T-33004) — the
// same news being added to or removed from a space makes, because that is
// exactly what happened to them: every view every app here declared appeared
// or went. Not `rostered`, which asks one app's store what it declares: the
// whole space went, so nothing is asked and everybody is told.
let reachMoved = async (env: Env, dir: Directory, space: Space) => {
  for (let person of await dir.members(space)) await reachChanged(env, person)
}

// A whole space into the trash, and out of it: the one word on the space row,
// and everyone in it told their views moved. The apps are not touched — not
// their marks, not their stores, not their bytes — so a space that comes back
// comes back with the same apps in the same states it had (`space_restore`,
// tools.ts).
export let trashSpace = async (
  env: Env,
  dir: Directory,
  space: Space,
  who: Who,
) => {
  await mark(dir, space.eid, who, {})
  await reachMoved(env, dir, space)
}

export let untrashSpace = async (
  env: Env,
  dir: Directory,
  space: Space,
  who: Who,
) => {
  await mark(dir, space.eid, who, null)
  await woken(env, await dir.apps(space))
  await reachMoved(env, dir, space)
}

// What a space's trashing says back — `went`'s opposite number, and the same
// sentence on the confirmation page and in the answer the agent reads out, so
// nobody is told two different stories about where their space went.
export let kept = (d: Doomed, env: HostEnv = {}) =>
  `${d.space.slug}.${
    apex(env)
  } is in the trash. Nothing was erased: ${d.apps.length} ${
    d.apps.length == 1 ? 'app' : 'apps'
  }, their files and everything they ` +
  'saved are all kept, and the address is held. Restore it any time — ' +
  `signed in at https://${d.space.slug}.${apex(env)}/, or ` +
  `space_restore(space: '${d.space.slug}'). Only your separate confirmation ` +
  'can erase it from the trash.'

// One app gone for good: its storage (`emptied` above, the same call a
// space's death makes), then the row that says the app exists — that order,
// because the row is the app. Answers how many of the keys were files a
// person wrote rather than bytes a version pinned (@yaks/platform/versions `own`), which
// is what a delete says back.
export let erased = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
) => {
  let declarations = await rehomed(env, dir, space, app, who)
  if (declarations.length) {
    await dir.stamp({ entities: declarations }, vouched(who))
  }
  let files = await emptied(env, space, app, who, true)
  let gone = await dir.apply({
    entities: [{ entity: { eid: app.eid }, tombstone: {} }],
  }, vouched(who))
  await purgedRows(dir, gone, [app.eid])
  return files.length
}

// Kept at this public seam for callers that describe the trash schedule.
export { DAILY } from './trash.ts'

// The daily sweep only puts abandoned spaces in the trash. Time passing is
// never permission to purge: apps, spaces, held numbers, visitor stores and
// test accounts stay recoverable until their owner chooses permanent erasure.
let retitled = async (
  dir: Directory,
  rows: { eid: string; title: string }[],
) => {
  let entities = rows.filter((r) => r.title != clamped(r.title))
    .map((r) => ({ entity: { eid: r.eid }, doc: { title: clamped(r.title) } }))
  if (entities.length) await dir.apply({ entities })
}

/** Trash abandoned spaces, retaining every existing trash entry and its
 * shared names. Answers how many spaces moved, or `MORE` between pieces. */
export let collected = async (
  env: Env,
  now = new Date(),
  spent: () => boolean = () => false,
): Promise<number | typeof MORE> => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let gone = 0
  let more = () => {
    if (gone) console.log(`yak-trash: ${gone} trashed, and more to do`)
    return MORE
  }
  // A newcomer's budget is a month's (newcomer.ts `KEEPING`): trashed, the
  // space spends nothing in the next one, and each one on its own, so one
  // that will not go holds up none of the rest. Only spaces still out of the
  // trash are read: one already in it is owed nothing more.
  for (let { person, spaces } of await unkept(env, dir, now)) {
    if (spent()) return more()
    let who = { person, role: 'owner' as const }
    for (let space of spaces) {
      if (spent()) return more()
      await trashSpace(env, dir, space, who)
        .then(() => gone++)
        .catch((why) => caught(why, { request: 'trash an unkept space' }))
    }
  }
  let spaces = await dir.all()
  let idle = new Set(await abandoned(env, now))
  for (let space of spaces) {
    // Never the directory itself, whatever its row says: the app that holds
    // every space on the platform is not one a sweep may erase (`refused`
    // above and tools.ts app_delete hold the same line at the doors).
    if (!idle.has(space.eid) || PROTECTED.has(space.slug)) continue
    if (spent()) return more()
    // Other requests can write while an external read yields. Read the
    // present again before moving an abandoned space to the trash.
    if (!(await abandoned(env, now, space.eid)).includes(space.eid)) continue
    let d = await doomed(dir, space)
    if (
      !await refused(space, env) && await nobodys(dir, d) &&
      !d.apps.some((a) => a.published)
    ) {
      await trashSpace(env, dir, space, {
        person: d.members[0]?.person ?? null,
        role: 'owner',
      })
      gone++
    }
  }
  if (spent()) return more()
  // Trashed apps retain their files and versions alongside active apps.
  let apps = await dir.apps(spaces)
  await retitled(dir, [...spaces, ...apps])
  let of = new Map(spaces.map((s) => [s.eid, s]))
  let standing: Pinner[] = apps.flatMap((app) => {
    let space = of.get(app.space)
    return space ? [{ prefix: under(space, app), app }] : []
  })
  // And then what those apps are still holding on to: the bytes a write or a
  // deploy pinned that nothing names any more (written.ts `pruned`, T-34508).
  // It rides here rather than on every write because the rule needs to see the
  // whole bucket at once, and rather than only on a deploy because an app that
  // stopped deploying would then keep its pins forever.
  let unpinned = await pruned(
    dir,
    r2RawObjects(env.BLOBS),
    standing,
    now.getTime(),
    (keys) =>
      retiring(
        {
          read: (query) => meta(env).query(query),
          apply: (entities) => meta(env).apply(entities, KERNEL),
        },
        keys,
        now.getTime(),
      ),
  )
  if (gone) console.log(`yak-trash: ${gone} trashed at ${now.toISOString()}`)
  if (unpinned) console.log(`yak-trash: ${unpinned} pinned blobs let go`)
  return gone
}

// ---- an account's end ----
//
// Test accounts use the same retained trash as their spaces. Revoking their
// credentials happens only during an explicit permanent purge.
export type Closing = {
  person: string
  trashed: boolean
  /** The account remains in trash until its owner confirms a purge. */
  pending?: boolean
  /** The account as it was named: its address, or its eid. */
  address: string
  spaces: Space[]
  seats: Space[]
  /** The seat each kept space's ownership passes to. */
  heirs: { space: Space; seat: string }[]
}

// An account is named by its address, or by its eid when its row has none: a
// person a credential wrote back after their erase is a bare `person{}`
// (T-147822). Such a row is nobody who signs in, so it is as expendable as a
// test account, unless it has a number or is a newcomer still building.
let accountRow = async (env: Env, named: string) => {
  let [row] = await meta(env).query(
    minted(named)
      ? line`.entity.eid=${named}&.person ?email ?phone ?newcomer ?trashed`
      : line`.person&.email.address=${named} ?trashed`,
  ) as unknown as DirRow[]
  return row ?? null
}

let account = async (env: Env, named: string) => {
  let row = await accountRow(env, named)
  if (!row) return null
  let address = row.email?.address
  let spent = address ? expendable(address) : !row.phone && !row.newcomer
  if (!spent) {
    throw refuse(
      'access',
      `${named} is not an expendable test account: only those are erased here`,
    )
  }
  return row
}

export let closing = async (
  env: Env,
  dir: Directory,
  address: string,
): Promise<Closing | null> => {
  let row = await accountRow(env, address)
  if (!row) return null
  let person = row.entity.eid
  let out: Closing = {
    person,
    address,
    trashed: !!row.trashed,
    spaces: [],
    seats: [],
    heirs: [],
  }
  for (let { space } of await dir.seated(person)) {
    if ((await dir.owners(space)).some((p) => p != person)) {
      out.seats.push(space)
      continue
    }
    let left = (await dir.members(space)).filter((p) => p != person)
    let people = []
    for (let p of left) {
      if (!isTestAddress(await dir.emailAt(p) ?? '')) people.push(p)
    }
    if (!people.length && !PROTECTED.has(space.slug)) {
      out.spaces.push(space)
      continue
    }
    let heir = people[0] ?? left[0]
    if (!heir) {
      throw refuse(
        'conflict',
        `${address} is the only one in ${space.slug}, which the platform ` +
          'keeps: seat its fixture there first',
      )
    }
    out.seats.push(space)
    out.heirs.push({ space, seat: (await dir.member(space, heir))!.eid })
  }
  return out
}

// The row last, so an erase that dies halfway is finished by asking again.
export let closed = async (
  env: Env,
  dir: Directory,
  address: string,
  who: Who,
) => {
  if (!await account(env, address)) return null
  let c = (await closing(env, dir, address))!
  for (let space of c.spaces) {
    if (!space.trashed) await trashSpace(env, dir, space, who)
  }
  await mark(dir, c.person, who, {})
  return { ...c, pending: true }
}

/** Restore the account record; its owner can restore each space separately. */
export let untrashAccount = (dir: Directory, person: string, who: Who) =>
  mark(dir, person, who, null)

export let trashedAccount: Kind<Closing> = {
  kind: 'account',
  find: async (dir, space, target, env) =>
    space.slug == META.space && await account(env, target)
      ? await closing(env, dir, target)
      : null,
  typed: (c) => c.address,
  title: (c) => `Erase ${c.address} from the trash?`,
  until: () =>
    'The account and its saved work remain in the trash until restored or purged.',
  stop: (c) => c.trashed ? '' : 'Move the account to the trash first.',
  lines: (
    _space,
    c,
  ) => [
    c.address,
    ...c.spaces.map((s) => `${s.slug}: its apps and everything saved`),
  ],
  press: () => 'Erase account forever',
  act: async (env, dir, _space, c, who) => {
    for (let space of c.spaces) {
      let out = await erase(env, dir, await doomed(dir, space), who)
      if (out.trashed) {
        return 'Newly owned spaces moved to trash. Confirm the account purge separately.'
      }
    }
    if (c.heirs.length) {
      await dir.stamp({
        entities: c.heirs.map(({ seat }) => ({
          entity: { eid: seat },
          member: { role: 'owner' },
        })),
      }, vouched(who))
    }
    await buried(env, dir, c.person, who)
    return `${c.address} is erased from the trash.`
  },
}

// A person gone: their credentials before their row, so none of them can
// write the row back, then the row, whose death cascades to every seat,
// grant and invite naming them, then the stores their browsers were given
// and they never installed, which nobody else can reach.
let buried = async (env: Env, dir: Directory, person: string, who: Who) => {
  let held = await dir.read(
    line`(.browser_session.person=${person} | .oauth_grant.person=${person} | .grant.person=${person})`,
  )
  let { unheld } = await import('./identity.ts')
  await unheld(env, person)
  let gone = await dir.stamp({
    entities: [{ entity: { eid: person }, tombstone: {} }],
  }, vouched(who))
  await purgedRows(dir, gone, [person, ...held.map((b) => b.entity.eid)])
  for (let given of await visits(ledgerOf(env), { by: person })) {
    await unvisited(env, given, true)
  }
}

/**
 * A newcomer (newcomer.ts) who holds nothing any more goes, as a closed
 * account does: once keeping moved their seats to whoever signed in
 * (newcomer.ts `keep`), or once their space was erased (`erase`). So the
 * daily sweep (newcomer.ts `unkept`) reads only newcomers still building.
 * Anybody else, or a newcomer with a seat left, is left alone.
 */
export let vacated = async (
  _env: Env,
  dir: Directory,
  person: string,
  who: Who,
) => {
  if (!await dir.newcomer(person) || (await dir.seated(person)).length) return
  await mark(dir, person, who, {})
}

// No app store is woken by the preview. A file write is a `written` row, which
// keeps the edit's own time and author whoever stamped the row. Asked about
// one space, it reads only what that space holds.
export let abandoned = async (env: Env, now = new Date(), only?: string) => {
  let read = (q: Line) => meta(env).query(q) as unknown as Promise<Row[]>
  let rows = only ? await censusOf(read, only) : await read(CENSUS)
  let eligible = new Set(idleSpaces(rows, now.getTime()))
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let spaces = only ? [await dir.at(only)] : await dir.all()
  let result: string[] = []
  for (let space of spaces) {
    if (!space || !eligible.has(space.eid) || await refused(space, env)) {
      continue
    }
    // Directory references carry their creation and use clocks: memory,
    // connections, deploys, space or app hostnames, invitations and reports.
    // Ask generically so a new space-owned record needs no cleanup whitelist.
    let apps = rows.filter((r) => r.app && idOf(r.app.space) == space.eid)
    let refs = [space.eid, ...apps.map((app) => app.entity.eid)]
    let used = false
    // Plus spaces have no app ceiling; each read must stay under the
    // directory's parameter and SQL statement-size limits.
    for (let i = 0; i < refs.length && !used; i += 5) {
      let writes = await meta(env).query(
        line`(${
          sub(
            joined(refs.slice(i, i + 5).map((eid) => line`.refs=${eid}`), '|'),
          )
        }) ?created ?used ?written`,
      ) as unknown as Row[]
      used = !inactive(
        writes.filter((row) =>
          row.used || row.created?.by || row.created?.via || row.written?.by
        ),
        now.getTime(),
      )
    }
    if (!used) result.push(space.eid)
  }
  return result
}
