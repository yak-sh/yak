// Who is in a space and its apps, and who has yet to accept: what the space's
// owner reads on the dashboard's People page (pages.ts `people`) and what
// app_list tells their assistant (tools.ts), from this one read, so "my
// friend can't get in" has the same first step on both (T-123886). It is the
// owner's alone: an invitation names an address the owner typed, and that is
// nobody else's to read.
import type { App, Directory, Held, Space } from './directory.ts'
import type { Host } from './host.ts'
import { manageAt } from './route.ts'

/** One person here: where they stand, what to call them, and where
 * their letters go. */
export type Person = Held & { name: string; email: string | null }

/** A space's people: its members and the invitations to it, then each app's
 * guests and the invitations to that app. */
export type People = {
  space: Space
  members: Person[]
  invited: Person[]
  apps: { app: App; guests: Person[]; invited: Person[] }[]
}

// Owners first, then whoever writes, then whoever reads.
let RANK = ['owner', 'editor', 'viewer']

/** Who is in these spaces and in their apps among `apps`, in two
 * directory reads however many there are. */
export let peopleIn = async (
  dir: Directory,
  spaces: Space[],
  apps: App[],
): Promise<People[]> => {
  let held = await dir.held(spaces.map((s) => s.eid), apps.map((a) => a.eid))
  let known = await dir.persons([...new Set(held.map((h) => h.person))])
  let people = held.map((h): Person => ({
    ...h,
    name: known.get(h.person)?.name ?? '',
    email: known.get(h.person)?.email ?? null,
  })).sort((a, b) =>
    RANK.indexOf(a.role) - RANK.indexOf(b.role) ||
    a.name.localeCompare(b.name)
  )
  let at = (on: string, held: Held['held']) =>
    people.filter((p) => p.on == on && p.held == held)
  return spaces.map((space) => ({
    space,
    members: at(space.eid, 'seat'),
    invited: at(space.eid, 'invite'),
    apps: apps.filter((a) => a.space == space.eid).map((app) => ({
      app,
      guests: at(app.eid, 'grant'),
      invited: at(app.eid, 'invite'),
    })),
  }))
}

// What to call someone in a sentence: their address, which is what member_add
// and member_remove take, and the name beside it only where it says more.
let who = (p: Person) =>
  !p.email
    ? p.name
    : !p.name || p.name == p.email.split('@')[0]
    ? p.email
    : `${p.name} <${p.email}>`

/** One person as data: what to call them, where their letters go, where they
 * stand, and for an invitation the day its latest letter went. */
export let shown = (p: Person) => ({
  name: p.name,
  email: p.email,
  role: p.role,
  ...p.held == 'invite' ? { sent: p.sent } : {},
})

/**
 * Who is here, as an assistant passes it on: every invitation not accepted
 * yet, since somebody may be waiting on it, and everyone else as a count and
 * the page that lists them. Nothing when nobody else is here.
 */
export let aloud = (p: People, me: string, env: Host = {}): string[] => {
  let waiting = [
    ...p.invited.map((x) => [x, 'the whole space'] as const),
    ...p.apps.flatMap((a) => a.invited.map((x) => [x, a.app.title] as const)),
  ].map(([x, of]) =>
    `${who(x)} (${x.role} of ${of}${
      x.sent ? `, letter sent ${x.sent.slice(0, 10)}` : ''
    })`
  )
  let others = new Set(
    [...p.members, ...p.apps.flatMap((a) => a.guests)]
      .filter((x) => x.person != me).map((x) => x.person),
  ).size
  return [
    ...waiting.length
      ? [
        `Not accepted yet: ${waiting.join('; ')} — member_add sends another ` +
        'letter, member_remove withdraws one',
      ]
      : [],
    ...others
      ? [
        `${others} other ${
          others == 1 ? 'person is' : 'people are'
        } in ${p.space.slug} — the People page lists them: ${
          manageAt(p.space.slug, 'people', env)
        }`,
      ]
      : [],
  ]
}
