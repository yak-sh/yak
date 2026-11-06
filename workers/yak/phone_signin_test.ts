// Signing in with a number (T-136826), through the whole kernel: once the
// platform texts strangers (TEXT_SIGNUP), the sign-in card takes a US mobile
// number beside an email address, the code goes by text from the platform's
// number, and spending it lands a new person, wearing the number, on their
// own space. Before that, the card is the
// email card it always was.
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cleanup, test, until } from '@yaks/testing'
import { fresh } from './probe.ts'
import { endpoints } from './endpoints.ts'
import { CODE_NOTE, codeText, VISITS } from './signin.ts'
import { NOT_EMAIL } from './identity.ts'
import type { Env } from './env.ts'
import { channels } from './operator-channels.ts'
import { onceLink, type Pass } from './link.ts'
import { cookieValue, opened, verify } from './lib/token.ts'

let FREE = '+18885550100'
let texts: { from: string; to: string; text: string }[] = []
let telnyx = endpoints(globalThis).open(async (req) => {
  let sent = await req.json()
  texts.push({ from: sent.from, to: sent.to, text: sent.text })
  return Response.json({ data: { id: `msg-${texts.length}` } })
})
cleanup(() => telnyx.stop())

let env!: Env
let k = await fresh({
  TELNYX_API: telnyx.url,
  TELNYX_API_KEY: 'a-key',
  PHONE_SENDER: { via: 'telnyx', number: FREE },
}, (e) => {
  env = e
})
cleanup(() => k.stop())

let form = (path: string, fields: Record<string, string>, ip = '') =>
  k.at('yaks.app', path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(ip ? { 'cf-connecting-ip': ip } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  })

let page = async (r: Response) => parseHTML(await r.text()).document

// Off: the email card, and a number is no address.
let offCard = await page(await k.at('yaks.app', '/login'))
let offNumber = await form('/login', { address: '269-555-0142' })
let offSaid = (await page(offNumber)).body.textContent ?? ''

// On.
env.TEXT_SIGNUP = 'on'
let card = await page(await k.at('yaks.app', '/login'))
let NUMBER = '+12695550142'
let asked = await form('/login', { address: '(269) 555-0142' }, '203.0.113.9')
let codeCard = await page(asked)
let [sent] = await until(() => texts.length ? texts.splice(0) : null)
let code = /\b(\d{6})\b/.exec(sent.text)![1]
let inn = await form('/login/code', { address: NUMBER, code })
let person = (await k.dir.phoned(NUMBER))!
let agreed = await k.dir.texting(person)
let known = await k.dir.known(person)
let spaces = await k.dir.seats(person, 'owner')

// The Operator texts them a link to its page (T-136825), and a link to
// somewhere else. A copy of its pass bound to another number is followed
// first, then the link twice.
let mine = spaces[0].space
let PAGE = `https://yaks.app/manage/${mine.slug}`
await channels(env).text(
  {
    space: mine.eid,
    person,
    channel: 'text',
    address: NUMBER,
    reply_to: FREE,
  },
  { text: `Your page: ${PAGE}. Mine: https://example.com/x` },
  '',
)
let [told] = texts.splice(0)
let link =
  /https:\/\/yaks\.app\/login\/link\?t=[\w-]+\.[\w-]+/.exec(told.text)![0]
let go = (href: string) =>
  k.at('yaks.app', href.slice('https://yaks.app'.length), {
    redirect: 'manual',
  })
let pass = (await opened<Pass>(
  'link',
  new URL(link).searchParams.get('t')!,
  env.SESSION_SECRET!,
))!
let elsewhere = await go(
  await onceLink(env.SESSION_SECRET!, { ...pass.once!, email: '+12695550199' }),
)
let followed = await go(link)
let session = await verify(
  cookieValue(followed.headers.get('set-cookie'))!,
  env.SESSION_SECRET!,
)
let twice = await go(link)

test('until the platform texts strangers, the card asks for an email and a number is refused', () => {
  assert(offCard.querySelector('input[name="address"][type="email"]'))
  assertEquals(offCard.querySelector('#by-text'), null)
  assertEquals(offNumber.status, 400)
  assert(offSaid.includes(NOT_EMAIL))
})

test('then one box takes an email or a mobile number, with what a number agrees to beside it', () => {
  let box = card.querySelector('input[name="address"]')!
  assertEquals(box.getAttribute('type'), 'text')
  assertEquals(box.getAttribute('aria-describedby'), 'by-text')
  assert(card.querySelector('#by-text')!.textContent!.includes(CODE_NOTE))
})

test('a number is texted its code from the platform number, and the card says where it went', () => {
  assertEquals(asked.status, 200)
  assertEquals([sent.from, sent.to], [FREE, NUMBER])
  assertEquals(sent.text, codeText(code))
  assert(
    codeCard.body.textContent!.includes(
      'texted a six-digit code to (269) 555-0142',
    ),
  )
  assertEquals(
    codeCard.querySelector('form[action="/login/code"] input[name="address"]')
      ?.getAttribute('value'),
    NUMBER,
  )
})

test('the code lands a new person wearing the number, on their own space, not yet subscribed to Operator texts', () => {
  assertEquals(inn.status, 303)
  assert(inn.headers.get('set-cookie'))
  assertEquals(known, null, 'no address')
  assertEquals(agreed, null, 'the code card agreed to codes alone')
  assertEquals(spaces.length, 1)
})

test('one visitor gets five texted codes an hour, whichever numbers they type', async () => {
  let ip = '198.51.100.7'
  let statuses = []
  for (let i = 0; i <= VISITS; i++) {
    let r = await form('/login', { address: `269555${1000 + i}` }, ip)
    await r.body?.cancel()
    statuses.push(r.status)
  }
  assertEquals(statuses, [...Array(VISITS).fill(200), 429])
  await until(() => texts.length >= VISITS)
  assertEquals(texts.splice(0).length, VISITS)
})

test("a link in the Operator's text signs its person in, once, onto the page it named", () => {
  assert(
    told.text.startsWith(`Your page: ${link}. Mine: https://example.com/x`),
  )
  assertEquals(pass.once!.email, NUMBER)
  assertEquals(pass.once!.back, PAGE)
  assertEquals(elsewhere.status, 400, 'bound to the number')
  assertEquals(followed.status, 303)
  assertEquals(followed.headers.get('location'), PAGE)
  assertEquals(session?.person, person)
  assertEquals(twice.status, 400, 'single use')
})
