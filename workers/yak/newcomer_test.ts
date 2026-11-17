// The home page's box (D-146737), through the whole kernel: an idea typed by
// a stranger opens a space of their own holding one build's dollars, signs
// their browser in and takes them to its Operator's chat; the same browser
// goes on in that space; and past an address's builds they meet the sign-in
// card saying why. A newcomer's Operator may build and nothing else. The
// platform admin sees each build, what it spent and who kept it.
import { line } from '@yaks/query'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cleanup, test } from '@yaks/testing'
import type { Tool } from '@yaks/graph'
import { authorizing, fresh, letters, mailed } from './probe.ts'
import type { Env } from './env.ts'
import {
  atCeiling,
  dollars,
  unaffordable,
  UNKEPT,
} from '@yaks/platform/standing'
import { limitOf } from '@yaks/platform/meter'
import {
  BUILDING,
  confined,
  DAILY,
  FULL,
  KEEP,
  keep as keepNewcomer,
  KEEPING,
  opened,
  PER_BUILD,
  START,
} from './newcomer.ts'
import { collected } from './erase.ts'
import { answer } from './admin.ts'
import { type Id, idOf, META } from './directory.ts'
import { meta } from './meta.ts'
import { COOKIE, sign } from './lib/token.ts'
import { links, onceLink, stand } from './link.ts'
import { ledger, mint } from './grants.ts'
import { COOKIE as CAME } from './arrival.ts'
import { CHECK } from '@yaks/platform/bots'
import type { Ctx } from './tool.ts'
import { TOOLS } from './tools.ts'
import { PUBLISHED } from './published.ts'
import { packageTools } from './package-tools.ts'

let env!: Env
let k = await fresh({}, (e) => {
  env = e
})
cleanup(() => k.stop())

// A person's browser, unless a build says what else asked.
let BROWSER = 'Mozilla/5.0 (Macintosh) AppleWebKit Safari'
let build = (
  say: string,
  { ip = '', cookie = '', org = '', ua = BROWSER } = {},
) =>
  k.at('yaks.app', START, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': ua,
      ...ip ? { 'cf-connecting-ip': ip } : {},
      ...cookie ? { cookie } : {},
    },
    body: new URLSearchParams({ say, ...org ? { org } : {} }).toString(),
  })

let cookieOf = (r: Response) =>
  r.headers.getSetCookie().map((set) => set.split(';')[0]).join('; ')
let spaceOf = (r: Response) =>
  /\/manage\/([a-z0-9-]+)/.exec(r.headers.get('location') ?? '')?.[1] ?? ''

let first = await build('A sign-up sheet for our bake sale', {
  ip: '203.0.113.7',
})
let cookie = cookieOf(first)
let again = await build('Add a column for allergies', { cookie })
// The box of a page for churches, given the address of the site they have.
let sited = await build(' GraceChurch.example/visit ', {
  cookie,
  org: 'church',
})
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
let sitedSaid = parseHTML(
  await (await k.at(
    'yaks.app',
    new URL(sited.headers.get('location')!).pathname,
    { headers: { cookie } },
  )).text(),
).document.body.textContent ?? ''

let landing = await k.at('yaks.app', '/login', { headers: { cookie } })
await landing.body?.cancel()
await keepNewcomer(env, k.dir, owner, owner)
let afterLanding = {
  newcomer: await k.dir.newcomer(owner),
  budget: (await k.dir.at(space.eid))?.budget,
}
let forbidden = await k.at('yaks.app', `/manage/${space.slug}/people`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    invite: 'unasked@example.net',
    role: 'owner',
    note: 'Unasked note',
  }),
})
let forbiddenSaid = await forbidden.text()
let unasked = letters(k, 'unasked@example.net')
let legacyInvite = crypto.randomUUID()
await k.dir.stamp({
  entities: [{
    entity: { eid: legacyInvite },
    invite: { to: space.eid, person: k.owner.person, role: 'owner', by: owner },
  }],
})

