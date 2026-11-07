// The sign-in code's decisions, at the seam: signin.ts talks to the meta
// store as a graph (meta.ts), so a stub Meta holds the rows and records the
// bundles. What is proved here is what a workerd test cannot reach without
// waiting ten minutes or forging a server-stamped property: a code dies of old
// age, a code dies of too many guesses, a code minted for one address never
// opens another, and an address gets three letters an hour — a window no test
// can sit through, and a count nobody buys back by burning a code.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert'
import {
  called,
  canon,
  chose,
  codeLetter,
  LIFE,
  mac,
  mayText,
  mint,
  nameOf,
  personOf,
  SENDS,
  type Signin,
  spend,
  texted,
  TRIES,
  visitor,
  VISITS,
  WINDOW,
} from './signin.ts'
import { type Bundle, Stale, token } from '@yaks/graph'
import type { Meta } from './meta.ts'

let n = 0
let row = (
  email: string,
  code: string,
  expires: string,
  tries = 0,
) => ({ entity: { eid: `e${++n}` }, signin: { email, code, expires, tries } })

let door = (rows: unknown[]) => {
  let wrote: Bundle[] = []
  let at: Meta = {
    query: () => Promise.resolve(rows as Bundle[]),
    apply: (bundles) => {
      wrote.push(...bundles)
      // What a mint gets back: the eid the store gave the `$who` the bundle
      // asked for, riding the applied bundle as `$alias` (D-23827).
      return Promise.resolve(
        bundles.map((b) =>
          b.entity.eid == '$who'
            ? { ...b, entity: { eid: 'p1' }, $alias: '$who' }
            : b
        ),
      )
    },
  }
  return { at, wrote }
}

let soon = () => new Date(Date.now() + 60_000).toISOString()
let past = () => new Date(Date.now() - 1).toISOString()

let SECRET = 'a probe secret'
let ME = 'me@yaks.app'
// The mac of the code most tests send, made once: the first one imports the
// secret's key (@yaks/secrets/signed `secretKey`), which every sign-in after reuses.
let CODE = await mac(ME, '123456', SECRET)

// A bundle that buries the entity: a tombstone.
let forgotten = (wrote: Bundle[]) => wrote.some((b) => b.tombstone)

// The guess count each patched row was left holding.
let tries = (wrote: Bundle[]) =>
  wrote.map((b) => (b.signin as { tries?: number } | undefined)?.tries)
    .filter((t) => t != null)

test('the live code opens, and is spent', async () => {
  assertEquals(
    CODE,
    '4b16a8c088351316c93cd7b715ff2bb70e1e34901046eab1b9c6d8d19a952e02',
  )
  let d = door([row(ME, CODE, soon())])
  assert(await spend(d.at, SECRET, ME, '123456'))
  // Closed in the guarded write that took the guess, buried after.
  assertEquals(tries(d.wrote), [TRIES])
  assert(forgotten(d.wrote))
})

test('a wrong guess costs a try, not the code', async () => {
  let d = door([row(ME, CODE, soon())])
  assertFalse(await spend(d.at, SECRET, ME, '654321'))
  assertFalse(forgotten(d.wrote))
  assertEquals(tries(d.wrote), [1])
})

test('the last guess burns the code, and leaves its record', async () => {
  let burnt = row(ME, CODE, soon(), TRIES - 1)
  let d = door([burnt])
  assertFalse(await spend(d.at, SECRET, ME, '654321'))
  assertEquals(tries(d.wrote), [TRIES])
  // The row stays: it is one of the three letters this hour, and burning a
  // code is not how anyone buys a fourth.
  assertFalse(forgotten(d.wrote))
  // And it opens nothing now, right digits or not.
  let after = door([{ ...burnt, signin: { ...burnt.signin, tries: TRIES } }])
  assertFalse(await spend(after.at, SECRET, ME, '123456'))
  assertEquals(after.wrote.length, 0)
})

test('an expired code opens nothing, right digits or not', async () => {
  let d = door([row(ME, CODE, past())])
  assertFalse(await spend(d.at, SECRET, ME, '123456'))
  assertEquals(d.wrote.length, 0)
})

