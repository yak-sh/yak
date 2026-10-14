// The platform admin's directory (admin.ts): what each row uses, counted over
// the whole directory, and the door that draws it for the admin alone.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { type Census, uses } from './admin.ts'
import type { Meter } from './directory.ts'
import { connector, kernel, signIn } from './probe.ts'

let NOW = new Date('2026-10-14T12:00:00Z')
let meter = (m: Partial<Meter>) => ({ month: '2026-10', ...m })
let census = (): Census => ({
  people: [
    { entity: { eid: 'ann' }, person: {}, email: { address: 'ann@x.com' } },
    {
      entity: { eid: 'bot' },
      person: {},
      email: { address: 'probe@bot.yak.sh' },
      used: { at: '2026-10-13T00:00:00Z' },
      signed_in: { at: '2026-10-14T09:00:00Z' },
    },
  ],
  spaces: [
    {
      entity: { eid: 'home' },
      space: { slug: 'ann' },
      meter: meter({ models: 0.25, realtime: 0.25, bytes: 100, files: 20 }),
    },
    {
      entity: { eid: 'shop' },
      space: { slug: 'shop' },
      plan: { tier: 'plus' },
      meter: meter({ models: 1, bytes: 1000 }),
    },
    { entity: { eid: 'lab' }, space: { slug: 'lab' } },
  ],
  apps: [
    {
      entity: { eid: 'a1' },
      app: { slug: 'notes', space: 'home', version: 2 },
      meter: meter({ requests: 40, bytes: 100 }),
      used: { at: '2026-10-12T00:00:00Z' },
    },
    {
      entity: { eid: 'a2' },
      app: { slug: 'cart', space: 'shop', version: 1 },
      meter: { month: '2026-09', requests: 9, bytes: 7 },
      used: { at: '2026-10-14T10:00:00Z' },
    },
    {
      entity: { eid: 'a3' },
      app: { slug: 'old', space: 'shop', version: 1 },
      trashed: { at: '2026-10-01T00:00:00Z' },
    },
    { entity: { eid: 'a4' }, app: { slug: 'try', space: 'lab', version: 1 } },
  ],
  seats: [
    {
      entity: { eid: 's1' },
      member: { space: 'home', person: 'ann', role: 'owner' },
    },
    {
      entity: { eid: 's2' },
      member: { space: 'shop', person: 'ann', role: 'owner' },
    },
    {
      entity: { eid: 's3' },
      member: { space: 'lab', person: 'bot', role: 'owner' },
    },
    {
      entity: { eid: 's4' },
      member: { space: 'shop', person: 'bot', role: 'viewer' },
    },
  ],
})

test('a person uses what the spaces they own use, from one budget', () => {
  let u = uses(census(), NOW)
  assertEquals(u.get('ann'), {
    spend: { spent: 1.5, limit: 3.2 },
    storage: 1120,
    apps: 2,
    active: null,
    test: false,
  })
  assertEquals(u.get('bot')?.active, '2026-10-14T09:00:00Z')
  assertEquals(u.get('bot')?.test, true)
})

test('a space counts its live apps and its latest use; an app its month', () => {
  let u = uses(census(), NOW)
  assertEquals(u.get('shop'), {
    spend: { spent: 1 },
    storage: 1000,
    apps: 1,
    active: '2026-10-14T10:00:00Z',
    test: false,
  })
  assertEquals(u.get('a1')?.requests, 40)
  assertEquals(u.get('a2')?.requests, 0, 'last month is not this month')
  assertEquals([u.get('lab')?.test, u.get('a4')?.test], [true, true])
})

test('the directory is drawn for the platform admin and nobody else', async () => {
  let k = await kernel()
  try {
    let them = await signIn(k)
    let slug = them.email.split('@')[0]
    await connector(k, them.cookie).tool('app_new', {
      space: slug,
      slug: 'notes',
      title: 'Field notes',
    })
    let get = (path: string, cookie?: string) =>
      k.at('yaks.app', path, {
        redirect: 'manual',
        headers: cookie ? { cookie } : {},
      })
    let out = await get('/admin/people')
    assertEquals(out.status, 302)
    assertEquals(out.headers.get('location'), '/login?return=%2Fadmin%2Fpeople')
    await out.body?.cancel()
    let stranger = await get('/admin/people', them.cookie)
    assertEquals(stranger.status, 404)
    await stranger.body?.cancel()

    let found = await get(`/admin/people?q=${slug}`, k.owner.cookie)
    assertEquals(found.status, 200)
    let html = await found.text()
    assertStringIncludes(html, them.email)
    let eid = html.match(/href="\/admin\/([0-9a-f-]{36})"/)?.[1]
    let page = await (await get(`/admin/${eid}`, k.owner.cookie)).text()
    assertStringIncludes(page, 'Owner of')
    assertStringIncludes(page, `${slug}.yaks.app`)
    let apps = await (await get(`/admin/apps?q=${slug}`, k.owner.cookie)).text()
    assertStringIncludes(apps, 'Field notes')
    assertStringIncludes(apps, `${slug}/notes`)
  } finally {
    await k.stop()
  }
})
