// Private subscription links through the app router and vouched sign-up tools.
import { cleanup, equal, ok, test } from '@yaks/testing'
import { connector, fresh, signIn } from './probe.ts'
import { signupTools } from './operator-signup.ts'
import type { Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'

let env!: Env
let k = await fresh({}, (value) => env = value)
cleanup(() => k.stop())
let owner = await signIn(k), agent = connector(k, owner.cookie)
let host = `${owner.name}.${k.host}`, app = 'personal-calendar'
await agent.tool('app_new', { slug: app, title: 'Sign-ups', access: 'private' })
await agent.tool('app_deploy', { app })
let space = (await k.dir.seats(owner.person))[0].space
let person = crypto.randomUUID(), other = crypto.randomUUID()
let browser = crypto.randomUUID(), local = crypto.randomUUID()
let browserLocal = crypto.randomUUID(), webRegistration = crypto.randomUUID()
await meta(env).apply([
  { entity: { eid: person }, person: {}, phone: { number: '+12695550144' } },
  { entity: { eid: browser }, person: {}, phone: { number: '+12695550145' } },
], KERNEL)
let events = Array.from({ length: 9 }, () => crypto.randomUUID())
let registrations = Array.from({ length: 8 }, () => crypto.randomUUID())
let event = {
  starts: '2026-11-08T10:00:00',
  ends: '2026-11-08T11:00:00',
  zone: 'America/Detroit',
  repeats: 'FREQ=WEEKLY',
}
let labels = [
  'Mine',
  'Other person',
  'Unfinished',
  'Cancelled sign-up',
  'Waitlist',
  'Cancelled event',
  'No sign-up',
  'Website',
  'Website only',
]
await agent.tool('graph_apply', {
  app,
  entities: [
    { entity: { eid: local }, phone: { number: '+12695550144' } },
    { entity: { eid: browserLocal }, phone: { number: '+12695550145' } },
    ...events.map((eid, i) => ({
      entity: { eid },
      form: {},
      event,
      doc: { title: labels[i] },
      ...i == 5 ? { cancelled: {} } : {},
    })),
  ],
})
await agent.tool('graph_apply', {
  app,
  entities: [
    {
      entity: { eid: webRegistration },
      registration: { form: events[7], person: local, answers: {} },
      completed: {},
    },
    {
      entity: { eid: crypto.randomUUID() },
      registration: { form: events[8], person: browserLocal, answers: {} },
      completed: {},
    },
    ...registrations.map((eid, i) => ({
      entity: { eid },
      registration: {
        form: events[i == 7 ? 1 : i == 6 ? 0 : i],
        submitter: i == 1 || i == 7 ? other : person,
        answers: {},
      },
      ...i == 2 ? {} : { completed: {} },
      ...i == 3 ? { cancelled: {} } : {},
      ...i == 4 ? { waitlisted: {} } : {},
    })),
  ],
})
let run = async (who: string, name: string, args = {}) =>
  JSON.parse(
    await signupTools(env, space, who, '+12695550144')
      .find((t) => t.name == `signup_${name}`)!.run({ app, ...args }) as string,
  )
let mine = (await run(person, 'mine'))[0].result
let link: string = mine[0].calendar
let fetch = (link: string, init?: RequestInit) => {
  let url = new URL(link)
  return k.at(url.host, url.pathname + url.search, init)
}
let browserLink = (await run(browser, 'calendar'))[0].result.calendar
let browserText = await (await fetch(browserLink)).text()
let response = await fetch(link)
let text = await response.text()
let head = await fetch(link, { method: 'HEAD' })
let post = await fetch(link, { method: 'POST' })
let wrong = await k.at(host, `/${app}/calendar/unknown.ics`)
let forbidden = await k.at(host, `/${app}/api/query?q=.feed`, {
  headers: { authorization: `Bearer ${link.split('/').at(-1)!.slice(0, -4)}` },
})
let stolen = false
try {
  await run(other, 'calendar', {
    registration: registrations[0],
    replace: true,
  })
} catch {
  stolen = true
}
let otherLink: string = (await run(other, 'mine'))[0].result[0].calendar
let otherText = await (await fetch(otherLink)).text()
let rotated: string = (await run(person, 'calendar', {
  registration: registrations[0],
  replace: true,
}))[0].result.calendar
let revoked = await fetch(link)
let replacement = await fetch(rotated)
let replacementText = await replacement.text()
await agent.tool('graph_apply', {
  app,
  entities: [{ entity: { eid: webRegistration }, cancelled: {} }, {
    entity: { eid: registrations[0] },
    cancelled: {},
  }, {
    entity: { eid: registrations[6] },
    cancelled: {},
  }],
})
let removed = await (await fetch(rotated)).text()
let afterCancellation = (await run(person, 'calendar', {
  registration: registrations[0],
  replace: true,
}))[0].result.calendar
await agent.tool('app_set', { app, access: 'open' })
let anonymous = await k.at(host, `/${app}/api/query?q=.feed`)
let anonymousText = await anonymous.text()

// A second app cannot use a token from the first app's store.
await agent.tool('app_new', {
  slug: 'other-calendar',
  title: 'Other',
  access: 'private',
})
let elsewhere = await k.at(
  host,
  `/other-calendar/calendar/${afterCancellation.split('/').at(-1)}`,
)

test('private calendars contain only accepted sign-ups, once per event, with their zone', () => {
  equal(response.status, 200)
  equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8')
  equal(response.headers.get('cache-control'), 'private, no-store')
  equal(text.match(/BEGIN:VEVENT/g)?.length, 2)
  ok(text.includes(`UID:${events[0]}@yaks.app`))
  ok(text.includes('DTSTART;TZID=America/Detroit:20261108T100000\r\n'))
  ok(text.includes('RRULE:FREQ=WEEKLY\r\n'))
  for (let title of labels.filter((_, i) => i != 0 && i != 7)) {
    equal(text.includes(`SUMMARY:${title}\r\n`), false)
  }
  equal(new Set(mine.map((row: { calendar: string }) => row.calendar)).size, 1)
  equal(otherText.includes('SUMMARY:Mine\r\n'), false)
  equal(otherText.includes('SUMMARY:Website\r\n'), false)
  ok(text.includes('SUMMARY:Website\r\n'))
  ok(browserText.includes('SUMMARY:Website only\r\n'))
  equal(browserText.match(/BEGIN:VEVENT/g)?.length, 1)
  ok(otherText.includes('SUMMARY:Other person\r\n'))
})

test('calendar tokens open only their feed, hide from anonymous graph reads, and refuse writes', async () => {
  equal(head.status, 200)
  equal(await head.text(), '')
  equal(post.status, 405)
  equal(post.headers.get('allow'), 'GET, HEAD')
  equal(wrong.status, 404)
  equal(forbidden.status, 401)
  equal(elsewhere.status, 404)
  equal(anonymous.status, 200)
  equal(anonymousText.includes('"token"'), false)
  equal(anonymousText.includes(person), false)
  equal(stolen, true)
})

test('a person replaces their link and subscription reads follow registration changes', () => {
  ok(rotated != link)
  equal(revoked.status, 404)
  equal(replacement.status, 200)
  equal(replacementText, text)
  equal(removed.includes('BEGIN:VEVENT'), false)
  ok(afterCancellation != rotated)
})
