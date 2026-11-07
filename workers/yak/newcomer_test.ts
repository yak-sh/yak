// The home page's box (D-146737), through the whole kernel: an idea typed by
// a stranger opens a space of their own holding one build's dollars, signs
// their browser in and takes them to its Operator's chat; the same browser
// goes on in that space; and past an address's builds they meet the sign-in
// card saying why. A newcomer's Operator may build and nothing else.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cleanup, test } from '@yaks/testing'
import type { Tool } from '@yaks/graph'
import { fresh } from './probe.ts'
import type { Env } from './env.ts'
import { atCeiling, limitOf, unaffordable, UNKEPT } from './meter.ts'
import {
  BUILDING,
  confined,
  FULL,
  KEEP,
  keep,
  KEEPING,
  PER_BUILD,
  START,
} from './newcomer.ts'
import { collected } from './erase.ts'
import type { Ctx } from './tool.ts'
import { TOOLS } from './tools.ts'
import { PUBLISHED } from './published.ts'
import { packageTools } from './package-tools.ts'

let env!: Env
let k = await fresh({}, (e) => {
  env = e
})
cleanup(() => k.stop())

let build = (say: string, { ip = '', cookie = '' } = {}) =>
  k.at('yaks.app', START, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...ip ? { 'cf-connecting-ip': ip } : {},
      ...cookie ? { cookie } : {},
    },
    body: new URLSearchParams({ say }).toString(),
  })

let cookieOf = (r: Response) =>
  (r.headers.get('set-cookie') ?? '').split(';')[0]
let spaceOf = (r: Response) =>
  /\/manage\/([a-z0-9-]+)/.exec(r.headers.get('location') ?? '')?.[1] ?? ''

let first = await build('A sign-up sheet for our bake sale', {
  ip: '203.0.113.7',
})
let cookie = cookieOf(first)
let again = await build('Add a column for allergies', { cookie })
let second = await build('A chore chart', { ip: '203.0.113.7' })
let third = await build('A reading log', { ip: '203.0.113.7' })
let thirdSaid = parseHTML(await third.text()).document.body.textContent ?? ''
let empty = await build('   ', { ip: '203.0.113.8' })

let space = (await k.dir.space(spaceOf(first)))!
let [owner] = await k.dir.owners(space)
let chat = parseHTML(
  await (await k.at(
    'yaks.app',
    new URL(first.headers.get('location')!).pathname,
    {
      headers: { cookie },
    },
  )).text(),
).document
let card = chat.querySelector('form.Talk_Keep')

// Keeping: Dana, new here, keeps the first space; Ana, who has a space of
// her own, keeps the second beside it.
let person = async (address: string) => {
  let eid = crypto.randomUUID()
  await k.dir.stamp({
    entities: [{ entity: { eid }, person: {}, email: { address } }],
  })
  return eid
}
let dana = await person('dana@example.com')
await keep(env, k.dir, owner, dana)
let ana = await person('ana@example.com')
let anas = await k.dir.own(ana)
let other = (await k.dir.space(spaceOf(second)))!
await keep(env, k.dir, (await k.dir.owners(other))[0], ana)
let danaSeats = await k.dir.seats(dana, 'owner')
let anaSeats = await k.dir.seats(ana, 'owner')
let kept = (await k.dir.space(space.slug))!

// Nobody keeps a third: the daily sweep leaves it its week, then trashes it.
let left = spaceOf(await build('A plant watering log', { ip: '203.0.113.9' }))
let swept = async (after: number) => {
  await collected(env, new Date(Date.now() + after))
  let slugs = [left, space.slug, other.slug]
  let rows = await Promise.all(slugs.map((s) => k.dir.space(s)))
  return slugs.filter((_, i) => rows[i]?.trashed)
}
let hour = 3_600_000
let inWeek = await swept(KEEPING - hour)
let pastWeek = await swept(KEEPING + hour)

test("a stranger's idea opens a space of their own, signed in, in its chat", () => {
  assertEquals(first.status, 303)
  assert(cookie.length > 0, 'the browser is signed in')
  assert(
    /^\/manage\/[a-z0-9-]+\/operator\/[0-9a-f-]{36}$/.test(
      new URL(first.headers.get('location')!).pathname,
    ),
    'it lands on the chat its words opened',
  )
})

