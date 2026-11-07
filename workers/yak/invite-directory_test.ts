import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { accept, acceptLink, door, invitedWords, placeOf } from './invite.ts'
import { invitedHere, refusedSaid, shared, shut, waiting } from './apps.ts'
import { markup } from './html.ts'
import { invited as invitationPage, type Offer, people } from './pages.ts'
import { aloud, peopleOwned, type Person, shown } from './people.ts'
import {
  type App,
  type Directory,
  directoryRows,
  type Held,
  type Listing,
  type Space,
} from './directory.ts'
import type { Env } from './env.ts'
import { platformVocab } from './vocab.ts'

let SECRET = 'secret'

// The people and places of the tests below, and a directory that holds
// them: the seams that decide what a friend and an owner are told, without a
// kernel.
let JEFF = 'jeff-eid'
let space = { eid: 'sp', slug: 'jeff', title: 'Jeff' } as Space
let diary = {
  eid: 'ap',
  slug: 'diary',
  title: 'Diary',
  space: 'sp',
  access: 'private',
} as App
let emailOf = (person: string) => `${person}@x.test`

// Her letter's link, sealed once.
let link = await acceptLink(SECRET, { invite: 'inv', to: 'ap' }, {})
let env = {} as Env

// ana is invited to the diary and has not accepted; bo was never invited.
let invited = () => {
  let invites = new Map([['ap/ana', { eid: 'inv', role: 'editor' }]])
  let applied: unknown[] = []
  let dir = {
    invite: (to: string, person: string) =>
      Promise.resolve(invites.get(`${to}/${person}`) ?? null),
    invitation: (eid: string) =>
      Promise.resolve(
        eid == 'inv'
          ? { eid, to: 'ap', person: 'ana', role: 'editor', by: JEFF }
          : null,
      ),
    appAt: (eid: string) =>
      Promise.resolve(eid == 'ap' ? { space, app: diary } : null),
    at: () => Promise.resolve(null),
    emailAt: (person: string) => Promise.resolve(emailOf(person)),
    nameAt: () => Promise.resolve('Jeff'),
    grant: () => Promise.resolve(null),
    apply: (b: unknown) => Promise.resolve(void applied.push(b)),
  } as unknown as Directory
  return { dir, applied }
}

// Her letter's link, opened before she signs in, says who invited her to
// which app, and wears the platform's face rather than the private app's own,
// which is not hers to see yet.
let waitingOn = invited()
let closedTo = invited()
let acceptedBy = invited()
let offer: Offer = {
  email: emailOf('ana'),
  back: link,
  by: 'Jeff',
  see: false,
  space,
  app: { ...diary, open: false },
}
test('an invitation opened before signing in says who invited them to which app', async () => {
  let html = await invitationPage(offer).text()
  assertStringIncludes(html, 'invited you to use Diary.')
  assertStringIncludes(html, 'href="https://jeff.yaks.app/diary/"')
  assertStringIncludes(html, '/connector-512.png')
})

// Refused at the app, she is told her invitation waits; the stranger is told
// whose it is to grant, and sees nothing of the app.
test('a friend who has not accepted is told the invitation waits', async () => {
  let { dir } = waitingOn
  assertStringIncludes(
    await refusedSaid(dir, space, diary, 'ana', 'not_a_writer'),
    'invitation to this app',
  )
  assert(!await waiting(dir, space, diary, 'bo', 'not_a_writer'))
  assert(
    !(await refusedSaid(dir, space, diary, 'bo', 'not_a_writer')).includes(
      'invitation',
    ),
  )
})

test("a private app's page tells an invited friend it waits, and a stranger nothing", async () => {
  let { dir } = closedTo
  let at = (person: string) =>
    shut({} as Env, dir, space, diary, { person, role: null }, '/diary/')
  let page = await at('ana')
  assertEquals(page.status, 403)
  assertStringIncludes(await page.text(), 'Your invitation is waiting')
  assertStringIncludes(
    await (await at('bo')).text(),
    'Nothing here yet',
  )
})

test('asked again, the owner hears the friend never accepted', () => {
  assertStringIncludes(
    invitedWords({
      email: emailOf('ana'),
      role: 'editor',
      place: { space, app: diary },
      standing: true,
    }),
    'had not accepted yet',
  )
})

