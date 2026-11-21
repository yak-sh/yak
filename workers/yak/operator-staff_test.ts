// The person's own Operator sees what their other spaces' Operators are doing
// (operator-staff.ts): each space it asks answers from its own store, for a
// person who owns both, and refuses anyone else.
import { assertEquals, assertMatch, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { acceptOverview, spacesTool } from './operator-staff.ts'
import { operatorMemory } from './operator-testing.ts'

let { env } = platform('operator-staff')
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), stranger = crypto.randomUUID()
let mint = (owner: string, slug: string) =>
  dir.mint(owner, slug, slug, {
    'x-yak-person': owner,
    'x-yak-role': 'owner',
  })
let [home, away] = await Promise.all([
  mint(person, 'staff-home'),
  mint(person, 'staff-away'),
])
let target = operatorMemory()
await target.g.apply([
  {
    entity: { eid: crypto.randomUUID() },
    operator_handoff: {
      person,
      space: home,
      session: crypto.randomUUID(),
      task: crypto.randomUUID(),
    },
    doc: { title: 'staff-home', body: 'Draft the menu.' },
  },
  { entity: { eid: crypto.randomUUID() }, ask: {}, cost: { dollars: 0.25 } },
  { entity: { eid: crypto.randomUUID() }, ask: {}, cost: { dollars: 0.5 } },
], { trusted: true })
env.BUILDER = {
  idFromName: (name) => name,
  get: (space) => ({
    fetch: async (request) => {
      let { kind, ...asked } = await request.json() as {
        kind: string
        person: string
        from: string
      }
      assertEquals([space, kind], [away, 'overview'])
      return Response.json(await acceptOverview(env, target, away, asked))
    },
  }),
}
let [from, to] = await Promise.all([dir.at(home), dir.at(away)])
let look = async (spaces?: string[]) =>
  JSON.parse(
    await spacesTool(env, from!, person, [
      { eid: crypto.randomUUID(), space: to!, role: 'owner' },
    ]).run({ spaces }, undefined as never) as string,
  )

test('each owned space tells its waiting handoffs and its spend', async () => {
  let [seen] = await look()
  assertEquals(seen.space, 'staff-away')
  assertEquals(seen.spent, 0.75)
  assertEquals(seen.handoffs.map((h: { say: string }) => h.say), [
    'Draft the menu.',
  ])
  assertMatch(seen.updates, /empty/)
})

test('only the spaces named are asked, and an unknown name is refused', async () => {
  assertEquals((await look(['staff-away'])).length, 1)
  await assertRejects(() => look(['nowhere']), Error, 'own no other space')
})

test('a space answers no one who does not own it', async () => {
  await assertRejects(
    () => acceptOverview(env, target, away, { person: stranger, from: home }),
    Error,
    'owning both spaces',
  )
})
