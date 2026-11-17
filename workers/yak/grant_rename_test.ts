import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { connector, fresh, seed, unique } from './probe.ts'

let k = await fresh()
let slug = unique('grant-rename')
let moved = `${slug}-moved`
let other = `${slug}-other`
let owner = await seed(k, [{ slug, apps: [] }, { slug: other, apps: [] }])
let agent = connector(k, owner.cookie)
for (let space of [slug, other]) {
  await agent.tool('app_new', {
    space,
    slug: 'private',
    title: space,
    access: 'private',
  })
}
let grant = await agent.tool('grant', { space: slug })
let token = /yak login (\S+)/.exec(grant)![1]
let cli = connector(k, undefined, token)
await agent.tool('space_set', { space: slug, slug: moved })
await agent.tool('space_set', { space: other, slug })
let bearer = { authorization: `Bearer ${token}` }

test('a CLI grant follows its space through a rename and cannot reach its old name’s new space', async () => {
  let apps = await cli.tool('app_list', { space: moved })
  assertStringIncludes(apps, moved)
  assertStringIncludes(
    (await assertRejects(() => cli.tool('app_list', { space: slug }), Error))
      .message,
    `no space ${slug}`,
  )
  let own = await cli.tool('app_list')
  assertStringIncludes(own, moved)
  assertEquals(own.includes(`${slug}.yaks.app`), false)
})

test('app API authorization follows the grant’s space identity', async () => {
  for (let [space, status] of [[moved, 200], [slug, 401]] as const) {
    let res = await k.at(`${space}.yaks.app`, '/private/api/query?.doc', {
      headers: bearer,
    })
    await res.body?.cancel()
    assertEquals(res.status, status, space)
  }
})

test('the app resolver finds only the grant’s renamed space', async () => {
  let res = await k.at('yaks.app', '/api/app?app=private', { headers: bearer })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).app, `${moved}/private`)
})

test('the extension socket refuses the space that took the grant’s former slug', async () => {
  let res = await k.at('yaks.app', `/manage/${slug}/operator?browser=1`, {
    headers: { ...bearer, upgrade: 'websocket' },
  })
  await res.body?.cancel()
  assertEquals(res.status, 403)
})

test('a clone credential cannot read the space that took its former slug', async () => {
  let permitted = await k.at(
    `${moved}.yaks.app`,
    '/private.git/info/refs?service=git-upload-pack',
    {
      headers: {
        authorization: `Basic ${btoa(`x:${token}`)}`,
        'git-protocol': 'version=2',
      },
    },
  )
  await permitted.body?.cancel()
  assertEquals(permitted.status, 200)
  let res = await k.at(
    `${slug}.yaks.app`,
    '/private.git/info/refs?service=git-upload-pack',
    {
      headers: {
        authorization: `Basic ${btoa(`x:${token}`)}`,
        'git-protocol': 'version=2',
      },
    },
  )
  await res.body?.cancel()
  assertEquals(res.status, 403)
})

addEventListener('unload', () => void k.stop())
