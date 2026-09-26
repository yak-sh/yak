import { assertEquals, assertRejects } from '@std/assert'
import { packages, released } from './release.ts'

// jsr.io's scope listing, `per` names a page, over `names`.
let listing = (names: string[], per: number): typeof fetch => (url) => {
  let page = Number(new URL(String(url)).searchParams.get('page'))
  let items = names.slice((page - 1) * per, page * per).map((name) => ({
    name,
  }))
  return Promise.resolve(Response.json({ items, total: names.length }))
}

Deno.test('a scope’s packages are read page by page', async () => {
  let names = ['api', 'cli', 'doc', 'web', 'yaml']
  assertEquals(await packages('yaks', listing(names, 2)), names)
  assertEquals(await packages('yaks', listing([], 2)), [])
})

Deno.test('a release resolves under an exemption for every package in it', async () => {
  let config = await released('yaks', listing(['cli', 'web'], 100))
  assertEquals(config.minimumDependencyAge.exclude, [
    'jsr:@yaks/cli',
    'jsr:@yaks/web',
  ])
})

Deno.test('a scope jsr.io will not list is refused, not taken as empty', async () => {
  let down: typeof fetch = () =>
    Promise.resolve(new Response('', { status: 503 }))
  await assertRejects(() => packages('yaks', down), Error, '503')
})
