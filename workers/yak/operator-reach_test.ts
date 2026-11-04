// A space's owner lets another space's Operator work there from the People
// page, and that Operator then reaches it with the role given, for whoever may
// ask it at home (operator-reach.ts, T-136179).
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { connector, fresh, signIn } from './probe.ts'
import type { Env } from './env.ts'
import { operatorContext } from './operator.ts'
import { TOOLS } from './tools.ts'

let env: Env
let k = await fresh({}, (e) => void (env = e))
// Ada owns the books, Carl the shop, where Ada is an editor too.
let [ada, carl] = [await signIn(k), await signIn(k)]
let [books, shop] = [ada, carl].map((p) => p.email.split('@')[0])
await connector(k, ada.cookie)
  .tool('app_new', { space: books, slug: 'list', title: 'List' })
let page = (path: string, fields?: Record<string, string>) =>
  k.at('yaks.app', path, {
    redirect: 'manual',
    ...fields
      ? {
        method: 'POST',
        headers: {
          cookie: ada.cookie,
          origin: 'https://yaks.app',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
      }
      : { headers: { cookie: ada.cookie } },
  })
let people = `/manage/${books}/people`

// Bea writes in the shop too and sits nowhere else.
let bea = crypto.randomUUID()
let shopSpace = (await k.dir.space(shop))!
let seat = (person: string) => ({
  entity: { eid: crypto.randomUUID() },
  member: { space: shopSpace.eid, person, role: 'editor' },
})
await k.dir.apply({
  entities: [{ entity: { eid: bea }, person: {} }, seat(bea), seat(ada.person)],
}, { 'x-yak-person': carl.person, 'x-yak-role': 'owner' })
let reach = async () => {
  let ctx = await operatorContext(env!, { person: bea }, shopSpace)
  let there = await ctx.dir.space(books)
  return {
    there: there?.slug ?? null,
    role: there && await ctx.dir.role(there, bea),
    apps: (await ctx.dir.reachable(bea)).map((r) => r.app.slug),
    writes: await TOOLS.find((t) => t.name == 'app_new')!
      .run(ctx, { space: books, slug: 'notes', title: 'Notes' })
      .then(() => 'wrote', (e: Error) => e.message),
  }
}

let before = await reach()
let offered = await (await page(people)).text()
let letIn = await page(people, { operator: shop, role: 'viewer' })
let listed = await (await page(people)).text()
let during = await reach()
let stranger = await page(people, { operator: 'nobody-here', role: 'editor' })
let { eid } = shopSpace
let out = await page(people, { unreach: eid })
let after = await reach()
await k.stop()

test("a space's Operator reaches no other space until that space lets it in", () => {
  assertEquals(before.there, null)
  assertEquals(before.apps, [])
  assertStringIncludes(offered, "Let this space's Operator work here")
  assertStringIncludes(offered, `value="${shop}"`)
})

test('let in from the People page, it works there with the role given, for a writer at home with no seat there', () => {
  assertEquals(letIn.status, 303)
  assertStringIncludes(listed, `${shop}'s Operator · only looks`)
  assertEquals(during.there, books)
  assertEquals(during.role, 'viewer')
  assertEquals(during.apps, ['list'])
  assertStringIncludes(during.writes, `not a writer of ${books}`)
})

test('only a space its owner sits in is let in, and Remove takes it back out', async () => {
  assertStringIncludes(await stranger.text(), 'You are in no space nobody-here')
  assertEquals(out.status, 303)
  assertEquals(after.there, null)
})
