// What a space's Settings, Domains and Trash pages draw and write
// (@yaks/platform/space-pages), behind the page graph's door: each line read
// for the space's owner, as the directory answers it live (graph.ts
// `/person/ws`) and the server draws the page's first paint from (manage.ts
// `desk`), and each write done as them, answered with what it came to. A
// domain search's offers are the registrar's, read by the door
// (reach-door.ts).
import type { Bundle } from '@yaks/graph'
import { Refused, Stale } from '@yaks/graph/errors'
import { shown } from '@yaks/phone'
import { paid } from '@yaks/platform/plans'
import { logoPath } from '@yaks/platform/routes'
import {
  type Binned,
  binnedRows,
  domainRows,
  offerRows,
  settingsRow,
  type SettingsWrite,
  spaceDomains,
  spaceLine,
  spaceSettings,
  spaceTrash,
} from '@yaks/platform/space-pages'
import type { Held, SpacePage } from '@yaks/platform/space-pages-view'
import { sideApps } from '@yaks/platform/side-rows'
import { CallError } from '@yaks/tools/errors'
import { shelf } from './apps.ts'
import { offerDomain } from './app-transfer.ts'
import { caught } from './defects.ts'
import { type Directory, type Space, walkTo } from './directory.ts'
import { chooseDomain } from './domain-renewal.ts'
import { domainOffers, included, ownedDomains, pointDomain } from './domains.ts'
import type { Env } from './env.ts'
import { restoredAddress, untrash } from './erase.ts'
import { sentence } from './html.ts'
import { logoed } from './logo.ts'
import { restoredNumber } from './number-trash.ts'
import { dollars } from './numbers.ts'
import { vouched, type Who } from './session.ts'
import { personRows } from './side.ts'
import { admin } from './tool.ts'
import { TOOLS } from './tools.ts'

// The space `eid` and its owner `person`, when they own it or are the
// platform's admin; none, and its lines are answered with nothing.
let owned = async (dir: Directory, person: string, eid: string) => {
  let seats = await dir.seated(person)
  let seat = seats.find((s) => s.space.eid == eid && s.role == 'owner')
  if (seat) return { space: seat.space, who: { person, role: 'owner' } as Who }
  if (!await admin({ dir, person })) return undefined
  let space = await dir.at(eid)
  return space
    ? {
      space,
      who: { person, role: 'owner', administrative: true } as Who,
    }
    : undefined
}

/** The rows `line`, a line of a space's pages, asks of `person`. */
export let spaceRows = async (
  env: Env,
  dir: Directory,
  person: string,
  line: string,
): Promise<Bundle[]> => {
  let asked = spaceLine(line)
  if (!asked) return []
  let mine = await owned(dir, person, asked.space)
  return mine ? pageRows(env, dir, mine, asked.page) : []
}

// The rows of the space's `page`, for its owner.
let pageRows = async (
  env: Env,
  dir: Directory,
  { space, who }: { space: Space; who: Who },
  page: SpacePage,
): Promise<Bundle[]> => {
  // As the page's own reads ask them (manage.ts `desk`), so a page drawn
  // from these rows reads the directory once.
  let apps = await dir.apps(space)
  if (page == 'settings') {
    return [settingsRow(space.eid, {
      slug: space.slug,
      title: space.title,
      home: apps.find((a) => a.home && !a.trashed)?.slug ?? '',
      byline: !!space.byline,
      paying: paid(space.tier),
      included: included(space),
      logo: logoPath(space),
    })]
  }
  let { here, all } = shelf(apps, space, who)
  if (page == 'domains') {
    return domainRows(
      space.eid,
      await ownedDomains(env, dir, space, all),
    )
  }
  let lines = await dir.lines(walkTo(space.slug, space.eid))
  let binned: Binned[] = [
    ...here.filter((a) => a.trashed).map((a) => ({
      item: a.eid,
      kind: 'app' as const,
      name: a.title || a.slug,
    })),
    ...lines.filter((l) => l.trashed).map((l) => ({
      item: l.eid,
      kind: 'number' as const,
      name: shown(l.number),
      monthly: dollars(l.monthly),
    })),
  ]
  return binnedRows(space.eid, binned)
}

/** What a space's `page` is drawn from for `person`, by line, and the
 * domains searched for, `query`, on Domains. */
export let spaceHeld = async (
  env: Env,
  dir: Directory,
  person: string,
  eid: string,
  page: SpacePage,
  query: string,
): Promise<Held> => {
  let searching = page == 'domains' && query ? query : undefined
  let [settings, apps, rows, offers] = await Promise.all([
    spaceRows(env, dir, person, spaceSettings(eid)),
    personRows(dir, person, sideApps(eid)),
    page == 'domains'
      ? spaceRows(env, dir, person, spaceDomains(eid))
      : page == 'trash'
      ? spaceRows(env, dir, person, spaceTrash(eid))
      : undefined,
    searching ? offersFor(env, searching) : undefined,
  ])
  return { settings, apps, page: rows, offers, query: searching }
}

/** The domains the registrar offers for `query`, as rows: none, and why,
 * when it could not be asked. */
