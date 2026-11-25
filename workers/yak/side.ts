// What the person's own pages draw, read from the directory: the sidebar's
// spaces and apps (@yaks/platform/side-rows), their account, browsers and
// friends (@yaks/platform/account-rows), and the apps a space's Apps page
// lists (@yaks/platform/space-apps). A page asks it as it is drawn
// (manage.ts `beside`), and the directory answers the same as a live read of
// the person (graph.ts `/person/ws`), so the side the page drew and the one
// its rows redraw agree.
import {
  ALERTING,
  alertingRow,
  type Channel,
  TEXTING,
  textingRows,
} from '@yaks/platform/operator-settings'
import { routeOf } from './operator-alerts.ts'
import { writes } from '@yaks/member'
import type { Bundle } from '@yaks/graph'
import { logoPath } from '@yaks/platform/routes'
import {
  appRows,
  appsOf,
  appsSpace,
  type Picked,
  SIDE_SPACES,
  sideApps as appsLine,
  spaceRows,
} from '@yaks/platform/side-rows'
import type { Env } from './env.ts'
import { visitRows } from './views.ts'
import { type Directory, type Space, walkTo } from './directory.ts'
import { type Listed, listedRows, listedSpace } from '@yaks/platform/space-apps'
import { pilled, standing } from './gallery-row.ts'
import {
  ACCOUNT,
  accountRow,
  friendRows,
  FRIENDS,
  SIGNED_IN,
  signedInRows,
} from '@yaks/platform/account-rows'
import { friendList } from './friends.ts'
import { offerRows, offersSpace } from '@yaks/platform/update-rows'
import { offersIn } from './updates.ts'
import { shelf } from './apps.ts'
import { kernels } from '@yaks/platform/ladder'
import type { Who } from './session.ts'

// The apps of other people's spaces this person may open (T-124081): each app
// of a space they hold a seat in and do not own, and each app they are a guest
// of. What is in the trash opens onto nothing, so it is left out, and an app
// of a space they own is on that space's own page.
export let shared = async (
  dir: Directory,
  person: string,
) => {
  let [seats, granted] = await Promise.all([
    dir.seats(person),
    dir.granted(person),
  ])
  let owned = new Set(
    seats.filter((s) => s.role == 'owner').map((s) => s.space.eid),
  )
  let spaces = seats.map((s) => s.space)
    .filter((s) => !owned.has(s.eid) && !s.trashed)
  let seated = (await dir.apps(spaces)).map((app) => ({
    space: spaces.find((s) => s.eid == app.space)!,
    app,
  }))
  // One row an app, however it was shared: a seat and a grant can both
  // reach it.
  let each = new Map([...seated, ...granted].map((g) => [g.app.eid, g]))
  return [...each.values()]
    .filter(({ space, app }) =>
      !owned.has(space.eid) && !space.trashed && !app.trashed &&
      !kernels(space.slug, app.slug)
    )
    .map(({ space, app }) => ({
      eid: app.eid,
      slug: app.slug,
      title: app.title,
      space: space.slug,
    }))
}

// The spaces the side's selector offers: every one this person may work in,
// the platform's own `yak` among them for its owners, as the admin's
// directory lists their seats, the one they open first at the top, then
// those they own, then those they are a member of, each named by whose it
// is: every owner's name in one read.
export let pickable = async (
  dir: Directory,
  person: string,
): Promise<(Picked & { eid: string })[]> => {
  let kept = (await dir.seated(person)).filter((s) =>
    !s.space.trashed && writes(s.role)
  )
    .sort((a, b) =>
      Number(b.own) - Number(a.own) ||
      Number(b.role == 'owner') - Number(a.role == 'owner')
    )
  let names = await dir.persons([
    ...new Set(
      kept.flatMap((s) => s.role != 'owner' && s.owner ? [s.owner] : []),
    ),
  ])
  return kept.map((s) => ({
    eid: s.space.eid,
    slug: s.space.slug,
    title: s.space.title,
    owner: s.role == 'owner',
    own: s.own,
    whose: s.role == 'owner' ? undefined : names.get(s.owner!)?.name,
    operator: s.space.operator,
    logo: logoPath(s.space),
  }))
}

