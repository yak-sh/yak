// What the person's own pages draw, read from the directory: the sidebar's
// spaces and apps (@yaks/platform/side-rows), and their account and friends
// (@yaks/platform/account-rows). A page asks it as it is drawn
// (manage.ts `beside`), and the directory answers the same as a live read of
// the person (graph.ts `/person/ws`), so the side the page drew and the one
// its rows redraw agree.
import { writes } from '@yaks/member'
import type { Bundle } from '@yaks/graph'
import { logoPath } from '@yaks/platform/routes'
import {
  appRows,
  appsSpace,
  type Picked,
  SIDE_SPACES,
  spaceRows,
} from '@yaks/platform/side-rows'
import type { Directory, Space } from './directory.ts'
import {
  ACCOUNT,
  accountRow,
  friendRows,
  FRIENDS,
} from '@yaks/platform/account-rows'
import { friendList } from './friends.ts'
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

/** The rows `line` asks of the person: their account, their friends, or the
 * side's, none for a space they hold no seat in that lets them change it. */
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
  if (line == FRIENDS) {
    let all = await shared(dir, person)
    return friendRows(person, await friendList(dir, person, all))
  }
  return await sideRows(dir, person, line)
}

let sideRows = async (
  dir: Directory,
  person: string,
  line: string,
): Promise<Bundle[]> => {
  if (line == SIDE_SPACES) return spaceRows(person, await pickable(dir, person))
  let eid = appsSpace(line)
  if (!eid) return []
  let seat = (await dir.seated(person)).find((s) =>
    s.space.eid == eid && !s.space.trashed && writes(s.role)
  )
  if (!seat) return []
  let { space, role } = seat
  return appRows(person, eid, await sideApps(dir, space, { person, role }))
}
