// Two checkouts start from one release. The second hears what its files would
// remove and replace, and serving stays on the first until it confirms.
import { test } from '@yaks/testing'
import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from '@std/assert'
import { connector, kernel, seed, unique } from './probe.ts'

let k = await kernel()
let space = unique('deploy-base')
let { cookie } = await seed(k, [{ slug: space, apps: ['site'] }])
let agent = connector(k, cookie)
let app = { space, app: 'site' }
let page = (content: string) => ({ path: 'index.html', content })
let write = (files: { path: string; content: string }[]) =>
  agent.tool('app_files', { ...app, files })
let served = async (path: string) => {
  let res = await k.at(`${space}.yaks.app`, `/site/${path}`)
  return { status: res.status, text: await res.text() }
}
await write([page('<h1>Base</h1>')])
await agent.tool('app_deploy', app)
let initial = await agent.answer('app_files', { ...app, op: 'list' })
await write([
  page('<h1>First checkout</h1>'),
  { path: 'autocomplete.js', content: 'export let complete = () => []' },
])
let first = await agent.answer('app_deploy', { ...app, base: 1 })
await write([page('<h1>Second checkout</h1>')])
await agent.tool('app_files', {
  ...app,
  op: 'delete',
  path: 'autocomplete.js',
})
let second = await agent.answer('app_deploy', { ...app, base: 1 })
let live = await served('')
let autocomplete = await served('autocomplete.js')
let versions = await agent.tool('app_versions', app)
let pending = await agent.answer('app_files', { ...app, op: 'list' })
let read = await agent.answer('app_files', {
  ...app,
  op: 'read',
  path: 'index.html',
})
let confirmed = await agent.answer('app_deploy', {
  ...app,
  base: 1,
  confirm: true,
})
let after = await served('')
let removed = await served('autocomplete.js')
await write([page('<h1>Without a base</h1>')])
let unguarded = await agent.answer('app_deploy', app)
let unchanged = await agent.answer('app_deploy', { ...app, base: 1 })
let invalid: string[] = []
for (let base of [-1, 1.5, '1', 100]) {
  try {
    await agent.tool('app_deploy', { ...app, base })
    invalid.push('accepted')
  } catch (e) {
    invalid.push(String(e))
  }
}
await k.stop()

test('two deploys from one base leave the first serving and name the second losses', () => {
  assertEquals(first.value, { deployed: true, version: 2 })
  assertEquals(second.value, {
    deployed: false,
    base: 1,
    version: 2,
    removed: ['autocomplete.js'],
    replaced: ['index.html'],
  })
  assertStringIncludes(second.text, 'confirm')
  assertStringIncludes(second.text, 'autocomplete.js')
  assertStringIncludes(second.text, 'index.html')
  assertStringIncludes(live.text, '<h1>First checkout</h1>')
  assertEquals(autocomplete.status, 200)
  assertStringIncludes(versions, '2 versions')
})

test('file reads and lists say which live version the draft was read against', () => {
  assertEquals((initial.value as { version: number }).version, 1)
  assertEquals((pending.value as { version: number }).version, 2)
  assertEquals((pending.value as { unreleased: boolean }).unreleased, true)
  // The words say it too, since some hosts show their model only the words.
  assertStringIncludes(initial.text, 'live v1, with nothing unreleased')
  assertStringIncludes(pending.text, 'differs from live v2')
  assertStringIncludes(pending.text, 'app_deploy(base: 2)')
  assertEquals((read.value as { version: number }).version, 2)
})

test('confirmation releases the kept draft and calls without a base still deploy', () => {
  assertEquals(confirmed.value, { deployed: true, version: 3 })
  assertStringIncludes(after.text, '<h1>Second checkout</h1>')
  assertEquals(removed.status, 404)
  assertEquals(unguarded.value, { deployed: true, version: 4 })
  assertEquals(unchanged.value, {
    deployed: false,
    base: 1,
    version: 4,
    removed: [],
    replaced: [],
  })
})

test('a deploy refuses a malformed or future base', () => {
  for (let error of invalid) assertNotEquals(error, 'accepted')
  assertStringIncludes(invalid.at(-1)!, 'base')
})
