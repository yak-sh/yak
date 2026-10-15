import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { platform } from './testing.ts'
import { call, type Ctx } from './tools.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'

// An app whose wrangler config serves dist, with a page in it and a source
// file beside it (T-124473, T-124474).
let built = async () => {
  let scenario = platform('served-folder-secret')
  let { env } = scenario
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  let ctx: Ctx = { env, dir, person: ADA }
  await call(ctx, 'space_new', { slug: 'ada', title: 'Ada' })
  await call(ctx, 'app_new', { space: 'ada', slug: 'site', title: 'S' })
  let files = (items: Record<string, string>) =>
    call(ctx, 'app_files', {
      space: 'ada',
      app: 'site',
      files: Object.entries(items).map(([path, content]) => ({
        path,
        content,
      })),
    })
  return { ...scenario, ctx, files }
}

test('app_files gives addresses only for files the app serves', async () => {
  using s = await built()
  let wrote = await s.files({
    'wrangler.jsonc': '{"assets": {"directory": "dist"}}',
    'dist/about/index.html': '<h1>about</h1>',
    'src/main.js': '1',
  })
  let lines = wrote.text.split('\n')
  assertStringIncludes(
    lines.find((l) => l.startsWith('dist/about/index.html'))!,
    'ada.yaks.app/site/about/ —',
  )
  assertStringIncludes(
    lines.find((l) => l.startsWith('src/main.js'))!,
    'source only, not on the web',
  )
  let listed = await call(s.ctx, 'app_files', {
    space: 'ada',
    app: 'site',
    op: 'list',
  })
  assertEquals(listed.value?.serves, 'dist')
  assertEquals(listed.value?.sourceOnly, ['src/main.js', 'wrangler.jsonc'])
})

test('app_deploy says which folder the app serves', async () => {
  using s = await built()
  await s.files({
    'wrangler.jsonc': '{"assets": {"directory": "dist"}}',
    'dist/index.html': '<h1>home</h1>',
  })
  let out = await call(s.ctx, 'app_deploy', { space: 'ada', app: 'site' })
  assertStringIncludes(out.text, 'serves dist/')
  assertEquals(out.value?.serves, 'dist')
  await s.files({ 'wrangler.jsonc': '{}' })
  let plain = await call(s.ctx, 'app_deploy', { space: 'ada', app: 'site' })
  assert(!('serves' in (plain.value ?? {})))
})