test('her click, signed in as her, takes the invitation and writes her grant', async () => {
  let { dir, applied } = acceptedBy
  await accept(dir, { eid: 'inv', person: 'ana', role: 'editor' }, {
    space,
    app: diary,
  })
  assertMatch(JSON.stringify(applied), /"tombstone".*"grant".*"person":"ana"/)
})

let acceptedRequest = new Request(link)
let alreadyAccepted = {
  ...acceptedBy.dir,
  invitation: () => Promise.resolve(null),
  grant: () => Promise.resolve({ eid: 'grant', access: 'editor' }),
} as unknown as Directory
test('an accepted invitation redirects its person to the app', async () => {
  let response = await door(
    acceptedRequest,
    env,
    alreadyAccepted,
    'ana',
    SECRET,
  )
  assertEquals(response.status, 303)
  assertEquals(response.headers.get('location'), 'https://jeff.yaks.app/diary/')
})

let pending = invited()
let pendingRequest = new Request(link)
let announcements: unknown[] = []
test('a pending invitation is accepted by its person before redirecting to the app', async () => {
  let response = await door(
    pendingRequest,
    env,
    pending.dir,
    'ana',
    SECRET,
    (...args) => Promise.resolve(void announcements.push(args[2])),
  )
  assertEquals(response.status, 303)
  assertEquals(response.headers.get('location'), 'https://jeff.yaks.app/diary/')
  assertMatch(
    JSON.stringify(pending.applied),
    /"tombstone".*"grant".*"person":"ana"/,
  )
  assertEquals(announcements.length, 1)
})

// The space's roster as the directory holds it: jeff owns it, bo is a member,
// ana a guest of the diary, and cy invited to the space and not in yet.
let row = (
  held: Held['held'],
  person: string,
  role: Held['role'],
  on: string,
  sent: string | null = null,
): Held => ({ eid: `${person}/${on}`, held, on, person, role, sent })
let places = [
  row('seat', JEFF, 'owner', 'sp'),
  row('seat', 'bo', 'editor', 'sp'),
  row('grant', 'ana', 'editor', 'ap'),
  row('invite', 'cy', 'viewer', 'sp', '2026-10-14T09:00:00Z'),
]
let roster = {
  held: places,
  persons: new Map(
    places.map((h) => [h.person, { name: h.person, email: emailOf(h.person) }]),
  ),
} as unknown as Listing
let [bo, ana, cy] = ['bo', 'ana', 'cy'].map(emailOf)
let emails = (them: Person[]) =>
  them.map((p) => shown(p)).map((p) => `${p.email} ${p.role}`)

let ownerSeats = [{ space, role: 'owner' as const }]
let ownedApps = [diary]
let namedRoster = peopleOwned(roster, ownerSeats, ownedApps).get(
  space.eid,
)!
let pageRoster = peopleOwned(roster, ownerSeats, ownedApps).get(
  space.eid,
)!
let rosterPage = { space: 'jeff', apps: [], people: pageRoster }
// The registry composes its vocabulary and compiles render queries once.
people(rosterPage)
test('the owner and their assistant see who is in and who has not accepted', () => {
  let here = peopleOwned(roster, ownerSeats, ownedApps)
    .get(space.eid)!

  // The words name who has yet to accept, which is what someone may be
  // waiting on, and count the rest; the value names everyone.
  let said = aloud(here, JEFF).join('\n')
  assertStringIncludes(said, `${cy} (viewer of the whole space`)
  assertStringIncludes(said, 'letter sent 2026-10-14')
  assertStringIncludes(said, '2 other people')
  assert(!said.includes(bo) && !said.includes(ana))
  assert(emails(here.members).includes(`${bo} editor`))
  assertEquals(emails(here.invited), [`${cy} viewer`])
  assertEquals(emails(here.apps[0].guests), [`${ana} editor`])
})

test('asked by name, the assistant lists every member and app guest', () => {
  let named = aloud(namedRoster, JEFF, {}, true).join('\n')
  assertStringIncludes(named, `${bo} (editor)`)
  assertStringIncludes(named, `Guests of Diary: ${ana} (editor)`)
})

