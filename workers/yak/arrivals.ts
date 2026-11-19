// Where each person came from when they signed up (T-154825): the directory's
// `arrived` on their row, written once by whichever door they first came in
// by (`welcomed`), and read back as one list since a time (`arrivals`), which
// the admin's funnel answers beside its counts (admin.ts `funnelDoor`).
//
//   box          the home page's box opened their newcomer (identity.ts
//                `begun`), in the same write; keeping it hands it over
//                (newcomer.ts `keep`)
//   login        their first sign-in, by code, link or Google (identity.ts
//                `landed`), carrying their browser's arrival (arrival.ts)
//   connector    the same, begun from an assistant's connector, which names
//                the assistant
//   invitation   the same, by an invitation's link, which names its inviter
//   email, text  a letter or a text to the platform signed them up
//                (identity.ts `joined`, `textedIn`), with no browser to say
//                more
import type { Bundle } from '@yaks/graph'
import { and, eq, every, list, stringify } from '@yaks/query'
import { line } from '@yaks/query'
import type { Arrived } from './arrival.ts'
import { idOf, type Row, testIs } from './directory.ts'
import type { Namespace } from '@yaks/durable-object/door'
import { KERNEL, meta } from './meta.ts'

type Env = { STORE: Namespace }

/** Keep where `person` came from, unless something already says: a person
 * arrives once, by the first door they came in by. */
export let welcomed = async (env: Env, person: string, arrived: Arrived) => {
  let store = meta(env)
  let [row] = await store.query(line`.entity.eid=${person}&.person&?arrived`)
  if (!row || row.arrived) return
  await store.apply([{ entity: { eid: person }, arrived } as Bundle], KERNEL)
}

/** One person who signed up, where they came from, and who they are: their
 * address or number, and, for the app and the inviter that brought them, the
 * app's slug and the inviter's address. `referrer` is whoever's invite code
 * they sent (referral.ts). */
export type SignUp = Arrived & {
  person: string
  who: string
  slug?: string
  invited?: string
  referrer?: string
}

let whoOf = (r?: Row) =>
  r?.email?.address ?? r?.phone?.number ?? r?.doc?.title ?? ''

let rowsOf = async (env: Env, eids: string[]) =>
  eids.length
    ? await meta(env).query(
      stringify(and(eq('entity.eid', list(...eids)), every())),
    ) as Row[]
    : []

/**
 * Everybody who signed up at `since` or after, oldest first, each with where
 * they came from. A newcomer who has given no address yet has not signed up,
 * and test accounts and agents' checks (directory.ts `testIs`) are not people:
 * both are left out.
 */
export let arrivals = async (env: Env, since: string): Promise<SignUp[]> => {
  let people = (await meta(env).query(
    line`.person&.arrived.at>=${since}&?email&?phone&?doc&?newcomer`,
  ) as Row[]).filter((r) => (r.email || r.phone) && !testIs(r))
  let eids = people.map((r) => r.entity.eid)
  let referrals = eids.length
    ? await meta(env).query(
      stringify(and(eq('referral.invitee', list(...eids)), every())),
    ) as Row[]
    : []
  let referrer = new Map(
    referrals.map((
      r,
    ) => [idOf(r.referral!.invitee), idOf(r.referral!.inviter)]),
  )
  let named = new Map(
    (await rowsOf(env, [
      ...new Set(
        people.flatMap((r) => {
          let a = r.arrived!
          return [a.app, a.inviter].filter(Boolean).map((e) => idOf(e!))
        }).concat([...referrer.values()]),
      ),
    ])).map((r) => [r.entity.eid, r]),
  )
  return people
    .map((r): SignUp => {
      let { app, inviter, ...arrived } = r.arrived!
      let by = referrer.get(r.entity.eid)
      return {
        ...arrived as Arrived,
        person: r.entity.eid,
        who: whoOf(r),
        ...app
          ? {
            app: idOf(app),
            slug: named.get(idOf(app))?.app?.slug ?? undefined,
          }
          : {},
        ...inviter
          ? {
            inviter: idOf(inviter),
            invited: whoOf(named.get(idOf(inviter))),
          }
          : {},
        ...by ? { referrer: whoOf(named.get(by)) } : {},
      }
    })
    .sort((a, b) => a.at.localeCompare(b.at))
}