export let offersFor = async (env: Env, query: string): Promise<Bundle[]> => {
  try {
    return offerRows(query, await domainOffers(env, query))
  } catch (e) {
    if (!(e instanceof CallError)) caught(e, { request: 'search for domains' })
    return offerRows(
      query,
      [],
      'Domain search is unavailable right now. Try again shortly.',
    )
  }
}

// A refusal of what was asked, said as a sentence.
let refused = (e: unknown): never => {
  if (e instanceof Stale) {
    throw new CallError('arguments', 'This domain changed. Try again.')
  }
  if (e instanceof CallError || e instanceof Refused) {
    throw new CallError('arguments', sentence(e.message))
  }
  throw e
}

// A control on a page is the tool the person's assistant would call, called
// as the person, so the page and the assistant change a space one way.
let tool = (env: Env, dir: Directory, person: string) =>
(
  name: string,
  args: Record<string, unknown>,
) =>
  TOOLS.find((t) => t.name == name)!.run({ env, dir, person }, args)
    .catch(refused)

// The space's name and the line at the foot of its pages, what its address
// opens, its logo taken off, and last its address, since moving renames the
// space the homepage is written against.
let settle = async (
  env: Env,
  dir: Directory,
  space: Space,
  who: Who,
  set: SettingsWrite,
) => {
  let call = tool(env, dir, who.person!)
  // Its name and its line, in one call.
  let title = set.title?.trim()
  let named = title && title != space.title ? { title } : {}
  let lined = set.byline !== undefined && set.byline != !!space.byline
    ? { byline: set.byline }
    : {}
  if (Object.keys({ ...named, ...lined }).length) {
    await call('space_set', { space: space.slug, ...named, ...lined })
  }
  // The library is no app at all, so choosing it takes the word off the app
  // that has it.
  let now = set.home === undefined ? undefined : await dir.home(space)
  let app = set.home || now?.slug
  if (set.home !== undefined && set.home != (now?.slug ?? '') && app) {
    await call('app_set', { space: space.slug, app, home: !!set.home })
  }
  if (set.logo === null) await logoed(env, dir, space, null, vouched(who))
  let slug = set.slug?.trim().toLowerCase()
  if (slug && slug != space.slug) {
    let { choose } = await import('./identity.ts')
    let moved = await choose(env, who.person!, slug, space)
    if (moved.error) throw new CallError('arguments', moved.error)
  }
}

/** Do `bundles`, writes of the space `eid`'s pages, as `person` signed in as
 * `who`, answering the rows they moved and each act with what it came to. */
export let spaceApply = async (
  bundles: Bundle[],
  env: Env,
  dir: Directory,
  who: Who,
  person: string,
  eid: string,
): Promise<Bundle[]> => {
  let mine = await owned(dir, person, eid)
  if (!mine) {
    throw new CallError('access', 'Only the space’s owner changes this.')
  }
  let as = { ...who, ...mine.who, via: who.via } as Who
  let space = mine.space
  let moved = new Set<SpacePage>()
  let answered: Bundle[] = []
  let done = (b: Bundle, word: string, said: string) =>
    answered.push({
      ...b,
      [word]: { ...b[word] as Record<string, unknown>, said },
    })
  for (let b of bundles) {
    if (b.spaceSettings) {
      await settle(env, dir, space, as, b.spaceSettings as SettingsWrite)
      moved.add('settings')
    } else if (b.restoreBinned) {
      let { item } = b.restoreBinned as { item: string }
      let app = (await dir.apps(space)).find((a) => a.eid == item && a.trashed)
      let line = app
        ? undefined
        : (await dir.lines(space)).find((l) => l.eid == item && l.trashed)
      if (!app && !line) {
        throw new CallError('missing', 'That is no longer in the trash.')
      }
      let said = 'Restored.'
      if (app) {
        let restored = await untrash(env, dir, space, app, as).catch(refused)
        said = `Restored at /${restored.slug}/.` +
          restoredAddress(app.slug, restored.slug)
      } else await restoredNumber(env, dir, line!, as)
      moved.add('trash')
      done(b, 'restoreBinned', said)
    } else if (b.pointDomain) {
      let { name, destination = '' } = b.pointDomain as {
        name: string
        destination?: string
      }
      await pointDomain(env, dir, space, as, name, destination).catch(refused)
      moved.add('domains')
      done(b, 'pointDomain', 'Saved.')
    } else if (b.chooseDomain) {
      let { name } = b.chooseDomain as { name: string }
      await chooseDomain(dir, space, as, name).catch(refused)
      moved.add('domains')
      done(b, 'chooseDomain', 'Included domain saved.')
    } else if (b.offerDomain) {
      let { name, to } = b.offerDomain as { name: string; to: string }
      let said = await offerDomain(
        dir,
        space,
        as,
        name,
        to.trim().toLowerCase(),
      ).catch(refused)
      moved.add('domains')
      done(b, 'offerDomain', said)
    } else continue
    // As the write left it, for the next and for the rows answered.
    space = await dir.at(space.eid) ?? space
  }
  for (let page of moved) {
    answered.push(...await pageRows(env, dir, { space, who: mine.who }, page))
  }
  return answered
}
