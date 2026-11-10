import { test } from '@yaks/testing'
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'
import type { Binding } from '@yaks/cloudflare-mail'
import type { Item } from '@yaks/model'
import type { Bundle, Comp } from '@yaks/graph'
import { platform } from './directory-rows-probe.ts'
import { directoryOf, stamp } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { operatorContext } from './operator.ts'
import { receive, textSigned } from './operator-channels.ts'
import { notification } from './operator-updates.ts'
import { notificationSend, routeFor } from './operator-alerts.ts'
import { chatPage, operatorAnswer, operatorBody } from './operator-page.ts'
import { endpoints } from './endpoints.ts'
import { PER_SEGMENT } from './text-spend.ts'
import { vapidKey } from '@yaks/push'
import { browser } from '@yaks/push/testing'

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
let told = async (text: string, about?: string) => {
  let said = JSON.parse(
    String(await notify.run({ text, ...about ? { about } : {} })),
  ) as {
    notification: string
    reaches: string
  }
  await service.drain()
  let [row] = await store.g.get([said.notification])
  return { ...said, row }
}
let page = async (view: string, fields: Record<string, string> | object) => {
  let body: BodyInit = JSON.stringify(fields)
  if (view != 'push') {
    body = new FormData()
    for (let [k, v] of Object.entries(fields)) body.set(k, String(v))
  }
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
  let envelope = byMail.row.mail as Comp
  assertEquals(envelope.from, 'ana@yaks.app')
  assertEquals(envelope.to, ADDRESS)
  assertEquals(typeof envelope.at, 'string')
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

// A browser notification, on each browser the person allowed (T-147488):
// two browsers at a push service in this process, each opening what it is
// handed with its own keys.
let pushes: Record<string, number> = {}
let heard: { at: string; request: Request }[] = [], refused: string[] = []
let pushService = endpoints(globalThis).open((req) => {
  let at = new URL(req.url).pathname, status = pushes[at] ?? 201
  if (status == 201) heard.push({ at, request: req })
  else refused.push(at)
  return new Response(null, { status })
})
let [laptop, phone] = await Promise.all([
  browser(`${pushService.url}/laptop`),
  browser(`${pushService.url}/phone`),
])
let chatted = async () => await (await chatPage(env, space, held, 'new')).text()
let offerless = await operatorBody(env, space, held)
let chatOfferless = await chatted()
env.PUSH_VAPID_KEY = JSON.stringify(await vapidKey())
let offered = await operatorBody(env, space, held)
let chatOffered = await chatted()
let notAllowed = await page('push', { endpoint: 'http://push.invalid' })
let allowed = [
  await page('push', laptop.subscription),
  await page('push', phone.subscription),
  await page('push', phone.subscription),
]
await page('alerts', { channel: 'push' })
let chosePush = await operatorBody(env, space, held)
let chatOn = await chatted()
// What was written before a browser was allowed is not pushed to it.
let owed = await routeFor(dir, person, '2000-01-01T00:00:00.000Z')
let since = await routeFor(dir, person, new Date().toISOString())
let opened = async () =>
  Object.fromEntries(
    await Promise.all(
      take(heard).map(async ({ at, request }) => {
        let tab = at.endsWith('laptop') ? laptop : phone
        return [at.slice(1), JSON.parse((await tab.opened(request)).payload)]
      }),
    ),
  )
let about = crypto.randomUUID()
let byPush = await told('Your report is ready.\nIt has three charts.', about)
let onBoth = await opened()
pushes['/laptop'] = 410
let afterGone = await told('The laptop is gone.')
let onPhone = await opened()
let goneOnce = take(refused)
let left = await dir.pushes(person)
pushes['/phone'] = 404
take(texted)
let fellBack = await told('Every browser is gone.')
let fallen = [take(heard), take(refused), take(texted).map((t) => t.to)]
await pushService.stop()
test('a person allows browser notifications on the Operator page, one subscription per browser', () => {
  assertEquals(offerless.includes('value="push"'), false)
  assertStringIncludes(offered, 'value="push"')
  assertStringIncludes(offered, 'on this browser, once you allow it')
  assertEquals(notAllowed.status, 400)
  assertEquals(allowed.map((a) => a.said), [{ browsers: 1 }, { browsers: 2 }, {
    browsers: 2,
  }])
  assertMatch(chosePush, /value="push"[^>]*checked/)
  assertStringIncludes(chosePush, 'on the 2 browsers you allowed')
})
test('the conversation offers alerts on this device in one press, once yaks.app can push', () => {
  assertEquals(chatOfferless.includes('data-alerts-offer'), false)
  assertStringIncludes(chatOffered, 'data-alerts-offer')
  assertStringIncludes(chatOffered, 'data-at="/manage/ana/operator"')
  assertStringIncludes(chatOffered, '_alerts')
  assertStringIncludes(chatOffered, 'add this page to your Home Screen first')
  assertEquals(chatOffered.includes('data-on'), false)
  assertStringIncludes(chatOn, 'data-on')
  assertMatch(chatOn, /data-badge="0"/)
})
test('a browser allowed after an alert was written is not told it', () => {
  assertEquals(owed?.by, 'text')
  assertEquals(since?.by == 'push' && since.to.length, 2)
})
test('an alert to a person who chose push is a notification on each browser they allowed', () => {
  assertEquals(byPush.reaches, 'push')
  assertEquals(Object.keys(onBoth).sort(), ['laptop', 'phone'])
  let shown = onBoth.phone
  // The alert in a line, opening the conversation at what it is about, and
  // how many things need them for the installed icon.
  assertEquals([shown.title, shown.body], [
    space.operator,
    'Your report is ready.',
  ])
  assertEquals(new URL(shown.url).pathname, '/manage/ana')
  assertEquals(new URL(shown.url).hash, `#ask-${about}`)
  assertEquals(shown.tag, byPush.notification)
  assertEquals(shown.count, 0)
  assertEquals(typeof (byPush.row.delivered as { at: string }).at, 'string')
})
test('a browser that took back its subscription is dropped, and the rest still hear', () => {
  assertEquals([goneOnce, Object.keys(onPhone)], [['/laptop'], ['phone']])
  assertEquals(left.map((b) => b.endpoint), [phone.subscription.endpoint])
  assertEquals(typeof (afterGone.row.delivered as { at: string }).at, 'string')
})
test('when every browser allowed is gone, the alert goes the next way, as for a stopped number', async () => {
  assertEquals(fallen, [[], ['/phone'], [ANA]])
  assertEquals(await dir.pushes(person), [])
  assertEquals(typeof (fellBack.row.delivered as { at: string }).at, 'string')
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
