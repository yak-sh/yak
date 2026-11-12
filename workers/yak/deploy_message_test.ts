// A release says what it changed and why, and the next agent at the app reads
// it: app_files list and read end with the newest releases' messages,
// app_versions lists each under its version, and a copy updated from its
// publisher carries the messages of the releases it crossed.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { connector, kernel, seed, unique } from './probe.ts'

let k = await kernel()
let space = unique('deploy-message')
let { cookie } = await seed(k, [{ slug: space, apps: ['church'] }])
let agent = connector(k, cookie)
let app = { space, app: 'church' }
let deploy = async (page: string, message?: string) => {
  await agent.tool('app_files', {
    ...app,
    files: [{ path: 'index.html', content: page }],
  })
  await agent.tool('app_deploy', { ...app, ...message && { message } })
}
let first = 'Adds the home page with the service times.'
let second = 'Adds a Christmas services page.\n\nThe church asked for one ' +
  'page listing the Christmas Eve and Day services.'
await deploy('<h1>Locust Grove</h1>', first)
let name = unique('church')
await agent.tool('app_publish', { ...app, name })
await agent.tool('app_install', { space, name, as: 'copy' })
await deploy('<h1>Locust Grove</h1><a href="christmas">Christmas</a>', second)
await deploy('<h1>Locust Grove</h1>')
await agent.tool('app_publish', { ...app, name })
await agent.tool('app_update', { space, app: 'copy' })
let versions = await agent.tool('app_versions', app)
let list = await agent.answer('app_files', { ...app, op: 'list' })
let read = await agent.answer('app_files', { ...app, op: 'read' })
let copy = await agent.tool('app_versions', { space, app: 'copy' })
await k.stop()

test('app_versions shows each release with its message whole', () => {
  assertStringIncludes(versions, `v1 `)
  assertStringIncludes(versions, `  ${first}`)
  assertStringIncludes(
    versions,
    '  Adds a Christmas services page.\n\n  The church asked',
  )
})

test('an agent reading the app reads what the latest releases changed', () => {
  for (let said of [list, read]) {
    assertStringIncludes(said.text, `v2 `)
    assertStringIncludes(said.text, second)
    assertStringIncludes(said.text, first)
    let releases = (said.value as {
      releases: { version: number; message: string }[]
    }).releases
    // v3 said nothing, so it is not shown; the two that did are, newest first.
    assertEquals(releases.map((r) => [r.version, r.message]), [
      [2, second],
      [1, first],
    ])
  }
})

test("a copy's releases say what its publisher's said", () => {
  assertStringIncludes(copy, `  ${first}`)
  assertStringIncludes(copy, '  Adds a Christmas services page.')
  // One release crossed says its words alone, under no version of its own.
  assert(!copy.includes('v2:'), copy)
})