test('the People page lists members and offers to resend a pending invitation', () => {
  let page = markup(people(rosterPage))
  for (let them of [ana, bo, cy]) assertStringIncludes(page, them)
  assertStringIncludes(page, 'not accepted yet')
  assertStringIncludes(page, 'name="again" value="cy/sp"')
})

test('a member is not shown who else is in the space', () => {
  // bo's seat is a member's: the space's people, and who its owner invited,
  // are not his to read, even asking (app_list's `people`).
  let his = peopleOwned(roster, [{ space, role: 'editor' }], [diary])
  assertEquals(his.size, 0)
})

test('a page hears that an invitation waits only for the friend it waits for', async () => {
  // ana is invited to edit the private diary; dee to view the public wall.
  let wall = { ...diary, eid: 'wl', slug: 'wall', access: 'public' } as App
  let invites = new Map([
    ['ap/ana', { eid: 'i1', role: 'editor' as const }],
    ['wl/dee', { eid: 'i2', role: 'viewer' as const }],
  ])
  let dir = {
    invite: (to: string, person: string) =>
      Promise.resolve(invites.get(`${to}/${person}`) ?? null),
  }
  let hears = (
    app: App,
    person: string | null,
    reads: boolean,
    posts = false,
  ) => invitedHere(dir, space, app, person, reads, posts)
  assertEquals(await hears(diary, 'ana', false), true)
  // Nobody signed in, a stranger, and ana once she writes there.
  assertEquals(await hears(diary, null, false), false)
  assertEquals(await hears(diary, 'bo', false), false)
  assertEquals(await hears(diary, 'ana', true, true), false)
  // A viewer's invitation lifts no refusal to write on a page she reads.
  assertEquals(await hears(wall, 'dee', true), false)
})

// The directory itself, in memory: jeff's diary, ana invited to it, and cy
// invited and accepted (invite.ts `accept`), as the letter's click does.
let directoryWith = async () => {
  let vocab = platformVocab()
  let g = graph({ vocab, storage: ram(vocab) })
  let dir = directoryRows({
    query: async (line: string) =>
      (await g.read(line)).map((row) => ({ ...row, policy: { revision: 0 } })),
    apply: (b: Bundle[], headers: Record<string, string> = {}) =>
      Promise.resolve(g.apply(b, { trusted: headers['x-yak-kernel'] == '1' })),
  })
  let [owner, invitee, guest] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ]
  await g.apply([
    ...[owner, invitee, guest].map((eid) => ({
      entity: { eid },
      person: {},
      email: { address: `${eid}@x.test` },
    })),
    {
      entity: { eid: 'sp' },
      doc: { title: 'Jeff' },
      space: { slug: 'jeff', store: 'jeff' },
    },
    {
      entity: { eid: 'ap' },
      doc: { title: 'Diary' },
      app: { slug: 'diary', space: 'sp', access: 'private' },
    },
    {
      entity: { eid: 'seat' },
      member: { space: 'sp', person: owner, role: 'owner' },
    },
    ...[invitee, guest].map((person) => ({
      entity: { eid: `inv-${person}` },
      invite: { to: 'ap', person, role: 'editor' },
    })),
  ], { trusted: true })
  let place = (await placeOf(dir, 'ap'))!
  await accept(dir, (await dir.invitation(`inv-${guest}`))!, place)
  let snapshot = async (person: string) => {
    let [seats, granted] = await Promise.all([
      dir.seats(person),
      dir.granted(person),
    ])
    let apps = await dir.apps(seats.map((s) => s.space))
    return {
      seats: () => Promise.resolve(seats),
      granted: () => Promise.resolve(granted),
      apps: () => Promise.resolve(apps),
    } as unknown as Directory
  }
  return {
    waiting: await snapshot(invitee),
    accepted: await snapshot(guest),
    invitee,
    guest,
  }
}
let held = await directoryWith()

test("a friend's dashboard lists a shared app only once they accept", async () => {
  assertEquals(await shared(held.waiting, held.invitee), [])
})

test('a friend who accepted sees the shared app on their dashboard', async () => {
  assertEquals(await shared(held.accepted, held.guest), [
    { eid: 'ap', slug: 'diary', title: 'Diary', space: 'jeff' },
  ])
})
