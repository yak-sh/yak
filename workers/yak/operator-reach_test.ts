// A space's owner lets another space's Operator work there from the People
// page, and that Operator then reaches it with the role given, for whoever may
// ask it at home (operator-reach.ts, T-136179).
import { test } from '@yaks/testing'
import { possessive } from '@yaks/text'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { handler } from './kernel.ts'
import { REACH, TAB_PERSON } from '@yaks/platform/page-graph'
import { platform } from './deploy-probe.ts'
import { as, SECRET } from './serving-data-probe.ts'
import { directory, fetch as directoryFetch } from './directory.ts'
import { operatorContext } from './operator.ts'
import { letIn as admit } from './operator-reach.ts'
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
// A button of the books' People page, pressed: its act written through Ada's
// page graph (@yaks/platform/people-rows), answered with what it came to.
let press = async (act: string, args: Record<string, string>) => {
  let res = await handler.fetch(
    new Request(new URL(`${REACH}/apply`, 'https://yaks.app'), {
      method: 'POST',
      headers: {
        cookie,
        [TAB_PERSON]: ada.person,
        'content-type': 'application/json',
      },
      body: JSON.stringify([{
        entity: { eid: crypto.randomUUID() },
        [act]: { space: (await dir.space(books))!.eid, ...args },
      }]),
    }),
    env,
  )
  let body = await res.json()
  return {
    status: res.status,
    said: String(body[0]?.[act]?.said ?? body.message),
  }
}

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
let letIn = await press('operatorAdmit', {
  operator: shopSpace.eid,
  role: 'viewer',
})
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
// A person's own Operator reaches every space they sit in, one with no apps
// among them, whose apps their own reach read too, in a session that is
// theirs and in an administrative one.
let booksSpace = (await dir.space(books))!
let asOwner = asked.length
let ownRead = (administrative: boolean) =>
  tallying(new Map(), async () => {
    let ctx = await operatorContext(
      env,
      { person: ada.person, administrative },
      booksSpace,
      counted,
    )
    ctx.dir = ctx.reopen!()
    return (await ctx.dir.reachable(ada.person)).map((r) => r.app.slug)
  })
let own = [await ownRead(false), await ownRead(true)]
let createOwner = crypto.randomUUID()
let createHome = await dir.mint(createOwner, 'creating', 'Creating', {
  'x-yak-person': createOwner,
  'x-yak-role': 'owner',
}, { own: true })
await dir.stamp({
  entities: [{
    entity: { eid: createOwner },
    free_spaces: { count: 2 },
  }],
})
let homeForCreation = (await dir.at(createHome))!
test('a personal Operator receives the space it just created', async () => {
  await tallying(new Map(), async () => {
    let ctx = await operatorContext(
      env,
      { person: createOwner },
      homeForCreation,
    )
    let answer = await call(ctx, 'space_new', {
      slug: 'created',
      title: 'Created',
    })
    assertStringIncludes(answer.text, 'space created (')
    assertEquals(await ctx.dir.role(answer.space!, createOwner), 'owner')
  })
})

// Someone with no seat in the shop, talking with its Operator.
let outsider = await reach(crypto.randomUUID())
let stranger = await press('operatorAdmit', {
  operator: 'nobody-here',
  role: 'editor',
})
let { eid } = shopSpace
let out = await press('operatorOut', { operator: eid })
let after = await reach()

// Mal co-owns the books and writes alone in `mine` and `solo`, and with Carl
// in `ours`. Mal lets `mine` in; Ada lets `solo` and `ours` in. Mal's seat is
// then lowered to editor, and then removed from the People page (T-708).
let mal = { person: crypto.randomUUID(), email: 'mal@example.com' }
let homes = ['mine', 'solo', 'ours']
let by = (person: string) => ({ 'x-yak-person': person, 'x-yak-role': 'owner' })
let seated = (space: string, person: string, role = 'owner') => ({
  entity: { eid: crypto.randomUUID() },
  member: { space, person, role },
})
await dir.apply({
  entities: [
    { entity: { eid: mal.person }, person: {}, email: { address: mal.email } },
    seated(booksSpace.eid, mal.person),
    ...homes.flatMap((slug) => [
      {
        entity: { eid: `$${slug}` },
        doc: { title: slug },
        space: { slug, store: slug },
      },
      seated(`$${slug}`, mal.person),
    ]),
    seated('$ours', carl.person, 'editor'),
  ],
}, by(mal.person))
let home = Object.fromEntries(
  await Promise.all(homes.map(async (h) => [h, (await dir.space(h))!])),
)
await admit(dir, booksSpace, home.mine, 'editor', mal.person, by(mal.person))
for (let h of ['solo', 'ours']) {
  await admit(dir, booksSpace, home[h], 'editor', ada.person, by(ada.person))
}
let reached = async () =>
  Object.fromEntries(
    await Promise.all(homes.map(async (h) => {
      let ctx = await operatorContext(env, { person: mal.person }, home[h])
      let there = await ctx.dir.space(books)
      return [h, there && await ctx.dir.role(there, mal.person)]
    })),
  )
let owning = await reached()
let lowered = await call({ env, dir, person: ada.person }, 'member_add', {
  space: books,
  email: mal.email,
  role: 'editor',
})
let editing = await reached()
let removed = await press('memberRemove', { email: mal.email })
let gone = await reached()

test("a lowered or removed owner's Operators keep no reach beyond their seat", () => {
  assertEquals(owning, { mine: 'editor', solo: 'editor', ours: 'editor' })
  assertStringIncludes(
    lowered.text,
    "(was owner); mine's Operator no longer works there",
  )
  assertEquals(editing, { mine: null, solo: 'editor', ours: 'editor' })
  // Said where the button was pressed.
  assertEquals(removed.status, 200)
  assertStringIncludes(removed.said, "solo's Operator no longer works there")
  assertEquals(gone, { mine: null, solo: null, ours: 'editor' })
})

test("a space's Operator reaches no other space until that space lets it in", () => {
  assertEquals(before.there, null)
  assertEquals(before.apps, [])
  assertStringIncludes(offered, "Let this space's Operator work here")
  assertStringIncludes(offered, `value="${shopSpace.eid}"`)
})

test('let in from the People page, it works there with the role given, for a writer at home with no seat there', () => {
  assertEquals(letIn, { status: 200, said: 'Saved.' })
  assertStringIncludes(listed, `${possessive(shop)} Operator · only looks`)
  assertEquals(during.there, books)
  assertEquals(during.role, 'viewer')
  assertEquals(during.apps, ['list'])
  assertStringIncludes(during.writes, `not a writer of ${books}`)
})

test('the spaces an Operator reaches are read with their apps, in one trip', () => {
  assertEquals(oneRead, ['list'])
  assertEquals(own, [['list'], ['list']])
  assertEquals(asked.filter((q) => q.includes('.app.space=')), [])
  assert(asked.length > asOwner)
})

test('someone with no seat at home reaches nothing the Operator was let into', () => {
  assertEquals(outsider.there, null)
  assertEquals(outsider.apps, [])
  assertStringIncludes(outsider.writes, 'does not open that space')
})

test('only a space its owner sits in is let in, and Remove takes it back out', () => {
  assertEquals(stranger, { status: 404, said: 'You are in no such space.' })
  assertEquals(out, { status: 200, said: 'Removed.' })
  assertEquals(after.there, null)
})
