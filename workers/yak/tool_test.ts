/// <reference lib="deno.ns" />
// A refusal is not an incident (tool.ts `refuse`): the runner records a
// `CallError` as `error{code}` and mails nothing, and anything else a tool
// throws is a defect it reports.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { CallError } from '@yaks/tools'
import { apart, type Ctx, ownSpace, rejected, seatIn } from './tool.ts'
import type { Directory, Space } from './directory.ts'
import { narrowed } from './grants.ts'

test("a door's 4xx is a refusal with its code, and a 5xx a defect", () => {
  let code = (status: number) => {
    let e = rejected(status, 'no')
    return e instanceof CallError ? e.code : null
  }
  assertEquals(
    [400, 403, 404, 409, 413, 422, 429, 500, 503].map(code),
    [
      'arguments',
      'access',
      'missing',
      'conflict',
      'limit',
      'arguments',
      'limit',
      null,
      null,
    ],
  )
  assert(rejected(500, 'no') instanceof Error)
})

// The space a call means when it names none (tool.ts `ownSpace`): the one
// holding the app, else an Operator's own, else the person's own one.
test('a call naming no space means the app’s, the Operator’s, the person’s own', async () => {
  let [jeff, work, other] = ['jeff', 'work', 'other'].map((slug) => ({
    eid: `e-${slug}`,
    slug,
  })) as unknown as Space[]
  let all = [jeff, work, other]
  let mine = (owned: Space[], own?: Space) =>
    ({
      at: (eid: string) => Promise.resolve(all.find((s) => s.eid == eid)),
      space: (slug: string) => Promise.resolve(all.find((s) => s.slug == slug)),
      spaces: (_: string, role?: string) => Promise.resolve(role ? owned : all),
      seats: (_: string, role?: string) =>
        Promise.resolve(
          (role ? owned : all).map((space) => ({
            space,
            role: 'owner',
            own: space == own,
          })),
        ),
      app: (space: Space, slug: string) =>
        Promise.resolve(space == other && slug == 'garden' ? {} : null),
      narrowedTo: () => Promise.resolve(null),
    }) as unknown as Directory
  let reach = (space: Space) => ({
    eid: `r-${space.slug}`,
    space,
    role: 'editor' as const,
  })
  let operator = narrowed(mine([jeff, work]), 'jeff', 'e-jeff', false, [
    reach(work),
    reach(other),
  ])
  let means = (dir: Directory, app?: string) =>
    ownSpace({ dir, person: 'p' } as unknown as Ctx, app).then(
      (s) => s.slug,
      (e) => e.message,
    )
  assertEquals(
    await Promise.all([
      means(operator),
      means(operator, 'garden'),
      means(operator, 'nope'),
      means(mine([jeff, work])),
      means(mine([jeff, work], work)),
      means(mine([work])),
      means(mine([jeff, work]), 'garden'),
    ]),
    [
      'jeff',
      'other',
      'jeff',
      'space: name one of jeff, work — you own several spaces, so a call ' +
      'that names no space has no one space to mean. Send space: ' +
      "'<one of your spaces>'; naming the app alone is enough where only " +
      'one of them holds it.',
      'work',
      'work',
      'other',
    ],
  )
})

// A space named wrong is often a guess at the caller's own, so its refusal
// names theirs; one that moved is the space it moved to (tool.ts `named`).
test('a space that is not there is refused with the spaces the caller has', async () => {
  let spaces = ['peterson', 'nottawatownship'].map((slug) => ({
    eid: `e-${slug}`,
    slug,
  })) as unknown as Space[]
  let dir = (seated: Space[]) =>
    ({
      space: () => Promise.resolve(null),
      formerly: (slug: string) =>
        Promise.resolve(slug == 'old' ? spaces[0] : null),
      seats: () => Promise.resolve(seated.map((space) => ({ space }))),
      role: () => Promise.resolve('owner'),
    }) as unknown as Directory
  let said = (d: Directory, slug: string) =>
    seatIn({ dir: d, person: 'p' } as unknown as Ctx, slug).then(
      ([seat]) => seat.space.slug,
      (e) => e.message,
    )
  assertEquals(
    await Promise.all([
      said(dir(spaces), 'nottawa'),
      said(dir([]), 'nottawa'),
      said(dir(spaces), 'old'),
    ]),
    [
      'no space nottawa — call app_list() without arguments to list all your spaces, or pass one of your space slugs as space. Your spaces are nottawatownship, peterson.',
      "no space nottawa — you are a member of no space yet. Get one by signing up at https://yaks.app, or by accepting an invitation to someone's space.",
      'peterson',
    ],
  )
})

// conversation_projects lists spaces by id, so a call may name one that way;
// the id is read as its slug, so a directory that hides the space still does.
test('a space named by its id is the space with that id', async () => {
  let id = '0b2f6c1e-1d4a-4c8e-9f3a-5e6d7c8b9a01'
  let peterson = { eid: id, slug: 'peterson' } as unknown as Space
  let dir = (shown: string[]) =>
    ({
      at: (eid: string) => Promise.resolve(eid == id ? peterson : null),
      space: (slug: string) =>
        Promise.resolve(shown.includes(slug) ? peterson : null),
      formerly: () => Promise.resolve(null),
      seats: () => Promise.resolve([]),
      role: () => Promise.resolve('owner'),
    }) as unknown as Directory
  let seat = (d: Directory) =>
    seatIn({ dir: d, person: 'p' } as unknown as Ctx, id).then(
      ([s]) => s.space.slug,
      (e) => e.message,
    )
  assertEquals(await Promise.all([seat(dir(['peterson'])), seat(dir([]))]), [
    'peterson',
    `no space ${id} — you are a member of no space yet. Get one by signing up at https://yaks.app, or by accepting an invitation to someone's space.`,
  ])
})

// An app named with its space, as its address reads, names both.
test('an app named <space>/<app> names its space and the app', () => {
  let said = (args: Record<string, unknown>) => {
    try {
      apart(args)
      return args
    } catch (e) {
      return (e as Error).message
    }
  }
  assertEquals(
    [
      { app: 'jeff/hollow-dice' },
      { app: 'jeff/hollow-dice', space: 'jeff' },
      { app: 'jeff/hollow-dice', space: 'work' },
      { app: 'hollow-dice' },
      { app: '/hollow-dice' },
    ].map(said),
    [
      { app: 'hollow-dice', space: 'jeff' },
      { app: 'hollow-dice', space: 'jeff' },
      'app jeff/hollow-dice names space jeff, and space names work',
      { app: 'hollow-dice' },
      { app: '/hollow-dice' },
    ],
  )
})