let newcomer = await k.dir.newcomer(owner)
let known = await k.dir.known(owner)
let steps = await k.dir.stepper(owner)

// Keeping: Dana, new here, gives her address in the first chat's card and
// spends the code the letter brings, on the browser she built on; Ana, who
// has a space of her own, does the same on the browser that built the
// second, which joins her account with its chat and the other browser its
// newcomer built on.
let person = async (address: string) => {
  let eid = crypto.randomUUID()
  await k.dir.stamp({
    entities: [{ entity: { eid }, person: {}, email: { address } }],
  })
  return eid
}
let row = (eid: string) => meta(env).query(line`.entity.eid=${eid}`)
let signIn = (path: string, fields: Record<string, string>, on = cookie) =>
  k.at('yaks.app', path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: on,
    },
    body: new URLSearchParams(fields).toString(),
  })
// Before Dana keeps it, the browser is the newcomer's, and whoever holds it
// may not be Dana (T-770): it mints no standing link and gives no
// connector consent.
let authorize = await authorizing(k)
let linkAsked = await signIn('/login/link', { days: '365' })
let consentCard =
  await (await k.at('yaks.app', `/oauth/authorize?${authorize.q}`, {
    headers: { cookie },
  })).text()
let consentPosted = await signIn('/oauth/allow', {
  q: authorize.q,
  consent: 'x',
})
let back = new URL(first.headers.get('location')!).pathname
let signed = async (on: string) =>
  (await (await k.at('yaks.app', '/login/who', { headers: { cookie: on } }))
    .json()).signedIn
// Credentials issued before newcomers stopped minting them must end too.
let oldLink = await stand(k.secret, links(env.OAUTH_KV)!, { person: owner })
let oldGrant = await mint(k.secret, ledger(env.OAUTH_KV)!, { person: owner })
await (await signIn('/login', { address: 'dana@example.com', return: back }))
  .body?.cancel()
let digits = await mailed(k, 'dana@example.com')
let wrong = await signIn('/login/code', {
  address: 'dana@example.com',
  code: digits == '000000' ? '111111' : '000000',
  return: back,
})
let retrying = await signed(cookie)
await wrong.body?.cancel()
let signedIn = await signIn('/login/code', {
  address: 'dana@example.com',
  code: digits,
  return: back,
})
let dana = (await k.dir.owners(space))[0]
let linkAfter = await signIn('/login/link', { days: '365' })
let oldCookieSignedIn = await signed(cookie)
let verifiedSignedIn = await signed(cookieOf(signedIn))
let oldLinkFollowed = await k.at(
  'yaks.app',
  new URL(oldLink.url).pathname + new URL(oldLink.url).search,
)
let oldLinkStatus = oldLinkFollowed.status
await oldLinkFollowed.body?.cancel()
let oldGrantUsed = await k.at('yaks.app', '/oauth/me', {
  headers: { authorization: `Bearer ${oldGrant.token}` },
})
let oldGrantStatus = oldGrantUsed.status
await oldGrantUsed.body?.cancel()
let danaRow = (await row(dana))[0]
let chatAfter = await k.at('yaks.app', back, {
  headers: { cookie: cookieOf(signedIn) },
})
let chatAfterSaid = parseHTML(await chatAfter.text()).document.body
  .textContent ?? ''