test("a newcomer's space holds one build's dollars and no starter", () => {
  assertEquals(space.budget, PER_BUILD)
  assertEquals(limitOf(space), PER_BUILD)
})

test("a newcomer's build at its budget asks for their email, not a plan", () => {
  assertEquals(unaffordable(space, 'models', PER_BUILD + 1), UNKEPT)
  assertEquals(atCeiling(space, 'models'), UNKEPT)
  assertEquals(atCeiling(space, 'seconds').includes('Plus plan'), true)
  assertEquals(unaffordable(kept, 'models', 1e6)?.includes('Plus plan'), true)
})

test('a newcomer is a person with no address yet', async () => {
  assert(await k.dir.newcomer(owner))
  assertEquals(await k.dir.known(owner), null)
})

test("a newcomer's chat asks for their email, to come back to it", () => {
  assert(card, 'the card is there')
  assertEquals(card!.getAttribute('action'), '/login')
  assert(card!.querySelector('input[name="address"][type="email"][required]'))
  assertEquals(
    card!.querySelector('input[name="return"]')?.getAttribute('value'),
    new URL(first.headers.get('location')!).pathname,
  )
})

test('an address new here keeps the space as its own, at its plan', async () => {
  assertEquals(danaSeats.map((s) => [s.space.slug, s.own]), [[
    space.slug,
    true,
  ]])
  assertEquals(kept.budget, null)
  assert(limitOf(kept) > PER_BUILD)
  assertEquals(await k.dir.owners(kept), [dana])
  assertEquals((await k.dir.own(dana)).slug, space.slug)
})

test("somebody with a space keeps a newcomer's beside it", async () => {
  assertEquals(
    anaSeats.map((s) => s.space.slug).sort(),
    [anas.slug, other.slug].sort(),
  )
  assertEquals((await k.dir.own(ana)).slug, anas.slug)
})

test("a newcomer's space nobody kept goes to the trash a week after it opened", () => {
  assertEquals(inWeek, [])
  assertEquals(pastWeek, [left])
})

test('the same browser goes on building in the same space', () => {
  assertEquals(again.status, 303)
  assertEquals(spaceOf(again), space.slug)
  assertEquals(again.headers.get('set-cookie'), null)
})

test("past an address's builds, the sign-in card says why", () => {
  assertEquals(second.status, 303)
  assert(spaceOf(second) && spaceOf(second) != space.slug)
  assertEquals(third.status, 429)
  assert(thirdSaid.includes(FULL), thirdSaid)
})

test('an empty box goes back to the home page', () => {
  assertEquals(empty.status, 303)
  assertEquals(new URL(empty.headers.get('location')!).pathname, '/')
})

// A tool as a newcomer meets it, and as anybody else does.
let ran: string[] = []
let tool = (name: string): Tool => ({
  name,
  description: name,
  run: () => {
    ran.push(name)
    return Promise.resolve([])
  },
})
let ctxOf = (newcomer: boolean) =>
  ({
    person: 'p',
    dir: { newcomer: () => Promise.resolve(newcomer) },
  }) as unknown as Ctx
let call = async (newcomer: boolean, name: string) =>
  await confined(ctxOf(newcomer), tool(name)).run!(
    {} as Parameters<NonNullable<Tool['run']>>[0],
    {} as Parameters<NonNullable<Tool['run']>>[1],
  )

test('every tool a newcomer may call is one the platform has', () => {
  let names = new Set(
    [...TOOLS, ...PUBLISHED, ...packageTools({} as Ctx)].map((t) => t.name),
  )
  assertEquals([...BUILDING].filter((n) => !names.has(n)), [])
})

test('a newcomer builds, and is asked for an address before anything else', async () => {
  await call(true, 'app_new')
  await call(true, 'app_files')
  let refused = await assertRejects(() => call(true, 'mail_send'))
  assertEquals((refused as Error).message, KEEP)
  await call(false, 'mail_send')
  assertEquals(ran, ['app_new', 'app_files', 'mail_send'])
})
