// Calendar requests through the app router and anonymous graph read policy.
import { cleanup, equal, ok, test } from '@yaks/testing'
import { connector, fresh, signIn } from './probe.ts'
import { appStore } from './directory.ts'
import { ACCEPTED } from './door.ts'
import type { Env } from './env.ts'
import { KERNEL } from './meta.ts'

let env!: Env
let k = await fresh({}, (value) => env = value)
cleanup(() => k.stop())
let owner = await signIn(k)
let agent = connector(k, owner.cookie)
let host = `${owner.email.split('@')[0]}.${k.host}`
let slug = `calendar${crypto.randomUUID().slice(0, 6)}`
await agent.tool('app_new', { slug, title: 'Calendar', access: 'public' })
await agent.tool('app_files', {
  app: slug,
  op: 'write',
  path: 'vocab.json',
  content: JSON.stringify({
    $defs: {
      private_note: {
        personal: 'by',
        properties: { by: { type: 'string', ref: 'entity', death: 'keep' } },
      },
    },
  }),
})
await agent.tool('app_deploy', { app: slug })
let eid = crypto.randomUUID(), hidden = crypto.randomUUID()
let cancelled = crypto.randomUUID(), person = owner.person
let event = {
  starts: '2026-11-08T15:00:00Z',
  ends: '2026-11-08T16:00:00Z',
  repeats: 'FREQ=WEEKLY',
  place: 'Church',
}
await agent.tool('graph_apply', {
  app: slug,
  entities: [
    { entity: { eid: person }, person: {} },
    {
      entity: { eid },
      event,
      doc: { title: 'Sunday service', body: 'Welcome' },
    },
    {
      entity: { eid: cancelled },
      event,
      doc: { title: 'Cancelled' },
      cancelled: {},
    },
  ],
})
let privateWrite = await k.at(host, `/${slug}/api/apply`, {
  method: 'POST',
  headers: { cookie: owner.cookie, 'content-type': 'application/json' },
  body: JSON.stringify([{
    entity: { eid: hidden },
    event,
    doc: { title: 'Private appointment' },
    private_note: { by: person },
  }]),
})
if (!privateWrite.ok) throw new Error(await privateWrite.text())
await privateWrite.body?.cancel()
let path = `/${slug}/calendar.ics`
let response = await k.at(host, path)
let text = await response.text()
let signed = await k.at(host, path, { headers: { cookie: owner.cookie } })
let signedText = await signed.text()
let head = await k.at(host, path, { method: 'HEAD' })
let post = await k.at(host, path, { method: 'POST' })
await agent.tool('graph_apply', {
  app: slug,
  entities: [{ entity: { eid }, doc: { title: 'Updated service' } }],
})
let changed = await (await k.at(host, path)).text()
await agent.tool('app_set', { app: slug, access: 'private' })
let shut = await k.at(host, path, { headers: { cookie: owner.cookie } })

// Simulate an immutable release whose event word predates the platform's.
let legacy = `legacy${crypto.randomUUID().slice(0, 6)}`
await agent.tool('app_new', { slug: legacy, title: 'Legacy', access: 'public' })
let space = (await k.dir.space(owner.name))!
let app = (await k.dir.app(space, legacy))!
let store = appStore(env.STORE, space, app, env)
let declared = await store('/vocab', {
  method: 'POST',
  body: JSON.stringify({
    $defs: { event: { properties: { date: { type: 'string' } } } },
  }),
}, { ...KERNEL, [ACCEPTED]: JSON.stringify(['event']) })
if (!declared.ok) throw new Error(await declared.text())
await declared.body?.cancel()
let seeded = await store('/apply', {
  method: 'POST',
  body: JSON.stringify([{
    entity: { eid: crypto.randomUUID() },
    event: { date: '2026-11-08' },
    doc: { title: 'Legacy entry' },
  }]),
}, KERNEL)
if (!seeded.ok) throw new Error(await seeded.text())
await seeded.body?.cancel()
let oldFeed = await k.at(host, `/${legacy}/calendar.ics`)
let oldText = await oldFeed.text()

test('calendar.ics serves current graph events without cookies or a login', () => {
  equal(response.status, 200)
  equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8')
  equal(response.headers.get('cache-control'), 'no-cache')
  ok(text.includes(`UID:${eid}@yaks.app`))
  ok(text.includes('SUMMARY:Sunday service\r\n'))
  ok(text.includes('RRULE:FREQ=WEEKLY\r\n'))
  ok(text.includes('DESCRIPTION:Welcome\r\n'))
  ok(changed.includes('SUMMARY:Updated service\r\n'))
})

test('an older custom event vocabulary without starts yields an empty feed', () => {
  equal(oldFeed.status, 200)
  ok(oldText.startsWith('BEGIN:VCALENDAR\r\n'))
  equal(oldText.includes('BEGIN:VEVENT'), false)
  equal(oldText.includes('Legacy entry'), false)
})

test('public calendars exclude personal and cancelled rows even for an owner', () => {
  equal(signedText, text)
  for (let title of ['Private appointment', 'Cancelled']) {
    equal(text.includes(title), false)
  }
  equal(shut.status, 404)
})

test('calendar subscriptions support HEAD and refuse writes', async () => {
  equal(head.status, 200)
  equal(await head.text(), '')
  equal(post.status, 405)
  equal(post.headers.get('allow'), 'GET, HEAD')
})