/** The apps of `space` that `who` may open from the side. */
export let sideApps = async (dir: Directory, space: Space, who: Who) =>
  shelf(await dir.apps(space), space, who).mine.map((
    { eid, slug, title, source, generatedIcon },
  ) => ({ eid, slug, title, source, generatedIcon }))

/** The rows `line` asks of the person: their account, browsers, friends,
 * what the directory holds for them in a space, or the side's; none for a
 * space they hold no seat in that lets them change it. */
export let personRows = async (
  dir: Directory,
  person: string,
  line: string,
): Promise<Bundle[]> => {
  if (line == ACCOUNT) {
    let [name, email, hidden] = await Promise.all([
      dir.nameAt(person),
      dir.emailAt(person),
      dir.presenceHidden(person),
    ])
    return [accountRow(person, {
      name: name ?? '',
      email: email ?? '',
      hidden,
    })]
  }
  if (line == SIGNED_IN) {
    return signedInRows(await dir.browserSessions(person))
  }
  if (line == ALERTING) {
    let [channel, texting, email, pushes] = await Promise.all([
      dir.alerts(person),
      dir.texting(person),
      dir.emailAt(person),
      dir.pushes(person),
    ])
    return [alertingRow(person, {
      channel,
      by: routeOf(channel, texting, email, pushes)?.by as Channel ?? 'updates',
      browsers: pushes.length,
    })]
  }
  if (line == TEXTING) return textingRows(person, await dir.texting(person))
  if (line == FRIENDS) {
    let all = await shared(dir, person)
    return friendRows(person, await friendList(dir, person, all))
  }
  return await sideRows(dir, person, line)
}

/** What the Visits page of the space `eid` is drawn from: its apps as the
 * side lists them to `person`, and their views from Cloudflare's analytics
 * (@yaks/platform/visit-counts), which no store holds. None for a space they
 * hold no seat in that lets them change it. */
export let visitsRows = async (
  env: Env,
  dir: Directory,
  person: string,
  eid: string,
): Promise<{ apps: Bundle[]; counts: Bundle[] }> => {
  let apps = await personRows(dir, person, appsLine(eid))
  let counts = await visitRows(env, eid, appsOf(apps, eid).map((a) => a.eid))
  return { apps, counts }
}

/** The apps of `space` its Apps page lists for `who`, each with when it was
 * made and last deployed, and by whom, as the page draws them. */
export let listedApps = async (
  dir: Directory,
  space: Space,
  who: Who,
): Promise<Listed[]> => {
  let [{ all }, made] = await Promise.all([
    dir.apps(space).then((apps) => shelf(apps, space, who)),
    dir.provenance(walkTo(space.slug, space.eid)),
  ])
  let named = (s?: { at: string; by: string | null } | null) =>
    s &&
    {
      ...s,
      ...s.by && made.writers.has(s.by) ? { name: made.writers.get(s.by) } : {},
    }
  return all.map((a) => ({
    eid: a.eid,
    slug: a.slug,
    title: a.title,
    source: a.source,
    generatedIcon: a.generatedIcon,
    home: a.home || undefined,
    access: a.access,
    gallery: pilled(standing(a)) || undefined,
    made: named(made.of.get(a.eid)?.made),
    deployed: named(made.of.get(a.eid)?.deployed),
  }))
}

let sideRows = async (
  dir: Directory,
  person: string,
  line: string,
): Promise<Bundle[]> => {
  if (line == SIDE_SPACES) return spaceRows(person, await pickable(dir, person))
  let apps = appsSpace(line)
  let offers = offersSpace(line)
  let listed = listedSpace(line)
  let eid = apps ?? offers ?? listed
  if (!eid) return []
  let seat = (await dir.seated(person)).find((s) =>
    s.space.eid == eid && !s.space.trashed && writes(s.role)
  )
  if (!seat) return []
  let { space, role } = seat
  let who = { person, role }
  if (listed) return listedRows(person, eid, await listedApps(dir, space, who))
  return apps
    ? appRows(person, eid, await sideApps(dir, space, who))
    : offerRows(person, eid, await offersIn(dir, space, who))
}