// Several codes can stand for one address at once, because the store keeps a
// mac and never the digits: a second ask cannot re-send the first letter's
// code, so the first letter is left working for whoever it reaches late.
test('every standing code opens, and one guess costs them all', async () => {
  let standing = [
    await mac(ME, '111111', SECRET),
    await mac(ME, '222222', SECRET),
  ]
  let both = () => standing.map((code) => row(ME, code, soon()))
  for (let code of ['111111', '222222']) {
    let d = door(both())
    assert(await spend(d.at, SECRET, ME, code), code)
    assert(forgotten(d.wrote))
  }
  let d = door(both())
  assertFalse(await spend(d.at, SECRET, ME, '333333'))
  assertEquals(tries(d.wrote), [1, 1])
})

// The ceiling. A row outlives its code as the record that a letter went out,
// and `expires` minus LIFE is when that was.
let record = (ago: number) => ({
  entity: { eid: `e${++n}` },
  signin: {
    email: ME,
    code: 'x'.repeat(64),
    expires: new Date(Date.now() - ago + LIFE).toISOString(),
    tries: TRIES,
  },
})

let minted = (wrote: Bundle[]) =>
  wrote.filter((b) => (b.signin as { code?: string } | undefined)?.code)

test('three letters an hour to one address, and no more', async () => {
  let under = door([record(0), record(60_000)])
  assert(await mint(under.at, SECRET, ME))
  assertEquals(minted(under.wrote).length, 1)

  let full = door(Array.from({ length: SENDS }, () => record(60_000)))
  assertEquals(await mint(full.at, SECRET, ME), null)
  assertEquals(minted(full.wrote).length, 0)
  assertFalse(forgotten(full.wrote))
})

test('the window passes and the address may ask again', async () => {
  let old = Array.from({ length: SENDS }, () => record(WINDOW + 60_000))
  let d = door(old)
  assert(await mint(d.at, SECRET, ME))
  // Swept, since nothing else ever sweeps them.
  assert(forgotten(d.wrote))
  assertEquals(minted(d.wrote).length, 1)
})

test('signing in clears the count', async () => {
  let full = [
    ...Array.from({ length: SENDS - 1 }, () => record(60_000)),
    row(ME, CODE, soon()),
  ]
  let d = door(full)
  assert(await spend(d.at, SECRET, ME, '123456'))
  assertEquals(d.wrote.filter((b) => b.tombstone).length, full.length)
})

// A store that holds its rows and keeps `$was` the way the graph does
// (@yaks/graph guard.ts): a count written on a read that has since moved is
// refused, and nothing in its batch lands.
let guarded = (rows: Signin[]) => {
  let at: Meta = {
    query: () => Promise.resolve(structuredClone(rows) as unknown as Bundle[]),
    apply: (bundles) => {
      let row = (eid: string) => rows.find((r) => r.entity.eid == eid)
      for (let b of bundles) {
        let r = row(b.entity.eid)
        let was = (b.$was as { signin?: { tries?: string | null } })?.signin
        if (was && token(r?.signin.tries) != was.tries) {
          return Promise.reject(new Stale(b.entity.eid, 'signin', 'tries', 0))
        }
      }
      for (let b of bundles) {
        let r = row(b.entity.eid)
        if (b.tombstone) rows.splice(rows.indexOf(r!), 1)
        else if (r) Object.assign(r.signin, b.signin)
      }
      return Promise.resolve(bundles)
    },
  }
  return at
}

test('forty guesses at once still get five, and the code dies', async () => {
  let rows = [row(ME, CODE, soon()) as Signin]
  let store = guarded(rows)
  let wrong = Array.from({ length: 40 }, (_, i) => String(i).padStart(6, '9'))
  let opened = await Promise.all(wrong.map((c) => spend(store, SECRET, ME, c)))
  assertEquals(opened.filter(Boolean), [])
  assertEquals(rows[0].signin.tries, TRIES)
  assertFalse(await spend(store, SECRET, ME, '123456'))
})

