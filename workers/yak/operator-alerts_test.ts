import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Binding } from '@yaks/cloudflare-mail'
import type { Item } from '@yaks/model'
import type { Bundle } from '@yaks/graph'
import { platform } from './directory-rows-probe.ts'
import { directoryOf, stamp } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { operatorContext } from './operator.ts'
import { receive, textSigned } from './operator-channels.ts'
import { notification } from './operator-updates.ts'
import { notificationSend } from './operator-alerts.ts'
import { operatorAnswer, operatorBody } from './operator-page.ts'
import { endpoints } from './endpoints.ts'
import { PER_SEGMENT } from './text-spend.ts'

// A space's Operator tells its person something away from the page, the way
// they chose to be alerted (T-145056).
let { env } = platform('operator-alerts')
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
let ADDRESS = 'ana@bot.yak.sh', ANA = '+12695550142'
await dir.apply({
  entities: [
    { entity: { eid: person }, person: {}, email: { address: ADDRESS } },
    { entity: { eid }, space: { slug: 'ana', store: 'ana' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, owner)
let space = (await dir.at(eid))!
let held = { person, role: 'owner' as const, space: eid }

let letters: Parameters<Binding['send']>[0][] = []
env.MAIL = {
  send: (letter) => {
    letters.push(letter)
    return Promise.resolve({ messageId: `sent-${letters.length}` })
  },
} satisfies Binding
// Telnyx at its HTTP boundary, every text posted to it kept.
let texted: { to: string; text: string }[] = []
let telnyx = endpoints(globalThis).open(async (req) => {
  let path = new URL(req.url).pathname
  if (path == '/messaging_profiles') {
    return Response.json({ data: [{ id: 'profile-1' }] })
  }
  if (path.endsWith('/phone_numbers')) {
    return Response.json({ data: [{ phone_number: '+18885550100' }] })
  }
  let { to, text } = await req.json()
  texted.push({ to, text })
  return Response.json({ data: { id: `msg-${texted.length}` } })
})
Object.assign(env, {
  PHONE_SENDER: { via: 'telnyx' },
  TELNYX_API: telnyx.url,
  TELNYX_API_KEY: 'a-key',
})

let service = operatorService(
  env,
  held,
  operatorModel((req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{
        kind: 'assistant',
        text: 'Your weekly report is ready.',
      }] as Item[],
      cost: 0.001,
    })
  ),
)
env.BUILDER = service.binding
let { store } = service
let ctx = await operatorContext(env, held, space, () => dir)
let notify = notificationSend(ctx, space, store)
let told = async (text: string) => {
  let said = JSON.parse(String(await notify.run({ text }))) as {
    notification: string
    reaches: string
  }
  await service.drain()
  let [row] = await store.g.get([said.notification])
  return { ...said, row }
}
let page = async (view: string, fields: Record<string, string>) => {
  let body = new FormData()
  for (let [k, v] of Object.entries(fields)) body.set(k, v)
  let response = (await operatorAnswer(
    new Request(`https://yaks.app/manage/ana/operator?${view}=1`, {
      method: 'POST',
      body,
    }),
    env,
    space,
    held,
  ))!
  return { status: response.status, said: await response.json() }
}
let take = <T>(list: T[]) => list.splice(0)

// Not chosen, with only an address: by email.
let byMail = await told('The build finished.\nOpen it from your Updates.')
let mailed = take(letters)
// What everyone in the space is told, and what a person writes, stay in
// Updates.
await store.g.apply([
  notification({ to: eid, words: 'Ana changed Notes.', by: person }),
  notification({ to: eid, words: 'Fixed a break.', by: eid }),
  notification({ to: person, words: 'From Bo.', by: crypto.randomUUID() }),
], { trusted: true })
await service.drain()
let unsent = [take(letters), take(texted)]
test('an alert to a person who chose nothing and has an address is an email from the Operator', () => {
  assertEquals(byMail.reaches, 'email')
  assertEquals(mailed.length, 1)
  let [letter] = mailed
  assertEquals(letter.to, ADDRESS)
  assertEquals(letter.subject, 'The build finished.')
  assertStringIncludes(String(letter.text), 'Open it from your Updates.')
  assertStringIncludes(String(letter.text), '/manage/ana/updates')
  assertEquals(typeof (byMail.row.delivered as { at: string }).at, 'string')
})
test('what everyone in a space is told, or a person wrote, is sent to nobody', () => {
  assertEquals(unsent, [[], []])
})

// Once they agree to texts, an alert is a text, paid from the space's budget.
await page('texts', { number: ANA, agreed: 'yes' })
take(texted)
let before = (await dir.at(eid))!.meter?.texts ?? 0
let byText = await told('Your report is ready.')
let textedAlert = take(texted)
let spent = (await dir.at(eid))!.meter!.texts! - before
test('an alert to a person who agreed to texts is a text to their number, signed and paid for', () => {
  assertEquals(byText.reaches, 'text')
  assertEquals(textedAlert, [{
    to: ANA,
    text: `Your report is ready.\n\n${textSigned(space)}`,
  }])
  assertEquals(spent, PER_SEGMENT)
})

// Their choice wins: email, or Updates alone; nothing else is a choice.
let wrong = await page('alerts', { channel: 'pigeon' })
let chose = await page('alerts', { channel: 'email' })
let html = await operatorBody(env, space, held)
await told('Chose email.')
let afterEmail = [take(letters).map((l) => l.to), take(texted)]
await page('alerts', { channel: 'updates' })
let quiet = await told('Chose Updates.')
let afterUpdates = [take(letters), take(texted)]
test('a person chooses how they are alerted on the Operator page', () => {
  assertEquals(wrong.status, 400)
  assertEquals(chose.said, { channel: 'email' })
  assertStringIncludes(html, 'name="channel" value="email" checked')
  assertEquals(afterEmail, [[ADDRESS], []])
  assertEquals(quiet.reaches, 'updates')
  assertEquals(afterUpdates, [[], []])
  assertEquals(quiet.row.delivered, undefined)
})

// A wake-up's outcome is told the way they chose.
await page('alerts', { channel: 'text' })
await receive(
  store,
  { space: eid, person, channel: 'wake' },
  'Tell me when the weekly report is ready.',
)
await service.drain()
let woke = take(texted)
test("a wake-up's outcome reaches the person the way they chose", () => {
  assertEquals(woke.map((t) => t.text), [
    `Your weekly report is ready.\n\n${textSigned(space)}`,
  ])
})

// A spent budget sends nothing and says why on the notification.
let budgetOf = (dollars: number | null) =>
  stamp(env, {
    entities: [{
      entity: { eid },
      budget: dollars == null ? null : { dollars },
      starter: dollars == null ? null : { dollars },
    }],
  })
await budgetOf(0)
let unpaid = await told('Over budget.')
let unpaidTexts = take(texted)
await budgetOf(null)
await telnyx.stop()
test('an alert the space cannot pay for is bounced with the reason, and nothing is sent', () => {
  assertEquals(unpaidTexts, [])
  assertStringIncludes(
    String(
      (unpaid.row.bounced as Bundle['bounced'] & { reason: string })
        .reason,
    ),
    'texts go again',
  )
})
