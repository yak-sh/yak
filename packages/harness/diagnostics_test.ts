import { assert, assertEquals, assertMatch } from '@std/assert'
import { createDiagnostics, uncaught } from './diagnostics.ts'
import { open } from './store.ts'

Deno.test('a defect is an exception entity, stack and cause kept, secrets redacted, and never an entry', async () => {
  let h = open(':memory:')
  let reporter = createDiagnostics({ secrets: ['secret-key-123'] })
  let detach = reporter.attach(h.g)
  let error = new Error('savepoint failed secret-key-123', {
    cause: new Error('statement busy'),
  })
  reporter.report(error, { phase: 'projection', session: 'selected' })
  reporter.report(error, { phase: 'unhandledrejection' })
  await reporter.drain()
  let rows = await h.g.read('.exception')
  assertEquals(rows.length, 1)
  assert(!rows[0].entry)
  assertEquals(await h.g.read('.entry'), [])
  let said = JSON.parse(String((rows[0].content as { body: string }).body))
  assertMatch(said.body, /Caused by:/)
  assertMatch(said.body, /statement busy/)
  assertMatch(said.body, /diagnostics_test.ts/)
  assert(!said.body.includes('secret-key-123'))
  assertEquals(said.session, 'selected')
  detach()
  h.close()
})

Deno.test('a defect nobody can take is said on the terminal, not lost', async () => {
  let warnings: string[] = []
  let reporter = createDiagnostics({ warn: (s) => warnings.push(s) })
  reporter.report(new Error('nowhere to write this'), { phase: 'startup' })
  await reporter.drain()
  assertEquals(warnings.length, 1)
  assertMatch(JSON.parse(warnings[0]).body, /nowhere to write this/)
})

Deno.test('a database failure cannot recurse: the original is printed instead', async () => {
  let warnings: string[] = []
  let attempts = 0
  let reporter = createDiagnostics({ warn: (s) => warnings.push(s) })
  reporter.attach({
    apply: () => {
      attempts++
      throw new Error('database broken')
    },
  })
  reporter.report(new Error('original failure'), { phase: 'daemon' })
  await reporter.drain()
  assertEquals(attempts, 1)
  assertEquals(warnings.length, 1)
  assertMatch(warnings[0], /database broken/)
  assertMatch(warnings[0], /Original exception:[\s\S]*original failure/)
})

Deno.test('global error hooks preserve fatal default, clean up, deduplicate, and uninstall', () => {
  let said: string[] = []
  let reporter = createDiagnostics({ warn: (s) => said.push(s) })
  let target = new EventTarget()
  let cleaned = 0
  let remove = uncaught(reporter, target, () => {
    cleaned++
  })
  let error = new Error('render defect')
  let event = new ErrorEvent('error', { error, cancelable: true })
  assert(target.dispatchEvent(event))
  assert(!event.defaultPrevented)
  let rejection = new Event('unhandledrejection', { cancelable: true })
  Object.defineProperty(rejection, 'reason', { value: error })
  target.dispatchEvent(rejection)
  assertEquals(cleaned, 2)
  assertEquals(said.length, 1)
  remove()
  target.dispatchEvent(new ErrorEvent('error', { error: new Error('later') }))
  assertEquals(said.length, 1)
})

Deno.test('a graph shutdown drain is bounded', async () => {
  let warnings: string[] = []
  let reporter = createDiagnostics({ warn: (s) => warnings.push(s) })
  reporter.attach({ apply: () => new Promise(() => {}) })
  reporter.report(new Error('original'), { phase: 'shutdown' })
  await reporter.drain(1)
  assertMatch(warnings[0], /still pending/)
})

Deno.test('a fatal unhandled rejection really exits the subprocess, saying what it was', async () => {
  let module = new URL('./diagnostics.ts', import.meta.url).href
  let script = 'import {createDiagnostics,uncaught} from ' +
    JSON.stringify(module) + ';' +
    'uncaught(createDiagnostics());' +
    'Promise.reject(new Error("fatal-test", {cause:new Error("root-test")}));'
  let child = await new Deno.Command(Deno.execPath(), {
    args: ['eval', script],
    stdout: 'null',
    stderr: 'piped',
  }).output()
  assert(!child.success)
  let said = new TextDecoder().decode(child.stderr)
  assertMatch(said, /fatal-test/)
  assertMatch(said, /root-test/)
})