test('a code belongs to its address', async () => {
  // The address is inside the mac, so the row's own email cannot be edited
  // into someone else's sign-in.
  let d = door([row('you@yaks.app', CODE, soon())])
  assertFalse(await spend(d.at, SECRET, 'you@yaks.app', '123456'))
})

test('no code at all is no sign-in', async () => {
  let d = door([])
  assertFalse(await spend(d.at, SECRET, ME, '123456'))
  assertEquals(d.wrote.length, 0)
})

// What a person is called. An address is never it: the platform's own older
// rows are titled with one (T-32627), so such a title reads as no name — the
// next sign-in asks, and an app's store is written the front of the address
// meanwhile (T-32654).
test('a name, never an address', () => {
  assertEquals(nameOf('Dana', ME), 'Dana')
  assertEquals(nameOf(null, ME), 'me')
  assertEquals(nameOf('', 'Dana@Example.com'), 'dana')
  assertEquals(nameOf(ME, ME), 'me')
  assertEquals(chose(ME), null)
  assertEquals(chose('Dana'), 'Dana')
})

let person = (title?: string) => ({
  entity: { eid: 'p1' },
  person: {},
  ...(title ? { doc: { title } } : {}),
})

let titles = (wrote: Bundle[]) =>
  wrote.map((b) => (b.doc as { title?: string } | undefined)?.title)
    .filter(Boolean)

test('a person nobody has named keeps no title', async () => {
  let d = door([])
  await personOf(d.at, ME)
  assertEquals(titles(d.wrote), [])
})

test('an invitation names someone unnamed, and only them', async () => {
  let fresh = door([])
  await personOf(fresh.at, ME, 'Dana')
  assertEquals(titles(fresh.wrote), ['Dana'])
  // A row wearing the old address-as-title has no name yet, so it takes one.
  let old = door([person(ME)])
  await personOf(old.at, ME, 'Dana')
  assertEquals(titles(old.wrote), ['Dana'])
  // A name they chose is theirs; nobody else's invitation moves it.
  let named = door([person('Dana')])
  await personOf(named.at, ME, 'Someone else')
  assertEquals(named.wrote.length, 0)
})

// A number is an address too (T-136826): kept in E.164 form under
// `signin{phone}`, and a person found or minted by `phone{number}`.
let NUMBER = '+12695550142'

test('an address is an email or a US mobile number, however it is typed', () => {
  assertEquals(canon(' Me@Yaks.App '), ME)
  assertEquals(canon('(269) 555-0142'), NUMBER)
  assertEquals(canon('269.555.0142'), NUMBER)
  assertEquals(
    ['me@yaks.app', NUMBER, '+447700900123', '555-0142'].map(texted),
    [false, true, false, false],
  )
  // Canada, the Caribbean, premium-rate and toll-free share +1 but are no US
  // mobile number.
  assertEquals(
    ['(416) 555-0142', '(876) 555-0142', '(900) 555-0142', '(888) 555-0142']
      .map(canon).map(texted),
    [false, false, false, false],
  )
  assertEquals([called(ME), called(NUMBER)], ['me', undefined])
})

// What the store was asked, and what a stub answering only those lines holds.
let asking = (rows: (line: string) => unknown[]) => {
  let asked: string[] = []
  let wrote: Bundle[] = []
  let at: Meta = {
    query: (line) => {
      asked.push(line)
      return Promise.resolve(rows(line) as Bundle[])
    },
    apply: (bundles) => {
      wrote.push(...bundles)
      return Promise.resolve(
        bundles.map((b) =>
          b.entity.eid == '$who'
            ? { ...b, entity: { eid: 'p1' }, $alias: '$who' }
            : b
        ),
      )
    },
  }
  return { at, asked, wrote }
}