let ana = await person('ana@example.com')
let anas = await k.dir.own(ana)
let other = (await k.dir.space(spaceOf(second)))!
let otherNewcomer = (await k.dir.owners(other))[0]
let transferInvite = crypto.randomUUID()
await k.dir.stamp({
  entities: [{
    entity: { eid: transferInvite },
    invite: {
      to: other.eid,
      person: k.owner.person,
      role: 'owner',
      by: otherNewcomer,
    },
  }],
})
let browser = crypto.randomUUID()
await k.dir.stamp({ entities: [{ entity: { eid: browser }, browser: {} }] })
await k.dir.stamp({
  entities: [{ entity: { eid: browser }, browser: { by: otherNewcomer } }],
})
let otherBack = new URL(second.headers.get('location')!).pathname
await (await signIn(
  '/login',
  { address: 'ana@example.com', return: otherBack },
  cookieOf(second),
)).body?.cancel()
let anaIn = await signIn('/login/code', {
  address: 'ana@example.com',
  code: await mailed(k, 'ana@example.com'),
  return: otherBack,
}, cookieOf(second))
let anaChat = await k.at('yaks.app', otherBack, {
  headers: { cookie: cookieOf(anaIn) },
})
let anaChatSaid = parseHTML(await anaChat.text()).document.body
  .textContent ?? ''
let keptBrowser = (await row(browser))[0]?.browser as { by: Id }
let keptNewcomer = await row(otherNewcomer)
let danaSeats = await k.dir.seats(dana, 'owner')
let anaSeats = await k.dir.seats(ana, 'owner')
let kept = (await k.dir.space(space.slug))!

// Nobody keeps a third: the daily sweep leaves it its week, then trashes it.
let leaving = await build('A plant watering log', { ip: '203.0.113.9' })
let left = spaceOf(leaving)
let leaver = (await k.dir.owners((await k.dir.space(left))!))[0]
let swept = async (after: number) => {
  await collected(env, new Date(Date.now() + after))
  let slugs = [left, space.slug, other.slug]
  let rows = await Promise.all(slugs.map((s) => k.dir.space(s)))
  return slugs.filter((_, i) => rows[i]?.trashed)
}
let hour = 3_600_000
let inWeek = await swept(KEEPING - hour)
let pastWeek = await swept(KEEPING + hour)

// An agent checking the path keeps a fourth as a test account: the day counts
// it, and the admin's page leaves it off unless asked for tests.
// It came by the check's link, so its steps away from any request count
// under that campaign, as a test's.
let checked = await build('A reading list', {
  ip: '203.0.113.11',
  cookie: `${CAME}=utm_source=${CHECK}&at=1`,
})
let checkedSpace = (await k.dir.space(spaceOf(checked)))!
let checker = (await k.dir.owners(checkedSpace))[0]
let checkerSteps = await k.dir.stepper(checker)
await (await signIn('/login', { address: 'e2e@bot.yak.sh' }, cookieOf(checked)))
  .body?.cancel()
let letter = new URL(
  await onceLink(k.secret, {
    email: 'e2e@bot.yak.sh',
    code: await mailed(k, 'e2e@bot.yak.sh'),
  }),
)
let keptByLink = await signIn('/login/link', {
  t: letter.searchParams.get('t')!,
}, cookieOf(checked))
let checkerRow = (await row(checker))[0]

// An agent checking the box through a script, curl here, tags nothing: the
// newcomer it opens is nobody's all the same, and stays off the admin's page
// and out of the funnel's people.
let scripted = await build('A prayer list', {
  ip: '203.0.113.12',
  ua: 'curl/8.5.0',
})
let scriptedSpace = (await k.dir.space(spaceOf(scripted)))!
let scripter = (await k.dir.owners(scriptedSpace))[0]
let scripterSteps = await k.dir.stepper(scripter)
let tested = [await k.dir.tested(scripter), await k.dir.tested(owner)]
let linkedSignedIn = await signed(cookieOf(keptByLink))
let linkedOldCookie = await signed(cookieOf(checked))
await keptByLink.body?.cancel()

// The admin's Visitor builds page, read once everything above is done.
let root = await person('root@example.com')
await k.dir.stamp({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    member: {
      person: root,
      space: (await k.dir.space(META.space))!.eid,
      role: 'owner',
    },
  }],
})
let session = await sign(
  { person: root, space: null, exp: 4e9 },
  env.SESSION_SECRET!,
)
let buildsAt = async (path: string) =>
  parseHTML(
    await (await answer(
      new Request(`https://yaks.app${path}`, {
        headers: { cookie: `${COOKIE}=${session}` },
      }),
      env,
      '/admin/builds',
      k.dir,
    ))!.text(),
  ).document
