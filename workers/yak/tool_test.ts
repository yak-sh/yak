/// <reference lib="deno.ns" />
// A refusal is not an incident (tool.ts `refuse`): the runner records a
// `CallError` as `error{code}` and mails nothing, and anything else a tool
// throws is a defect it reports.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { CallError } from '@yaks/tools'
import { type Ctx, ownSpace, rejected } from './tool.ts'
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
// holding the app, else an Operator's own, else the person's only one.
test('a call naming no space means the app’s, the Operator’s, the only one', async () => {
  let [jeff, work, other] = ['jeff', 'work', 'other'].map((slug) => ({
    eid: `e-${slug}`,
    slug,
  })) as unknown as Space[]
  let all = [jeff, work, other]
  let mine = (owned: Space[]) =>
    ({
      at: (eid: string) => Promise.resolve(all.find((s) => s.eid == eid)),
      space: (slug: string) => Promise.resolve(all.find((s) => s.slug == slug)),
      spaces: (_: string, role?: string) => Promise.resolve(role ? owned : all),
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
      means(mine([work])),
      means(mine([jeff, work]), 'garden'),
    ]),
    ['jeff', 'other', 'jeff', 'space: name one of jeff, work', 'work', 'other'],
  )
})
