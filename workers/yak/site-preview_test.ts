// A site rebuilt from a web address the box was given (newcomer.ts
// `previewing`), through the kernel: the app born for it is private and
// marked, stays private through app_set, wears its preview line and asks not
// to be indexed, and a domain of that site verified on the space lifts it.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { cleanup, test } from '@yaks/testing'
import { connector, fresh, signIn } from './probe.ts'
import type { Env } from './env.ts'
import { HELD, previewed } from './newcomer.ts'
import { refresh } from './domains.ts'
import { KERNEL, meta } from './meta.ts'

let env!: Env
let k = await fresh({}, (e) => {
  env = e
})
cleanup(() => k.stop())

let site = 'https://www.grace.example/visit'
let me = await signIn(k)
let agent = connector(k, me.cookie)
let made = await agent.tool('app_new', { slug: 'before', title: 'Before' })
let space = (await k.dir.space(/^app ([^/]+)\//.exec(made)![1]))!
await previewed(env, space, site)
space = (await k.dir.space(space.slug))!

let said = await agent.tool('app_new', {
  slug: 'grace',
  title: 'Grace',
  access: 'public',
})
let grace = (await k.dir.app(space, 'grace'))!
let opened = await assertRejects(() =>
  agent.tool('app_set', { app: 'grace', access: 'public' })
)
await agent.tool('app_files', {
  app: 'grace',
  op: 'write',
  path: 'index.html',
  content: '<!doctype html><html><body><h1>Grace</h1></body></html>',
})
await agent.tool('app_deploy', { app: 'grace' })
let page = (cookie?: string) =>
  k.at(`${space.slug}.yaks.app`, '/grace/', {
    headers: cookie ? { cookie } : {},
  })
let mine = await page(me.cookie)
let html = await mine.text()
let stranger = await page()
await stranger.body?.cancel()

// The person attaches grace.example and its record is seen: the stamp that
// says it is verified takes the preview off.
let host = crypto.randomUUID()
let at = new Date().toISOString()
await meta(env).apply([{
  entity: { eid: host },
  hostname: { name: 'grace.example', serves: space.eid, stage: 'active', at },
}], KERNEL)
await refresh(env, {
  eid: host,
  name: 'grace.example',
  serves: space.eid,
  stage: 'active',
  at,
  verification: null,
  verified: null,
  to: null,
  mail: null,
}, null)
let lifted = (await k.dir.app(space, 'grace'))!
let opens = await agent.tool('app_set', { app: 'grace', access: 'public' })

test('an app born in a space the box was given a site for is its private preview', () => {
  assertEquals(grace.access, 'private')
  assertEquals(grace.preview?.site, site)
  assert(said.includes(HELD(site)), said)
  assertEquals((opened as Error).message, HELD(site))
})

test("an app the space had before is not the site's preview", async () => {
  assertEquals((await k.dir.app(space, 'before'))!.preview ?? null, null)
})

test('a preview says on its page whose site it is not, and asks not to be indexed', () => {
  assertEquals(mine.status, 200)
  assertEquals(mine.headers.get('x-robots-tag'), 'noindex, nofollow')
  assert(html.includes('data-yak-preview="grace.example"'), html.slice(0, 400))
  assert(![200, 304].includes(stranger.status), String(stranger.status))
})

test("verifying the site's domain on the space lifts its preview", () => {
  assertEquals(lifted.preview ?? null, null)
  assert(/public|anyone/.test(opens), opens)
})