let builds = await buildsAt('/admin/builds')
let withTests = await buildsAt('/admin/builds?tests=1')
let today = await opened(k.dir)

// Ben has an account and no space yet, as somebody invited has: the
// newcomer's is the one he keeps, his own.
let bens = await build('A recipe box', { ip: '203.0.113.12' })
let ben = await person('ben@example.com')
await (await signIn('/login', { address: 'ben@example.com' }, cookieOf(bens)))
  .body?.cancel()
await (await signIn('/login/code', {
  address: 'ben@example.com',
  code: await mailed(k, 'ben@example.com'),
}, cookieOf(bens))).body?.cancel()
await k.settled()
let benSeats = await k.dir.seats(ben, 'owner')

// Thirty days on the trash erases the third space, and its newcomer with it;
// their browser, still signed in as them, is a stranger at the box again.
let leaverBefore = await row(leaver)
await collected(env, new Date(Date.now() + KEEPING + 31 * 24 * hour))
let leaverAfter = await row(leaver)
let anew = await build('A plant watering log, again', {
  ip: '203.0.113.10',
  cookie: cookieOf(leaving),
})
let anewSpace = (await k.dir.space(spaceOf(anew)))!
let anewOwner = (await k.dir.owners(anewSpace))[0]

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

test("a web address typed in a church page's box asks for that church's site, whole", () => {
  assertEquals(spaceOf(sited), space.slug)
  assert(
    sitedSaid.includes(
      "My church's website is https://gracechurch.example/visit",
    ),
    sitedSaid.slice(-400),
  )
})

