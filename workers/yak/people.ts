// Who is in a space and its apps, and who has yet to accept: what the space's
// owner reads on the dashboard's People page (pages.ts `people`) and what
// app_list tells their assistant (tools.ts), from this one read, so "my
// friend can't get in" has the same first step on both (T-123886). It is the
// owner's alone: an invitation names an address the owner typed, and that is
// nobody else's to read.
import type { App, Directory, Held, Space } from './directory.ts'

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

let who = (p: Person) => p.email ? `${p.name} <${p.email}>` : p.name

/**
 * Who is in, as an assistant reads it: a line of whoever holds a place here
 * (`members` of a space, `guests` of an app), the caller left out, and a line
 * of the invitations not accepted yet, with the day each latest letter went.
 * Nothing when nobody else is there.
 */
export let aloud = (
  word: 'members' | 'guests',
  held: Person[],
  invited: Person[],
  me: string,
): string[] => {
  let others = held.filter((p) => p.person != me)
  return [
    ...others.length
      ? [`${word}: ${others.map((p) => `${who(p)} (${p.role})`).join(', ')}`]
      : [],
    ...invited.length
      ? [
        'invited, not accepted yet (member_add sends another letter, ' +
        `member_remove withdraws): ${
          invited.map((p) =>
            `${who(p)} (${p.role}${
              p.sent ? `, letter sent ${p.sent.slice(0, 10)}` : ''
            })`
          ).join(', ')
        }`,
      ]
      : [],
  ]
}
