import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { platform } from './directory-rows-probe.ts'
import { texter } from './phone-providers.ts'
import { endpoints } from './endpoints.ts'

let p = platform('phone-settings')
let eid = crypto.randomUUID()
let number = '+12695550100'
let posted: { path: string; body: unknown; key: string | null }[] = []
let api = endpoints(globalThis).open(async (req) => {
  posted.push({
    path: new URL(req.url).pathname,
    body: await req.json(),
    key: req.headers.get('PINNACLE-API-KEY'),
  })
  return Response.json({ messageId: 'msg_settings' })
})
Object.assign(p.env, {
  PINNACLE_API_KEY: 'test-only',
  PINNACLE_NUMBER: '+18885550100',
  PINNACLE_API: api.url,
  PHONE_SENDER: { via: 'pinnacle' },
})
await p.dir.apply({
  entities: [
    {
      entity: { eid },
      space: { slug: 'phone-settings', store: 'phone-settings' },
      sender: { via: 'pinnacle' },
      phone: { number },
    },
  ],
})
let space = (await p.dir.at(eid))!
let found = await p.dir.textSpace(number)
let platformReceipt = await texter(p.env).send({
  to: '+12695550142',
  text: 'Platform',
})
let spaceReceipt = await texter(p.env, space.sender).send({
  to: '+12695550142',
  text: 'Space',
})
await api.stop()

test('platform and space phone selections use the same provider boundary and neutral number component', () => {
  assertEquals(found?.eid, eid)
  assertEquals(space.sender, { via: 'pinnacle', number })
  assertEquals(platformReceipt, {
    id: 'msg_settings',
    from: '+18885550100',
    via: 'pinnacle',
  })
  assertEquals(spaceReceipt, {
    id: 'msg_settings',
    from: number,
    via: 'pinnacle',
  })
  assertEquals(posted, [
    {
      path: '/messages/send/sms',
      key: 'test-only',
      body: { from: '+18885550100', to: '+12695550142', text: 'Platform' },
    },
    {
      path: '/messages/send/sms',
      key: 'test-only',
      body: { from: number, to: '+12695550142', text: 'Space' },
    },
  ])
})
