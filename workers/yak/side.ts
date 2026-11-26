// What the person's own pages draw, read from the directory: the sidebar's
// spaces and apps (@yaks/platform/side-rows), their account, browsers and
// friends (@yaks/platform/account-rows), the apps a space's Apps page lists
// (@yaks/platform/space-apps), and a space's month against its allowances
// (@yaks/platform/payment-rows). A page asks it as it is drawn
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
import { visitDayRows, visitRows } from './views.ts'
import { type App, type Directory, type Space, walkTo } from './directory.ts'
import { warmApps } from './app-warm.ts'
import { type Listed, listedRows, listedSpace } from '@yaks/platform/space-apps'
import { pilled, standing } from './gallery-row.ts'
import {
  ACCOUNT,
  accountRow,
  CHAT_LINKS,
  chatLinkRows,
  FRIEND_MESSAGES,
  friendRows,
  FRIENDS,
  HELD_MESSAGES,
  INVITE_PAGE,
  inviteRow,
  messageRows,
  SHARED_APPS,
  sharedRows,
  SIGNED_IN,
  signedInRows,
} from '@yaks/platform/account-rows'
import { invitation } from './referral.ts'
import { friendList, friendsOf, messagesOf } from './friends.ts'
import {
  admittedRows,
  admittedSpace,
  holderRows,
  holdersSpace,
  INVITABLE,
  invitableRows,
} from '@yaks/platform/people-rows'
import { ranked } from './people.ts'
import { offerRows, offersSpace } from '@yaks/platform/update-rows'
import { offersIn } from './updates.ts'
import { shelf } from './apps.ts'
import { kernels } from '@yaks/platform/ladder'
import { allowancesRow, paymentPart } from '@yaks/platform/payment-rows'
import { draftedApp, draftedRow } from '@yaks/platform/app-canvas'
import { withLegacy } from '@yaks/platform/draft-choice'
import { movedRow, movedSpace } from '@yaks/platform/connections-page'
import { gauges } from '@yaks/platform/standing'
import { budget, spent } from '@yaks/platform/meter'
import type { Who } from './session.ts'
import { grantRows, GRANTS } from '@yaks/platform/agents'

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
export let appsFor = async (dir: Directory, space: Space, who: Who) =>
  shelf(await dir.apps(space), space, who).mine

/** What the side shows of each of `apps`. */
export let sideApps = (apps: App[]) =>
  apps.map(({ eid, slug, title, source, generatedIcon }) => ({
    eid,
    slug,
    title,
    source,
    generatedIcon,
  }))

/** The rows `line` asks of the person: their account, browsers, linked chat
 * accounts (whose platforms `env`'s vault says), friends, messages with them,
 * what others shared with them, their invite (which says the number `env`
 * texts from), what the directory holds for them in a space, or the side's;
 * none for a space they hold no seat in that lets them change it. */
