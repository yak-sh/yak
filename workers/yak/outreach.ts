// The spaces an outreach trial writes to (@yaks/platform/outreach-trial,
// T-1712): what every space's Operator would email its people between visits,
// written in one batch and kept as rows on the admin's Letters page. Nothing
// is sent.
//
// Each Operator is told what the admin's directory shows of its space (admin.ts
// `uses`): its people, its apps and their use. Test spaces and the platform's
// own are left out, and so are the platform's own accounts' (admin, the demo
// space); everyone else is in, pilots included.
import type { Comp } from '@yaks/graph'
import type { Facts } from '@yaks/platform/outreach'
import { BOT } from '@yaks/platform/bots'
import { type Census, fieldsOf, TILES, uses } from './admin.ts'
import { idOf, META, spaceOf } from './directory.ts'
import { calledOf } from './operator-name.ts'

let str = (v: unknown) => typeof v == 'string' ? v : ''

/** What the facts read of the directory's census: the admin's lists, and
 * each space's Operator by name. */
export let OUTREACH = fieldsOf(TILES, { spaces: ['operator.name'] })

/** Every space an Operator would write to, as its facts: the platform's own
 * space and every test space left out. */
export let factsOf = (c: Census, now: Date): Facts[] => {
  let used = uses(c, now)
  let people = new Map(c.people.map((r) => [r.entity.eid, r]))
  return c.spaces.flatMap((r): Facts[] => {
    let space = spaceOf(r)
    let seats = c.seats.filter((s) => idOf(s.member!.space) == space.eid)
    let bots = seats.every((s) =>
      str(
        (people.get(idOf(s.member!.person))?.email as Comp | undefined)
          ?.address,
      ).endsWith(BOT)
    )
    if (space.slug == META.space || used.get(space.eid)?.test || bots) {
      return []
    }
    let apps = c.apps.filter((a) =>
      !a.trashed && idOf(a.app!.space) == space.eid
    )
    return [{
      space: space.eid,
      slug: space.slug,
      operator: calledOf(r),
      plan: space.tier ?? 'free',
      made: r.created?.at ?? null,
      people: seats.map((s) => {
        let p = people.get(idOf(s.member!.person))
        return {
          name: str((p?.doc as Comp | undefined)?.title),
          role: s.member!.role,
          signedIn: str((p?.signed_in as Comp | undefined)?.at) || null,
        }
      }),
      apps: apps.map((a) => {
        let u = used.get(a.entity.eid) ?? {}
        return {
          slug: a.app!.slug ?? str((a.former as Comp | undefined)?.slug),
          title: str((a.doc as Comp | undefined)?.title),
          visits: u.visits ?? null,
          requests: u.requests ?? 0,
          deployed: u.deployed?.at ?? null,
          changed: u.changed ?? null,
          errored: u.errored ?? null,
          used: u.active ?? null,
        }
      }),
    }]
  })
}
