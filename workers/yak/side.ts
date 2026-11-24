// What the sidebar draws, read from the directory (@yaks/platform/side-rows):
// the spaces the person may work in, as the side's selector offers them, and
// the apps of one of them they may open. A page asks it as it is drawn
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
import { shelf } from './apps.ts'
import type { Who } from './session.ts'

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

/** The rows `line` asks of the person's side, or none for a space they hold
 * no seat in that lets them change it. */
export let sideRows = async (
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