export let personRows = async (
  dir: Directory,
  person: string,
  line: string,
  env: Env = {} as Env,
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
  if (line == CHAT_LINKS) {
    let [{ ownLinks }, rows] = await Promise.all([
      import('./chat.ts'),
      dir.ownConnections(person),
    ])
    return chatLinkRows(person, await ownLinks(env, rows))
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
  if (line == SHARED_APPS) return sharedRows(person, await shared(dir, person))
  if (line == INVITE_PAGE) {
    return [inviteRow(person, await invitation(env, dir, person))]
  }
  if (line == GRANTS) {
    return grantRows(person, (await dir.grants(person)).rows)
  }
  if (line == FRIENDS) {
    let all = await shared(dir, person)
    return friendRows(person, await friendList(dir, person, all))
  }
  if (line == FRIEND_MESSAGES) {
    return messageRows(
      (await messagesOf(dir, person, HELD_MESSAGES)).map((m) => ({
        eid: m.eid,
        from: m.outgoing ? person : m.friend,
        to: m.outgoing ? m.friend : person,
        words: m.words,
        at: m.at,
        read: m.read,
        operator: m.operator,
        ...m.invite ? { invite: m.invite } : {},
      })),
    )
  }
  if (line == INVITABLE) {
    return invitableRows(
      person,
      (await friendsOf(dir, person)).filter((f) => f.standing == 'friend')
        .map(({ person, name }) => ({ person, name })),
    )
  }
  let people = holdersSpace(line) ?? admittedSpace(line)
  if (people) return await peopleRows(dir, person, line, people)
  return await sideRows(dir, person, line, env)
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

/** The last day's visits to the apps of the space `eid` that `person` may
 * open, as rows (@yaks/platform/visit-counts `dayVisits`). */
export let visitDay = async (
  env: Env,
  dir: Directory,
  person: string,
  eid: string,
): Promise<Bundle[]> => {
  let apps = await personRows(dir, person, appsLine(eid))
  return visitDayRows(env, eid, appsOf(apps, eid).map((a) => a.eid))
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

/** The space `eid` when `person` owns it, out of the trash. */
export let ownedBy = async (dir: Directory, person: string, eid: string) =>
  (await dir.seated(person)).find((s) =>
    s.space.eid == eid && s.role == 'owner' && !s.space.trashed
  )?.space

// Who is in a space and the Operators let into it (People page,
// @yaks/platform/people-rows), by the walk to its address, which the page
// asked ahead (manage.ts `rowsAhead`); none but to its owner.
let peopleRows = async (
  dir: Directory,
  person: string,
  line: string,
  eid: string,
): Promise<Bundle[]> => {
  let space = await ownedBy(dir, person, eid)
  if (!space) return []
  let walk = walkTo(space.slug, space.eid)
  if (holdersSpace(line)) {
    return holderRows(
      person,
      eid,
      ranked(await dir.people(walk)).map(({ eid: place, ...p }) => ({
        place,
        ...p,
      })),
    )
  }
  return admittedRows(
    person,
    eid,
    (await dir.admits(walk)).map((r) => ({
      operator: r.space.eid,
      slug: r.space.slug,
      title: r.space.title,
      role: r.role,
    })),
  )
}

let sideRows = async (
  dir: Directory,
  person: string,
  line: string,
  env: Env,
): Promise<Bundle[]> => {
  if (line == SIDE_SPACES) return spaceRows(person, await pickable(dir, person))
  let drafted = draftedApp(line)
  if (drafted) return await draftedRows(dir, person, drafted)
  let moved = movedSpace(line)
  if (moved) {
    return await ownedBy(dir, person, moved) ? [movedRow(person, moved)] : []
  }
  let paid = paymentPart(line)
  if (paid) return await paymentRows(dir, person, paid)
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
  if (!apps) return offerRows(person, eid, await offersIn(dir, space, who))
  // Drawn in the side, each is a press away (app-warm.ts).
  let mine = await appsFor(dir, space, who)
  warmApps(env, space, mine)
  return appRows(person, eid, sideApps(mine))
}

// Where an app's drafts stand, to a person seated in its space: what the
// page graph's door reads the app beside the chat again on (canvas-read.ts).
let draftedRows = async (
  dir: Directory,
  person: string,
  eid: string,
): Promise<Bundle[]> => {
  let at = await dir.appAt(eid)
  if (!at) return []
  let seated = (await dir.seated(person)).some((s) =>
    s.space.eid == at.space.eid && !s.space.trashed
  )
  if (!seated) return []
  let { app } = at
  let [write, rows] = await Promise.all([
    dir.newestWrite(app),
    dir.drafts(app),
  ])
  let drafts = withLegacy(app, rows)
  return [draftedRow(person, eid, {
    write,
    drafts: drafts.map((d) => d.eid),
    previews: drafts.map((d) => d.previewed),
    source: app.source ?? null,
  })]
}

// A space's payments, to its owner. The allowances are the page's rows, the
// month as the space's row holds it. The rest the page graph's door reads of
// the provider (payment-reads.ts) on the space's row as the directory
// answers it here, `paymentAccount`, which the page never sees.
let paymentRows = async (
  dir: Directory,
  person: string,
  { part, space: eid }: NonNullable<ReturnType<typeof paymentPart>>,
): Promise<Bundle[]> => {
  let seat = (await dir.seated(person)).find((s) =>
    s.space.eid == eid && !s.space.trashed && s.role == 'owner'
  )
  if (!seat) return []
  let { space } = seat
  if (part == 'allowances') {
    let { all } = shelf(await dir.apps(space), space, { person, role: 'owner' })
    return [allowancesRow(eid, {
      limits: gauges(space, all.length),
      budget: budget(await dir.withBudget(space)),
      read: spent(space).at || null,
    })]
  }
  return [{ entity: { eid }, paymentAccount: accountOf(space) }]
}

/** What a space's payments are read of its directory row: its plan,
 * seller, credit and month. */
export let accountOf = (space: Space) => ({
  tier: space.tier,
  plan: space.plan,
  seller: space.seller ?? null,
  credit: space.credit ?? null,
  comped: space.comped ?? null,
  budget: space.budget,
  starter: space.starter ?? null,
  meter: space.meter,
})
