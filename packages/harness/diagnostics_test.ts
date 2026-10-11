import { test } from '@yaks/testing'
import { assert, assertEquals, assertMatch } from '@std/assert'
import { createDiagnostics, uncaught } from './diagnostics.ts'
import { harness } from './testing.ts'

test('a defect is an exception entity, stack and cause kept, secrets redacted, and never an entry', async () => {
  let h = await harness()
  let reporter = createDiagnostics({ secrets: ['secret-key-123'] })
  let detach = reporter.attach(h.g)
  let error = new Error('savepoint failed secret-key-123', {
    cause: new Error('statement busy'),
  })
  reporter.report(error, { phase: 'projection', session: 'selected' })
  reporter.report(error, { phase: 'unhandledrejection' })
  await reporter.drain()
  let rows = await h.g.read('.exception&*')
  assertEquals(rows.length, 1)
  assert(!rows[0].entry)
  assertEquals(await h.g.read('.entry&*'), [])
  let said = JSON.parse(String((rows[0].content as { body: string }).body))
  assertMatch(said.body, /Caused by:/)
  assertMatch(said.body, /statement busy/)
  assertMatch(said.body, /diagnostics_test.ts/)
  assert(!said.body.includes('secret-key-123'))
  assertEquals(said.session, 'selected')
  detach()
  h.close()
})

test('a defect nobody can take is said on the terminal, not lost', async () => {
  let warnings: string[] = []
  let reporter = createDiagnostics({ warn: (s) => warnings.push(s) })
  reporter.report(new Error('nowhere to write this'), { phase: 'startup' })
  await reporter.drain()
  assertEquals(warnings.length, 1)
  assertMatch(JSON.parse(warnings[0]).body, /nowhere to write this/)
})

// Exercise a fixed rejected sink once; keep its original warning and attempt count.
let failedSink = await (async () => {
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
  return { warnings, attempts }
})()
test('a database failure cannot recurse: the original is printed instead', () => {
  assertEquals(failedSink.attempts, 1)
  assertEquals(failedSink.warnings.length, 1)
  assertMatch(failedSink.warnings[0], /database broken/)
  assertMatch(
    failedSink.warnings[0],
    /Original exception:[\s\S]*original failure/,
  )
})

let runtimeError = new Error('render defect')
// Formatting stacks is covered above; these cases check routing and identity.
runtimeError.stack = 'Error: render defect'
let runtimeEvent = new ErrorEvent('error', {
  error: runtimeError,
  cancelable: true,
})
let runtimeRejection = new Event('unhandledrejection', { cancelable: true })
Object.defineProperty(runtimeRejection, 'reason', { value: runtimeError })
let laterEvent = new ErrorEvent('error', { error: new Error('later') })
test('global error hooks preserve fatal default, clean up, deduplicate, and uninstall', () => {
  let reports: { error: unknown; phase: string }[] = []
  let target = new EventTarget()
  let cleaned = 0
  let remove = uncaught(
    {
      report: (error, context) => reports.push({ error, phase: context.phase }),
    },
    target,
    () => {
      cleaned++
    },
  )
  assert(target.dispatchEvent(runtimeEvent))
  assert(!runtimeEvent.defaultPrevented)
  target.dispatchEvent(runtimeRejection)
  assertEquals(cleaned, 2)
  assert(reports[0].error === runtimeError)
  assert(reports[1].error === runtimeError)
  assertEquals(reports.map((r) => r.phase), ['error', 'unhandledrejection'])
  remove()
  target.dispatchEvent(laterEvent)
  assertEquals(reports.length, 2)
})

test('diagnostics say the same runtime error once across error and rejection phases', () => {
  let said: string[] = []
  let reporter = createDiagnostics({ warn: (s) => said.push(s) })
  reporter.report(runtimeError, { phase: 'error' })
  reporter.report(runtimeError, { phase: 'unhandledrejection' })
  assertEquals(said.length, 1)
})

test('a graph shutdown drain is bounded', async () => {
  let warnings: string[] = []
  let reporter = createDiagnostics({ warn: (s) => warnings.push(s) })
  reporter.attach({ apply: () => new Promise(() => {}) })
  reporter.report(new Error('original'), { phase: 'shutdown' })
  await reporter.drain(1)
  assertMatch(warnings[0], /still pending/)
})

test('a fatal unhandled rejection really exits the subprocess, saying what it was', async () => {
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