test('a code for a number is kept under the number, with who asked', async () => {
  let d = asking(() => [])
  let code = await mint(d.at, SECRET, '269-555-0142', 'v1')
  assertEquals(d.asked, [`.signin.phone="${NUMBER}"`])
  let [{ signin }] = minted(d.wrote) as unknown as Signin[]
  assertEquals([signin.phone, signin.email, signin.from], [
    NUMBER,
    undefined,
    'v1',
  ])
  assertEquals(signin.code, await mac(NUMBER, code!, SECRET))
  // A letter keeps no visitor: only texts are counted per visitor.
  let mailed = asking(() => [])
  await mint(mailed.at, SECRET, ME, 'v1')
  assertEquals(
    (minted(mailed.wrote)[0].signin as Signin['signin']).from,
    undefined,
  )
})

test('a number signs in with its code, and a person wears the number', async () => {
  let code = await mac(NUMBER, '123456', SECRET)
  let d = asking(
    () => [{
      entity: { eid: 'e1' },
      signin: { phone: NUMBER, code, expires: soon(), tries: 0 },
    }],
  )
  assert(await spend(d.at, SECRET, '(269) 555-0142', '123456'))
  let fresh = asking(() => [])
  assertEquals(await personOf(fresh.at, NUMBER), 'p1')
  assertEquals(fresh.asked, [`.person&.phone.number="${NUMBER}"&?doc`])
  assertEquals(fresh.wrote, [{
    entity: { eid: '$who' },
    person: {},
    phone: { number: NUMBER },
  }])
})

// Who asks is kept as a mac, so a row names nobody, and the same visitor is
// the same mac.
let visit = (from: string, ago: number) => ({
  entity: { eid: `e${++n}` },
  signin: {
    phone: NUMBER,
    from,
    code: 'x'.repeat(64),
    expires: new Date(Date.now() - ago + LIFE).toISOString(),
    tries: 0,
  },
})

test('five texted codes an hour from one visitor, and no more', async () => {
  let me = await visitor(SECRET, '203.0.113.9')
  assertMatch(me, /^[0-9a-f]{64}$/)
  assertEquals(await visitor(SECRET, '203.0.113.9'), me)
  assertEquals(await visitor(SECRET, ''), '')
  // An IPv6 subscriber holds a whole /64, so it is one visitor.
  let six = await visitor(SECRET, '2001:db8:0:1::7')
  assertEquals(await visitor(SECRET, '2001:DB8:0:1:abcd::9'), six)
  assertFalse(await visitor(SECRET, '2001:db8:0:2::7') == six)
  let under = asking(() =>
    Array.from({ length: VISITS - 1 }, () => visit(me, 60_000))
  )
  assert(await mayText(under.at, me))
  assertEquals(under.asked, [`.signin.from="${me}"`])
  let full = asking(() =>
    Array.from({ length: VISITS }, () => visit(me, 60_000))
  )
  assertFalse(await mayText(full.at, me))
  // The hour passes, and what fell out of it is swept.
  let old = asking(() =>
    Array.from({ length: VISITS }, () => visit(me, WINDOW + 60_000))
  )
  assert(await mayText(old.at, me))
  assert(forgotten(old.wrote))
  // A request from inside is never counted.
  assert(await mayText(asking(() => []).at, ''))
})

// The code is what a person opens the letter for, so it leads the letter,
// which is the Operator's and answers to the sign-up address, whose reply
// signs them up (inbox.ts `signingUp`). Only the greeting knows who is back.
test('a code letter leads with the code, and the Operator invites a reply', () => {
  let link = 'https://yaks.app/login/link?t=x'
  let fresh = codeLetter('dana@example.com', '123456', link)
  let back = codeLetter('dana@example.com', '123456', link, 'back')
  for (let l of [fresh, back]) {
    assertEquals(
      [l.subject, l.name, l.replyTo],
      ['123456 is your yaks.app code', 'yaks.app Operator', 'signup@yaks.app'],
    )
    assertMatch(
      l.body,
      /sign-in code is 123456\.\n\nOr sign in with one click: https:\/\/yaks\.app\/login\/link\?t=x\n\nOr just reply to this email/,
    )
  }
  assertMatch(fresh.body, /^Hi, I'm your Operator.*\n[^]*set up your space/)
  assertMatch(
    back.body,
    /^Hi, it's your Operator at yaks\.app\. Welcome back\./,
  )
})
