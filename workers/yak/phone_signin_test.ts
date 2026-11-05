// Signing in with a number (T-136826), through the whole kernel: once the
// platform texts strangers (TEXT_SIGNUP), the sign-in card takes a US mobile
// number beside an email address, the code goes by text from the platform's
// number, and spending it lands a new person, wearing the number and the
// words they agreed to, on their own space. Before that, the card is the
// email card it always was.
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cleanup, test, until } from '@yaks/testing'
import { fresh } from './probe.ts'
import { endpoints } from './endpoints.ts'
import { codeText, SIGNIN_CONSENT, VISITS } from './signin.ts'
import { NOT_EMAIL } from './identity.ts'
import type { Env } from './env.ts'

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
  assert(card.querySelector('#by-text')!.textContent!.includes(SIGNIN_CONSENT))
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

test('the code lands a new person wearing the number, their consent kept, on their own space', () => {
  assertEquals(inn.status, 303)
  assert(inn.headers.get('set-cookie'))
  assertEquals(known, null, 'no address')
  assertEquals([agreed?.number, agreed?.consent], [NUMBER, SIGNIN_CONSENT])
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
