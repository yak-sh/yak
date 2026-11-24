import { assertEquals } from '@std/assert'
import { DIRECT_CAP, messageEid, type Said } from '@yaks/chat'
import { clock, test } from '@yaks/testing'
import { line } from '@yaks/query'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { arrived, PLATFORMS } from './chat.ts'
import { platform as rows } from './directory-rows-probe.ts'
import { PLATFORM_OBJECT } from './door.ts'
import { KERNEL, meta } from './meta.ts'
import { platform } from './testing.ts'

let WEEK = 7 * 86_400_000
let START = Date.parse('2026-11-24T14:23:00.000Z')
let MARK = 'yak/store/chat-dm-expiry/1'
let discord = PLATFORMS.get('discord')!
let message = (id: string, account: string, at = START): Said => ({
  id,
  room: 'fixture',
  author: { id: account, name: 'Fixture' },
  text: 'Synthetic DM',
  at: new Date(at).toISOString(),
  addressed: 'direct',
})
let row = (said: Said, until?: string) => ({
  entity: { eid: messageEid('discord', said.id) },
  chat_dm: { via: 'discord', account: said.author.id, said, until },
})

test('pending DMs expire from the directory without a recoverable copy', async () => {
  let now = START
  let time = { ...clock(START), now: () => now }
  let p = platform('chat retention', { CLOCK: time, WIRE: undefined })
  let at = meta(p.env)
  let person = crypto.randomUUID()
  await at.apply([
    { entity: { eid: person }, person: {} },
    {
      entity: { eid: '$linked' },
      connection: {
        integration: 'discord-account',
        owner: person,
        account: 'seatless',
        status: 'connected',
      },
    },
  ], KERNEL)
  let messages = [message('one', 'unlinked'), message('two', 'seatless')]
  for (let said of messages) await arrived(p.env, discord, said)
  let ids = messages.map((said) => row(said).entity.eid)
  let held = () => at.query(line`.entity.eid=${ids}&.chat_dm`)
  assertEquals(
    (await held()).map((b) => (b.chat_dm as { until: string }).until),
    [
      new Date(START + WEEK).toISOString(),
      new Date(START + WEEK).toISOString(),
    ],
  )
  await at.apply(
    ids.map((eid) => ({
      entity: { eid },
      chat_dm: { until: new Date(START + 1).toISOString() },
    })),
    KERNEL,
  )
  let store = p.object(PLATFORM_OBJECT)
  let ring = async () => {
    await p.states.get(PLATFORM_OBJECT)!.storage.deleteAlarm()
    await store.alarm()
  }
  await ring()
  assertEquals((await held()).length, 2)
  now++
  await ring()
  assertEquals((await held()).length, 0)
  assertEquals((await at.trash!(ids)).length, 0)
})

test('DM admission keeps the last available slot for one concurrent arrival', async () => {
  let time = clock(START)
  let heard: string[] = []
  let p = rows('chat cap', { CLOCK: time }, {
    handlers: () => ({
      chat_dm_arrived: ({ entity }) => void heard.push(entity.eid),
    }),
  })
  let at = meta(p.env)
  let until = new Date(START + WEEK).toISOString()
  await at.apply(
    Array.from(
      { length: DIRECT_CAP - 1 },
      (_, i) => row(message(String(i), 'fixture'), until),
    ),
    KERNEL,
  )
  heard.length = 0
  let fresh = ['first', 'second'].map((id) => message(id, 'fixture'))
  await Promise.all(fresh.map((said) => arrived(p.env, discord, said)))
  await arrived(p.env, discord, message('independent', 'another'))
  let held = await at.query('.chat_dm.account=fixture&.chat_dm.said')
  assertEquals(held.length, DIRECT_CAP)
  assertEquals(
    (await at.query('.chat_dm.account=another&.chat_dm.said')).length,
    1,
  )
  let refused = fresh.map((said) => row(said).entity.eid)
    .find((eid) => !held.some((b) => b.entity.eid == eid))
  assertEquals(heard.length, 2)
  assertEquals(heard.includes(refused!), false)

  let [person, space] = [crypto.randomUUID(), crypto.randomUUID()]
  await at.apply([
    { entity: { eid: person }, person: {} },
    { entity: { eid: space }, space: { slug: 'room', store: 'room' } },
    {
      entity: { eid: '$seat' },
      member: { person, space, role: 'owner' },
    },
    {
      entity: { eid: '$connection' },
      connection: {
        owner: person,
        integration: 'discord-account',
        account: 'fixture',
        status: 'connected',
      },
    },
  ], KERNEL)
  let seated = message('seated', 'fixture')
  await arrived(p.env, discord, seated)
  assertEquals(heard.at(-1), row(seated).entity.eid)
})

test('a copied directory rehearses dating only its legacy held DMs', async () => {
  let time = clock(START)
  let source = platform('chat migration source', {
    CLOCK: time,
    WIRE: undefined,
  })
  let at = meta(source.env)
  let old = [message('legacy-old', 'fixture'), message('legacy-new', 'fixture')]
  let kept = row(
    message('dated', 'fixture'),
    new Date(START + WEEK).toISOString(),
  )
  await at.apply([...old.map((said) => row(said)), kept], KERNEL)
  let open = source.states.get(PLATFORM_OBJECT)!.storage.checkpoint()
  let copy = platform('chat migration copy', { CLOCK: time, WIRE: undefined })
  let store = copy.object(PLATFORM_OBJECT, open)
  let headers = { ...KERNEL, 'x-store': PLATFORM_STORE }
  let request = (path: string) =>
    store.fetch(new Request(`http://store${path}`, { method: 'POST', headers }))
  let response = await request('/move?rehearse=1')
  assertEquals(response.status, 200)
  let { rules } = await response.json()
  let { rows, moved, failed } = rules.find((r: { mark: string }) =>
    r.mark == MARK
  )
  assertEquals({ rows, moved, failed }, {
    rows: 2,
    moved: 2,
    failed: undefined,
  })
  assertEquals(
    (await meta(copy.env).query('.chat_dm.said&!chat_dm.until')).length,
    2,
  )
})
