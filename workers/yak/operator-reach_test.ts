// A space's owner lets another space's Operator work there from the People
// page, and that Operator then reaches it with the role given, for whoever may
// ask it at home (operator-reach.ts, T-136179).
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { handler } from './kernel.ts'
import { platform } from './deploy-probe.ts'
import { as, SECRET } from './serving-data-probe.ts'
import { directory, fetch as directoryFetch } from './directory.ts'
import { operatorContext } from './operator.ts'
import { call, TOOLS } from './tools.ts'
import { tallying } from './lib/hops.ts'

await using p = platform(SECRET)
let { env } = p
let dir = directory({ fetch: (req) => directoryFetch(req, env) })
let books = 'books', shop = 'shop'
let ada = {
  person: crypto.randomUUID(),
  email: 'ada@example.com',
}
let carl = {
  person: crypto.randomUUID(),
  email: 'carl@example.com',
}
let cookie = await as(ada.person)
// Ada owns the books, Carl the shop. Session cookies reach the People page;
// signing in and provisioning their accounts have their own checks.
await dir.apply({
  entities: [
    ...[ada, carl].map((person) => ({
      entity: { eid: person.person },
      person: {},
      email: { address: person.email },
    })),
    ...([[books, ada], [shop, carl]] as const).flatMap(([slug, owner]) => [
      {
        entity: { eid: `$${slug}` },
        doc: { title: slug },
        space: { slug, store: slug },
      },
      {
        entity: { eid: `$${slug}-owner` },
        member: {
          space: `$${slug}`,
          person: owner.person,
          role: 'owner',
          own: true,
        },
      },
    ]),
  ],
}, { 'x-yak-person': ada.person, 'x-yak-role': 'owner' })
await call({ env, dir, person: ada.person }, 'app_new', {
  space: books,
  slug: 'list',
  title: 'List',
})
let page = (path: string, fields?: Record<string, string>) =>
  handler.fetch(
    new Request(new URL(path, 'https://yaks.app'), {
      redirect: 'manual',
      ...fields
        ? {
          method: 'POST',
          headers: {
            cookie,
            origin: 'https://yaks.app',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(fields),
        }
        : { headers: { cookie } },
    }),
    env,
  )
let people = `/manage/${books}/people`

// Bea writes in the shop too and sits nowhere else.
let bea = crypto.randomUUID()
let shopSpace = (await dir.space(shop))!
let seat = (person: string) => ({
  entity: { eid: crypto.randomUUID() },
  member: { space: shopSpace.eid, person, role: 'editor' },
})
await dir.apply({
  entities: [{ entity: { eid: bea }, person: {} }, seat(bea), seat(ada.person)],
}, { 'x-yak-person': carl.person, 'x-yak-role': 'owner' })
let reach = async (person = bea) => {
  let ctx = await operatorContext(env, { person }, shopSpace)
  let there = await ctx.dir.space(books)
  return {
    there: there?.slug ?? null,
    role: there && await ctx.dir.role(there, person),
    apps: (await ctx.dir.reachable(person)).map((r) => r.app.slug),
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
// Within one request, the spaces the Operator reaches come with their apps:
// what it then asks of their apps is answered from that read, through any
// client the request opens.
let asked: string[] = []
let counted = () =>
  directory({
    fetch: (req) => {
      asked.push(decodeURIComponent(new URL(req.url).search))
      return directoryFetch(req, env)
    },
  })
let oneRead = await tallying(new Map(), async () => {
  let ctx = await operatorContext(env, { person: bea }, shopSpace, counted)
  return (await ctx.dir.reachable(bea)).map((r) => r.app.slug)
})
// Someone with no seat in the shop, talking with its Operator.
let outsider = await reach(crypto.randomUUID())
let stranger = await page(people, { operator: 'nobody-here', role: 'editor' })
let { eid } = shopSpace
let out = await page(people, { unreach: eid })
let after = await reach()

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

test('the spaces an Operator reaches are read with their apps, in one trip', () => {
  assertEquals(oneRead, ['list'])
  assertEquals(asked.filter((q) => q.includes('.app.space=')), [])
})

test('someone with no seat at home reaches nothing the Operator was let into', () => {
  assertEquals(outsider.there, null)
  assertEquals(outsider.apps, [])
  assertStringIncludes(outsider.writes, 'does not open that space')
})

test('only a space its owner sits in is let in, and Remove takes it back out', async () => {
  assertStringIncludes(await stranger.text(), 'You are in no space nobody-here')
  assertEquals(out.status, 303)
  assertEquals(after.there, null)
})