test("a web address typed in the box makes what is built from it that site's preview", () => {
  assertEquals(kept.preview?.site, 'https://gracechurch.example/visit')
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

test('a newcomer is a person with no address yet', () => {
  assert(newcomer)
  assertEquals(known, null)
})

test("a newcomer's steps away from the box count under the campaign they came to it by", () => {
  assertEquals(steps, { who: null, campaign: '', test: false })
  assertEquals(checkerSteps, { who: null, campaign: `${CHECK}//`, test: true })
})

test("a newcomer a script opened is nobody's before it has any address", () => {
  assertEquals(scripterSteps, { who: null, campaign: '', test: true })
  assertEquals(tested, [true, false])
})

test("keeping into an account takes the newcomer's browser, and their row goes", () => {
  assertEquals(idOf(keptBrowser.by), ana)
  assertEquals(keptNewcomer, [])
})

test("erasing an unkept newcomer's space erases its newcomer", () => {
  assertEquals(leaverBefore.length, 1)
  assertEquals(leaverAfter, [])
})

test("an erased newcomer's browser builds as a newcomer anew", async () => {
  assertEquals(anew.status, 303)
  assert(anew.headers.get('set-cookie'), 'signed in again')
  assert(anewOwner != leaver)
  assert(await k.dir.newcomer(anewOwner))
  assertEquals(anewSpace.budget, PER_BUILD)
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

test("an address new here keeps the newcomer's identity and chat with fresh credentials", () => {
  assertEquals(signedIn.status, 303)
  assertEquals(
    new URL(signedIn.headers.get('location')!, 'https://yaks.app').pathname,
    back,
  )
  assertEquals(dana, owner)
  assertEquals(verifiedSignedIn, true)
  assertEquals(oldCookieSignedIn, false)
  assertEquals(oldLinkStatus, 400)
  assertEquals(oldGrantStatus, 401)
  assertEquals(danaRow.email, { address: 'dana@example.com' })
  assertEquals(danaRow.newcomer, undefined)
  assertEquals(chatAfter.status, 200)
  assert(!chatAfterSaid.includes('This chat is not here'), chatAfterSaid)
  assert(!chatAfterSaid.includes('Keep this app'), 'nothing left to keep')
})

test('a wrong code keeps the newcomer signed in to retry', () => {
  assertEquals(wrong.status, 400)
  assertEquals(retrying, true)
})

test('a letter link keeps newcomer identity with a fresh browser credential too', () => {
  assertEquals(keptByLink.status, 303)
  assertEquals(checkerRow.email, { address: 'e2e@bot.yak.sh' })
  assertEquals(checkerRow.newcomer, undefined)
  assertEquals(linkedSignedIn, true)
  assertEquals(linkedOldCookie, false)
})

test('a newcomer mints no standing link and gives no consent', async () => {
  assertEquals(linkAsked.status, 403)
  assertEquals((await linkAsked.json()).error.code, 'no_address')
  assert(!consentCard.includes('name="consent"'), 'the sign-in card instead')
  assertEquals(consentPosted.headers.get('location'), null)
  await consentPosted.body?.cancel()
})

test("the newcomer's browser, once kept on, mints nothing for its old cookie", async () => {
  assertEquals(linkAfter.status, 401)
  await linkAfter.body?.cancel()
})

test("an address with an account takes the newcomer's chat, signed in", () => {
  assertEquals(anaIn.status, 303)
  assertEquals(
    new URL(anaIn.headers.get('location')!, 'https://yaks.app').pathname,
    otherBack,
  )
  assertEquals(anaChat.status, 200)
  assert(!anaChatSaid.includes('This chat is not here'), anaChatSaid)
  assert(anaChatSaid.includes('A chore chart'), anaChatSaid)
  assert(!anaChatSaid.includes('Keep this app'), 'nothing left to keep')
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

test("somebody with no space keeps a newcomer's as their one own", () => {
  assertEquals(benSeats.map((s) => [s.space.slug, s.own]), [[
    spaceOf(bens),
    true,
  ]])
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

test("the admin's Visitor builds page says today's builds against the day's, and who kept each", () => {
  assertEquals(today, 5)
  let said = (el: ParentNode) =>
    Object.fromEntries(
      [...el.querySelectorAll('dl > div')].map((d) => [
        d.querySelector('dt')!.textContent,
        d.querySelector('dd')!.textContent,
      ]),
    )
  let facts = said(builds.querySelector('.Directory_Facts')!)
  assertEquals([facts['Opened today'], facts.Kept], [
    `5 of ${DAILY}`,
    '2 of 3',
  ])
  let rows = [...builds.querySelectorAll('.Directory_Row')].map((row) => [
    row.querySelector('strong')!.textContent,
    [...row.querySelectorAll('.Chips > *')].map((t) => t.textContent).join(),
    said(row)['Kept by'],
    said(row)['Spent this month'].replace(/^\$[\d.]+ of /, ''),
  ])
  assertEquals(rows.map((r) => r.slice(0, 3)), [
    [left, 'in the trash', 'not yet'],
    [other.slug, 'kept', 'ana'],
    [space.slug, 'kept', 'dana'],
  ])
  assertEquals(rows[0][3], dollars(PER_BUILD))
})

test("the admin's Visitor builds page leaves a test account's build off unless asked for tests", () => {
  let slugs = (d: Document) =>
    [...d.querySelectorAll('.Directory_Row strong')].map((s) => s.textContent)
  for (let test of [checkedSpace, scriptedSpace]) {
    assertEquals(slugs(builds).includes(test.slug), false)
    assertEquals(slugs(withTests).includes(test.slug), true)
  }
})

test('a landing without address proof keeps newcomer limits on the browser and People form', () => {
  assertEquals(afterLanding.newcomer, true)
  assertEquals(afterLanding.budget, PER_BUILD)
  assert(forbiddenSaid.includes(KEEP), forbiddenSaid)
  assertEquals(unasked, [])
})

test('keeping a newcomer withdraws invitations sent before address proof', async () => {
  for (let eid of [legacyInvite, transferInvite]) {
    assertEquals(await row(eid), [])
    assertEquals(await k.dir.invitation(eid), null)
  }
})
